#!/usr/bin/env node
/* Seeds .data/ with a plausible review history so the audit-analytics
 * dashboard (/dashboard) has something to aggregate on a fresh clone.
 *
 * Strictly demo tooling: it writes the SAME shapes the real flow writes
 * (RunRecord files + append-only audit.jsonl with structured meta), through
 * the front door of the file store — it never touches application code and
 * nothing here executes tools. Runs are marked provider "mock" and their ids
 * are prefixed "demo-".
 *
 * Usage:  npm run seed          (refuses if demo data is already present)
 *         npm run seed -- --force   (append another batch anyway)
 */

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const RUN_DIR = path.join(DATA_DIR, "runs");
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");

const now = Date.now();
const HOUR = 3600_000;
const batch = process.argv.includes("--force") ? `-${now.toString(36)}` : "";

/* ------------------------------------------------------------------ */
/* Scenario data — two fixtures, thirteen runs across four days.       */
/* d = approved/rejected, edit = {key, from, to} applied before the    */
/* approve (matching write-ahead semantics: the run file carries the   */
/* corrected args). t = seconds from run creation to the decision.     */
/* ------------------------------------------------------------------ */

const SNC = {
  fixtureId: "supernicecompany-support",
  name: "SuperNiceCompany Customer Support",
  reply:
    "Dear customer,\n\nWe have updated your payment plan and contact details as requested.\n\nBest regards,\nSuperNiceCompany Corporation Customer Service",
  calls: {
    bbp: (v) => ({ toolName: "update_customer_budget_billing_plan", args: { new_bbp: v } }),
    contact: (mail) => ({ toolName: "update_customer_contact_info", args: { email_adress: mail } }),
  },
};

const VIN = {
  fixtureId: "vinventions-order-agent",
  name: "Vinventions Order Processing",
  policy: { currencyThreshold: 1000 },
  reply:
    "Order processed: order lines registered against the pricing matrix, freight as auxiliary line, delivery address set. Flagged items await follow-up.",
  calls: {
    line: (sku, qty, price, pack) => ({
      toolName: "create_order_line",
      args: { sku, quantity: qty, unit_price: price, packaging: pack },
    }),
    aux: (kind, amount) => ({ toolName: "add_auxiliary_line", args: { kind, amount } }),
    address: (address) => ({ toolName: "set_delivery_address", args: { address } }),
    artwork: (reason) => ({ toolName: "flag_missing_artwork", args: { reason } }),
  },
};

/** One scenario = one run. hoursAgo spreads them over the past days so the
 *  dashboard's period line and latency stats look lived-in. */
