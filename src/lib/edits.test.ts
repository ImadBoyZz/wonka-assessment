import { describe, expect, it } from "vitest";
import { describeChanges, validateEditedArgs } from "./edits";
import { parseToolSignature } from "./parser";

/* Edit-before-approve validation: the client sends raw input strings; the
 * server coerces and validates them against the same parsed types the provider
 * tools were built from. These tests use the assignment's own signatures,
 * including the one missing its closing parenthesis. */

const budgetTool = parseToolSignature("update_customer_budget_billing_plan(new_bbp : float)");
// Verbatim assignment typo: missing closing parenthesis (recovery path).
const contactTool = parseToolSignature(
  "update_customer_contact_info(email_adress : optional(str), phone_number : optional(str)"
);
const mixedTool = parseToolSignature("book_order(qty : int, express : bool, note : optional(str))");

describe("validateEditedArgs", () => {
  it("coerces a numeric input string to a float", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { new_bbp: "45.5" });
    expect(result).toEqual({
      ok: true,
      args: { new_bbp: 45.5 },
      changes: { new_bbp: { from: 50, to: 45.5 } },
    });
  });

  it("rejects a non-numeric value for a float param", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { new_bbp: "fifty" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("new_bbp");
  });

  it("rejects a whitespace-padded non-number instead of coercing it to 0", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { new_bbp: " abc " });
    expect(result.ok).toBe(false);
  });

  it("enforces int (no fractions) while accepting an integer string", () => {
    expect(validateEditedArgs(mixedTool, { qty: 3, express: false }, { qty: "2.5" }).ok).toBe(false);
    const ok = validateEditedArgs(mixedTool, { qty: 3, express: false }, { qty: "12" });
    expect(ok).toMatchObject({ ok: true, args: { qty: 12, express: false } });
  });

  it("coerces 'true'/'false' strings for bool and rejects anything else", () => {
    const ok = validateEditedArgs(mixedTool, { qty: 3, express: false }, { express: "true" });
    expect(ok).toMatchObject({ ok: true, args: { qty: 3, express: true } });
    expect(validateEditedArgs(mixedTool, { qty: 3, express: false }, { express: "maybe" }).ok).toBe(false);
  });

  it("clearing an optional param removes it from the final args", () => {
    const result = validateEditedArgs(
      contactTool,
      { email_adress: "old@example.com", phone_number: "+3212345678" },
      { phone_number: "" }
    );
    expect(result).toEqual({
      ok: true,
      args: { email_adress: "old@example.com" },
      changes: { phone_number: { from: "+3212345678", to: undefined } },
    });
  });

  it("refuses to clear a required param", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { new_bbp: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("required");
  });

  it("refuses edits on undeclared arguments", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { discount: "100" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("not a declared parameter");
  });

  it("filling a previously omitted optional param adds it (from: unset)", () => {
    const result = validateEditedArgs(
      contactTool,
      { email_adress: "a@b.com" },
      { phone_number: "+3287654321" }
    );
    expect(result).toEqual({
      ok: true,
      args: { email_adress: "a@b.com", phone_number: "+3287654321" },
      changes: { phone_number: { from: undefined, to: "+3287654321" } },
    });
  });

  it("an edit back to the same value produces no change entry", () => {
    const result = validateEditedArgs(budgetTool, { new_bbp: 50 }, { new_bbp: "50" });
    expect(result).toEqual({ ok: true, args: { new_bbp: 50 }, changes: {} });
  });

  it("one invalid field rejects the whole edit (no partial application)", () => {
    const result = validateEditedArgs(
      mixedTool,
      { qty: 3, express: false },
      { qty: "7", express: "banana" }
    );
    expect(result.ok).toBe(false);
  });
});

describe("describeChanges", () => {
  it("renders an audit-friendly old -> new line", () => {
    expect(
      describeChanges("update_customer_budget_billing_plan", { new_bbp: { from: 50, to: 45 } })
    ).toBe("update_customer_budget_billing_plan: new_bbp 50 -> 45");
  });

  it("marks cleared and previously unset values", () => {
    expect(
      describeChanges("update_customer_contact_info", {
        phone_number: { from: "+32123", to: undefined },
        email_adress: { from: undefined, to: "new@x.com" },
      })
    ).toBe('update_customer_contact_info: phone_number "+32123" -> (cleared), email_adress (unset) -> "new@x.com"');
  });
});
