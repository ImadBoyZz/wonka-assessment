"use client";

import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { AuditEntry } from "@/lib/types";

/* Audit trail for the current run — every system event and human decision, in
 * order. Rendered as a log: mono rows with a colored event dot. */

const EVENT_DOT: Record<AuditEntry["event"], string> = {
  run_created: "bg-accent",
  action_edited: "bg-warn",
  action_approved: "bg-approve",
  action_rejected: "bg-reject",
  action_executed: "bg-approve-deep",
  reply_sent: "bg-approve",
  run_status_changed: "bg-ink-faint",
};

export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <ClockCounterClockwise className="size-4 text-ink-faint" weight="bold" />
          Audit trail
        </h2>
        <span className="font-mono text-[11px] text-ink-faint">
          {entries.length} event{entries.length === 1 ? "" : "s"} · append-only
        </span>
      </header>
      <ol className="flex flex-col p-3.5 font-mono text-[11.5px]">
        {entries.map((entry, i) => (
          <li key={i} className="flex items-baseline gap-2.5 py-[3px]">
            <span className="shrink-0 text-ink-faint">
              {new Date(entry.at).toLocaleTimeString("en-GB")}
            </span>
            <span
              className={`relative top-px size-1.5 shrink-0 self-center rounded-[2px] ${EVENT_DOT[entry.event] ?? "bg-ink-faint"}`}
            />
            <span className="w-40 shrink-0 text-ink-soft max-sm:w-auto">{entry.event}</span>
            <span className="shrink-0 text-[10.5px] text-ink-faint">{entry.actor}</span>
            <span className="min-w-0 break-all text-ink-soft">{entry.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
