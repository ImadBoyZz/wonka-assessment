import type { ProviderToolSchema } from "../parser";
import type { MockResult, NormalizedToolCall } from "../types";

/* ------------------------------------------------------------------ */
/* Provider interface — a thin abstraction in the spirit of an LLM     */
/* gateway (Requesty in miniature): one request shape, one normalized  */
/* result shape, N interchangeable backends with automatic fallback.   */
/* ------------------------------------------------------------------ */

export interface AgentRunRequest {
  systemPrompt: string;
  /** Fully rendered user prompt (placeholders already substituted). */
  userPrompt: string;
  /** Tool schemas derived from the SAME AgentSchema that generated the UI —
   *  one source of truth, so the UI can never disagree with the tools the
   *  model was given. */
  tools: ProviderToolSchema[];
  /** Demo data used only by the mock provider. */
  mockResult?: MockResult;
}

export interface AgentRunResult {
  toolCalls: NormalizedToolCall[];
  replyText: string;
  model: string;
}

export interface AgentProvider {
  name: string;
  available(): boolean;
  runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
}

export type ProviderPreference = "auto" | "anthropic" | "openai" | "mock";
