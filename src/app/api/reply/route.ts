import { appendAudit, getRun, saveRun } from "@/lib/store";

/* Marks the suggested reply as sent (mock send — the prototype has no email
 * backend). The reply is a validation object too: sending is a human action
 * and lands in the audit trail like any approval. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { runId?: string } | null;

  if (!body?.runId) {
    return Response.json({ error: "runId is required" }, { status: 400 });
  }

  const run = await getRun(body.runId);
  if (!run) {
    return Response.json({ error: `Unknown run: ${body.runId}` }, { status: 404 });
  }

  if (run.replySent) {
    return Response.json({ error: "Reply already sent", run }, { status: 409 });
  }

  run.replySent = true;
  if (run.toolCalls.length === 0 && run.status === "to_be_validated") {
    // No tool calls: the reply itself is the validation object.
    run.status = "confirmed";
  }

  await appendAudit({
    runId: run.runId,
    actor: "human",
    event: "reply_sent",
    detail: "suggested reply approved and sent (mock)",
  });

  await saveRun(run);
  return Response.json({ run });
}
