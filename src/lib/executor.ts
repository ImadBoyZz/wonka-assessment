import type { NormalizedToolCall } from "./types";

/* Executor: the boundary where an approved action would hit a real backend
 * (ERP, CRM, email API). execute() is called from one place only, the actions
 * route, and only after a human approves. It never runs on run, render, or
 * reject, not even this mock. */

export interface ExecutionResult {
  ok: boolean;
  message: string;
}

export interface ToolExecutor {
  name: string;
  execute(call: NormalizedToolCall): Promise<ExecutionResult>;
}

/** Prototype stand-in: records what would have been executed. A real
 *  implementation (an HTTP call to a customer backend) plugs in here without
 *  changing anything upstream of this interface. */
class MockExecutor implements ToolExecutor {
  name = "mock";

  async execute(call: NormalizedToolCall): Promise<ExecutionResult> {
    return {
      ok: true,
      message: `mock-executed ${call.toolName}(${JSON.stringify(call.args)})`,
    };
  }
}

export const executor: ToolExecutor = new MockExecutor();
