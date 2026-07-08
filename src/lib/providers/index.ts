import { anthropicProvider } from "./anthropic";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import type { AgentProvider, AgentRunRequest, AgentRunResult, ProviderPreference } from "./types";

export type { AgentRunRequest, AgentRunResult, ProviderPreference } from "./types";

/* Fallback chain: "auto" tries Anthropic first, then OpenAI. Each failure is
 * recorded as a warning so the UI can show that a fallback happened instead
 * of hiding it. The mock provider is never a silent fallback — only an
 * explicit choice: a demo result must never masquerade as a real run. */

const CHAINS: Record<ProviderPreference, AgentProvider[]> = {
  auto: [anthropicProvider, openaiProvider],
  anthropic: [anthropicProvider],
  openai: [openaiProvider],
  mock: [mockProvider],
};

export interface ProviderRunOutcome {
  result: AgentRunResult;
  providerUsed: string;
  warnings: string[];
}

export async function runWithFallback(
  preference: ProviderPreference,
  request: AgentRunRequest
): Promise<ProviderRunOutcome> {
  const chain = CHAINS[preference] ?? CHAINS.auto;
  const warnings: string[] = [];

  for (const provider of chain) {
    if (!provider.available()) {
      warnings.push(`${provider.name}: skipped (no API key configured)`);
      continue;
    }
    try {
      const result = await provider.runAgent(request);
      return { result, providerUsed: provider.name, warnings };
    } catch (err) {
      warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All providers failed: ${warnings.join(" | ") || "no provider available"}`);
}
