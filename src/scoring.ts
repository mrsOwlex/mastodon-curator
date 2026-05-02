import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import type { NormalizedMastodonStatus } from './mastodon-client.js';

export interface TopicRule {
  topic: string;
  score: number;
  patterns: RegExp[];
}

export interface NegativeRule {
  label: string;
  penalty: number;
  patterns: RegExp[];
}

export interface SignalPatterns {
  opinion: RegExp[];
  community: RegExp[];
  techContext: RegExp[];
  workLife: RegExp[];
  personal: RegExp[];
  criticalReflection: RegExp[];
  discussion: RegExp[];
}

export interface InterestProfile {
  interestProfile: string;
  topicRules: TopicRule[];
  negativeRules: NegativeRule[];
  signalPatterns: SignalPatterns;
  allowTopics: string[];
  blockTopics: string[];
}

export interface LoadedInterestProfile {
  source: string;
  profile: InterestProfile;
  warnings: string[];
}

interface RawTopicRule {
  topic?: unknown;
  score?: unknown;
  patterns?: unknown;
}

interface RawNegativeRule {
  label?: unknown;
  penalty?: unknown;
  patterns?: unknown;
}

interface RawSignalPatterns {
  opinion?: unknown;
  community?: unknown;
  'tech-context'?: unknown;
  techContext?: unknown;
  workLife?: unknown;
  personal?: unknown;
  criticalReflection?: unknown;
  discussion?: unknown;
}

interface RawInterestProfile {
  interestProfile?: unknown;
  topics?: unknown;
  negativeRules?: unknown;
  signalPatterns?: unknown;
  allowTopics?: unknown;
  blockTopics?: unknown;
}

const DEFAULT_PROFILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'interests.example.yaml');

