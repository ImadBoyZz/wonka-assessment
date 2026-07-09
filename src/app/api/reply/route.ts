import { withLock } from "@/lib/lock";
import { appendAudit, getRun, saveRun } from "@/lib/store";

/* Marks the suggested reply as sent (mock send — the prototype has no email
 * backend). The reply is a validation object too: sending is a human action
 * and lands in the audit trail like any approval. Serialized per run so the
 * "already sent" gate holds under concurrent requests. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { runId?: string } | null;

  if (!body?.runId) {
    return Response.json({ error: "runId is required" }, { status: 400 });
  }
  const { runId } = body;

  return withLock(`run:${runId}`, async () => {
    const run = await getRun(runId);
    if (!run) {
      return Response.json({ error: `Unknown run: ${runId}` }, { status: 404 });
    }

    if (run.replySent) {
      return Response.json({ error: "Reply already sent", run }, { status: 409 });
    }

    const previousStatus = run.status;
    run.replySent = true;
    if (run.toolCalls.length === 0 && run.status === "to_be_validated") {
      // No tool calls: the reply itself is the validation object.
      run.status = "confirmed";
    }
    await saveRun(run);

    await appendAudit({
      runId: run.runId,
      actor: "human",
      event: "reply_sent",
      detail: "suggested reply approved and sent (mock)",
      meta: { fixtureId: run.fixtureId },
    });
    if (run.status !== previousStatus) {
      // Same invariant as the actions route: every status change is audited.
      await appendAudit({
        runId: run.runId,
        actor: "system",
        event: "run_status_changed",
        detail: `${previousStatus} -> ${run.status}`,
        meta: { from: previousStatus, to: run.status },
      });
    }

    return Response.json({ run });
  });
}
