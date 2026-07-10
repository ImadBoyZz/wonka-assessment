import { isMutatingTool } from "./parser";
import type { NormalizedToolCall, RiskPolicy, ToolAction } from "./types";

/* Rule-based risk classification. Deterministic, no LLM: the level is derived
 * from the tool schema and the argument values, not asked from the model that
 * proposed the action.
 *
 * Rules, in escalating order:
 *   R1  read-only tool, all arguments declared            -> low
 *   R2  mutating tool                                     -> medium
 *   R3  undeclared tool or undeclared argument            -> high
 *   R4  mutating + a fraud vector: a currency amount at   -> high
 *       or above the policy threshold, or a contact/address change
 * High risk requires a second confirmation click in the UI. */

export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  /** Human-readable rule hits, shown as the badge tooltip. */
  reasons: string[];
}

export const DEFAULT_CURRENCY_THRESHOLD = 1000;

/** Fields whose change could redirect money or goods (email, phone, address). */
const REDIRECTION_KEY_RE = /mail|phone|tel|address/i;

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

export function assessRisk(
  call: NormalizedToolCall,
  action: ToolAction | undefined,
  policy?: RiskPolicy
): RiskAssessment {
  const reasons: string[] = [];
  let level: RiskLevel = "low";
  const escalate = (to: RiskLevel, reason: string) => {
    if (RANK[to] > RANK[level]) level = to;
    reasons.push(reason);
  };

  const mutating = action?.mutating ?? isMutatingTool(call.toolName);
  if (mutating) escalate("medium", "changes external state (R2)");

  // R3: undeclared tool or argument.
  if (!action) {
    escalate("high", "tool is not declared in the agent definition (R3)");
  } else {
    const declared = new Set(action.fields.map((f) => f.key));
    const undeclared = Object.keys(call.args).filter((k) => !declared.has(k) && hasValue(call.args[k]));
    if (undeclared.length > 0) {
      escalate("high", `undeclared argument(s): ${undeclared.join(", ")} (R3)`);
    }
  }

  // R4: fraud vectors, only relevant when the action mutates something.
  if (mutating && action) {
    const threshold = policy?.currencyThreshold ?? DEFAULT_CURRENCY_THRESHOLD;
    for (const field of action.fields) {
      const value = call.args[field.key];
      if (!hasValue(value)) continue;
      if (field.type === "currency" && Number(value) >= threshold) {
        escalate("high", `amount ${String(value)} is at or above the ${threshold} threshold (R4)`);
      }
      if (field.type === "email" || REDIRECTION_KEY_RE.test(field.key)) {
        escalate("high", `changes ${field.label.toLowerCase()} — communication/delivery redirection risk (R4)`);
      }
    }
  }

  if (reasons.length === 0) reasons.push("read-only tool, all arguments declared (R1)");
  return { level, reasons };
}