const FALLBACK_PROFILE: RawInterestProfile = {
  interestProfile: `Core:
- AI/KI: Nutzung, Kritik, Ethik, Tools
- Leadership/Management: ehrlich, praktisch, besonders Junior-/Azubi-Kontext
- Software Engineering: TypeScript, Tooling, Developer Experience
- Trans/LGBTQ+: Community, HRT, Sichtbarkeit
- ADHD: Alltag, Coping, Ehrlichkeit

Sprachen:
- Deutsch und Englisch sind gleichwertig willkommen
- Auch gemischte Posts oder Denglisch sind okay, wenn der Inhalt passt

Starkes Interesse:
- Open Source, Indie Web, Fediverse-Kultur
- Entrepreneurship, Solo-Founder, Side Projects
- Go / Baduk / Weiqi
- Kochen, besonders asiatisch/koreanisch

Nische aber relevant:
- Neurodivergenz und Work-Life
- Automation / Workflow-Tooling
- Leipzig / lokale Tech-Community

Nicht interessant:
- Reine Tech-News ohne persoenliche Perspektive
- Crypto / Web3
- Generische Motivationsposts`,
  topics: [
    {
      topic: 'ai',
      score: 5,
      patterns: [
        '\\b(ai|ki|llm|gpt|claude|openai|anthropic|prompt engineering|machine learning|deep learning|artificial intelligence|kuenstliche intelligenz|künstliche intelligenz)\\b',
        '\\b(agentic|agents|mcp|rag|embeddings|prompting)\\b',
      ],
    },
    {
      topic: 'automation',
      score: 5,
      patterns: [
        '\\b(automation|automatisierung|workflow|workflows|zapier|n8n|make\\.com|integromat|orchestration|prozessautomation|arbeitsablauf|prozessfluss|automatisiere|automating)\\b',
        '\\b(productivity system|workflow tooling|ops automation|automationsfluss|toolchain|pipeline|scriptable|skriptbar)\\b',
      ],
    },
    {
      topic: 'software-engineering',
      score: 4,
      patterns: [
        '\\b(typescript|javascript|node\\.?js|developer experience|dx|tooling|linting|testing|refactor|api design|software engineering|softwareentwicklung|entwicklererfahrung|wartbarkeit|maintainability)\\b',
        '\\b(compiler|bundler|frontend|backend|release engineering|entwickler:innen|entwickler|deploy|deployment|devops|codebase|entwicklungsprozess)\\b',
      ],
    },
    {
      topic: 'leadership',
      score: 4,
      patterns: [
        '\\b(leadership|management|manager|mentoring|mentorship|junior developers|apprentice|azubi|career ladder|fuehrung|führung|teamleitung|nachwuchs|ausbildung)\\b',
        '\\b(team lead|people management|onboarding|feedback culture|fuehrungskraft|führungskraft|mitarbeitergespraech|mitarbeitergespräch|people lead)\\b',
      ],
    },
    {
      topic: 'lgbtq',
      score: 5,
      patterns: [
        '\\b(trans|transness|hrt|gender affirming|queer|lgbt|lgbtq|nonbinary|visibility|pride|sichtbarkeit)\\b',
        '\\b(chosen family|community care|coming out|transition|transfeindlichkeit|queerfeindlichkeit)\\b',
      ],
    },
    {
      topic: 'adhd-neurodivergence',
      score: 5,
      patterns: [
        '\\b(adhd|audhd|neurodivergent|neurodivergence|executive dysfunction|sensory overload|masking|adhs|neurodivergenz|prokrastination|dopamin)\\b',
        '\\b(coping strategy|coping strategies|brain fog|reizueberflutung|reizüberflutung|ueberforderung|überforderung|task paralysis)\\b',
      ],
    },
    {
      topic: 'fediverse-open-source',
      score: 4,
      patterns: [
        '\\b(fediverse|mastodon|activitypub|open source|foss|indie web|self-hosted|self hosted|selbstgehostet|selbst gehostet)\\b',
        '\\b(community moderation|federation|foederation|föderation|moderation)\\b',
      ],
    },
    {
      topic: 'entrepreneurship',
      score: 3,
      patterns: [
        '\\b(solo founder|indie hacker|bootstrapped|bootstrapping|side project|micro-saas|micro saas|entrepreneurship|selbststaendig|selbständig|nebenerwerb)\\b',
        '\\b(founder journey|sustainable business|gruendung|gründung|kleines produkt)\\b',
      ],
    },
    {
      topic: 'go-baduk',
      score: 3,
      patterns: [
        '\\b(baduk|weiqi|\\bgo board\\b|\\bgo club\\b)\\b',
      ],
    },
    {
      topic: 'cooking',
      score: 2,
      patterns: [
        '\\b(korean cooking|asian cooking|kimchi|gochujang|ramen|dumplings|home cooking|recipe experiment)\\b',
      ],
    },
    {
      topic: 'leipzig-tech',
      score: 3,
      patterns: [
        '\\b(leipzig|saxony|sachsen)\\b',
        '\\b(meetup|hackspace|ccc|tech community)\\b',
      ],
    },
  ],
  negativeRules: [
    {
      label: 'crypto-web3',
      penalty: -9,
      patterns: ['\\b(crypto|web3|nft|airdrop|token launch|blockchain|maxi)\\b'],
    },
    {
      label: 'generic-motivation',
      penalty: -7,
      patterns: [
        '\\b(grindset|rise and grind|just keep going|you got this|never give up|motivation monday|hustle harder)\\b',
        '\\b(success mindset|abundance mindset)\\b',
      ],
    },
    {
      label: 'recruiting-spam',
      penalty: -6,
      patterns: [
        '\\b(hiring now|we are hiring|dm me for opportunities|drop your resume|job opening)\\b',
        '\\b(recruiter|talent pipeline)\\b',
      ],
    },
    {
      label: 'aggregated-news',
      penalty: -8,
      patterns: [
        '\\b(daily briefing|breaking news|latest science news|posted into|top stories|news roundup)\\b',
        '\\b(via flipboard|newsletter issue|headline roundup)\\b',
      ],
    },
  ],
  signalPatterns: {
    opinion: [
      '\\b(i think|i feel|i learned|i keep noticing|my take|in my experience|for me|i wish|lived experience|my experience|ich denke|ich finde|ich habe gelernt|meiner erfahrung nach|aus eigener erfahrung|fuer mich|für mich)\\b',
      '\\b(we need to|i am tired of|i am glad|i am worried|wir muessen|wir müssen|ich bin muede von|ich bin müde von|ich freue mich|ich mache mir sorgen)\\b',
    ],
    community: [
      '\\b(community|mutual aid|care work|peer support|belonging|solidarity|collective|gemeinschaft|solidaritaet|solidarität)\\b',
      '\\b(conversation|discussion|reflection|experience report|austausch|diskussion|reflexion|erfahrungsbericht|nachdenken|debate)\\b',
    ],
    techContext: [
      '\\b(code|coding|software|developer|engineering|maintainer|pull request|api|platform|product|tool|tooling|repo|architektur|architecture)\\b',
      '\\b(team|manager|startup|founder|shipping|deployed|open source|self-hosted|self hosted|release|betrieb)\\b',
    ],
    workLife: [
      '\\b(burnout|burned out|rest|balance|work life|work-life|fatigue|overwhelm|cope|coping|arbeitsalltag|ueberforderung|überforderung)\\b',
      '\\b(accessibility|accommodations|psychological safety|boundaries|barrierefreiheit|grenzen setzen)\\b',
    ],
    personal: [
      '\\b(i|ich)\\b',
      '\\b(my|mein|meine|meiner|meinem)\\b',
      '\\b(personally|for me|for us|our experience|in practice|lately|recently|persoenlich|persönlich|in der praxis|kuerzlich|kürzlich|wir haben|wir lernen|we built|we learned)\\b',
    ],
    criticalReflection: [
      '\\b(why are we|what if we|i am skeptical|i\\'m skeptical|this keeps happening|i don\\'t buy|i dont buy|warum tun wir|ich bin skeptisch|das passiert staendig|das passiert ständig)\\b',
      '\\b(critique|criticism|frustrating|messy|complicated|nuanced|tradeoff|trade-off|kritik|frustrierend|kompliziert|nuanciert|abwaegung|abwägung)\\b',
    ],
    discussion: [
      '\\b(anyone else|curious how others|what do you all think|would love to hear|who else has seen)\\b',
      '\\b(wie seht ihr das|kennt das noch wer|was denkt ihr|wer hat aehnliche erfahrungen|wer hat ähnliche erfahrungen)\\b',
    ],
  },
};

