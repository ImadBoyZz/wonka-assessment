import type { ProviderToolSchema } from "../parser";
import type { MockResult, NormalizedToolCall } from "../types";

/* Provider interface: one request shape, one normalized result shape, and
 * several interchangeable backends with automatic fallback. */

export interface AgentRunRequest {
  systemPrompt: string;
  /** Fully rendered user prompt (placeholders already substituted). */
  userPrompt: string;
  /** Tool schemas derived from the same AgentSchema that generated the UI, so
   *  the UI and the tools given to the model stay in sync. */
  tools: ProviderToolSchema[];
  /** Demo data used only by the mock provider. */
  mockResult?: MockResult;
}

export interface AgentRunResult {
  toolCalls: NormalizedToolCall[];
  replyText: string;
  model: string;
  /** True when the loop hit MAX_AGENT_TURNS while the model still wanted to
   *  call tools. The action list may be incomplete and the reviewer is warned. */
  truncated?: boolean;
}

export interface AgentProvider {
  name: string;
  available(): boolean;
  runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
}

export type ProviderPreference = "auto" | "anthropic" | "openai" | "mock";
