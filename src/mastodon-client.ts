import { load } from 'cheerio';

interface MastodonAccountPayload {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  url: string;
  note?: string | null;
  followers_count?: number;
}

interface MastodonTagPayload {
  name: string;
}

interface MastodonStatusPayload {
  id: string;
  uri?: string;
  url?: string | null;
  created_at: string;
  visibility: string;
  content: string;
  spoiler_text?: string;
  favourites_count?: number;
  reblogs_count?: number;
  replies_count?: number;
  quotes_count?: number;
  favourited?: boolean;
  reblog?: MastodonStatusPayload | null;
  in_reply_to_id?: string | null;
  in_reply_to_account_id?: string | null;
  account: MastodonAccountPayload;
  tags?: MastodonTagPayload[];
}

export interface MastodonAuthenticatedAccount {
  id: string;
  username: string;
  acct: string;
  displayName: string;
  url: string;
  note: string;
  followersCount: number;
}

export interface NormalizedMastodonStatus {
  id: string;
  uri: string;
  url: string;
  createdAt: string;
  visibility: string;
  plainText: string;
  spoilerText: string;
  textForRanking: string;
  favouritesCount: number;
  reblogsCount: number;
  repliesCount: number;
  quotesCount: number | null;
  favourited: boolean;
  inReplyToId: string | null;
  inReplyToAccountId: string | null;
  reblog: boolean;
  account: {
    id: string;
    username: string;
    acct: string;
    displayName: string;
    url: string;
    note: string;
  };
  tags: string[];
  urlCount: number;
}

export interface FetchPublicTimelinePageOptions {
  instanceUrl: string;
  accessToken: string;
  userAgent?: string;
  maxId?: string;
  limit?: number;
}

function normalizeBaseUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '');
}

export async function fetchPublicTimelinePage(
  options: FetchPublicTimelinePageOptions,
): Promise<{ statuses: NormalizedMastodonStatus[]; nextMaxId: string | null }> {
  const params = new URLSearchParams({
    limit: `${options.limit ?? 40}`,
  });

  if (options.maxId) {
    params.set('max_id', options.maxId);
  }

  const statuses = await mastodonRequest<MastodonStatusPayload[]>(
    options.instanceUrl,
    options.accessToken,
    `/api/v1/timelines/public?${params.toString()}`,
    undefined,
    options.userAgent,
  );
  const normalized = statuses.map(normalizeStatus);
  const nextMaxId = normalized.length > 0 ? normalized[normalized.length - 1]?.id ?? null : null;
  return {
    statuses: normalized,
    nextMaxId,
  };
}

export async function favouriteStatus(options: {
  instanceUrl: string;
  accessToken: string;
  statusId: string;
  userAgent?: string;
}): Promise<NormalizedMastodonStatus> {
  return performStatusAction(options, 'favourite');
}

function normalizeAccount(account: MastodonAccountPayload): MastodonAuthenticatedAccount {
  return {
    id: account.id,
    username: account.username,
    acct: account.acct,
    displayName: account.display_name,
    url: account.url,
    note: htmlToPlainText(account.note ?? ''),
    followersCount: typeof account.followers_count === 'number' ? account.followers_count : 0,
  };
}

export function normalizeStatus(status: MastodonStatusPayload): NormalizedMastodonStatus {
  const plainText = htmlToPlainText(status.content ?? '');
  const spoilerText = (status.spoiler_text ?? '').trim();
  const tags = (status.tags ?? []).map((tag) => tag.name.trim()).filter(Boolean);
  const textForRanking = [spoilerText, plainText, tags.map((tag) => `#${tag}`).join(' ')]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const url = status.url || status.uri || `${status.account.url}/${status.id}`;

  return {
    id: status.id,
    uri: status.uri || url,
    url,
    createdAt: status.created_at,
    visibility: status.visibility,
    plainText,
    spoilerText,
    textForRanking,
    favouritesCount: typeof status.favourites_count === 'number' ? status.favourites_count : 0,
    reblogsCount: typeof status.reblogs_count === 'number' ? status.reblogs_count : 0,
    repliesCount: typeof status.replies_count === 'number' ? status.replies_count : 0,
    quotesCount: typeof status.quotes_count === 'number' ? status.quotes_count : null,
    favourited: Boolean(status.favourited),
    inReplyToId: status.in_reply_to_id ?? null,
    inReplyToAccountId: status.in_reply_to_account_id ?? null,
    reblog: Boolean(status.reblog),
    account: {
      id: status.account.id,
      username: status.account.username,
      acct: status.account.acct,
      displayName: status.account.display_name,
      url: status.account.url,
      note: htmlToPlainText(status.account.note ?? ''),
    },
    tags,
    urlCount: (plainText.match(/https?:\/\//gi) ?? []).length,
  };
}

async function mastodonRequest<T>(
  instanceUrl: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
  userAgent?: string,
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(instanceUrl)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': userAgent ?? 'mastodon-curator/1.0',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.error_description === 'string'
          ? payload.error_description
          : response.statusText;
    throw new Error(`Mastodon API ${response.status}: ${errorMessage}`);
  }

  return payload as T;
}

async function performStatusAction(
  options: {
    instanceUrl: string;
    accessToken: string;
    statusId: string;
    userAgent?: string;
  },
  action: 'favourite' | 'unfavourite',
): Promise<NormalizedMastodonStatus> {
  const status = await mastodonRequest<MastodonStatusPayload>(
    options.instanceUrl,
    options.accessToken,
    `/api/v1/statuses/${options.statusId}/${action}`,
    {
      method: 'POST',
    },
    options.userAgent,
  );

  return normalizeStatus(status);
}

function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n');
  const $ = load(`<div>${withBreaks}</div>`);
  return $('div').text().replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
