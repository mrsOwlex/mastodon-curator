import { generate } from './llm.js';
import { formatDateInTimezone, formatNowInTimezone, resolveUserTimezone } from './time.js';
import {
  buildHandledSet,
  buildStatusKey,
  loadMastodonCuratorState,
  recordHandledStatuses,
  saveMastodonCuratorState,
} from './state.js';
import {
  fetchPublicTimelinePage,
  favouriteStatus,
  type NormalizedMastodonStatus,
} from './mastodon-client.js';
import { MASTODON_CURATOR_SYSTEM_PROMPT } from './prompt.js';
import {
  evaluateRules,
  type InterestProfile,
} from './scoring.js';
import type { MastodonDigestMetadata, MastodonDigestPostMetadata, AgentRunOutput } from './types.js';

const BIO_OPT_OUT_TAG_PATTERN = /(^|[^\p{L}\p{N}_])#(?:nobot|noai|nosearch)(?![\p{L}\p{N}_-])/iu;

const PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: {
      effort: 'high',
    },
  },
};

interface RankingDecision {
  keep: boolean;
  score: number;
  topic: string;
  reason: string;
}

interface CuratorConfig {
  instanceUrl: string;
  accessToken: string;
  userAgent: string;
  targetCount: number;
  maxPostAgeHours: number;
  maxFavourites: number;
  maxPages: number;
  maxLookbackHours: number;
  enableFavourites: boolean;
  timezone: string;
  stateFile: string;
  model: string;
  profile: InterestProfile;
  profileSource: string;
  profileWarnings: string[];
  dryRun?: boolean;
}

export interface CuratorRunOutput extends AgentRunOutput {
  metadata: MastodonDigestMetadata & CuratorRunMetadata;
}

interface CuratorRunMetadata {
  filteredOut: number;
  hardFilterStats: Record<string, number>;
  ruleRejected: number;
  profileSource: string;
  profileWarnings: string[];
  favouriteFailures: string[];
}

interface CuratorCandidate {
  promptId: string;
  key: string;
  status: NormalizedMastodonStatus;
  ageHours: number;
  ruleScore: number;
  matchedTopics: string[];
  positives: string[];
  negatives: string[];
}

