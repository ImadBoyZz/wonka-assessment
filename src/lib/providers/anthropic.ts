import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedToolCall } from "../types";
import { PENDING_ACK, MAX_AGENT_TURNS } from "./shared";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

/* Primary provider. The agent loop has no side effects: every tool call is
 * intercepted and acknowledged as "queued for human validation" instead of
 * being executed, so the model finishes its turn and writes the final reply.
 * The loop and max_tokens are capped (shared assessment keys). */

export const anthropicProvider: AgentProvider = {
  name: "anthropic",

  available() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    const client = new Anthropic({ maxRetries: 1 });
    const tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.userPrompt }];
    const toolCalls: NormalizedToolCall[] = [];
    let replyText = "";
    let model = MODEL;
    let truncated = false;

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: request.systemPrompt,
        messages,
        tools,
      });
      model = response.model;

      const turnToolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const turnText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      for (const block of turnToolUses) {
        toolCalls.push({
          id: block.id,
          toolName: block.name,
          args: (block.input ?? {}) as Record<string, unknown>,
        });
      }
      // The final answer is the text of the last turn; interim narration
      // ("I'll now update...") is superseded once a later turn produces text.
      if (turnText) replyText = turnText;

      if (response.stop_reason !== "tool_use" || turnToolUses.length === 0) break;
      if (turn === MAX_AGENT_TURNS - 1) {
        truncated = true; // cap reached while the model still wanted tools
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: turnToolUses.map((block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: PENDING_ACK,
        })),
      });
    }

    return { toolCalls, replyText, model, truncated };
  },
};
