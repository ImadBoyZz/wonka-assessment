import type { AuditEntry, RunStatus } from "./types";

/* Aggregation over the append-only audit log. Read-only: this module folds
 * AuditEntry[] into numbers and never touches the run store, the executor or
 * any route. It reads the structured `meta` field rather than parsing the
 * detail strings; entries written before `meta` existed fall back to two
 * narrow detail parsers below. */

export interface ToolStats {
  toolName: string;
  approved: number;
  rejected: number;
  /** Number of human corrections (action_edited) on this tool's actions. */
  edited: number;
  decided: number;
  /** approved / decided, 0..1. Only meaningful when decided > 0. */
  approvalRate: number;
}

export interface FieldEditStats {
  toolName: string;
  field: string;
  edits: number;
}

export const RUN_STATUSES: RunStatus[] = [
  "confirmed",
  "partially_confirmed",
  "rejected",
  "to_be_validated",
];

export interface DashboardStats {
  totals: {
    runs: number;
    actionsProposed: number;
    decided: number;
    approved: number;
    rejected: number;
    /** action_edited events: each one is a human correcting the AI. */
    edits: number;
    executed: number;
    repliesSent: number;
    /** Proposed actions still awaiting a decision. */
    pending: number;
  };
  /** Final status per run (KPIs per state). */
  statusCounts: Record<RunStatus, number>;
  tools: ToolStats[];
  fieldEdits: FieldEditStats[];
  /** Median latency between run_created and each human decision on that run. */
  medianMsToDecision: number | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
}

/** Fallback for entries written before the structured meta field. Tool names
 *  are [A-Za-z_]+, so the text before the first "(" or ":" is the tool name. */
function toolNameFromDetail(detail: string): string | null {
  const match = /^([A-Za-z_]+)\s*[(:]/.exec(detail);
  return match ? match[1] : null;
}

function statusFromDetail(detail: string): RunStatus | null {
  const to = detail.split(" -> ")[1]?.trim();
  return (RUN_STATUSES as string[]).includes(to ?? "") ? (to as RunStatus) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function aggregateAudit(entries: AuditEntry[]): DashboardStats {
  const runCreatedAt = new Map<string, number>();
  const runStatus = new Map<string, RunStatus>();
  const tools = new Map<string, ToolStats>();
  const fieldEdits = new Map<string, FieldEditStats>();
  const decisionLatencies: number[] = [];

  const totals: DashboardStats["totals"] = {
    runs: 0,
    actionsProposed: 0,
    decided: 0,
    approved: 0,
    rejected: 0,
    edits: 0,
    executed: 0,
    repliesSent: 0,
    pending: 0,
  };

  const toolStats = (name: string): ToolStats => {
    let stats = tools.get(name);
    if (!stats) {
      stats = { toolName: name, approved: 0, rejected: 0, edited: 0, decided: 0, approvalRate: 0 };
      tools.set(name, stats);
    }
    return stats;
  };

  for (const entry of entries) {
    switch (entry.event) {
      case "run_created": {
        totals.runs += 1;
        runCreatedAt.set(entry.runId, Date.parse(entry.at));
        if (!runStatus.has(entry.runId)) runStatus.set(entry.runId, "to_be_validated");
        const proposed =
          entry.meta?.actionCount ?? Number(/(\d+) proposed action/.exec(entry.detail)?.[1] ?? 0);
        totals.actionsProposed += Number.isFinite(proposed) ? proposed : 0;
        break;
      }
      case "action_approved":
      case "action_rejected": {
        const approved = entry.event === "action_approved";
        totals.decided += 1;
        totals[approved ? "approved" : "rejected"] += 1;
        const name = entry.meta?.toolName ?? toolNameFromDetail(entry.detail);
        if (name) {
          const stats = toolStats(name);
          stats.decided += 1;
          stats[approved ? "approved" : "rejected"] += 1;
        }
        const createdAt = runCreatedAt.get(entry.runId);
        if (createdAt !== undefined) {
          const latency = Date.parse(entry.at) - createdAt;
          if (Number.isFinite(latency) && latency >= 0) decisionLatencies.push(latency);
        }
        break;
      }
      case "action_edited": {
        totals.edits += 1;
        const name = entry.meta?.toolName ?? toolNameFromDetail(entry.detail);
        if (name) toolStats(name).edited += 1;
        for (const key of entry.meta?.editedKeys ?? []) {
          const id = `${name ?? "unknown"}.${key}`;
          const stats = fieldEdits.get(id) ?? { toolName: name ?? "unknown", field: key, edits: 0 };
          stats.edits += 1;
          fieldEdits.set(id, stats);
        }
        break;
      }
      case "action_executed":
        totals.executed += 1;
        break;
      case "reply_sent":
        totals.repliesSent += 1;
        break;
      case "run_status_changed": {
        const to = entry.meta?.to ?? statusFromDetail(entry.detail);
        if (to) runStatus.set(entry.runId, to);
        break;
      }
    }
  }

  totals.pending = Math.max(0, totals.actionsProposed - totals.decided);

  const statusCounts: Record<RunStatus, number> = {
    to_be_validated: 0,
    confirmed: 0,
    rejected: 0,
    partially_confirmed: 0,
  };
  for (const status of runStatus.values()) statusCounts[status] += 1;

  const toolList = [...tools.values()]
    .map((t) => ({ ...t, approvalRate: t.decided > 0 ? t.approved / t.decided : 0 }))
    .sort((a, b) => b.decided - a.decided || a.toolName.localeCompare(b.toolName));

  const fieldEditList = [...fieldEdits.values()].sort(
    (a, b) => b.edits - a.edits || a.field.localeCompare(b.field)
  );

  return {
    totals,
    statusCounts,
    tools: toolList,
    fieldEdits: fieldEditList,
    medianMsToDecision: median(decisionLatencies),
    firstEventAt: entries.length > 0 ? entries[0].at : null,
    lastEventAt: entries.length > 0 ? entries[entries.length - 1].at : null,
  };
}

/** "12s" / "1m 42s" / "2h 05m". Coarse on purpose. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