export function loadInterestProfile(configPath?: string): LoadedInterestProfile {
  const sourcePath = configPath ? resolve(configPath) : DEFAULT_PROFILE_PATH;

  let rawProfile: RawInterestProfile = FALLBACK_PROFILE;
  const warnings: string[] = [];
  if (existsSync(sourcePath)) {
    const fileContents = readFileSync(sourcePath, 'utf-8');
    const parsed = parseYaml(fileContents) as RawInterestProfile | null;
    if (parsed && isObject(parsed)) {
      rawProfile = mergeProfile(FALLBACK_PROFILE, parsed);
    }
  } else if (configPath) {
    throw new Error(`Interest profile not found: ${sourcePath}`);
  }

  const profile = {
    interestProfile: asString(rawProfile.interestProfile, FALLBACK_PROFILE.interestProfile as string),
    topicRules: parseTopicRules(rawProfile.topics, warnings),
    negativeRules: parseNegativeRules(rawProfile.negativeRules, warnings),
    signalPatterns: parseSignalPatterns(rawProfile.signalPatterns, warnings),
    allowTopics: normalizeTopicList(rawProfile.allowTopics),
    blockTopics: normalizeTopicList(rawProfile.blockTopics),
  };

  return {
    source: sourcePath,
    profile,
    warnings,
  };
}

