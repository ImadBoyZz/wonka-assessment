import { executor } from "@/lib/executor";
import { withLock } from "@/lib/lock";
import { appendAudit, getRun, saveRun } from "@/lib/store";
import type { RunRecord, RunStatus } from "@/lib/types";

/* Human decision endpoint — the heart of the validation loop.
 *
 * Invariants:
 * - The executor runs ONLY here, ONLY on "approved", and ONLY once per
 *   action. The whole read-check-write is serialized per run (withLock),
 *   so the 409 idempotency gate holds under concurrent requests too, not
 *   just for a double-click.
 * - The decision is persisted BEFORE the executor runs (write-ahead): if
 *   the process dies mid-execution, a replay hits the 409 instead of
 *   executing a second time.
 * - Every decision writes an audit line, approved or rejected. */

function deriveStatus(run: RunRecord): RunStatus {
  const total = run.toolCalls.length;
  if (total === 0) return run.replySent ? "confirmed" : "to_be_validated";

  const decisions = Object.values(run.decisions);
  if (decisions.length < total) return "to_be_validated";

  const approved = decisions.filter((d) => d === "approved").length;
  if (approved === total) return "confirmed";
  if (approved === 0) return "rejected";
  return "partially_confirmed";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    runId?: string;
    toolCallId?: string;
    decision?: "approved" | "rejected";
  } | null;

  if (!body?.runId || !body.toolCallId || !body.decision) {
    return Response.json({ error: "runId, toolCallId and decision are required" }, { status: 400 });
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return Response.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  const { runId, toolCallId, decision } = body;

  return withLock(`run:${runId}`, async () => {
    const run = await getRun(runId);
    if (!run) {
      return Response.json({ error: `Unknown run: ${runId}` }, { status: 404 });
    }

    const toolCall = run.toolCalls.find((c) => c.id === toolCallId);
    if (!toolCall) {
      return Response.json({ error: `Unknown tool call: ${toolCallId}` }, { status: 404 });
    }

    if (run.decisions[toolCall.id]) {
      return Response.json(
        { error: `Action already ${run.decisions[toolCall.id]} — decisions are final`, run },
        { status: 409 }
      );
    }

    run.decisions[toolCall.id] = decision;
    const previousStatus = run.status;
    run.status = deriveStatus(run);
    await saveRun(run); // write-ahead: durable before anything executes

    await appendAudit({
      runId: run.runId,
      actor: "human",
      event: decision === "approved" ? "action_approved" : "action_rejected",
      detail: `${toolCall.toolName}(${JSON.stringify(toolCall.args)})`,
    });
    if (run.status !== previousStatus) {
      await appendAudit({
        runId: run.runId,
        actor: "system",
        event: "run_status_changed",
        detail: `${previousStatus} -> ${run.status}`,
      });
    }

    let execution = null;
    if (decision === "approved") {
      // The one and only call site of the executor — strictly after approval.
      execution = await executor.execute(toolCall);
      await appendAudit({
        runId: run.runId,
        actor: "system",
        event: "action_executed",
        detail: execution.message,
      });
    }

    return Response.json({ run, execution });
  });
}