const SCENARIOS = [
  {
    fx: SNC, hoursAgo: 94, reply: true,
    actions: [
      { call: SNC.calls.bbp(50), d: "approved", t: 95, edit: { key: "new_bbp", from: 50, to: 45 } },
      { call: SNC.calls.contact("antoine.percy@meetwonka.com"), d: "approved", t: 140 },
    ],
  },
  {
    fx: SNC, hoursAgo: 90, reply: true,
    actions: [
      { call: SNC.calls.bbp(50), d: "approved", t: 40 },
      { call: SNC.calls.contact("billing@rapid-pay-eu.example"), d: "rejected", t: 75 },
    ],
  },
  {
    fx: VIN, hoursAgo: 78, reply: true,
    actions: [
      { call: VIN.calls.line("NOM-GRN-44", 250000, 0.045, "bulk bags"), d: "approved", t: 210, edit: { key: "unit_price", from: 0.045, to: 0.042 } },
      { call: VIN.calls.line("NOM-SEL-47", 120000, 0.055, "cartons"), d: "approved", t: 260 },
      { call: VIN.calls.aux("freight", 450), d: "approved", t: 300 },
      { call: VIN.calls.address("Chateau Belleval warehouse, Zone Industrielle Nord, 33250 Pauillac, France"), d: "approved", t: 340 },
      { call: VIN.calls.artwork("Artwork for printed item NOM-GRN-44 announced by separate mail"), d: "approved", t: 360 },
    ],
  },
  {
    fx: SNC, hoursAgo: 71,
    actions: [
      { call: SNC.calls.bbp(280), d: "rejected", t: 55 },
      { call: SNC.calls.contact("refund-desk@quick-transfer.example"), d: "rejected", t: 70 },
    ],
  },
  {
    fx: VIN, hoursAgo: 55, reply: true,
    actions: [
      { call: VIN.calls.line("NOM-CLS-38", 80000, 0.048, "cartons"), d: "approved", t: 150 },
      { call: VIN.calls.aux("freight", 500), d: "approved", t: 190, edit: { key: "amount", from: 500, to: 450 } },
      { call: VIN.calls.address("Bodega San Rafael, Calle Mayor 8, 26350 Cenicero, Spain"), d: "rejected", t: 240 },
      { call: VIN.calls.artwork("No artwork received for printed batch"), d: "approved", t: 270 },
    ],
  },
  {
    fx: SNC, hoursAgo: 52, reply: true,
    actions: [
      { call: SNC.calls.bbp(60), d: "approved", t: 65, edit: { key: "new_bbp", from: 60, to: 50 } },
      { call: SNC.calls.contact("lucie.moreau@vintners.example"), d: "approved", t: 90 },
    ],
  },
  {
    fx: VIN, hoursAgo: 47, reply: true,
    actions: [
      { call: VIN.calls.line("NOM-GRN-44", 25000, 0.042, "bulk bags"), d: "approved", t: 180, edit: { key: "quantity", from: 25000, to: 250000 } },
      { call: VIN.calls.aux("pallets", 120), d: "approved", t: 220 },
      { call: VIN.calls.address("Weingut Steiner, Kellergasse 4, 3550 Langenlois, Austria"), d: "approved", t: 250 },
    ],
  },
  {
    fx: SNC, hoursAgo: 30, reply: true,
    actions: [
      { call: SNC.calls.bbp(45), d: "approved", t: 30 },
      { call: SNC.calls.contact("j.vandenberg@corkimport.example"), d: "approved", t: 45 },
    ],
  },
  {
    fx: VIN, hoursAgo: 26,
    actions: [
      { call: VIN.calls.line("NOM-XXL-99", 500000, 0.03, "bulk bags"), d: "rejected", t: 120 },
      { call: VIN.calls.aux("rebate", -250), d: "approved", t: 160 },
      { call: VIN.calls.address("Cantina Rossi, Via del Vino 12, 53024 Montalcino, Italy"), d: "approved", t: 200 },
    ],
  },
  {
    fx: VIN, hoursAgo: 22, reply: true,
    actions: [
      { call: VIN.calls.line("NOM-SEL-47", 60000, 0.055, "cartons"), d: "approved", t: 95 },
      { call: VIN.calls.aux("freight", 380), d: "approved", t: 130 },
    ],
  },
  {
    fx: SNC, hoursAgo: 8, reply: true,
    actions: [
      { call: SNC.calls.bbp(55), d: "approved", t: 50 },
      { call: SNC.calls.contact("m.dubois@chateau-mail.example"), d: "approved", t: 80, edit: { key: "email_adress", from: "m.dubois@chateau-mail.example", to: "marc.dubois@chateau-mail.example" } },
    ],
  },
  // Two runs still awaiting review — the pending slice of every KPI.
  {
    fx: VIN, hoursAgo: 3,
    actions: [
      { call: VIN.calls.line("NOM-GRN-44", 90000, 0.042, "bulk bags"), t: null },
      { call: VIN.calls.artwork("Printed closures, artwork missing from PO"), t: null },
    ],
  },
  {
    fx: SNC, hoursAgo: 1,
    actions: [{ call: SNC.calls.bbp(50), t: null }],
  },
];

/* ------------------------------------------------------------------ */

function deriveStatus(decisions, total) {
  if (decisions.length < total) return "to_be_validated";
  const approved = decisions.filter((d) => d === "approved").length;
  if (approved === total) return "confirmed";
  if (approved === 0) return "rejected";
  return "partially_confirmed";
}

