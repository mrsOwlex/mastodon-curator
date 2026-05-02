import { resolve as resolvePath } from 'node:path';

export interface CliOptions {
  help: boolean;
  configPath?: string;
  outputPath?: string;
  dryRun: boolean;
  json: boolean;
  instanceUrl?: string;
  targetCount?: number;
  maxPostAgeHours?: number;
  maxFavourites?: number;
  maxPages?: number;
  maxLookbackHours?: number;
  timezone?: string;
  locale?: string;
  stateFile?: string;
  model?: string;
}

export interface RuntimeConfig {
  instanceUrl: string;
  mastodonAccessToken: string;
  mastodonUserAgent: string;
  openRouterApiKey: string;
  model: string;
  targetCount: number;
  maxPostAgeHours: number;
  maxFavourites: number;
  maxPages: number;
  maxLookbackHours: number;
  enableFavourites: boolean;
  timezone: string;
  locale?: string;
  stateFile: string;
  interestProfilePath?: string;
  outputPath?: string;
  dryRun: boolean;
  outputJson: boolean;
  showHelp: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');

    const key = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined;

    const nextValue = () => {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('-')) {
        return undefined;
      }
      const value = argv[index + 1];
      index += 1;
      return value;
    };

    const consumeValue = (): string | undefined => inlineValue ?? nextValue();

    switch (key) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--config':
      case '-c': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --config');
        }
        options.configPath = resolvePath(value);
        break;
      }
      case '--output':
      case '-o': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --output');
        }
        options.outputPath = resolvePath(value);
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--instance-url': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --instance-url');
        }
        options.instanceUrl = value;
        break;
      }
      case '--target-count': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --target-count');
        }
        options.targetCount = parseNumberOption(value);
        break;
      }
      case '--max-post-age-hours': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --max-post-age-hours');
        }
        options.maxPostAgeHours = parseNumberOption(value);
        break;
      }
      case '--max-favourites': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --max-favourites');
        }
        options.maxFavourites = parseNumberOption(value);
        break;
      }
      case '--max-pages': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --max-pages');
        }
        options.maxPages = parseNumberOption(value);
        break;
      }
      case '--max-lookback-hours': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --max-lookback-hours');
        }
        options.maxLookbackHours = parseNumberOption(value);
        break;
      }
      case '--timezone': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --timezone');
        }
        options.timezone = value;
        break;
      }
      case '--locale': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --locale');
        }
        options.locale = value;
        break;
      }
      case '--state-file': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --state-file');
        }
        options.stateFile = value;
        break;
      }
      case '--model':
      case '--curator-model': {
        const value = consumeValue();
        if (!value) {
          throw new Error('Missing value for --model');
        }
        options.model = value;
        break;
      }
      default:
        if (key.startsWith('--') || key.startsWith('-')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }

  return options;
}

export function resolveRuntimeConfig(options: CliOptions): RuntimeConfig {
  const env = process.env;

  const resolvedInstanceUrl = options.instanceUrl?.trim() || env.MASTODON_BASE_URL?.trim() || '';
  const resolvedTimeZone = options.timezone?.trim()
    || env.CURATOR_TIMEZONE?.trim()
    || env.TZ?.trim()
    || 'Europe/Berlin';
  const resolvedLocale = options.locale?.trim() || env.CURATOR_LOCALE?.trim() || undefined;
  const resolvedStateFile = options.stateFile?.trim() || env.CURATOR_STATE_FILE?.trim() || 'data/state.json';
  const resolvedModel = options.model?.trim() || env.CURATOR_MODEL?.trim() || 'deepseek/deepseek-v3.2';

  const resolvedTargetCount = clamp(
    options.targetCount ?? Number.parseInt(env.CURATOR_TARGET_COUNT ?? '10', 10),
    10,
    1,
    20,
  );
  const resolvedMaxPostAgeHours = clamp(
    options.maxPostAgeHours ?? Number.parseInt(env.CURATOR_MAX_POST_AGE_HOURS ?? '8', 10),
    8,
    1,
    168,
  );
  const resolvedMaxFavourites = clamp(
    options.maxFavourites ?? Number.parseInt(env.CURATOR_MAX_FAVOURITES ?? '5', 10),
    5,
    1,
    25,
  );
  const resolvedMaxPages = clamp(
    options.maxPages ?? Number.parseInt(env.CURATOR_MAX_PAGES ?? '25', 10),
    25,
    1,
    100,
  );
  const resolvedMaxLookbackHours = clamp(
    options.maxLookbackHours ?? Number.parseInt(env.CURATOR_MAX_LOOKBACK_HOURS ?? '168', 10),
    168,
    8,
    24 * 30,
  );

  const dryRun = options.dryRun;
  const rawFavourites = env.CURATOR_ENABLE_FAVOURITES;
  const resolvedEnableFavourites = dryRun
    ? false
    : parseBoolean(rawFavourites, false);

  return {
    instanceUrl: resolvedInstanceUrl,
    mastodonAccessToken: env.MASTODON_ACCESS_TOKEN?.trim() ?? '',
    mastodonUserAgent: env.MASTODON_USER_AGENT?.trim() || 'mastodon-curator/1.0',
    openRouterApiKey: env.OPENROUTER_API_KEY?.trim() ?? '',
    model: resolvedModel,
    targetCount: resolvedTargetCount,
    maxPostAgeHours: resolvedMaxPostAgeHours,
    maxFavourites: resolvedMaxFavourites,
    maxPages: resolvedMaxPages,
    maxLookbackHours: resolvedMaxLookbackHours,
    enableFavourites: resolvedEnableFavourites,
    timezone: resolvedTimeZone,
    locale: resolvedLocale,
    stateFile: resolvedStateFile,
    interestProfilePath: options.configPath,
    outputPath: options.outputPath,
    dryRun,
    outputJson: options.json,
    showHelp: options.help,
  };
}

export function usageText(): string {
  return `Usage:
  npx mastodon-curator [options]

Options:
  -h, --help                  Show this help text.
  -c, --config <path>         Path to interest profile YAML (optional, defaults to interests.example.yaml).
  -o, --output <path>         Write output to a file.
  --dry-run                   Run without favouriting selected posts.
  --json                      Print machine-readable JSON instead of plain markdown.
  --instance-url <url>         Mastodon instance base URL (same as MASTODON_BASE_URL).
  --target-count <n>          Number of posts to select (1-20).
  --max-post-age-hours <n>    Drop posts older than n hours before pre-filter.
  --max-favourites <n>        Skip already too-liked posts >= n.
  --max-pages <n>             Fetch at most n public timeline pages.
  --max-lookback-hours <n>    Stop once posts are older than n hours.
  --timezone <tz>             IANA timezone for output.
  --locale <locale>           BCP 47 locale for date/time output, e.g. en-US or de-DE.
  --state-file <path>         Dedup state file path.
  --model <id>                OpenRouter model id.
  --curator-model <id>        Alias for --model.
`;
}

function parseNumberOption(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'y'].includes(normalized);
}

function clamp(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return Math.max(min, Math.min(max, rounded));
}
