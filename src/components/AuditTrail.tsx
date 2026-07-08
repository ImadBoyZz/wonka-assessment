"use client";

import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { AuditEntry } from "@/lib/types";

/* Append-only audit trail for the current run — every system event and every
 * human decision, in order ("full audit trail on every action"). */

const EVENT_COLOR: Record<AuditEntry["event"], string> = {
  run_created: "bg-accent",
  action_approved: "bg-approve",
  action_rejected: "bg-reject",
  action_executed: "bg-accent-deep",
  reply_sent: "bg-approve",
  run_status_changed: "bg-ink-soft",
};

export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ClockCounterClockwise className="size-4 text-accent" weight="bold" />
        Audit trail
      </h2>
      <ol className="mt-3 flex flex-col gap-1.5">
        {entries.map((entry, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 font-mono text-[11px] text-ink-soft">
              {new Date(entry.at).toLocaleTimeString("en-GB")}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] text-white ${EVENT_COLOR[entry.event] ?? "bg-ink-soft"}`}
            >
              {entry.event}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-soft">{entry.actor}</span>
            <span className="min-w-0 break-all text-ink-soft">{entry.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
