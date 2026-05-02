import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NormalizedMastodonStatus } from './mastodon-client.js';

export interface MastodonCuratorStateEntry {
  key: string;
  statusId: string;
  url: string;
  handledAt: string;
}

export interface MastodonCuratorState {
  handledItems: MastodonCuratorStateEntry[];
}

const DEFAULT_RETENTION_DAYS = 180;

export function loadMastodonCuratorState(stateFile: string, retentionDays = DEFAULT_RETENTION_DAYS): MastodonCuratorState {
  try {
    const raw = readFileSync(stateFile, 'utf-8');
    const parsed = JSON.parse(raw) as MastodonCuratorState;
    return pruneState(parsed, retentionDays);
  } catch {
    return { handledItems: [] };
  }
}

export function saveMastodonCuratorState(stateFile: string, state: MastodonCuratorState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

export function recordHandledStatuses(
  stateFileState: MastodonCuratorState,
  statuses: NormalizedMastodonStatus[],
  handledAt: string,
  retentionDays = DEFAULT_RETENTION_DAYS,
): MastodonCuratorState {
  const next = pruneState(stateFileState, retentionDays);
  const entries = new Map(next.handledItems.map((entry) => [entry.key, entry] as const));

  for (const status of statuses) {
    const key = buildStatusKey(status);
    entries.set(key, {
      key,
      statusId: status.id,
      url: status.url,
      handledAt,
    });
  }

  return pruneState({ handledItems: [...entries.values()] }, retentionDays);
}

export function buildHandledSet(state: MastodonCuratorState): Set<string> {
  return new Set((state.handledItems ?? []).map((entry) => entry.key));
}

export function buildStatusKey(status: Pick<NormalizedMastodonStatus, 'uri' | 'url' | 'id'>): string {
  return status.uri || status.url || status.id;
}

function pruneState(state: MastodonCuratorState, retentionDays: number): MastodonCuratorState {
  const cutoff = Date.now() - retentionDays * 24 * 3600_000;
  return {
    handledItems: (state.handledItems ?? [])
      .filter((entry) => Number.isFinite(Date.parse(entry.handledAt)) && Date.parse(entry.handledAt) >= cutoff)
      .sort((left, right) => right.handledAt.localeCompare(left.handledAt)),
  };
}