async function main() {
  try {
    const existing = await fs.readFile(AUDIT_FILE, "utf8");
    if (existing.includes('"runId":"demo-') && !process.argv.includes("--force")) {
      console.log("Demo data already present in .data/audit.jsonl — use --force to append another batch.");
      return;
    }
  } catch {
    // No audit log yet — fresh seed.
  }

  await fs.mkdir(RUN_DIR, { recursive: true });
  const auditEntries = [];
  let seededRuns = 0;

  for (const [index, scenario] of SCENARIOS.entries()) {
    const { fx } = scenario;
    const runId = `demo-${String(index + 1).padStart(3, "0")}${batch}`;
    const createdMs = now - scenario.hoursAgo * HOUR;
    const createdAt = new Date(createdMs).toISOString();

    const toolCalls = scenario.actions.map((a, i) => ({
      id: `call-${i + 1}`,
      toolName: a.call.toolName,
      args: { ...a.call.args },
    }));

    auditEntries.push({
      at: createdAt,
      runId,
      actor: "system",
      event: "run_created",
      detail: `run created for agent "${fx.name}" via mock (mock); ${toolCalls.length} proposed action(s) awaiting validation`,
      meta: { fixtureId: fx.fixtureId, provider: "mock", model: "mock", actionCount: toolCalls.length },
    });

    const decisions = {};
    let lastDecisionMs = createdMs;

    for (const [i, action] of scenario.actions.entries()) {
      if (!action.d) continue;
      const call = toolCalls[i];
      const decidedMs = createdMs + action.t * 1000;
      lastDecisionMs = Math.max(lastDecisionMs, decidedMs);

      if (action.edit) {
        call.args[action.edit.key] = action.edit.to; // write-ahead: the run file carries corrected args
        auditEntries.push({
          at: new Date(decidedMs - 15_000).toISOString(),
          runId,
          actor: "human",
          event: "action_edited",
          detail: `${call.toolName}: ${action.edit.key} ${JSON.stringify(action.edit.from)} -> ${JSON.stringify(action.edit.to)}`,
          meta: { toolName: call.toolName, editedKeys: [action.edit.key] },
        });
      }

      decisions[call.id] = action.d;
      auditEntries.push({
        at: new Date(decidedMs).toISOString(),
        runId,
        actor: "human",
        event: action.d === "approved" ? "action_approved" : "action_rejected",
        detail: `${call.toolName}(${JSON.stringify(call.args)})`,
        meta: { toolName: call.toolName },
      });
      if (action.d === "approved") {
        auditEntries.push({
          at: new Date(decidedMs + 1000).toISOString(),
          runId,
          actor: "system",
          event: "action_executed",
          detail: `mock-executed ${call.toolName}(${JSON.stringify(call.args)})`,
          meta: { toolName: call.toolName },
        });
      }
    }

    const status = deriveStatus(Object.values(decisions), toolCalls.length);
    if (status !== "to_be_validated") {
      auditEntries.push({
        at: new Date(lastDecisionMs + 1000).toISOString(),
        runId,
        actor: "system",
        event: "run_status_changed",
        detail: `to_be_validated -> ${status}`,
        meta: { from: "to_be_validated", to: status },
      });
    }

    const replySent = Boolean(scenario.reply);
    if (replySent) {
      auditEntries.push({
        at: new Date(lastDecisionMs + 30_000).toISOString(),
        runId,
        actor: "human",
        event: "reply_sent",
        detail: "suggested reply approved and sent (mock)",
        meta: { fixtureId: fx.fixtureId },
      });
    }

    const run = {
      runId,
      fixtureId: fx.fixtureId,
      provider: "mock",
      inputs: {},
      toolCalls,
      replyText: fx.reply,
      decisions,
      replySent,
      status,
      createdAt,
      ...(fx.policy ? { policy: fx.policy } : {}),
      trace: {
        provider: "mock",
        model: "mock",
        durationMs: 40,
        truncated: false,
        fallbackPath: [],
        systemPrompt: "(seeded demo run — see the fixture for the real prompt)",
        renderedUserPrompt: "(seeded demo run)",
      },
    };
    await fs.writeFile(path.join(RUN_DIR, `${runId}.json`), JSON.stringify(run, null, 2), "utf8");
    seededRuns += 1;
  }

  auditEntries.sort((a, b) => a.at.localeCompare(b.at));
  const lines = auditEntries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.appendFile(AUDIT_FILE, lines, "utf8");

  console.log(
    `Seeded ${seededRuns} demo runs (${auditEntries.length} audit entries) into .data/ — open /dashboard to see the aggregation.`
  );
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exitCode = 1;
});
