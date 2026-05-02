# Mastodon Curator CLI

> "Could you also publish the Mastodon curator as a standalone script?"

This repository packages the Mastodon Curator Agent as a standalone, publishable CLI.

## What it does

The tool fetches public posts from a Mastodon instance, then applies:

1. a fast rule-based pre-filter (topics, negative rules, heuristics)
2. LLM ranking on the strongest candidates (OpenRouter)

The result is a concise Markdown digest printed to stdout.

It preserves the original behavior: timezone-aware output, profile-aware filtering, hard rule guards, stateful deduplication, and #nobot/#noai/#nosearch bio filtering.

## Install

```bash
npm install
npm run build
```

Run it:

```bash
npx mastodon-curator
# or
node dist/index.js
```

## Configuration

Copy `.env.example` to `.env` and fill the required values:

```ini
MASTODON_BASE_URL=https://your-instance.social
MASTODON_ACCESS_TOKEN=your-token
OPENROUTER_API_KEY=sk-or-...
```

Optional values:

```ini
MASTODON_USER_AGENT=mastodon-curator/1.0
CURATOR_MODEL=deepseek/deepseek-v3.2
CURATOR_TARGET_COUNT=10
CURATOR_MAX_POST_AGE_HOURS=8
CURATOR_MAX_FAVOURITES=5
CURATOR_MAX_PAGES=25
CURATOR_MAX_LOOKBACK_HOURS=168
CURATOR_ENABLE_FAVOURITES=false
CURATOR_TIMEZONE=Europe/Berlin
CURATOR_LOCALE=en-US
CURATOR_STATE_FILE=data/state.json
```

`CURATOR_STATE_FILE` is relative to the current working directory unless you pass an absolute path. For cron or global installs, prefer an explicit path such as `~/.cache/mastodon-curator/state.json`.

## How to get credentials

### Mastodon access token

1. Open your Mastodon instance settings.
2. Go to **Preferences / Development**.
3. Create an app with at least `read:statuses`.
4. Generate and copy the token to `MASTODON_ACCESS_TOKEN`.

### OpenRouter API key

1. Sign in at [OpenRouter](https://openrouter.ai/).
2. Create an API key.
3. Set it in `OPENROUTER_API_KEY`.

## Interest profile in YAML

`interests.example.yaml` contains the default profile.

- `interestProfile` – free-text profile context for the LLM
- `topics` – array of `{ topic, score, patterns[] }`
- `negativeRules` – array of `{ label, penalty, patterns[] }`
- `signalPatterns` – opinion/community/tech context signals for rule scoring

Customize with your own profile:

```bash
npx mastodon-curator --config ./my-interests.yaml
```

Minimal profile example:

```yaml
interestProfile: |
  I am interested in practical software engineering, open source,
  thoughtful AI tooling, Fediverse culture, and personal technical writing.

topics:
  - topic: software-engineering
    score: 4
    patterns:
      - '\\b(typescript|javascript|software engineering|developer experience|testing|refactor)\\b'
  - topic: ai-tools
    score: 5
    patterns:
      - '\\b(ai|llm|agents|openrouter|prompting|rag)\\b'

negativeRules:
  - label: crypto-web3
    penalty: -9
    patterns:
      - '\\b(crypto|web3|nft|airdrop)\\b'

signalPatterns:
  opinion:
    - '\\b(i think|my take|in my experience)\\b'
  community:
    - '\\b(community|discussion|reflection)\\b'
  techContext:
    - '\\b(code|software|developer|api|open source)\\b'
  workLife:
    - '\\b(burnout|work-life|boundaries)\\b'
  personal:
    - '\\b(i|my|personally)\\b'
  criticalReflection:
    - '\\b(critique|tradeoff|nuanced|skeptical)\\b'
  discussion:
    - '\\b(what do you think|curious how others)\\b'
```

Some signal labels are used by the fallback ranking guard: `opinion`, `community`, `critical-reflection`, `work-life`, `discussion`, `personal-voice`, `tech-context`, and `strong-context-fit`. The bundled negative labels `crypto-web3`, `generic-motivation`, `recruiting-spam`, and `aggregated-news` also get special fallback treatment. Keep those labels if you want the fallback behavior to match the default profile.

## CLI usage

```bash
npx mastodon-curator [options]
```

```text
-h, --help                  Show this help text.
-c, --config <path>         Path to interest profile YAML (defaults to interests.example.yaml).
-o, --output <path>         Write output to a file.
--dry-run                   Run without favouriting selected posts.
--json                      Print machine-readable JSON instead of plain markdown.
--instance-url <url>        Mastodon instance base URL.
--target-count <n>          Number of posts to select (1-20).
--max-post-age-hours <n>    Drop posts older than n hours before pre-filtering.
--max-favourites <n>        Skip posts already liked >= n.
--max-pages <n>             Fetch at most n public timeline pages.
--max-lookback-hours <n>    Stop scanning once posts are older than n hours.
--timezone <tz>             IANA timezone for output.
--locale <locale>           BCP 47 locale for date/time output, e.g. en-US.
--state-file <path>         Dedup state file path.
--model <id>                OpenRouter model id.
--curator-model <id>        Alias for --model.
```

### JSON output

```bash
npx mastodon-curator --json
```

Emits:

```json
{
  "generatedAt": "...",
  "markdown": "...",
  "success": true,
  "model": "deepseek/deepseek-v3.2",
  "metadata": { ... },
  "usage": { ... },
  "config": { ... }
}
```

## Cron-friendly usage

No scheduler is bundled. Run manually or from cron.

```cron
0 8 * * * cd /path/to/mastodon-curator && node dist/index.js --json --state-file ~/.cache/mastodon-curator/state.json
```

## Respect opt-out tags

Profiles and accounts with `#nobot`, `#noai`, or `#nosearch` are excluded intentionally.

## Project structure

```
mastodon-curator/
├── src/
│   ├── index.ts          # CLI entrypoint (arg parsing + execution)
│   ├── curator.ts        # Main curation pipeline
│   ├── mastodon-client.ts # Mastodon API client + HTML→plain text helper
│   ├── llm.ts            # OpenRouter (Vercel AI SDK)
│   ├── scoring.ts        # Scoring/rule engine + YAML profile loader
│   ├── state.ts          # Dedup persistence
│   ├── config.ts         # Env + CLI config resolver
│   ├── time.ts           # Timezone helpers
│   ├── prompt.ts         # German LLM system prompt
│   └── types.ts          # Types for run output and profile metadata
├── interests.example.yaml
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

## LICENSE

MIT
