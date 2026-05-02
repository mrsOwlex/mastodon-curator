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

export function loadInterestProfile(configPath?: string): LoadedInterestProfile {
  const sourcePath = configPath ? resolve(configPath) : DEFAULT_PROFILE_PATH;
  if (!existsSync(sourcePath)) {
    throw new Error(
      `Interest profile not found: ${sourcePath}. Pass --config ./interests.yaml or keep interests.example.yaml next to the package.`,
    );
  }

  const fileContents = readFileSync(sourcePath, 'utf-8');
  const parsed = parseYaml(fileContents) as RawInterestProfile | null;
  if (!parsed || !isObject(parsed)) {
    throw new Error(`Interest profile is empty or invalid YAML: ${sourcePath}`);
  }

  const warnings: string[] = [];
  const profile = {
    interestProfile: asString(parsed.interestProfile, '').trim(),
    topicRules: parseTopicRules(parsed.topics, warnings),
    negativeRules: parseNegativeRules(parsed.negativeRules, warnings),
    signalPatterns: parseSignalPatterns(parsed.signalPatterns, warnings),
    allowTopics: normalizeTopicList(parsed.allowTopics),
    blockTopics: normalizeTopicList(parsed.blockTopics),
  };

  if (!profile.interestProfile) {
    throw new Error(`Interest profile is missing required field "interestProfile": ${sourcePath}`);
  }
  if (profile.topicRules.length === 0) {
    throw new Error(`Interest profile must define at least one topic rule: ${sourcePath}`);
  }

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

function parseTopicRules(value: unknown, warnings: string[]): TopicRule[] {
  return asArray(value)
    .map((entry) => parseTopicRule(entry, warnings))
    .filter((entry): entry is TopicRule => entry !== null);
}

function parseNegativeRules(value: unknown, warnings: string[]): NegativeRule[] {
  return asArray(value)
    .map((entry) => parseNegativeRule(entry, warnings))
    .filter((entry): entry is NegativeRule => entry !== null);
}

function parseSignalPatterns(value: unknown, warnings: string[]): SignalPatterns {
  const raw = isObject(value) ? value as RawSignalPatterns : {};
  return {
    opinion: parsePatternList(raw.opinion, warnings, 'signalPatterns.opinion'),
    community: parsePatternList(raw.community, warnings, 'signalPatterns.community'),
    techContext: parsePatternList(resolveTechContextPatterns(raw), warnings, 'signalPatterns.tech-context'),
    workLife: parsePatternList(raw.workLife, warnings, 'signalPatterns.work-life'),
    personal: parsePatternList(raw.personal, warnings, 'signalPatterns.personal'),
    criticalReflection: parsePatternList(raw.criticalReflection, warnings, 'signalPatterns.critical-reflection'),
    discussion: parsePatternList(raw.discussion, warnings, 'signalPatterns.discussion'),
  };
}

function parseTopicRule(value: unknown, warnings: string[]): TopicRule | null {
  if (!isObject(value)) {
    return null;
  }

  const topic = asString(value.topic, '').trim();
  const score = Number.isFinite(Number(value.score)) ? Math.floor(Number(value.score)) : 0;
  const patterns = parsePatternList(value.patterns, warnings, `topics.${topic || 'unknown'}.patterns`);

  if (!topic || score === 0 || patterns.length === 0) {
    return null;
  }

  return { topic, score, patterns };
}

function parseNegativeRule(value: unknown, warnings: string[]): NegativeRule | null {
  if (!isObject(value)) {
    return null;
  }

  const label = asString(value.label, '').trim();
  const scoreValue = Number(value.penalty);
  const penalty = Number.isFinite(scoreValue) ? Math.floor(scoreValue) : 0;
  const patterns = parsePatternList(value.patterns, warnings, `negativeRules.${label || 'unknown'}.patterns`);

  if (!label || !Number.isFinite(scoreValue) || patterns.length === 0) {
    return null;
  }

  return { label, penalty, patterns };
}

function parsePatternList(raw: unknown, warnings: string[], fieldName: string): RegExp[] {
  const regexes: RegExp[] = [];
  for (const entry of asArray(raw)) {
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