export function evaluateRules(
  status: NormalizedMastodonStatus,
  profile: InterestProfile,
): {
  score: number;
  matchedTopics: string[];
  positives: string[];
  negatives: string[];
} {
  const haystack = `${status.textForRanking}\n${status.account.displayName}\n${status.account.acct}`;
  let score = 0;
  const matchedTopics: string[] = [];
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const rule of profile.topicRules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      score += rule.score;
      matchedTopics.push(rule.topic);
      positives.push(rule.topic);
    }
  }

  for (const topic of profile.allowTopics) {
    if (haystack.toLowerCase().includes(topic.replace(/-/g, ' '))) {
      score += 1;
      if (!matchedTopics.includes(topic)) {
        matchedTopics.push(topic);
      }
    }
  }

  for (const rule of profile.negativeRules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      score += rule.penalty;
      negatives.push(rule.label);
    }
  }

  for (const topic of profile.blockTopics) {
    if (haystack.toLowerCase().includes(topic.replace(/-/g, ' '))) {
      score -= 4;
      negatives.push(topic);
    }
  }

  if (profile.signalPatterns.opinion.some((pattern) => pattern.test(haystack))) {
    score += 2;
    positives.push('opinion');
  }

  if (profile.signalPatterns.community.some((pattern) => pattern.test(haystack))) {
    score += 2;
    positives.push('community');
  }

  if (profile.signalPatterns.workLife.some((pattern) => pattern.test(haystack))) {
    score += 2;
    positives.push('work-life');
  }

  if (profile.signalPatterns.criticalReflection.some((pattern) => pattern.test(haystack))) {
    score += 2;
    positives.push('critical-reflection');
  }

  if (profile.signalPatterns.discussion.some((pattern) => pattern.test(haystack))) {
    score += 1;
    positives.push('discussion');
  }

  const wordCount = status.textForRanking.split(/\s+/).filter(Boolean).length;
  const hasPersonalVoice = profile.signalPatterns.personal.some((pattern) => pattern.test(haystack));
  const hasTechContext = profile.signalPatterns.techContext.some((pattern) => pattern.test(haystack));
  const accountHaystack = `${status.account.displayName}\n${status.account.acct}`;
  const looksLikeNewsAccount = /\b(news|feed|bot|updates|briefing|magazine|daily|zeitung|presse|ticker)\b/i.test(accountHaystack);

  if (hasPersonalVoice && wordCount >= 18) {
    score += 1;
    positives.push('personal-voice');
  }

  if (hasTechContext) {
    score += 1;
    positives.push('tech-context');
  }

  if (hasTechContext && (
    positives.includes('opinion')
    || positives.includes('community')
    || positives.includes('critical-reflection')
  )) {
    score += 2;
    positives.push('strong-context-fit');
  }

  if (wordCount >= 35 && wordCount <= 220) {
    score += 1;
    positives.push('substance');
  }

  if (status.urlCount > 0 && wordCount < 35 && !positives.includes('opinion')) {
    score -= 3;
    negatives.push('headline-only');
  }

  if (looksLikeNewsAccount && !hasPersonalVoice) {
    score -= 6;
    negatives.push('news-account');
  }

  if (
    status.urlCount > 0
    && !hasPersonalVoice
    && !positives.includes('community')
    && !positives.includes('critical-reflection')
    && !positives.includes('discussion')
  ) {
    score -= 4;
    negatives.push('linkdump-without-commentary');
  }

  return {
    score,
    matchedTopics,
    positives,
    negatives,
  };
}

function parseTopicRules(
  value: unknown,
  warnings: string[],
): TopicRule[] {
  const values = asArray(value);
  if (values.length === 0) {
    return [];
  }

  return values
    .map((entry) => parseTopicRule(entry, warnings))
    .filter((entry): entry is TopicRule => entry !== null);
}

