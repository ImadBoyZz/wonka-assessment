import type {
  AgentDefinition,
  AgentSchema,
  BaseType,
  ParsedParam,
  ParsedPlaceholder,
  ParsedTool,
} from "./types";

/* ------------------------------------------------------------------ */
/* Structural Parser — 100% deterministic.                             */
/*                                                                     */
/* Everything structural (which placeholders exist, which tools exist, */
/* which params they take, which are optional) is extracted with a     */
/* small grammar, never with an LLM: structure must not hallucinate.   */
/*                                                                     */
/* The parser is deliberately forgiving because agent definitions are  */
/* written by humans: the assignment's own example contains typo'd     */
/* keys ({{custome_mail}}, email_adress) and a tool signature missing  */
/* its closing parenthesis. Typos pass through untouched (they are the */
/* real keys); broken syntax degrades, it never throws.                */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function parsePlaceholders(template: string): {
  placeholders: ParsedPlaceholder[];
  trailingText: string | null;
} {
  const placeholders: ParsedPlaceholder[] = [];
  const seen = new Set<string>();
  let lastEnd = 0;

  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    lastEnd = (m.index ?? 0) + m[0].length;
    const key = m[1];
    if (seen.has(key)) continue; // same slot used twice → one field
    seen.add(key);
    placeholders.push({
      key,
      index: placeholders.length,
      labelBefore: labelBefore(template, m.index ?? 0),
    });
  }

  const trailing = template.slice(lastEnd).trim();
  return { placeholders, trailingText: trailing.length > 0 ? trailing : null };
}

/** Nearest label-like line preceding a placeholder ("Customer mail :" → "Customer mail").
 *  Used as semantic context for the annotator and as a deterministic label fallback. */
function labelBefore(template: string, at: number): string | null {
  const lines = template
    .slice(0, at)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (!last || /\{\{/.test(last)) return null; // previous line is another placeholder, not a label
  const label = last.replace(/[:\s]+$/, "").trim();
  return label.length > 0 ? label : null;
}

/* ------------------------- tool signatures ------------------------- */
/* Grammar:  name "(" param ("," param)* ")"                           */
/*           param := ident ":" type                                   */
/*           type  := ident | ident "(" type ")"    e.g. optional(str) */
/* Recovery: a missing closing parenthesis (present in the assignment  */
/* PDF!) is treated as end-of-list.                                    */

export function parseToolSignature(signature: string, description = ""): ParsedTool {
  const trimmed = signature.trim();
  const open = trimmed.indexOf("(");

  if (open === -1) {
    // No parameter list at all → tool without arguments.
    return { name: extractIdent(trimmed) ?? trimmed, description, params: [] };
  }

  const name = extractIdent(trimmed.slice(0, open)) ?? trimmed.slice(0, open).trim();
  const body = trimmed.slice(open + 1);
  const params = splitTopLevel(body)
    .map(parseParam)
    .filter((p): p is ParsedParam => p !== null);

  return { name, description, params };
}

/** Split a parameter list on top-level commas. A depth-0 ")" is the closing
 *  parenthesis of the signature; reaching end-of-string without one is the
 *  PDF-typo recovery path — both end the list the same way. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of body) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      if (depth === 0) break; // closing parenthesis of the signature itself
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseParam(part: string): ParsedParam | null {
  const colon = part.indexOf(":");
  if (colon === -1) {
    const name = extractIdent(part);
    return name ? { name, baseType: "unknown", rawType: "", required: true } : null;
  }
  const name = extractIdent(part.slice(0, colon));
  if (!name) return null;
  const rawType = part.slice(colon + 1).trim();
  const { baseType, required } = parseType(rawType);
  return { name, baseType, rawType, required };
}

export function parseType(raw: string): { baseType: BaseType; required: boolean } {
  const t = raw.trim().toLowerCase();

  // Wrapper form: head(inner) — closing parenthesis optional (PDF recovery).
  const wrapper = t.match(/^([a-z_][a-z0-9_]*)\s*\(\s*(.*?)\s*\)?\s*$/);
  if (wrapper && t.includes("(")) {
    const [, head, inner] = wrapper;
    if (head === "optional") {
      const innerParsed = parseType(inner);
      return { baseType: innerParsed.baseType, required: false };
    }
    // Unknown wrapper (list(...), dict(...)) → renders as a generic field, never crashes.
    return { baseType: "unknown", required: true };
  }

  switch (t) {
    case "float":
    case "number":
    case "double":
      return { baseType: "float", required: true };
    case "int":
    case "integer":
      return { baseType: "int", required: true };
    case "str":
    case "string":
      return { baseType: "str", required: true };
    case "bool":
    case "boolean":
      return { baseType: "bool", required: true };
    default:
      return { baseType: "unknown", required: true };
  }
}

function extractIdent(s: string): string | null {
  const m = s.match(/[A-Za-z_][A-Za-z0-9_]*/);
  return m ? m[0] : null;
}

