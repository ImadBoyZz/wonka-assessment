import { z } from "zod";
import type { ParsedParam, ParsedTool } from "./types";

/* Server-side validation for edited action arguments.
 *
 * A reviewer can correct a pending action's arguments before approving it.
 * The client sends raw strings; the types it claims are not trusted. Each
 * edited value is re-validated here against the same parameter types the
 * parser produced, so an edit can't set a value the tool signature would not
 * allow. */

export type EditValidationResult =
  | {
      ok: true;
      /** Final args: original ⊕ validated edits, empty optionals removed. */
      args: Record<string, unknown>;
      /** Only the values that actually changed (for the audit trail).
       *  `to: undefined` means the optional param was cleared. */
      changes: Record<string, { from: unknown; to: unknown }>;
    }
  | { ok: false; errors: string[] };

/** Zod validator per base type. Mirrors jsonSchemaType() in parser.ts: a
 *  human may correct a value to whatever the model was allowed to send. */
function validatorFor(param: ParsedParam): z.ZodType<unknown> {
  switch (param.baseType) {
    case "float":
      return z.coerce.number().finite();
    case "int":
      return z.coerce.number().int();
    case "bool":
      return z.preprocess((v) => {
        if (v === "true") return true;
        if (v === "false") return false;
        return v;
      }, z.boolean());
    case "str":
    case "unknown":
      // unknown degrades to a text input in the UI, so it round-trips as a string.
      return z.string();
  }
}

function isCleared(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

export function validateEditedArgs(
  tool: ParsedTool,
  originalArgs: Record<string, unknown>,
  edits: Record<string, unknown>
): EditValidationResult {
  const errors: string[] = [];
  const args = { ...originalArgs };
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, raw] of Object.entries(edits)) {
    const param = tool.params.find((p) => p.name === key);
    if (!param) {
      // Undeclared arguments are shown (flagged) but never editable: there is
      // no declared type to validate an edit against.
      errors.push(`"${key}" is not a declared parameter of ${tool.name} — undeclared arguments cannot be edited`);
      continue;
    }

    if (isCleared(raw)) {
      if (param.required) {
        errors.push(`"${key}" is required and cannot be cleared`);
        continue;
      }
      if (key in args) {
        changes[key] = { from: args[key], to: undefined };
        delete args[key]; // empty optional params are omitted, same as at run time
      }
      continue;
    }

    const value = typeof raw === "string" && param.baseType !== "str" ? raw.trim() : raw;
    const parsed = validatorFor(param).safeParse(value);
    if (!parsed.success) {
      errors.push(`"${key}" must be a valid ${param.rawType || param.baseType}`);
      continue;
    }
    if (parsed.data !== args[key]) {
      changes[key] = { from: args[key], to: parsed.data };
      args[key] = parsed.data;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, args, changes };
}

/** One audit-friendly line describing an edit, e.g.
 *  `update_customer_budget_billing_plan: new_bbp 50 -> 45`. */
export function describeChanges(
  toolName: string,
  changes: Record<string, { from: unknown; to: unknown }>
): string {
  const parts = Object.entries(changes).map(([key, { from, to }]) => {
    const fromStr = from === undefined ? "(unset)" : JSON.stringify(from);
    const toStr = to === undefined ? "(cleared)" : JSON.stringify(to);
    return `${key} ${fromStr} -> ${toStr}`;
  });
  return `${toolName}: ${parts.join(", ")}`;
}
