import { ArrowLeft, ChartBar } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { aggregateAudit, formatDuration, RUN_STATUSES } from "@/lib/analytics";
import { readAudit } from "@/lib/store";
import type { RunStatus } from "@/lib/types";

/* Audit analytics — a read-only fold over the append-only audit log
 * (.data/audit.jsonl). Server component: it reads the same store the audit
 * trail writes to and renders numbers; it cannot touch runs, decisions or
 * the executor. Covers the reference project's nice-to-haves: KPIs per
 * validation state and human-correction (≈ AI error) rates per field. */

export const metadata: Metadata = {
  title: "Audit analytics",
  description: "Approval rates per tool, edit rates per field and decision latency from the audit log.",
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<RunStatus, string> = {
  confirmed: "confirmed",
  partially_confirmed: "partially confirmed",
  rejected: "rejected",
  to_be_validated: "to be validated",
};

/* Segment colors validated with the dataviz palette checker (lightness band,
 * chroma floor, contrast vs panel); the amber↔red deutan pair sits in the
 * 8–12 floor band, which is why every segment also carries a 2px surface gap,
 * a legend swatch AND a text count — identity is never color-alone. */
const STATUS_BAR: Record<RunStatus, string> = {
  confirmed: "bg-approve",
  partially_confirmed: "bg-warn",
  rejected: "bg-reject",
  to_be_validated: "bg-chart-pending",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-28 flex-col gap-0.5 px-4 first:pl-0 last:pr-0" title={hint}>
      <span className="font-mono text-[17px] font-medium tracking-tight text-ink">{value}</span>
      <span className="font-mono text-[11px] text-ink-faint">{label}</span>
    </div>
  );
}

function RateBar({ rate }: { rate: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-[3px] bg-line/60">
        <span className="block h-full rounded-[3px] bg-approve" style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
      <span className="font-mono text-[12px] text-ink">{Math.round(rate * 100)}%</span>
    </span>
  );
}