export async function runCurator(config: CuratorConfig): Promise<CuratorRunOutput> {
  const timezone = resolveUserTimezone(config.timezone);
  const now = new Date();
  const nowIso = now.toISOString();
  const dayKey = formatDateInTimezone(now, timezone);
  const sourceUrl = `${config.instanceUrl.replace(/\/+$/, '')}/public`;
  const hardFilterStats: Record<string, number> = {};
  const warnings: string[] = [...config.profileWarnings];
  let ruleRejected = 0;

  const state = loadMastodonCuratorState(config.stateFile);
  const seenKeys = new Set<string>(buildHandledSet(state));
  const candidates: CuratorCandidate[] = [];
  let pageCount = 0;
  let fetchedStatuses = 0;
  let filteredOut = 0;
  let nextMaxId: string | undefined;
  let hitLookbackLimit = false;

  while (pageCount < config.maxPages) {
    const page = await fetchPublicTimelinePage({
      instanceUrl: config.instanceUrl,
      accessToken: config.accessToken,
      userAgent: config.userAgent,
      maxId: nextMaxId,
      limit: 40,
    });

    pageCount += 1;
    if (page.statuses.length === 0) {
      break;
    }

    for (const status of page.statuses) {
      fetchedStatuses += 1;
      const ageHours = (now.getTime() - Date.parse(status.createdAt)) / 3600_000;
      if (ageHours > config.maxLookbackHours) {
        hitLookbackLimit = true;
        break;
      }

      const skipReason = getHardFilterReason(status, ageHours, config, seenKeys);
      if (skipReason) {
        filteredOut += 1;
        hardFilterStats[skipReason] = (hardFilterStats[skipReason] ?? 0) + 1;
        continue;
      }

      const ruleEvaluation = evaluateRules(status, config.profile);
      if (ruleEvaluation.score <= 0) {
        filteredOut += 1;
        ruleRejected += 1;
        continue;
      }

      const key = buildStatusKey(status);
      seenKeys.add(key);
      candidates.push({
        promptId: `C${candidates.length + 1}`,
        key,
        status,
        ageHours,
        ruleScore: ruleEvaluation.score,
        matchedTopics: ruleEvaluation.matchedTopics,
        positives: ruleEvaluation.positives,
        negatives: ruleEvaluation.negatives,
      });
    }

    if (hitLookbackLimit || !page.nextMaxId) {
      break;
    }

    nextMaxId = page.nextMaxId;
  }

  const candidatesForRanking = [...candidates]
    .sort(compareByRuleScore)
    .slice(0, 40)
    .map((candidate, index) => ({
      ...candidate,
      promptId: `C${index + 1}`,
    }));

  if (candidatesForRanking.length === 0) {
    const digest = [
      '# Mastodon Digest',
      '',
      `Keine passenden Posts auf ${config.instanceUrl} gefunden.`,
      '',
      `Geprueft am ${formatNowInTimezone(now, timezone)}.`,
      `Fenster: bis ${config.maxPostAgeHours}h alt, max. ${config.maxFavourites} Favoriten.`,
      `Seiten: ${pageCount}, Statuses: ${fetchedStatuses}, herausgefiltert: ${filteredOut}.`,
      formatHardFilterSummary(hardFilterStats),
    ].join('\n');

    return {
      success: true,
      result: digest,
      model: config.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: undefined,
      metadata: {
        ...buildDigestMetadata({
          dayKey,
          sourceUrl,
          warnings,
          pagesFetched: pageCount,
          fetchedStatuses,
          rankedCandidates: 0,
          lookbackHours: config.maxLookbackHours,
          selected: [],
        }),
        filteredOut,
        hardFilterStats,
        ruleRejected,
        profileSource: config.profileSource,
        profileWarnings: warnings,
        favouriteFailures: [],
      },
    };
  }

  const rankingResult = await generate({
    model: config.model,
    system: MASTODON_CURATOR_SYSTEM_PROMPT,
    prompt: buildRankingPrompt(candidatesForRanking, config.profile, config, timezone, now),
    temperature: 0.1,
    providerOptions: PROVIDER_OPTIONS,
  });

  const rankingDecisions = parseRankingDecisions(rankingResult.text);
  const llmSelected = candidatesForRanking
    .map((candidate) => ({
      candidate,
      decision: rankingDecisions.get(candidate.promptId) ?? fallbackDecision(candidate),
    }))
    .filter((entry) => entry.decision.keep && passesSelectionGuard(entry.candidate))
    .sort((left, right) => {
      return right.decision.score - left.decision.score
        || left.candidate.status.favouritesCount - right.candidate.status.favouritesCount
        || Date.parse(right.candidate.status.createdAt) - Date.parse(left.candidate.status.createdAt);
    })
    .slice(0, config.targetCount);

  const selectedKeys = new Set(llmSelected.map((entry) => entry.candidate.key));
  const selected = [...llmSelected];

  if (selected.length < Math.min(3, config.targetCount)) {
    const supplemental = candidatesForRanking
      .filter((candidate) => !selectedKeys.has(candidate.key))
      .map((candidate) => ({
        candidate,
        decision: fallbackDecision(candidate),
      }))
      .filter((entry) => entry.decision.keep)
      .sort((left, right) => {
        return right.decision.score - left.decision.score
          || left.candidate.status.favouritesCount - right.candidate.status.favouritesCount
          || Date.parse(right.candidate.status.createdAt) - Date.parse(left.candidate.status.createdAt);
      })
      .slice(0, config.targetCount - selected.length);

    if (supplemental.length > 0) {
      selected.push(...supplemental);
      warnings.push(`LLM war zu streng; ${supplemental.length} regelbasierte Fallback-Picks ergaenzt.`);
    }
  }

  if (selected.length < config.targetCount) {
    warnings.push(`Nur ${selected.length} passende Posts gefunden (Ziel: ${config.targetCount}) innerhalb von ${pageCount} Seiten / ${config.maxLookbackHours}h Lookback.`);
  }

  const favouriteFailures: string[] = [];
  const shouldFavourite = config.enableFavourites && !config.dryRun;
  if (shouldFavourite) {
    for (const entry of selected) {
      try {
        entry.candidate.status = await favouriteStatus({
          instanceUrl: config.instanceUrl,
          accessToken: config.accessToken,
          statusId: entry.candidate.status.id,
          userAgent: config.userAgent,
        });
      } catch (error) {
        favouriteFailures.push(`${entry.candidate.status.account.acct}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    warnings.push('Dry-Run: Favorisieren ist deaktiviert (`enableFavourites=false`).');
  }

  if (favouriteFailures.length > 0) {
    warnings.push(`Favorisieren fehlgeschlagen fuer ${favouriteFailures.length} Posts.`);
  }

  const digest = renderDigest({
    now,
    timezone,
    instanceUrl: config.instanceUrl,
    selected,
    warnings,
    favouriteFailures,
    pagesFetched: pageCount,
    fetchedStatuses,
    filteredOut,
    rankedCandidates: candidatesForRanking.length,
    lookbackHours: config.maxLookbackHours,
    hardFilterStats,
    ruleRejected,
  });

  saveMastodonCuratorState(
    config.stateFile,
    recordHandledStatuses(
      state,
      selected.map((entry) => entry.candidate.status),
      nowIso,
    ),
  );

  return {
    success: true,
    result: digest,
    model: config.model,
    promptTokens: rankingResult.usage.promptTokens,
    completionTokens: rankingResult.usage.completionTokens,
    costUsd: rankingResult.usage.costUsd ?? undefined,
    metadata: {
      ...buildDigestMetadata({
        dayKey,
        sourceUrl,
        warnings,
        pagesFetched: pageCount,
        fetchedStatuses,
        rankedCandidates: candidatesForRanking.length,
        lookbackHours: config.maxLookbackHours,
        selected,
      }),
      filteredOut,
      hardFilterStats,
      ruleRejected,
      profileSource: config.profileSource,
      profileWarnings: warnings,
      favouriteFailures,
    },
  };
}

function compareByRuleScore(left: CuratorCandidate, right: CuratorCandidate): number {
  return right.ruleScore - left.ruleScore
    || left.status.favouritesCount - right.status.favouritesCount
    || Date.parse(right.status.createdAt) - Date.parse(left.status.createdAt);
}

function getHardFilterReason(
  status: NormalizedMastodonStatus,
  ageHours: number,
  config: Pick<CuratorConfig, 'maxPostAgeHours' | 'maxFavourites'>,
  seenKeys: Set<string>,
): string | null {
  if (status.reblog) return 'reblog';
  if (looksLikeRepostBridge(status)) return 'repost-bridge';
  if (status.inReplyToId) return 'reply';
  if (hasBioOptOutTag(status)) return 'bio-opt-out';
  if (status.visibility !== 'public') return 'visibility';
  if (status.favourited) return 'already-favourited';
  if (ageHours > config.maxPostAgeHours) return 'too-old';
  if (status.favouritesCount >= config.maxFavourites) return 'too-many-favourites';
  if (seenKeys.has(buildStatusKey(status))) return 'duplicate';
  if (!status.textForRanking.trim()) return 'empty';
  return null;
}

function hasBioOptOutTag(status: NormalizedMastodonStatus): boolean {
  return BIO_OPT_OUT_TAG_PATTERN.test(status.account.note);
}

function buildRankingPrompt(
  candidates: CuratorCandidate[],
  profile: InterestProfile,
  config: CuratorConfig,
  timezone: string,
  now: Date,
): string {
  const payload = candidates.map((candidate) => ({
    id: candidate.promptId,
    author: candidate.status.account.displayName || candidate.status.account.acct,
    acct: candidate.status.account.acct,
    createdAt: candidate.status.createdAt,
    ageHours: Number(candidate.ageHours.toFixed(1)),
    favouritesCount: candidate.status.favouritesCount,
    link: candidate.status.url,
    ruleScore: candidate.ruleScore,
    matchedTopics: candidate.matchedTopics,
    positives: candidate.positives,
    negatives: candidate.negatives,
    text: truncate(candidate.status.textForRanking, 900),
  }));

  return [
    `Alexandras Interessenprofil:\n${profile.interestProfile}`,
    '',
    `Explizit erwuenschte Topics: ${profile.allowTopics.join(', ') || '(keine)'}`,
    `Explizit zu vermeiden: ${profile.blockTopics.join(', ') || '(keine)'}`,
    `Aktuelle lokale Zeit: ${formatNowInTimezone(now, timezone)}`,
    `Quelle: ${config.instanceUrl.replace(/\/+$/, '')}/public`,
    '',
    'Bewerte diese Mastodon-Posts. Die Posts koennen auf Deutsch oder Englisch sein; bewerte semantisch, nicht nach Sprache.',
    'keep=true nur bei echtem, persoenlichem Fit.',
    JSON.stringify({ items: payload }, null, 2),
  ].join('\n');
}

function parseRankingDecisions(rawText: string): Map<string, RankingDecision> {
  const parsed = tryParseJson(rawText);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const decisions = new Map<string, RankingDecision>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as {
      id?: unknown;
      keep?: unknown;
      score?: unknown;
      topic?: unknown;
      reason?: unknown;
    };
    const id = typeof typed.id === 'string' ? typed.id : null;
    if (!id) continue;

    const keep = Boolean(typed.keep);
    const score = clampNumber(
      typeof typed.score === 'number'
        ? typed.score
        : 0,
      0,
      0,
      100,
    );
    const topic = typeof typed.topic === 'string'
      ? truncate(typed.topic.trim(), 80)
      : 'unspecified';
    const reason = typeof typed.reason === 'string'
      ? truncate(typed.reason.trim(), 280)
      : 'Keine Begruendung geliefert.';

    decisions.set(id, { keep, score, topic, reason });
  }

  return decisions;
}

function tryParseJson(rawText: string): { items?: unknown[] } | null {
  const trimmed = rawText.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { items?: unknown[] };
    } catch {
      // Try next representation.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as { items?: unknown[] };
    } catch {
      return null;
    }
  }

  return null;
}

function fallbackDecision(candidate: CuratorCandidate): RankingDecision {
  const hasCriticalNegative = candidate.negatives.some((negative) =>
    negative === 'crypto-web3'
    || negative === 'generic-motivation'
    || negative === 'recruiting-spam'
    || negative === 'aggregated-news'
    || negative === 'news-account'
    || negative === 'linkdump-without-commentary',
  );
  const hasStrongPositive = candidate.positives.some((positive) =>
    positive === 'opinion'
    || positive === 'community'
    || positive === 'critical-reflection'
    || positive === 'strong-context-fit',
  );

  return {
    keep: !hasCriticalNegative
      && passesSelectionGuard(candidate)
      && (candidate.ruleScore >= 4 || (candidate.ruleScore >= 2 && hasStrongPositive)),
    score: Math.max(1, Math.min(100, candidate.ruleScore * 10)),
    topic: candidate.matchedTopics[0] ?? 'general-fit',
    reason: candidate.positives.length > 0
      ? `Regelbasiert relevant wegen ${candidate.positives.join(', ')}.`
      : 'Regelbasiert relevanter Kandidat ohne LLM-Entscheidung.',
  };
}

function passesSelectionGuard(candidate: CuratorCandidate): boolean {
  const hasMatchedTopic = candidate.matchedTopics.length > 0;
  const hasPerspectiveAnchor = candidate.positives.includes('opinion')
    || candidate.positives.includes('personal-voice')
    || candidate.positives.includes('community')
    || candidate.positives.includes('critical-reflection')
    || candidate.positives.includes('work-life')
    || candidate.positives.includes('discussion');
  const hasTechAnchor = candidate.positives.includes('tech-context') || candidate.positives.includes('strong-context-fit');

  if (hasMatchedTopic && (hasTechAnchor || hasPerspectiveAnchor)) {
    return true;
  }

  return !hasMatchedTopic && hasTechAnchor && hasPerspectiveAnchor;
}

function looksLikeRepostBridge(status: NormalizedMastodonStatus): boolean {
  const acct = status.account.acct.toLowerCase();
  const url = status.url.toLowerCase();
  const text = status.textForRanking.toLowerCase();

  if (
    acct.includes('@web.brid.gy')
    || acct.includes('@ap.brid.gy')
    || acct.includes('@bsky.brid.gy')
    || acct.includes('@flipboard.com')
    || url.includes('fed.brid.gy/')
    || url.includes('flipboard.com/')
  ) {
    return true;
  }

  return /\b(reposted from|shared from|via flipboard|posted into)\b/i.test(text);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function renderDigest(input: {
  now: Date;
  timezone: string;
  instanceUrl: string;
  selected: Array<{ candidate: CuratorCandidate; decision: RankingDecision }>;
  warnings: string[];
  favouriteFailures: string[];
  pagesFetched: number;
  fetchedStatuses: number;
  filteredOut: number;
  rankedCandidates: number;
  lookbackHours: number;
  hardFilterStats: Record<string, number>;
  ruleRejected: number;
}): string {
  const lines: string[] = [
    `# Mastodon Digest ${formatDateInTimezone(input.now, input.timezone)}`,
    '',
    `Quelle: ${input.instanceUrl.replace(/\/+$/, '')}/public`,
    `Ausgefuehrt: ${formatNowInTimezone(input.now, input.timezone)}`,
    `Auswahl: ${input.selected.length} Post(s) aus ${input.rankedCandidates} gerankten Kandidaten`,
    `Suchraum: ${input.pagesFetched} Seiten, ${input.fetchedStatuses} Statuses, ${input.lookbackHours}h Lookback`,
    '',
  ];

  if (input.warnings.length > 0) {
    lines.push('## Hinweise', '');
    for (const warning of input.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (input.selected.length === 0) {
    lines.push('Keine Posts konnten nach dem LLM-Ranking ueberzeugend behalten werden.');
    return lines.join('\n');
  }

  lines.push('## Kuratierte Posts', '');
  input.selected.forEach((entry, index) => {
    const title = entry.decision.topic !== 'unspecified' ? entry.decision.topic : 'Relevanter Post';
    lines.push(`### ${index + 1}. ${title} - ${entry.candidate.status.account.displayName || entry.candidate.status.account.acct}`);
    lines.push(`- Account: @${entry.candidate.status.account.acct}`);
    lines.push(`- Erstellt: ${entry.candidate.status.createdAt}`);
    lines.push(`- Favoriten bei Auswahl: ${entry.candidate.status.favouritesCount}`);
    lines.push(`- Rule Score: ${entry.candidate.ruleScore} | LLM Score: ${entry.decision.score}`);
    lines.push(`- Themen: ${entry.candidate.matchedTopics.join(', ') || 'keine expliziten'}`);
    lines.push(`- Link: ${entry.candidate.status.url}`);
    lines.push(`- Warum relevant: ${entry.decision.reason}`);
    lines.push('');
    lines.push(`> ${truncate(entry.candidate.status.textForRanking.replace(/\n+/g, ' / '), 450)}`);
    lines.push('');
  });

  lines.push('## Suchstatistik', '');
  lines.push(`- Herausgefiltert vor Ranking: ${input.filteredOut}`);
  lines.push(`- Regelbasiert verworfen: ${input.ruleRejected}`);
  lines.push(`- Favorisieren fehlgeschlagen: ${input.favouriteFailures.length}`);

  const hardFilterEntries = Object.entries(input.hardFilterStats).sort((a, b) => b[1] - a[1]);
  if (hardFilterEntries.length > 0) {
    lines.push('- Haeufigste Hard-Filter:');
    for (const [reason, count] of hardFilterEntries.slice(0, 6)) {
      lines.push(`  - ${reason}: ${count}`);
    }
  }

  return lines.join('\n');
}

function buildDigestMetadata(input: {
  dayKey: string;
  sourceUrl: string;
  warnings: string[];
  pagesFetched: number;
  fetchedStatuses: number;
  rankedCandidates: number;
  lookbackHours: number;
  selected: Array<{ candidate: CuratorCandidate; decision: RankingDecision }>;
}): MastodonDigestMetadata {
  return {
    digestType: 'mastodon-curation',
    runDayKey: input.dayKey,
    sourceUrl: input.sourceUrl,
    warnings: [...input.warnings],
    pagesFetched: input.pagesFetched,
    fetchedStatuses: input.fetchedStatuses,
    rankedCandidates: input.rankedCandidates,
    selectedCount: input.selected.length,
    lookbackHours: input.lookbackHours,
    posts: input.selected.map((entry) => buildDigestPostMetadata(entry)),
  };
}

function buildDigestPostMetadata(entry: {
  candidate: CuratorCandidate;
  decision: RankingDecision;
}): MastodonDigestPostMetadata {
  return {
    statusId: entry.candidate.status.id,
    statusUrl: entry.candidate.status.url,
    accountAcct: entry.candidate.status.account.acct,
    accountDisplayName: entry.candidate.status.account.displayName,
    createdAt: entry.candidate.status.createdAt,
    favouritesCount: entry.candidate.status.favouritesCount,
    favourited: entry.candidate.status.favourited,
    ruleScore: entry.candidate.ruleScore,
    llmScore: entry.decision.score,
    topics: [...entry.candidate.matchedTopics],
    reason: entry.decision.reason,
    selectionTopic: entry.decision.topic,
    plainTextFull: entry.candidate.status.plainText,
    spoilerText: entry.candidate.status.spoilerText,
    tags: [...entry.candidate.status.tags],
  };
}

function formatHardFilterSummary(hardFilterStats: Record<string, number>): string {
  const summary = Object.entries(hardFilterStats)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ');

  return summary ? `Top-Filtergruende: ${summary}.` : 'Top-Filtergruende: keine.';
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
