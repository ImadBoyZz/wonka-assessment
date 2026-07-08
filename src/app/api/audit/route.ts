import { readAudit } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Full audit trail, optionally filtered per run. */
export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId") ?? undefined;
  const entries = await readAudit(runId);
  return Response.json({ entries });
}
