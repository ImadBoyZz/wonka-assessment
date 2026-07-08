import type { NormalizedToolCall } from "./types";

/* ------------------------------------------------------------------ */
/* Executor — the pluggable boundary where an approved action would    */
/* hit a real backend (ERP, CRM, email API).                           */
/*                                                                     */
/* THE invariant of this whole system: execute() is called from        */
/* exactly one place, the actions route, and only AFTER a human        */
/* clicked APPROVE. Nothing fires on run, render, or reject — not      */
/* even this mock.                                                     */
/* ------------------------------------------------------------------ */

export interface ExecutionResult {
  ok: boolean;
  message: string;
}

export interface ToolExecutor {
  name: string;
  execute(call: NormalizedToolCall): Promise<ExecutionResult>;
}

/** Prototype stand-in: records what WOULD have been executed. Swapping in a
 *  real implementation (HTTP call to a customer backend) changes nothing
 *  upstream of this interface. */
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
