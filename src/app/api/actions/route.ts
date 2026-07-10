import { describeChanges, validateEditedArgs } from "@/lib/edits";
import { executor } from "@/lib/executor";
import { getFixture } from "@/lib/fixtures";
import { withLock } from "@/lib/lock";
import { parseAgentDefinition } from "@/lib/parser";
import { appendAudit, getRun, saveRun } from "@/lib/store";
import type { RunRecord, RunStatus } from "@/lib/types";

/* Human decision endpoint.
 *
 * - The executor runs only here, only on "approved", and once per action. The
 *   read-check-write is serialized per run (withLock), so the 409 check holds
 *   under concurrent requests, not just a double-click.
 * - The decision is persisted before the executor runs (write-ahead): if the
 *   process dies mid-execution, a replay hits the 409 instead of executing
 *   twice.
 * - Every decision writes an audit line, approved or rejected.
 * - Edited arguments are re-validated server-side against the parsed types
 *   (not trusted from the client), persisted with the decision, and audited
 *   as "action_edited" before anything executes. */

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
    editedArgs?: Record<string, unknown>;
  } | null;

  if (!body?.runId || !body.toolCallId || !body.decision) {
    return Response.json({ error: "runId, toolCallId and decision are required" }, { status: 400 });
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return Response.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  const { runId, toolCallId, decision } = body;
  const editedArgs =
    body.editedArgs && typeof body.editedArgs === "object" && !Array.isArray(body.editedArgs)
      ? body.editedArgs
      : undefined;
  if (editedArgs && Object.keys(editedArgs).length > 0 && decision !== "approved") {
    // Editing is for correct-and-confirm; a rejection discards the action as proposed.
    return Response.json({ error: "editedArgs is only valid with an 'approved' decision" }, { status: 400 });
  }

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

    // Re-validate edits before recording the decision: an invalid edit rejects
    // the whole request and the action stays pending.
    let editChanges: Record<string, { from: unknown; to: unknown }> | null = null;
    if (editedArgs && Object.keys(editedArgs).length > 0) {
      const fixture = await getFixture(run.fixtureId);
      if (!fixture) {
        return Response.json(
          { error: `Definition "${run.fixtureId}" is no longer available — cannot validate edits` },
          { status: 400 }
        );
      }
      const tool = parseAgentDefinition(fixture.definition).tools.find((t) => t.name === toolCall.toolName);
      if (!tool) {
        return Response.json(
          { error: `Tool "${toolCall.toolName}" is not declared in the definition — its arguments cannot be edited` },
          { status: 400 }
        );
      }
      const validated = validateEditedArgs(tool, toolCall.args, editedArgs);
      if (!validated.ok) {
        return Response.json({ error: `Invalid edit: ${validated.errors.join("; ")}` }, { status: 400 });
      }
      if (Object.keys(validated.changes).length > 0) {
        toolCall.args = validated.args;
        editChanges = validated.changes;
      }
    }

    run.decisions[toolCall.id] = decision;
    const previousStatus = run.status;
    run.status = deriveStatus(run);
    await saveRun(run); // write-ahead: decision and edits saved before anything executes

    if (editChanges) {
      await appendAudit({
        runId: run.runId,
        actor: "human",
        event: "action_edited",
        detail: describeChanges(toolCall.toolName, editChanges),
        meta: { toolName: toolCall.toolName, editedKeys: Object.keys(editChanges) },
      });
    }
    await appendAudit({
      runId: run.runId,
      actor: "human",
      event: decision === "approved" ? "action_approved" : "action_rejected",
      detail: `${toolCall.toolName}(${JSON.stringify(toolCall.args)})`,
      meta: { toolName: toolCall.toolName },
    });
    if (run.status !== previousStatus) {
      await appendAudit({
        runId: run.runId,
        actor: "system",
        event: "run_status_changed",
        detail: `${previousStatus} -> ${run.status}`,
        meta: { from: previousStatus, to: run.status },
      });
    }

    let execution = null;
    if (decision === "approved") {
      // The only call site of the executor, after approval.
      execution = await executor.execute(toolCall);
      await appendAudit({
        runId: run.runId,
        actor: "system",
        event: "action_executed",
        detail: execution.message,
        meta: { toolName: toolCall.toolName },
      });
    }

    return Response.json({ run, execution });
  });
}
