import { describe, expect, it } from "vitest";
import { aggregateAudit, formatDuration } from "./analytics";
import type { AuditEntry } from "./types";

/* The analytics module is the read-only half of the dashboard: a pure fold
 * over the append-only audit log. These tests pin the aggregation semantics —
 * per-tool rates, per-field edit counts, status KPIs, median latency — plus
 * the graceful degradation for entries written before the structured `meta`
 * field existed. */

const T0 = "2026-07-01T10:00:00.000Z";

function at(secondsAfterT0: number): string {
  return new Date(Date.parse(T0) + secondsAfterT0 * 1000).toISOString();
}

function entry(partial: Partial<AuditEntry> & Pick<AuditEntry, "event">): AuditEntry {
  return {
    at: T0,
    runId: "run-1",
    actor: "system",
    detail: "",
    ...partial,
  };
}

function createdRun(runId: string, actionCount: number, atTime = T0): AuditEntry {
  return entry({
    event: "run_created",
    runId,
    at: atTime,
    detail: `run created for agent "X" via mock (mock); ${actionCount} proposed action(s) awaiting validation`,
    meta: { fixtureId: "fx", provider: "mock", model: "mock", actionCount },
  });
}

describe("aggregateAudit", () => {
  it("returns an all-zero shape for an empty log", () => {
    const stats = aggregateAudit([]);
    expect(stats.totals).toEqual({
      runs: 0,
      actionsProposed: 0,
      decided: 0,
      approved: 0,
      rejected: 0,
      edits: 0,
      executed: 0,
      repliesSent: 0,
      pending: 0,
    });
    expect(stats.medianMsToDecision).toBeNull();
    expect(stats.tools).toEqual([]);
    expect(stats.fieldEdits).toEqual([]);
    expect(stats.firstEventAt).toBeNull();
  });

  it("aggregates a full run lifecycle into totals, per-tool stats and status KPIs", () => {
    const stats = aggregateAudit([
      createdRun("run-1", 2),
      entry({
        event: "action_edited",
        at: at(30),
        actor: "human",
        detail: 'update_customer_budget_billing_plan: new_bbp 50 -> 45',
        meta: { toolName: "update_customer_budget_billing_plan", editedKeys: ["new_bbp"] },
      }),
      entry({
        event: "action_approved",
        at: at(60),
        actor: "human",
        detail: 'update_customer_budget_billing_plan({"new_bbp":45})',
        meta: { toolName: "update_customer_budget_billing_plan" },
      }),
      entry({
        event: "action_executed",
        at: at(60),
        detail: "mock-executed ...",
        meta: { toolName: "update_customer_budget_billing_plan" },
      }),
      entry({
        event: "action_rejected",
        at: at(120),
        actor: "human",
        detail: 'update_customer_contact_info({"email_adress":"x@y.z"})',
        meta: { toolName: "update_customer_contact_info" },
      }),
      entry({
        event: "run_status_changed",
        at: at(120),
        detail: "to_be_validated -> partially_confirmed",
        meta: { from: "to_be_validated", to: "partially_confirmed" },
      }),
      entry({ event: "reply_sent", at: at(150), actor: "human", detail: "sent (mock)" }),
    ]);

    expect(stats.totals).toEqual({
      runs: 1,
      actionsProposed: 2,
      decided: 2,
      approved: 1,
      rejected: 1,
      edits: 1,
      executed: 1,
      repliesSent: 1,
      pending: 0,
    });
    expect(stats.statusCounts.partially_confirmed).toBe(1);
    expect(stats.statusCounts.to_be_validated).toBe(0);

    const budget = stats.tools.find((t) => t.toolName === "update_customer_budget_billing_plan");
    expect(budget).toMatchObject({ approved: 1, rejected: 0, decided: 1, edited: 1, approvalRate: 1 });
    const contact = stats.tools.find((t) => t.toolName === "update_customer_contact_info");
    expect(contact).toMatchObject({ approved: 0, rejected: 1, decided: 1, approvalRate: 0 });

    expect(stats.fieldEdits).toEqual([
      { toolName: "update_customer_budget_billing_plan", field: "new_bbp", edits: 1 },
    ]);

    // Decisions at +60s and +120s from run creation → median 90s.
    expect(stats.medianMsToDecision).toBe(90_000);
  });

  it("counts a run without status transitions as to_be_validated (pending KPI)", () => {
    const stats = aggregateAudit([createdRun("run-1", 3)]);
    expect(stats.statusCounts.to_be_validated).toBe(1);
    expect(stats.totals.pending).toBe(3);
  });

  it("keeps the LAST status transition per run", () => {
    const stats = aggregateAudit([
      createdRun("run-1", 1),
      entry({ event: "run_status_changed", detail: "to_be_validated -> rejected", meta: { to: "rejected" } }),
      entry({ event: "run_status_changed", detail: "rejected -> confirmed", meta: { to: "confirmed" } }),
    ]);
    expect(stats.statusCounts.confirmed).toBe(1);
    expect(stats.statusCounts.rejected).toBe(0);
  });

  it("degrades gracefully for legacy entries without meta (detail fallbacks)", () => {
    const stats = aggregateAudit([
      entry({
        event: "run_created",
        detail: 'run created for agent "X" via mock (mock); 2 proposed action(s) awaiting validation',
      }),
      entry({ event: "action_approved", at: at(10), detail: 'update_thing({"a":1})' }),
      entry({ event: "action_edited", at: at(5), detail: "update_thing: a 1 -> 2" }),
      entry({ event: "run_status_changed", detail: "to_be_validated -> confirmed" }),
    ]);
    expect(stats.totals.actionsProposed).toBe(2); // parsed from the detail sentence
    expect(stats.tools[0]).toMatchObject({ toolName: "update_thing", approved: 1, edited: 1 });
    expect(stats.fieldEdits).toEqual([]); // legacy edits have no structured keys — never guessed
    expect(stats.statusCounts.confirmed).toBe(1);
  });

  it("computes the median over an even number of decision latencies", () => {
    const stats = aggregateAudit([
      createdRun("run-1", 2),
      entry({ event: "action_approved", at: at(10), meta: { toolName: "a" } }),
      entry({ event: "action_approved", at: at(30), meta: { toolName: "a" } }),
    ]);
    expect(stats.medianMsToDecision).toBe(20_000);
  });

  it("sorts tools by decision volume and never divides by zero", () => {
    const stats = aggregateAudit([
      createdRun("run-1", 3),
      entry({ event: "action_approved", at: at(1), meta: { toolName: "busy_tool" } }),
      entry({ event: "action_rejected", at: at(2), meta: { toolName: "busy_tool" } }),
      entry({ event: "action_approved", at: at(3), meta: { toolName: "quiet_tool" } }),
      // an edit on a tool that never got decided in this log
      entry({ event: "action_edited", at: at(4), meta: { toolName: "edited_only", editedKeys: ["x"] } }),
    ]);
    expect(stats.tools.map((t) => t.toolName)).toEqual(["busy_tool", "quiet_tool", "edited_only"]);
    expect(stats.tools[2]).toMatchObject({ decided: 0, approvalRate: 0 });
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours coarsely", () => {
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(102_000)).toBe("1m 42s");
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe("2h 05m");
  });
});
