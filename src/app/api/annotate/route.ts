import { annotate } from "@/lib/annotator";
import { mergeToUISpec } from "@/lib/merger";
import { collectParserWarnings, parseAgentDefinition } from "@/lib/parser";
import { AgentDefinitionSchema } from "@/lib/types";

/* Playground annotation endpoint. Same pipeline as /api/generate but for an
 * inline definition instead of a fixture, and ephemeral: nothing is cached or
 * persisted. The parse + merge steps run in the browser; this route only adds
 * the annotator step, on demand. */

const MAX_DEFINITION_BYTES = 20_000; // shared assessment keys: keep annotator input bounded

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
