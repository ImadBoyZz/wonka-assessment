"use client";

import { Check, PencilSimple, ShieldWarning, Warning, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { ExecutionResult } from "@/lib/executor";
import type { NormalizedToolCall, RiskPolicy, ToolAction } from "@/lib/types";
import { FieldInput, formatArgValue } from "./FieldRenderer";
import { titleCase } from "@/lib/merger";
import { isMutatingTool } from "@/lib/parser";
import { assessRisk, type RiskLevel } from "@/lib/risk";

/* Panel 2 card — one proposed tool call, pending until a human decides.
 *
 * - Only arguments the model actually provided are shown: an optional
 *   parameter left empty (like phone_number in the example) produces no row.
 * - Arguments NOT declared in the schema are still shown, flagged — hiding
 *   what would be executed is exactly the wrong failure mode.
 * - Values render prominently so a reviewer can spot a manipulated value
 *   (prompt injection) before approving.
 * - Declared arguments are EDITABLE before approval (correct-and-confirm,
 *   the reference project's "all order fields are editable"). Edits reuse
 *   the same whitelisted FieldInput registry as the input panel and are
 *   re-validated server-side against the AgentSchema types — this client
 *   only proposes strings. Undeclared arguments stay read-only: there is
 *   no declared type to validate an edit against.
 * - Every card carries a deterministic risk badge (src/lib/risk.ts, rules
 *   R1–R4 — never the model's own opinion); HIGH requires an explicit
 *   second confirmation click before the approve is sent. */

/* Risk is the loudest signal on a card: only medium/high carry color,
 * low stays a quiet outline — color budget goes to what needs attention. */
const RISK_STYLE: Record<RiskLevel, string> = {
  low: "border border-line-strong text-ink-faint",
  medium: "bg-warn-soft text-warn-deep",
  high: "bg-reject-soft text-reject-deep",
};

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** Tool-call arg → editable input string (the inverse of what the server
 *  coerces back with Zod). */
function toInputString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ActionCard({
  action,
  call,
  decision,
  execution,
  busy,
  policy,
  onDecide,
}: {
  action: ToolAction | undefined;
  call: NormalizedToolCall;
  decision: "approved" | "rejected" | undefined;
  execution: ExecutionResult | null | undefined;
  busy: boolean;
  policy?: RiskPolicy;
  onDecide: (decision: "approved" | "rejected", editedArgs?: Record<string, string>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const label = action?.label ?? titleCase(call.toolName);
  // A tool call OUTSIDE the declared schema is the most suspicious case of
  // all — it must never look safer than a declared one, so the mutating
  // classification falls back to the same deterministic heuristic.
  const mutating = action?.mutating ?? isMutatingTool(call.toolName);
  const risk = assessRisk(call, action, policy);
  // Only declared tools with declared params can be edited (see server-side
  // validation: undeclared → nothing to validate against).
  const canEdit = decision === undefined && (action?.fields.length ?? 0) > 0;

  // Schema-ordered known params first, then any unrecognized extras.
  const knownRows = (action?.fields ?? [])
    .filter((f) => hasValue(call.args[f.key]))
    .map((f) => ({ key: f.key, label: f.label, value: formatArgValue(f.type, call.args[f.key]), known: true }));
  const knownKeys = new Set((action?.fields ?? []).map((f) => f.key));
  const extraRows = Object.entries(call.args)
    .filter(([key, value]) => !knownKeys.has(key) && hasValue(value))
    .map(([key, value]) => ({ key, label: titleCase(key), value: formatArgValue("unknown", value), known: false }));
  const rows = [...knownRows, ...extraRows];

  function startEditing() {
    const initial: Record<string, string> = {};
    for (const f of action?.fields ?? []) initial[f.key] = toInputString(call.args[f.key]);
    setDraft(initial);
    setEditing(true);
  }

  function changedDraft(): Record<string, string> | undefined {
    // Send only what actually changed — the audit diff stays minimal and an
    // untouched field can never be "re-approved" to a stale value.
    const changed: Record<string, string> = {};
    for (const f of action?.fields ?? []) {
      if ((draft[f.key] ?? "") !== toInputString(call.args[f.key])) changed[f.key] = draft[f.key] ?? "";
    }
    return Object.keys(changed).length > 0 ? changed : undefined;
  }

  /** HIGH-risk approvals need a second, explicit click; the first one only
   *  arms the confirmation step. Nothing about this lives on the server —
   *  the server-side gates (409, validation) are unchanged. */
  function requestApprove() {
    if (risk.level === "high" && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onDecide("approved", editing ? changedDraft() : undefined);
  }

  return (
    <article
      className={`rounded-md border bg-card p-3 transition-colors ${
        decision === undefined ? "border-line-strong" : "border-line"
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">{label}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {mutating && (
            <span
              title="This action changes external state; it only executes after approval"
              className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-soft"
            >
              <ShieldWarning className="size-3" weight="bold" /> mutating
            </span>
          )}
          <span
            title={risk.reasons.join("\n")}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[10.5px] font-medium ${RISK_STYLE[risk.level]}`}
          >
            {risk.level === "high" && <Warning className="size-3" weight="bold" />}
            {risk.level} risk
          </span>
        </div>
      </header>

      {editing && decision === undefined ? (
        <div className="mt-2.5 flex flex-col gap-2">
          {(action?.fields ?? []).map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-ink-soft">
                {f.label}
                {!f.required && <span className="ml-1 text-[11px] italic text-ink-faint">(optional: clear to omit)</span>}
              </span>
              <FieldInput
                type={f.type}
                value={draft[f.key] ?? ""}
                onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
              />
            </label>
          ))}
          {extraRows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-1.5 text-[12.5px]">
              <span className="text-ink-soft">
                {row.label}
                <span
                  className="ml-1 inline-flex items-center gap-0.5 text-warn-deep"
                  title="Argument not declared in the tool signature; it cannot be edited, only approved or rejected as-is"
                >
                  <Warning className="inline size-3" weight="bold" /> undeclared, read-only
                </span>
                :
              </span>
              <span className="font-mono text-[12.5px] font-medium text-ink">{row.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <dl className="mt-2 flex flex-col gap-1">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-2 text-[12.5px]">
              <dt className="shrink-0 text-ink-soft">
                {row.label}
                {!row.known && (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 text-warn-deep"
                    title="Argument not declared in the tool signature"
                  >
                    <Warning className="inline size-3" weight="bold" /> undeclared
                  </span>
                )}
              </dt>
              <dd className="min-w-0 break-words font-mono font-medium text-ink">{row.value}</dd>
            </div>
          ))}
          {rows.length === 0 && <p className="text-[12.5px] italic text-ink-faint">No arguments provided.</p>}
        </dl>
      )}

      <footer className="mt-3">
        {decision === undefined ? (
          confirming ? (
            <div className="flex flex-col gap-2 rounded-md border border-reject/40 bg-reject-soft p-2.5">
              <p className="text-[12px] font-medium leading-relaxed text-reject-deep">
                High-risk action ({risk.reasons.join("; ")}). Approve anyway?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={requestApprove}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-approve px-2.5 text-[12px] font-semibold text-panel transition-colors hover:bg-approve-deep disabled:opacity-50"
                >
                  <Check className="size-3.5" weight="bold" /> Confirm approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-panel px-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
                >
                  <X className="size-3.5" weight="bold" /> Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={requestApprove}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-approve px-3 text-[12.5px] font-semibold text-panel transition-colors hover:bg-approve-deep disabled:opacity-50"
              >
                <Check className="size-3.5" weight="bold" /> {editing ? "Approve edited" : "Approve"}
              </button>
              {editing ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
                >
                  <X className="size-3.5" weight="bold" /> Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDecide("rejected")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-reject/50 bg-panel px-3 text-[12.5px] font-semibold text-reject transition-colors hover:bg-reject-soft disabled:opacity-50"
                  >
                    <X className="size-3.5" weight="bold" /> Reject
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={startEditing}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
                    >
                      <PencilSimple className="size-3.5" weight="bold" /> Edit
                    </button>
                  )}
                </>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            <span
              className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-px font-mono text-[11px] font-medium ${
                decision === "approved" ? "bg-approve-soft text-approve-deep" : "bg-reject-soft text-reject-deep"
              }`}
            >
              {decision === "approved" ? (
                <Check className="size-3" weight="bold" />
              ) : (
                <X className="size-3" weight="bold" />
              )}
              {decision}
            </span>
            {execution && (
              <code className="block truncate font-mono text-[11px] text-ink-faint" title={execution.message}>
                {execution.message}
              </code>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
