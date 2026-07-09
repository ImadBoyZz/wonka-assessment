import OpenAI from "openai";
import type { NormalizedToolCall } from "../types";
import { PENDING_ACK, MAX_AGENT_TURNS } from "./shared";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "./types";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

/* Fallback provider. Same side-effect-free loop as the Anthropic provider,
 * with OpenAI's tool_calls (JSON-string arguments) normalized to the shared
 * result shape. */

export const openaiProvider: AgentProvider = {
  name: "openai",

  available() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    const client = new OpenAI({ maxRetries: 1 });
    const tools = request.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as unknown as Record<string, unknown>,
      },
    }));

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];
    const toolCalls: NormalizedToolCall[] = [];
    let replyText = "";
    let model = MODEL;
    let truncated = false;

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 4096,
        messages,
        tools,
        tool_choice: "auto",
      });
      model = response.model;

      const message = response.choices[0]?.message;
      if (!message) break;

      const turnCalls = (message.tool_calls ?? []).filter((c) => c.type === "function");
      for (const call of turnCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          // Malformed arguments surface as an empty card rather than a crash.
        }
        toolCalls.push({ id: call.id, toolName: call.function.name, args });
      }
      if (message.content?.trim()) replyText = message.content.trim();

      if (turnCalls.length === 0) break;
      if (turn === MAX_AGENT_TURNS - 1) {
        truncated = true; // cap reached while the model still wanted tools
        break;
      }

      messages.push(message);
      for (const call of turnCalls) {
        messages.push({ role: "tool", tool_call_id: call.id, content: PENDING_ACK });
      }
    }

    return { toolCalls, replyText, model, truncated };
  },
};
