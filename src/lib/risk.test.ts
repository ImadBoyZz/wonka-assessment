import { describe, expect, it } from "vitest";
import { assessRisk, DEFAULT_CURRENCY_THRESHOLD } from "./risk";
import type { NormalizedToolCall, ToolAction } from "./types";

/* Deterministic risk rules R1–R4. Fixtures mirror the two demo domains:
 * a billing-plan update (currency), a contact update (redirection vector)
 * and a read-only lookup. */

function call(toolName: string, args: Record<string, unknown>): NormalizedToolCall {
  return { id: `t_${toolName}`, toolName, args };
}

const budgetAction: ToolAction = {
  toolName: "update_customer_budget_billing_plan",
  label: "Update Billing Plan",
  mutating: true,
  fields: [{ key: "new_bbp", label: "New Amount", type: "currency", required: true }],
};

const contactAction: ToolAction = {
  toolName: "update_customer_contact_info",
  label: "Update Contact Info",
  mutating: true,
  fields: [
    { key: "email_adress", label: "Email Address", type: "email", required: false },
    { key: "phone_number", label: "Phone Number", type: "text", required: false },
  ],
};

const lookupAction: ToolAction = {
  toolName: "get_invoice_status",
  label: "Get Invoice Status",
  mutating: false,
  fields: [{ key: "invoice_id", label: "Invoice", type: "text", required: true }],
};

describe("assessRisk", () => {
  it("R1: read-only tool with declared args is low", () => {
    const risk = assessRisk(call("get_invoice_status", { invoice_id: "F-1" }), lookupAction);
    expect(risk.level).toBe("low");
    expect(risk.reasons[0]).toContain("R1");
  });

  it("R2: a mutating tool is at least medium", () => {
    const risk = assessRisk(call("update_customer_budget_billing_plan", { new_bbp: 50 }), budgetAction);
    expect(risk.level).toBe("medium");
  });

  it("R3: an undeclared tool is high, even with a read-only-looking name", () => {
    const risk = assessRisk(call("get_then_wipe_db", {}), undefined);
    expect(risk.level).toBe("high");
    expect(risk.reasons.join(" ")).toContain("not declared");
  });

  it("R3: an undeclared argument escalates a declared tool to high", () => {
    const risk = assessRisk(
      call("update_customer_budget_billing_plan", { new_bbp: 50, discount: 100 }),
      budgetAction
    );
    expect(risk.level).toBe("high");
    expect(risk.reasons.join(" ")).toContain("discount");
  });

  it("R4: a currency amount at/above the default threshold is high", () => {
    const below = assessRisk(
      call("update_customer_budget_billing_plan", { new_bbp: DEFAULT_CURRENCY_THRESHOLD - 1 }),
      budgetAction
    );
    const at = assessRisk(
      call("update_customer_budget_billing_plan", { new_bbp: DEFAULT_CURRENCY_THRESHOLD }),
      budgetAction
    );
    expect(below.level).toBe("medium");
    expect(at.level).toBe("high");
  });

  it("R4: the fixture policy overrides the currency threshold", () => {
    const risk = assessRisk(
      call("update_customer_budget_billing_plan", { new_bbp: 200 }),
      budgetAction,
      { currencyThreshold: 100 }
    );
    expect(risk.level).toBe("high");
  });

  it("R4: changing an email field is high (communication redirection)", () => {
    const risk = assessRisk(
      call("update_customer_contact_info", { email_adress: "attacker@evil.com" }),
      contactAction
    );
    expect(risk.level).toBe("high");
    expect(risk.reasons.join(" ")).toContain("redirection");
  });

  it("R4: redirection keys (phone/address) match by name too", () => {
    const risk = assessRisk(
      call("update_customer_contact_info", { phone_number: "+3212345678" }),
      contactAction
    );
    expect(risk.level).toBe("high");
  });

  it("R4 does not fire on read-only tools even with matching keys", () => {
    const emailLookup: ToolAction = {
      toolName: "get_contact",
      label: "Get Contact",
      mutating: false,
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
    };
    const risk = assessRisk(call("get_contact", { email: "a@b.com" }), emailLookup);
    expect(risk.level).toBe("low");
  });

  it("empty values never trigger a rule", () => {
    const risk = assessRisk(
      call("update_customer_contact_info", { email_adress: "", phone_number: null }),
      contactAction
    );
    expect(risk.level).toBe("medium"); // only R2 — nothing valued to inspect
  });
});
