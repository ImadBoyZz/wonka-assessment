import { describe, expect, it } from "vitest";
import {
  collectParserWarnings,
  isMutatingTool,
  parseAgentDefinition,
  parsePlaceholders,
  parseToolSignature,
  renderUserPrompt,
  toProviderTools,
} from "./parser";

/* The strings below are VERBATIM from the assignment PDF — including the
 * typo'd placeholder keys ({{generic_intructions}}, {{custome_mail}}), the
 * typo'd parameter name (email_adress) and the missing closing parenthesis
 * on the second tool signature. The parser must survive the assignment
 * exactly as written, not a cleaned-up version of it. */

const SYSTEM_PROMPT =
  "you are an agent for the customer support of SuperNiceCompany Corporation.\n\n" +
  "your tasks are the following :\n" +
  "- generating responses to customer written requests based on generic instructions and historical data about elder human written question/response.\n" +
  "- if the customer written request can be resolved by any of you available tool, resolve it.";

const TEMPLATE =
  "Generic instructions :\n{{generic_intructions}}\nCustomer mail :\n{{custome_mail}}\n" +
  "similar questions & responses :\n{{similar_questions_responses}}\nanswer :";

const TOOL_1 = "update_customer_budget_billing_plan(new_bbp : float)";
// As printed in the PDF: no closing parenthesis.
const TOOL_2_VERBATIM = "update_customer_contact_info(email_adress : optional(str), phone_number : optional(str)";
const TOOL_2_CLOSED = `${TOOL_2_VERBATIM})`;

describe("parsePlaceholders (verbatim assignment template)", () => {
  const { placeholders, trailingText } = parsePlaceholders(TEMPLATE);

  it("extracts the typo'd keys exactly as written", () => {
    expect(placeholders.map((p) => p.key)).toEqual([
      "generic_intructions",
      "custome_mail",
      "similar_questions_responses",
    ]);
  });

  it("captures the label text preceding each placeholder", () => {
    expect(placeholders.map((p) => p.labelBefore)).toEqual([
      "Generic instructions",
      "Customer mail",
      "similar questions & responses",
    ]);
  });

  it("detects the trailing completion marker", () => {
    expect(trailingText).toBe("answer :");
  });

  it("dedupes repeated placeholders and ignores label lines that are placeholders", () => {
    const twice = parsePlaceholders("{{a}}\n{{b}}\n{{a}}");
    expect(twice.placeholders.map((p) => p.key)).toEqual(["a", "b"]);
    expect(twice.placeholders[1].labelBefore).toBeNull();
    expect(twice.trailingText).toBeNull();
  });
});

describe("parseToolSignature (verbatim assignment tools)", () => {
  it("parses a required float parameter", () => {
    const tool = parseToolSignature(TOOL_1, "updates the customer budget billing plan");
    expect(tool.name).toBe("update_customer_budget_billing_plan");
    expect(tool.params).toEqual([
      { name: "new_bbp", baseType: "float", rawType: "float", required: true },
    ]);
  });

  it("survives the missing closing parenthesis exactly as printed in the PDF", () => {
    const tool = parseToolSignature(TOOL_2_VERBATIM);
    expect(tool.name).toBe("update_customer_contact_info");
    expect(tool.params).toHaveLength(2);
    expect(tool.params[0]).toMatchObject({ name: "email_adress", baseType: "str", required: false });
    expect(tool.params[1]).toMatchObject({ name: "phone_number", baseType: "str", required: false });
  });

  it("parses identically with and without the closing parenthesis", () => {
    expect(parseToolSignature(TOOL_2_VERBATIM).params).toEqual(parseToolSignature(TOOL_2_CLOSED).params);
  });

  it("handles tools without parameters", () => {
    expect(parseToolSignature("refresh_cache()").params).toEqual([]);
    expect(parseToolSignature("refresh_cache").params).toEqual([]);
  });

  it("degrades unknown types to 'unknown' instead of throwing", () => {
    const tool = parseToolSignature("schedule(when : datetime, tags : list(str))");
    expect(tool.params[0]).toMatchObject({ baseType: "unknown", rawType: "datetime", required: true });
    expect(tool.params[1]).toMatchObject({ baseType: "unknown", rawType: "list(str)", required: true });
  });

  it("parses int and bool types", () => {
    const tool = parseToolSignature("create_order_line(sku : str, quantity : int, rush : bool)");
    expect(tool.params.map((p) => p.baseType)).toEqual(["str", "int", "bool"]);
  });
});

