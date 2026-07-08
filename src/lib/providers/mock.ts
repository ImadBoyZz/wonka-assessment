import type { NormalizedToolCall } from "../types";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "./types";

/* Mock provider — demo/offline mode. Returns the fixture's mockResult when
 * present (the assignment's Antoine example, verbatim), or a generic result
 * derived from the tool schemas. No network, no tokens, and the tool calls
 * still go through the exact same approval gate as real ones. */

let counter = 0;

export const mockProvider: AgentProvider = {
  name: "mock",

  available() {
    return true;
  },

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.mockResult) {
      return {
        toolCalls: request.mockResult.toolCalls.map((c) => ({
          id: `mock_${++counter}_${c.toolName}`,
          toolName: c.toolName,
          args: c.args,
        })),
        replyText: request.mockResult.replyText,
        model: "mock",
      };
    }

    // No scripted result: propose one call per tool with schema-typed sample args.
    const toolCalls: NormalizedToolCall[] = request.tools.map((tool) => {
      const args: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
        if (!tool.inputSchema.required.includes(name)) continue; // leave optionals empty
        args[name] =
          prop.type === "number" ? 1.0 : prop.type === "integer" ? 1 : prop.type === "boolean" ? true : "example";
      }
      return { id: `mock_${++counter}_${tool.name}`, toolName: tool.name, args };
    });

    return {
      toolCalls,
      replyText: "This is a mock reply generated without an LLM call, for offline demos.",
      model: "mock",
    };
  },
};
