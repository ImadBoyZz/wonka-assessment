"use client";

import { Check, PencilSimple, ShieldWarning, Warning, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { ExecutionResult } from "@/lib/executor";
import type { NormalizedToolCall, ToolAction } from "@/lib/types";
import { FieldInput, formatArgValue } from "./FieldRenderer";
import { titleCase } from "@/lib/merger";
import { isMutatingTool } from "@/lib/parser";

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
 *   no declared type to validate an edit against. */

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
  onDecide,
}: {
  action: ToolAction | undefined;
  call: NormalizedToolCall;
  decision: "approved" | "rejected" | undefined;
  execution: ExecutionResult | null | undefined;
  busy: boolean;
  onDecide: (decision: "approved" | "rejected", editedArgs?: Record<string, string>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const label = action?.label ?? titleCase(call.toolName);
  // A tool call OUTSIDE the declared schema is the most suspicious case of
  // all — it must never look safer than a declared one, so the mutating
  // classification falls back to the same deterministic heuristic.
  const mutating = action?.mutating ?? isMutatingTool(call.toolName);
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

  function approveEdited() {
    // Send only what actually changed — the audit diff stays minimal and an
    // untouched field can never be "re-approved" to a stale value.
    const changed: Record<string, string> = {};
    for (const f of action?.fields ?? []) {
      if ((draft[f.key] ?? "") !== toInputString(call.args[f.key])) changed[f.key] = draft[f.key] ?? "";
    }
    onDecide("approved", Object.keys(changed).length > 0 ? changed : undefined);
  }

  return (
    <article className="rounded-lg border border-line bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        {mutating && (
          <span
            title="This action changes external state — it only executes after approval"
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-deep"
          >
            <ShieldWarning className="size-3" weight="bold" /> mutating
          </span>
        )}
      </header>

      {editing && decision === undefined ? (
        <div className="mt-2 flex flex-col gap-2">
          {(action?.fields ?? []).map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-[13px]">
              <span className="text-ink-soft">
                {f.label}
                {!f.required && <span className="ml-1 text-[11px] italic">(optional — clear to omit)</span>}
              </span>
              <FieldInput
                type={f.type}
                value={draft[f.key] ?? ""}
                onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
              />
            </label>
          ))}
          {extraRows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-1.5 text-[13px]">
              <span className="text-ink-soft">
                {row.label}
                <span
                  className="ml-1 inline-flex items-center gap-0.5 text-warn"
                  title="Argument not declared in the tool signature — cannot be edited, only approved or rejected as-is"
                >
                  <Warning className="inline size-3" weight="bold" /> undeclared, read-only
                </span>
                :
              </span>
              <span className="font-medium text-ink">{row.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <dl className="mt-1.5 flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-1.5 text-[13px]">
              <dt className="text-ink-soft">
                {row.label}
                {!row.known && (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 text-warn"
                    title="Argument not declared in the tool signature"
                  >
                    <Warning className="inline size-3" weight="bold" /> undeclared
                  </span>
                )}
                :
              </dt>
              <dd className="font-medium text-ink">{row.value}</dd>
            </div>
          ))}
          {rows.length === 0 && <p className="text-[13px] italic text-ink-soft">No arguments provided.</p>}
        </dl>
      )}

      <footer className="mt-2.5">
        {decision === undefined ? (
          editing ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={approveEdited}
                className="inline-flex items-center gap-1 rounded-md bg-approve px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white hover:bg-approve-deep disabled:opacity-50"
              >
                <Check className="size-3.5" weight="bold" /> Approve edited
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft hover:bg-card disabled:opacity-50"
              >
                <X className="size-3.5" weight="bold" /> Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide("approved")}
                className="inline-flex items-center gap-1 rounded-md bg-approve px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white hover:bg-approve-deep disabled:opacity-50"
              >
                <Check className="size-3.5" weight="bold" /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide("rejected")}
                className="inline-flex items-center gap-1 rounded-md border border-reject bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-wide text-reject hover:bg-reject-soft disabled:opacity-50"
              >
                <X className="size-3.5" weight="bold" /> Reject
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={startEditing}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft hover:bg-card disabled:opacity-50"
                >
                  <PencilSimple className="size-3.5" weight="bold" /> Edit
                </button>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1">
            <span
              className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                decision === "approved" ? "bg-approve text-white" : "bg-reject text-white"
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
              <code className="block truncate rounded bg-panel px-2 py-1 font-mono text-[11px] text-ink-soft" title={execution.message}>
                {execution.message}
              </code>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
