import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelV1 } from 'ai';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ProviderOptions = Record<string, Record<string, JsonValue>>;

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
}

export async function generate(opts: {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  providerOptions?: ProviderOptions;
}): Promise<LlmResult> {
  const model = getModel(opts.model);
  const result = await generateText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    providerOptions: opts.providerOptions,
  });

  return {
    text: result.text,
    usage: {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costUsd: extractOpenRouterCost(result.providerMetadata),
    },
  };
}

function getModel(modelId: string): LanguageModelV1 {
  return openrouter.chat(modelId, {
    usage: {
      include: true,
    },
  });
}

function extractOpenRouterCost(providerMetadata: unknown): number | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return null;
  }
  const openrouterMetadata = (providerMetadata as { openrouter?: unknown }).openrouter;
  if (!openrouterMetadata || typeof openrouterMetadata !== 'object') {
    return null;
  }
  const usage = (openrouterMetadata as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
}
