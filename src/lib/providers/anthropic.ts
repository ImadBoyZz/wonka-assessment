import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedToolCall } from "../types";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

/* Primary provider. max_tokens is capped and maxRetries reduced because the
 * assessment keys are shared across candidates. */

export const anthropicProvider: AgentProvider = {
  name: "anthropic",

  available() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    const client = new Anthropic({ maxRetries: 1 });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      tools: request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    });

    const toolCalls: NormalizedToolCall[] = [];
    const textParts: string[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          toolName: block.name,
          args: (block.input ?? {}) as Record<string, unknown>,
        });
      } else if (block.type === "text") {
        textParts.push(block.text);
      }
    }

    return { toolCalls, replyText: textParts.join("\n").trim(), model: response.model };
  },
};