function parseNegativeRules(
  value: unknown,
  warnings: string[],
): NegativeRule[] {
  const values = asArray(value);
  if (values.length === 0) {
    return [];
  }

  return values
    .map((entry) => parseNegativeRule(entry, warnings))
    .filter((entry): entry is NegativeRule => entry !== null);
}

function parseSignalPatterns(
  value: unknown,
  warnings: string[],
): SignalPatterns {
  const raw = isObject(value) ? value as RawSignalPatterns : {};
  const opinion = parsePatternList(raw.opinion, warnings, 'signalPatterns.opinion');
  const community = parsePatternList(raw.community, warnings, 'signalPatterns.community');
  const techContext = parsePatternList(resolveTechContextPatterns(raw), warnings, 'signalPatterns.tech-context');
  const workLife = parsePatternList(raw.workLife, warnings, 'signalPatterns.work-life');
  const personal = parsePatternList(raw.personal, warnings, 'signalPatterns.personal');
  const criticalReflection = parsePatternList(raw.criticalReflection, warnings, 'signalPatterns.critical-reflection');
  const discussion = parsePatternList(raw.discussion, warnings, 'signalPatterns.discussion');

  return {
    opinion: opinion,
    community: community,
    techContext,
    workLife: workLife,
    personal: personal,
    criticalReflection: criticalReflection,
    discussion: discussion,
  };
}

function parseTopicRule(value: unknown, warnings: string[]): TopicRule | null {
  if (!isObject(value)) {
    return null;
  }

  const topic = asString(value.topic, '');
  const score = Number.isFinite(Number(value.score)) ? Math.floor(Number(value.score)) : 0;
  const patterns = parsePatternList(value.patterns, warnings, `topics.${topic || 'unknown'}.patterns`);

  if (!topic || score === 0 || patterns.length === 0) {
    return null;
  }

  return {
    topic: topic.trim(),
    score,
    patterns,
  };
}

function parseNegativeRule(value: unknown, warnings: string[]): NegativeRule | null {
  if (!isObject(value)) {
    return null;
  }

  const label = asString(value.label, '');
  const scoreValue = Number(value.penalty);
  const penalty = Number.isFinite(scoreValue) ? Math.floor(scoreValue) : 0;
  const patterns = parsePatternList(value.patterns, warnings, `negativeRules.${label || 'unknown'}.patterns`);

  if (!label || !Number.isFinite(scoreValue) || patterns.length === 0) {
    return null;
  }

  return {
    label: label.trim(),
    penalty,
    patterns,
  };
}

function parsePatternList(
  raw: unknown,
  warnings: string[],
  fieldName: string,
): RegExp[] {
  const entries = asArray(raw);
  if (entries.length === 0) {
    return [];
  }

  const regexes: RegExp[] = [];
  for (const entry of entries) {
    const pattern = asString(entry, '');
    if (!pattern) {
      continue;
    }
    try {
      regexes.push(new RegExp(pattern, 'i'));
    } catch {
      warnings.push(`Invalid regex in ${fieldName}: ${pattern}`);
    }
  }
  return regexes;
}

function normalizeTopicList(value: unknown): string[] {
  return asArray(value).map((item) => asString(item, '').toLowerCase().trim()).filter(Boolean);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function resolveTechContextPatterns(raw: RawSignalPatterns): unknown {
  return raw['tech-context'] ?? raw.techContext ?? [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeProfile(base: RawInterestProfile, override: RawInterestProfile): RawInterestProfile {
  return {
    interestProfile: override.interestProfile ?? base.interestProfile,
    topics: override.topics ?? base.topics,
    negativeRules: override.negativeRules ?? base.negativeRules,
    signalPatterns: {
      ...(isObject(base.signalPatterns as unknown) ? (base.signalPatterns as RawSignalPatterns) : {}),
      ...(isObject(override.signalPatterns as unknown) ? (override.signalPatterns as RawSignalPatterns) : {}),
    },
    allowTopics: override.allowTopics ?? base.allowTopics,
    blockTopics: override.blockTopics ?? base.blockTopics,
  };
}