/* --------------------------- entry point --------------------------- */

export function parseAgentDefinition(def: AgentDefinition): AgentSchema {
  const { placeholders, trailingText } = parsePlaceholders(def.user_prompt_template);
  return {
    systemPrompt: def.system_prompt,
    userPromptTemplate: def.user_prompt_template,
    placeholders,
    tools: def.tools.map((t) => parseToolSignature(t.signature, t.description)),
    trailingText,
  };
}

/* ----------------------- parser diagnostics ------------------------ */
/* The parser never throws, but silent degradation is its own failure   */
/* mode: a placeholder key or tool name outside the supported grammar   */
/* (e.g. accented identifiers — "{{données_client}}", "créer_ligne")    */
/* would produce a UI that LOOKS complete while missing an input or     */
/* mangling a tool name. These checks make that degradation visible.    */

const LOOSE_PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function collectParserWarnings(def: AgentDefinition, schema: AgentSchema): string[] {
  const warnings: string[] = [];

  const parsedKeys = new Set(schema.placeholders.map((p) => p.key));
  const reported = new Set<string>();
  for (const m of def.user_prompt_template.matchAll(LOOSE_PLACEHOLDER_RE)) {
    const key = m[1].trim();
    if (parsedKeys.has(key) || reported.has(key)) continue;
    reported.add(key);
    warnings.push(
      `Placeholder {{${key}}} is outside the supported key syntax (letters, digits, underscore) — ` +
        `no input field was generated and it will reach the model as literal text.`
    );
  }

  def.tools.forEach((tool, i) => {
    const raw = tool.signature.trim();
    const open = raw.indexOf("(");
    const namePart = (open === -1 ? raw : raw.slice(0, open)).trim().replace(/^\d+[.)]?\s*/, "");
    const parsedName = schema.tools[i]?.name;
    if (parsedName && namePart.length > 0 && !IDENT_RE.test(namePart) && namePart !== parsedName) {
      warnings.push(
        `Tool name "${namePart}" contains unsupported characters — it was parsed as "${parsedName}", ` +
          `which will not match what the model calls it.`
      );
    }
  });

  return warnings;
}

/* ------------------- derived views of the schema ------------------- */
/* The same AgentSchema feeds both the UI generation and the runtime   */
/* provider call — one source of truth, so the UI can never disagree   */
/* with the tools the model was actually given (no schema drift).      */

export interface ProviderToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string }>;
    required: string[];
    additionalProperties: false;
  };
}

export function toProviderTools(schema: AgentSchema): ProviderToolSchema[] {
  return schema.tools.map((tool) => {
    const properties: Record<string, { type: string }> = {};
    for (const p of tool.params) {
      properties[p.name] = { type: jsonSchemaType(p.baseType) };
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object" as const,
        properties,
        required: tool.params.filter((p) => p.required).map((p) => p.name),
        additionalProperties: false as const,
      },
    };
  });
}

function jsonSchemaType(base: BaseType): string {
  switch (base) {
    case "float":
      return "number";
    case "int":
      return "integer";
    case "bool":
      return "boolean";
    case "str":
    case "unknown":
      return "string";
  }
}

/** Substitute {{placeholders}} with run inputs; unknown keys become "". */
export function renderUserPrompt(template: string, inputs: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (_match, key: string) => inputs[key] ?? "");
}

/** A tool is treated as mutating unless its name clearly reads as read-only.
 *  Deliberately conservative and deterministic: the safety classification of
 *  an action is never delegated to an LLM. */
const READONLY_PREFIXES = ["get_", "list_", "read_", "search_", "find_", "fetch_", "lookup_", "check_"];

export function isMutatingTool(name: string): boolean {
  const n = name.toLowerCase();
  return !READONLY_PREFIXES.some((p) => n.startsWith(p));
}
