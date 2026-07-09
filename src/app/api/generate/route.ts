import { annotate } from "@/lib/annotator";
import { getFixture } from "@/lib/fixtures";
import { mergeToUISpec } from "@/lib/merger";
import { collectParserWarnings, parseAgentDefinition } from "@/lib/parser";
import { definitionHash, readCachedSpec, writeCachedSpec, type CachedSpec } from "@/lib/store";

/* FASE A — generation time. definition → parse (deterministic) →
 * annotate (1 LLM call) → merge (deterministic) → UISpec, cached on
 * hash(definition). Changing the definition file is the only way to get a
 * different UI — which is exactly the point of the generator. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    fixtureId?: string;
    forceRefresh?: boolean;
  } | null;

  if (!body?.fixtureId) {
    return Response.json({ error: "fixtureId is required" }, { status: 400 });
  }

  const fixture = await getFixture(body.fixtureId);
  if (!fixture) {
    return Response.json({ error: `Unknown fixture: ${body.fixtureId}` }, { status: 404 });
  }

  const hash = definitionHash(fixture.definition);

  if (!body.forceRefresh) {
    const cached = await readCachedSpec(hash);
    if (cached) {
      return Response.json({ ...cached, cache: { hit: true, hash } });
    }
  }

  const started = Date.now();
  const agentSchema = parseAgentDefinition(fixture.definition);
  const annotation = await annotate(agentSchema);
  const uiSpec = mergeToUISpec(agentSchema, annotation.annotations);

  const spec: CachedSpec = {
    uiSpec,
    annotationSource: annotation.source,
    annotationModel: annotation.model,
    annotationError: annotation.error,
    parserWarnings: collectParserWarnings(fixture.definition, agentSchema),
    generatedAt: new Date().toISOString(),
    generationMs: Date.now() - started,
  };
  await writeCachedSpec(hash, spec);

  return Response.json({ ...spec, cache: { hit: false, hash } });
}
