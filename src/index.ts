#!/usr/bin/env node
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { parseCliArgs, resolveRuntimeConfig, usageText } from './config.js';
import { loadInterestProfile } from './scoring.js';
import { runCurator } from './curator.js';

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usageText());
    return;
  }

  const config = resolveRuntimeConfig(options);
  if (!config.instanceUrl.trim()) {
    throw new Error('MASTODON_BASE_URL is not set. Set it in .env or pass --instance-url.');
  }
  if (!config.mastodonAccessToken.trim()) {
    throw new Error('MASTODON_ACCESS_TOKEN is not set.');
  }
  if (!config.openRouterApiKey.trim()) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  const profile = loadInterestProfile(config.interestProfilePath);
  const result = await runCurator({
    instanceUrl: config.instanceUrl,
    accessToken: config.mastodonAccessToken,
    userAgent: config.mastodonUserAgent,
    targetCount: config.targetCount,
    maxPostAgeHours: config.maxPostAgeHours,
    maxFavourites: config.maxFavourites,
    maxPages: config.maxPages,
    maxLookbackHours: config.maxLookbackHours,
    enableFavourites: config.enableFavourites,
    timezone: config.timezone,
    locale: config.locale,
    stateFile: config.stateFile,
    model: config.model,
    profile: profile.profile,
    profileSource: profile.source,
    profileWarnings: profile.warnings,
    dryRun: config.dryRun,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    markdown: result.result,
    success: result.success,
    model: result.model,
    metadata: result.metadata,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: result.costUsd ?? null,
    },
    config: {
      instanceUrl: config.instanceUrl,
      targetCount: config.targetCount,
      maxPostAgeHours: config.maxPostAgeHours,
      maxFavourites: config.maxFavourites,
      maxPages: config.maxPages,
      maxLookbackHours: config.maxLookbackHours,
      timezone: config.timezone,
      locale: config.locale,
      profileSource: profile.source,
    },
  };

  if (config.outputPath) {
    writeFileSync(config.outputPath, config.outputJson ? JSON.stringify(payload, null, 2) : result.result, 'utf-8');
  }

  if (config.outputJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(result.result);
  }
}

main().catch((error) => {
  console.error('[mastodon-curator] Error:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
