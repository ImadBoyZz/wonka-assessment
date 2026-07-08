import OpenAI from "openai";
import type { NormalizedToolCall } from "../types";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "./types";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

/* Fallback provider. Normalizes OpenAI's tool_calls (JSON-string arguments)
 * to the same shape as Anthropic's tool_use blocks. */

export const openaiProvider: AgentProvider = {
  name: "openai",

  available() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    const client = new OpenAI({ maxRetries: 1 });

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      tools: request.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as unknown as Record<string, unknown>,
        },
      })),
      tool_choice: "auto",
    });

    const message = response.choices[0]?.message;
    const toolCalls: NormalizedToolCall[] = [];

    for (const call of message?.tool_calls ?? []) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        // Malformed arguments surface as an empty card rather than a crash.
      }
      toolCalls.push({ id: call.id, toolName: call.function.name, args });
    }

    return {
      toolCalls,
      replyText: (message?.content ?? "").trim(),
      model: response.model,
    };
  },
};
