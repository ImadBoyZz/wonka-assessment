import { annotate } from "@/lib/annotator";
import { mergeToUISpec } from "@/lib/merger";
import { collectParserWarnings, parseAgentDefinition } from "@/lib/parser";
import { AgentDefinitionSchema } from "@/lib/types";

/* Playground annotation endpoint — same pipeline as /api/generate but for an
 * INLINE definition instead of a fixture file, and deliberately ephemeral:
 * nothing is cached or persisted. The deterministic half (parse + merge)
 * already runs live in the browser; this route only adds the one AI step,
 * explicitly user-triggered. */

const MAX_DEFINITION_BYTES = 20_000; // the assessment keys are shared — keep annotator input bounded

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { definition?: unknown } | null;

  const parsed = AgentDefinitionSchema.safeParse(body?.definition);
  if (!parsed.success) {
    return Response.json({ error: "definition must match { system_prompt, user_prompt_template, tools[] }" }, { status: 400 });
  }
  if (JSON.stringify(parsed.data).length > MAX_DEFINITION_BYTES) {
    return Response.json({ error: `Definition too large (max ${MAX_DEFINITION_BYTES} bytes)` }, { status: 400 });
  }

  const started = Date.now();
  const agentSchema = parseAgentDefinition(parsed.data);
  const annotation = await annotate(agentSchema);
  const uiSpec = mergeToUISpec(agentSchema, annotation.annotations);

  return Response.json({
    uiSpec,
    annotationSource: annotation.source,
    annotationModel: annotation.model,
    annotationError: annotation.error,
    parserWarnings: collectParserWarnings(parsed.data, agentSchema),
    generationMs: Date.now() - started,
  });
}