export default async function DashboardPage() {
  const stats = aggregateAudit(await readAudit());
  const { totals } = stats;
  const statusTotal = RUN_STATUSES.reduce((sum, s) => sum + stats.statusCounts[s], 0);
  const maxFieldEdits = Math.max(1, ...stats.fieldEdits.map((f) => f.edits));
  const period =
    stats.firstEventAt && stats.lastEventAt
      ? `${new Date(stats.firstEventAt).toLocaleDateString("en-GB")} – ${new Date(stats.lastEventAt).toLocaleDateString("en-GB")}`
      : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* ── App bar ───────────────────────────────────────────────── */}
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex h-12 w-full max-w-screen-2xl items-center gap-2.5 px-4 lg:px-6">
          <ChartBar className="size-[18px] text-ink" weight="fill" />
          <h1 className="font-mono text-[13px] font-medium tracking-tight text-ink">Audit analytics</h1>
          <span className="hidden text-[12px] text-ink-faint sm:inline">
            read-only aggregation over the append-only audit log
          </span>
          <nav className="ml-auto flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-soft transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-3.5" weight="bold" /> validation app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 lg:px-6">
        {totals.runs === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-panel px-6 py-16">
            <div className="flex max-w-xl flex-col items-center gap-3 text-center">
              <p className="text-[13.5px] text-ink">The audit log is empty: nothing has run yet.</p>
              <p className="text-[12.5px] leading-relaxed text-ink-soft">
                Run an agent in the <Link href="/" className="text-accent underline underline-offset-2">validation app</Link> and
                decide on its actions, or seed a demo history with{" "}
                <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11.5px] text-glass-ink">npm run seed</code>.
                Every approve, reject, edit and status change lands here.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Headline facts ──────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-ink">What the reviewers decided</h2>
                {period && <span className="font-mono text-[11.5px] text-ink-faint">{period}</span>}
              </div>
              <div className="flex flex-wrap divide-x divide-line rounded-lg border border-line bg-panel px-4 py-3">
                <Stat label="runs" value={String(totals.runs)} />
                <Stat label="actions proposed" value={String(totals.actionsProposed)} />
                <Stat
                  label="approved"
                  value={String(totals.approved)}
                  hint={`${totals.executed} executed strictly after approval`}
                />
                <Stat label="rejected" value={String(totals.rejected)} />
                <Stat
                  label="human edits"
                  value={String(totals.edits)}
                  hint="arguments corrected before approval"
                />
                <Stat
                  label="median time to decision"
                  value={stats.medianMsToDecision === null ? "—" : formatDuration(stats.medianMsToDecision)}
                  hint="from run creation to each human decision"
                />
              </div>
            </section>

            {/* ── Runs per state (KPIs per state) ─────────────────── */}
            <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel p-4">
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Runs per validation state</h3>
                <span className="font-mono text-[11px] text-ink-faint">{statusTotal} runs</span>
              </header>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]">
                {RUN_STATUSES.filter((s) => stats.statusCounts[s] > 0).map((s) => (
                  <span
                    key={s}
                    title={`${STATUS_LABEL[s]}: ${stats.statusCounts[s]}`}
                    className={`${STATUS_BAR[s]} rounded-[2px]`}
                    style={{ width: `${(stats.statusCounts[s] / statusTotal) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {RUN_STATUSES.map((s) => (
                  <li key={s} className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-soft">
                    <span className={`size-2 rounded-[2px] ${STATUS_BAR[s]}`} />
                    {STATUS_LABEL[s]}
                    <span className="text-ink">{stats.statusCounts[s]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
              {/* ── Decisions per tool ──────────────────────────────── */}
              <section className="overflow-hidden rounded-lg border border-line bg-panel lg:col-span-3">
                <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
                  <h3 className="text-[13px] font-semibold text-ink">Decisions per tool</h3>
                  <span className="font-mono text-[11px] text-ink-faint">{totals.decided} decisions</span>
                </header>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line font-mono text-[10.5px] text-ink-faint">
                      <th className="px-3.5 py-1.5 text-left font-normal">tool</th>
                      <th className="px-2 py-1.5 text-right font-normal">appr</th>
                      <th className="px-2 py-1.5 text-right font-normal">rej</th>
                      <th className="px-2 py-1.5 text-right font-normal">edits</th>
                      <th className="px-3.5 py-1.5 text-left font-normal">approval rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.tools.map((tool) => (
                      <tr key={tool.toolName} className="border-b border-line last:border-b-0">
                        <td className="break-all px-3.5 py-2 font-mono text-[12px] leading-snug text-ink">
                          {tool.toolName}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-approve-deep">{tool.approved}</td>
                        <td className="px-2 py-2 text-right font-mono text-reject-deep">{tool.rejected}</td>
                        <td className="px-2 py-2 text-right font-mono text-ink-soft">{tool.edited}</td>
                        <td className="px-3.5 py-2">
                          {tool.decided > 0 ? (
                            <RateBar rate={tool.approvalRate} />
                          ) : (
                            <span className="font-mono text-[11.5px] text-ink-faint">no decisions</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* ── Corrections per field ───────────────────────────── */}
              <section className="overflow-hidden rounded-lg border border-line bg-panel lg:col-span-2">
                <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
                  <h3 className="text-[13px] font-semibold text-ink">Human corrections per field</h3>
                  <span className="font-mono text-[11px] text-ink-faint">{totals.edits} edits</span>
                </header>
                <div className="flex flex-col gap-2.5 p-3.5">
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    Each edit is a human correcting the AI&apos;s proposed value before approving: the closest
                    deterministic proxy for a per-field AI error rate.
                  </p>
                  {stats.fieldEdits.length === 0 ? (
                    <p className="font-mono text-[11.5px] text-ink-faint">
                      No corrections yet; every approved action ran exactly as proposed.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {stats.fieldEdits.map((f) => (
                        <li key={`${f.toolName}.${f.field}`} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate font-mono text-[12px] text-ink">
                              {f.field}
                              <span className="ml-1.5 text-[10.5px] text-ink-faint">{f.toolName}</span>
                            </span>
                            <span className="font-mono text-[12px] text-ink">{f.edits}</span>
                          </div>
                          <span className="h-1.5 overflow-hidden rounded-[3px] bg-line/60">
                            <span
                              className="block h-full rounded-[3px] bg-warn"
                              style={{ width: `${(f.edits / maxFieldEdits) * 100}%` }}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>

            <p className="font-mono text-[11px] text-ink-faint">
              {totals.repliesSent} replies sent · {totals.pending} actions still pending · executed = approved only,
              exactly once ({totals.executed}/{totals.approved})
            </p>
          </>
        )}
      </main>
    </div>
  );
}
