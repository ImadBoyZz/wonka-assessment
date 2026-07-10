import { z } from "zod";

/* Agent definition, the input of the generator: a system prompt, a user
 * prompt template with {{placeholders}}, and tool signatures written in
 * pseudocode ("name(param : type, ...)"). */

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

/* A fixture is a definition plus demo data. Only `definition` feeds the
 * generator; sampleInputs/mockResult let a reviewer run the flow with one
 * click and without spending tokens. */

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

/* AgentSchema, the output of the structural parser. The keys, types and
 * counts here come from parsing only; no LLM is involved. */

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
  /** Non-placeholder text after the last placeholder (e.g. "answer :"); signals a free-text completion. */
  trailingText: string | null;
}

/* UISpec, the JSON contract between generation and rendering. It is
 * language-agnostic: in a Python backend this would be the equivalent
 * Pydantic model. */

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
 *  retrieved: lookup/RAG data that the model uses but the reviewer does not need. */
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
  /** Whether approving this action changes external state. Derived from the
   *  tool name, not from the LLM. */
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

/* Runtime: one validation run and the human decisions on it. */

export interface NormalizedToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type RunStatus = "to_be_validated" | "confirmed" | "rejected" | "partially_confirmed";

/** Snapshot of one agent run for the trace panel. Prompts and metadata only,
 *  never API keys. */
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
  /** The user prompt template after placeholder substitution, exactly what the model saw. */
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

/** Structured companion to the human-readable `detail` string. The dashboard
 *  aggregates over these fields instead of parsing the detail text. All fields
 *  optional, so entries written before this field existed stay valid. */
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
