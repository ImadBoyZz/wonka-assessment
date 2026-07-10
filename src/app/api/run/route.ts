import { randomUUID } from "crypto";
import { getFixture } from "@/lib/fixtures";
import { parseAgentDefinition, renderUserPrompt, toProviderTools } from "@/lib/parser";
import { runWithFallback, type ProviderPreference } from "@/lib/providers";
import { MAX_AGENT_TURNS } from "@/lib/providers/shared";
import { appendAudit, saveRun } from "@/lib/store";
import type { RunRecord } from "@/lib/types";

/* Run time. Renders the template with the entered inputs and calls the
 * provider with tool schemas derived from the same AgentSchema that generated
 * the UI. Tool calls come back as pending cards; nothing is executed here. */

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    fixtureId?: string;
    inputs?: Record<string, string>;
    provider?: ProviderPreference;
  } | null;

  if (!body?.fixtureId) {
    return Response.json({ error: "fixtureId is required" }, { status: 400 });
  }

  const fixture = await getFixture(body.fixtureId);
  if (!fixture) {
    return Response.json({ error: `Unknown fixture: ${body.fixtureId}` }, { status: 404 });
  }

  const agentSchema = parseAgentDefinition(fixture.definition);
  const inputs = body.inputs ?? {};
  const provider = body.provider ?? "auto";
  const renderedUserPrompt = renderUserPrompt(agentSchema.userPromptTemplate, inputs);

  try {
    const started = Date.now();
    const outcome = await runWithFallback(provider, {
      systemPrompt: agentSchema.systemPrompt,
      userPrompt: renderedUserPrompt,
      tools: toProviderTools(agentSchema),
      mockResult: provider === "mock" ? fixture.mockResult : undefined,
    });

    const run: RunRecord = {
      runId: randomUUID(),
      fixtureId: fixture.id,
      provider: outcome.providerUsed,
      inputs,
      toolCalls: outcome.result.toolCalls,
      replyText: outcome.result.replyText,
      decisions: {},
      replySent: false,
      status: "to_be_validated",
      createdAt: new Date().toISOString(),
      policy: fixture.policy,
      // Trace for the run. In production this would be a Langfuse span.
      // Prompts and metadata only, never keys.
      trace: {
        provider: outcome.providerUsed,
        model: outcome.result.model,
        durationMs: Date.now() - started,
        truncated: outcome.result.truncated ?? false,
        fallbackPath: outcome.warnings,
        systemPrompt: agentSchema.systemPrompt,
        renderedUserPrompt,
      },
    };

    await saveRun(run);
    await appendAudit({
      runId: run.runId,
      actor: "system",
      event: "run_created",
      detail: `run created for agent "${fixture.name}" via ${outcome.providerUsed} (${outcome.result.model}); ${run.toolCalls.length} proposed action(s) awaiting validation`,
      meta: {
        fixtureId: fixture.id,
        provider: outcome.providerUsed,
        model: outcome.result.model,
        actionCount: run.toolCalls.length,
      },
    });

    const warnings = [...outcome.warnings];
    if (outcome.result.truncated) {
      warnings.push(
        `Turn cap reached (${MAX_AGENT_TURNS}): the proposed action list may be incomplete. Review with extra care.`
      );
    }

    return Response.json({ run, warnings });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Agent run failed" },
      { status: 502 }
    );
  }
}
