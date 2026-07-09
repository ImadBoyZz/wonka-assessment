import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Agent definition — the input of the generator.                      */
/* This mirrors how the assignment presents an agent: a system prompt, */
/* a user prompt template with {{placeholders}}, and tool signatures   */
/* written in pseudocode ("name(param : type, ...)").                  */
/* ------------------------------------------------------------------ */

export const ToolDefinitionSchema = z.object({
  signature: z.string().min(1),
  description: z.string().default(""),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const AgentDefinitionSchema = z.object({
  system_prompt: z.string(),
  user_prompt_template: z.string(),
  tools: z.array(ToolDefinitionSchema).default([]),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/* A fixture is a definition file plus demo data. Only `definition`    */
/* feeds the generator; sampleInputs/mockResult exist so a reviewer    */
/* can exercise the flow with one click (and without burning tokens).  */

export const MockResultSchema = z.object({
  toolCalls: z.array(
    z.object({
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
    })
  ),
  replyText: z.string(),
});
export type MockResult = z.infer<typeof MockResultSchema>;

/** Per-agent thresholds for the deterministic risk rules (src/lib/risk.ts).
 *  Optional: every rule has a safe default. */
export const RiskPolicySchema = z.object({
  currencyThreshold: z.number().positive().optional(),
});
export type RiskPolicy = z.infer<typeof RiskPolicySchema>;

export const FixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: AgentDefinitionSchema,
  sampleInputs: z.record(z.string(), z.string()).default({}),
  mockResult: MockResultSchema.optional(),
  policy: RiskPolicySchema.optional(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/* ------------------------------------------------------------------ */
/* AgentSchema — output of the deterministic Structural Parser.        */
/* This is the ground truth: keys, types and counts can never be       */
/* invented or dropped by an LLM because no LLM is involved here.      */
/* ------------------------------------------------------------------ */

export type BaseType = "float" | "int" | "str" | "bool" | "unknown";

export interface ParsedParam {
  name: string;
  baseType: BaseType;
  /** The type expression exactly as written in the signature, e.g. "optional(str)". */
  rawType: string;
  required: boolean;
}

export interface ParsedTool {
  name: string;
  description: string;
  params: ParsedParam[];
}

export interface ParsedPlaceholder {
  key: string;
  /** Order of first appearance in the template. */
  index: number;
  /** Nearest label-like text preceding the placeholder ("Customer mail :" → "Customer mail"). */
  labelBefore: string | null;
}

export interface AgentSchema {
  systemPrompt: string;
  userPromptTemplate: string;
  placeholders: ParsedPlaceholder[];
  tools: ParsedTool[];
  /** Non-placeholder text after the last placeholder (e.g. "answer :") — signals a free-text completion. */
  trailingText: string | null;
}

/* ------------------------------------------------------------------ */
/* UISpec — the language-agnostic JSON contract between generation     */
/* and rendering. (In a Python backend this would be the 1:1 Pydantic  */
/* model; Zod is the TypeScript spelling of the same contract.)        */
/* ------------------------------------------------------------------ */

export const FieldTypeSchema = z.enum([
  "text",
  "longtext",
  "number",
  "currency",
  "email",
  "boolean",
  "unknown",
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/** primary: the per-run input a reviewer must see; context: static configuration;
 *  retrieved: RAG/lookup data that is input to the model but noise to the reviewer. */
export const FieldRoleSchema = z.enum(["primary", "context", "retrieved"]);
export type FieldRole = z.infer<typeof FieldRoleSchema>;

export const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: FieldTypeSchema,
  required: z.boolean(),
  role: FieldRoleSchema.optional(),
});
export type Field = z.infer<typeof FieldSchema>;

export const ToolActionSchema = z.object({
  toolName: z.string(),
  label: z.string(),
  /** Whether approving this action mutates external state (update_, create_, ...).
   *  Derived deterministically — never left to the LLM. */
  mutating: z.boolean(),
  fields: z.array(FieldSchema),
});
export type ToolAction = z.infer<typeof ToolActionSchema>;

export const UISpecSchema = z.object({
  version: z.literal(1),
  agentTitle: z.string(),
  inputPanel: z.object({ title: z.string(), fields: z.array(FieldSchema) }),
  actionsPanel: z.object({ title: z.string(), actions: z.array(ToolActionSchema) }),
  outputPanel: z.object({
    title: z.string(),
    type: z.literal("generated-text"),
    description: z.string(),
  }),
});
export type UISpec = z.infer<typeof UISpecSchema>;

/* ------------------------------------------------------------------ */
/* Runtime — one validation run and the human decisions on it.         */
/* ------------------------------------------------------------------ */

export interface NormalizedToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type RunStatus = "to_be_validated" | "confirmed" | "rejected" | "partially_confirmed";

/** Observability snapshot of one agent run — what a Langfuse span would carry
 *  in production. Contains prompts and metadata only, never API keys. */
export interface RunTrace {
  /** Provider that actually answered (after any fallback). */
  provider: string;
  model: string;
  durationMs: number;
  /** True when the turn cap cut the loop short. */
  truncated: boolean;
  /** Providers that were skipped or failed before one answered. */
  fallbackPath: string[];
  systemPrompt: string;
  /** The user prompt template after placeholder substitution — exactly what the model saw. */
  renderedUserPrompt: string;
}

export interface RunRecord {
  runId: string;
  fixtureId: string;
  provider: string;
  inputs: Record<string, string>;
  toolCalls: NormalizedToolCall[];
  replyText: string;
  /** toolCall id → decision; absent means pending. */
  decisions: Record<string, "approved" | "rejected">;
  replySent: boolean;
  status: RunStatus;
  createdAt: string;
  /** Snapshot of the fixture's risk policy at run time (deterministic badges). */
  policy?: RiskPolicy;
  trace?: RunTrace;
}

/** Structured companion to the human-readable `detail` string. The analytics
 *  dashboard aggregates over these fields — presentation strings are for
 *  people and are never parsed back into data (the same line the generator
 *  draws: structure is never recovered from free text). All fields optional:
 *  entries written before this field existed stay valid. */
export interface AuditMeta {
  fixtureId?: string;
  provider?: string;
  model?: string;
  /** run_created: number of proposed tool calls awaiting validation. */
  actionCount?: number;
  toolName?: string;
  /** action_edited: which declared params the human corrected. */
  editedKeys?: string[];
  /** run_status_changed: the transition. */
  from?: RunStatus;
  to?: RunStatus;
}

export interface AuditEntry {
  at: string;
  runId: string;
  actor: "human" | "system";
  event:
    | "run_created"
    | "action_edited"
    | "action_approved"
    | "action_rejected"
    | "action_executed"
    | "reply_sent"
    | "run_status_changed";
  detail: string;
  meta?: AuditMeta;
}