describe("parseAgentDefinition + derived views", () => {
  const schema = parseAgentDefinition({
    system_prompt: SYSTEM_PROMPT,
    user_prompt_template: TEMPLATE,
    tools: [
      { signature: TOOL_1, description: "updates the customer budget billing plan and replaces the previous amount by new_bbp in euros" },
      { signature: TOOL_2_VERBATIM, description: "updates customer contact information with the provided email address and/or phone number" },
    ],
  });

  it("produces the full ground-truth schema", () => {
    expect(schema.placeholders).toHaveLength(3);
    expect(schema.tools).toHaveLength(2);
    expect(schema.trailingText).toBe("answer :");
  });

  it("derives provider tool schemas with optionals excluded from required", () => {
    const tools = toProviderTools(schema);
    expect(tools[0].inputSchema.properties).toEqual({ new_bbp: { type: "number" } });
    expect(tools[0].inputSchema.required).toEqual(["new_bbp"]);
    expect(tools[1].inputSchema.required).toEqual([]);
    expect(Object.keys(tools[1].inputSchema.properties)).toEqual(["email_adress", "phone_number"]);
  });

  it("renders the user prompt with typo'd keys and keeps the trailing marker", () => {
    const rendered = renderUserPrompt(TEMPLATE, {
      generic_intructions: "GI",
      custome_mail: "CM",
      similar_questions_responses: "SQR",
    });
    expect(rendered).toBe(
      "Generic instructions :\nGI\nCustomer mail :\nCM\nsimilar questions & responses :\nSQR\nanswer :"
    );
  });

  it("leaves unknown placeholder inputs empty instead of leaking the slot syntax", () => {
    expect(renderUserPrompt("x {{missing}} y", {})).toBe("x  y");
  });
});

describe("collectParserWarnings (silent degradation made visible)", () => {
  it("reports zero warnings for the verbatim assignment definition", () => {
    const def = {
      system_prompt: SYSTEM_PROMPT,
      user_prompt_template: TEMPLATE,
      tools: [
        { signature: TOOL_1, description: "" },
        { signature: TOOL_2_VERBATIM, description: "" },
      ],
    };
    expect(collectParserWarnings(def, parseAgentDefinition(def))).toEqual([]);
  });

  it("warns when a placeholder key is outside the supported syntax (accents)", () => {
    const def = {
      system_prompt: "",
      user_prompt_template: "Client :\n{{données_client}}\nanswer :",
      tools: [],
    };
    const schema = parseAgentDefinition(def);
    expect(schema.placeholders).toHaveLength(0); // silently dropped by the strict grammar…
    const warnings = collectParserWarnings(def, schema);
    expect(warnings).toHaveLength(1); // …but never silently for the user
    expect(warnings[0]).toContain("données_client");
  });

  it("warns when a tool name contains unsupported characters", () => {
    const def = {
      system_prompt: "",
      user_prompt_template: "{{input}}",
      tools: [{ signature: "créer_ligne(prix : float)", description: "" }],
    };
    const schema = parseAgentDefinition(def);
    const warnings = collectParserWarnings(def, schema);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("créer_ligne");
    expect(warnings[0]).toContain(`"${schema.tools[0].name}"`);
  });

  it("dedupes repeated unsupported placeholders", () => {
    const def = {
      system_prompt: "",
      user_prompt_template: "{{bad-key}} en nog eens {{bad-key}}",
      tools: [],
    };
    expect(collectParserWarnings(def, parseAgentDefinition(def))).toHaveLength(1);
  });
});

describe("isMutatingTool", () => {
  it("treats update_/create_ tools as mutating and get_/list_ as read-only", () => {
    expect(isMutatingTool("update_customer_contact_info")).toBe(true);
    expect(isMutatingTool("create_order_line")).toBe(true);
    expect(isMutatingTool("flag_missing_artwork")).toBe(true);
    expect(isMutatingTool("get_order_status")).toBe(false);
    expect(isMutatingTool("list_products")).toBe(false);
  });
});
