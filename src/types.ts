interface RunMetadata {
  [key: string]: unknown;
}

export interface AgentRunOutput {
  success: boolean;
  result: string;
  error?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  noOutput?: boolean;
  metadata?: RunMetadata;
}

export interface MastodonDigestPostMetadata {
  statusId: string;
  statusUrl: string;
  accountAcct: string;
  accountDisplayName: string;
  createdAt: string;
  favouritesCount: number;
  favourited: boolean;
  ruleScore: number;
  llmScore: number;
  topics: string[];
  reason: string;
  selectionTopic: string;
  plainTextFull: string;
  spoilerText: string;
  tags: string[];
}

export interface MastodonDigestMetadata extends RunMetadata {
  digestType: 'mastodon-curation';
  runDayKey: string;
  sourceUrl: string;
  warnings: string[];
  pagesFetched: number;
  fetchedStatuses: number;
  rankedCandidates: number;
  selectedCount: number;
  lookbackHours: number;
  posts: MastodonDigestPostMetadata[];
}
