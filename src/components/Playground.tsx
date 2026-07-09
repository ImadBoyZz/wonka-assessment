"use client";

import { ArrowLeft, Flask, Plus, ShieldWarning, Sparkle, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { mergeToUISpec } from "@/lib/merger";
import { collectParserWarnings, parseAgentDefinition } from "@/lib/parser";
import type { AgentDefinition, ToolAction, UISpec } from "@/lib/types";
import { FieldTypeIcon } from "./FieldRenderer";
import { InputPanel } from "./InputPanel";

/* UISpec Playground — paste any agent definition and watch the validation UI
 * appear. The deterministic half of the pipeline (Structural Parser + Merger)
 * is pure TypeScript with no server dependency, so it runs LIVE in the
 * browser on every keystroke: instant proof that structure never needs an
 * LLM. The one AI step (Semantic Annotator) sits behind an explicit button
 * and calls the same server pipeline as /api/generate — but nothing here is
 * cached or persisted; the playground is ephemeral by design. */

interface AnnotateResponse {
  uiSpec: UISpec;
  annotationSource: "llm" | "fallback";
  annotationModel?: string;
  annotationError?: string;
  parserWarnings?: string[];
  generationMs: number;
}

/* Prefill: the README's "adding a new agent" example — a third domain on
 * purpose (neither support nor orders), so the playground opens on proof
 * of reusability rather than a fixture the app already ships. */
const EXAMPLE: AgentDefinition = {
  system_prompt:
    "You are a release agent for the platform team. You review deployment requests and either trigger the deploy or roll back, based on the change summary and pipeline status.",
  user_prompt_template:
    "Change summary :\n{{change_summary}}\nPipeline status :\n{{pipeline_status}}\ndecision :",
  tools: [
    { signature: "trigger_deploy(environment : str, version : str)", description: "deploys the given version to the given environment" },
    { signature: "rollback(reason : optional(str))", description: "rolls back the previous release" },
  ],
};

const inputCls =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

function ActionPreviewCard({ action }: { action: ToolAction }) {
  return (
    <article className="rounded-lg border border-line bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{action.label}</h3>
        {action.mutating && (
          <span
            title="This action changes external state — it only executes after approval"
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-deep"
          >
            <ShieldWarning className="size-3" weight="bold" /> mutating
          </span>
        )}
      </header>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {action.fields.map((f) => (
          <li key={f.key} className="flex items-center gap-1.5 text-[13px] text-ink-soft">
            <FieldTypeIcon type={f.type} className="size-3.5" />
            <span className="font-medium text-ink">{f.label}</span>
            <span className="font-mono text-[11px]">({f.type}{f.required ? "" : ", optional"})</span>
          </li>
        ))}
        {action.fields.length === 0 && <li className="text-[13px] italic text-ink-soft">No parameters.</li>}
      </ul>
      <footer className="mt-2.5 flex gap-2">
        <span className="rounded-md bg-approve px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white opacity-60">
          Approve
        </span>
        <span className="rounded-md border border-reject px-3 py-1 text-xs font-semibold uppercase tracking-wide text-reject opacity-60">
          Reject
        </span>
      </footer>
    </article>
  );
}

export function Playground() {
  const [systemPrompt, setSystemPrompt] = useState(EXAMPLE.system_prompt);
  const [template, setTemplate] = useState(EXAMPLE.user_prompt_template);
  const [tools, setTools] = useState(EXAMPLE.tools);
  const [annotated, setAnnotated] = useState<AnnotateResponse | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});

  const definition: AgentDefinition = useMemo(
    () => ({ system_prompt: systemPrompt, user_prompt_template: template, tools }),
    [systemPrompt, template, tools]
  );

  // The deterministic pipeline, live on every keystroke: parse + merge with
  // fallback labels. No LLM, no server, no debounce needed.
  const live = useMemo(() => {
    const schema = parseAgentDefinition(definition);
    return {
      spec: mergeToUISpec(schema, null),
      warnings: collectParserWarnings(definition, schema),
    };
  }, [definition]);

  // Any edit invalidates a previous annotation result (it described an older
  // definition) — wrap the setters so the preview can never show stale labels.
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setAnnotated(null);
      setter(v);
    };
  }
  const setSystem = edit(setSystemPrompt);
  const setTpl = edit(setTemplate);
  const setToolList = edit(setTools);

  async function annotateNow() {
    setAnnotating(true);
    setError(null);
    try {
      const res = await fetch("/api/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const data = (await res.json()) as AnnotateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `annotate failed (${res.status})`);
      setAnnotated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annotation failed");
    } finally {
      setAnnotating(false);
    }
  }

  const spec = annotated?.uiSpec ?? live.spec;
  const warnings = annotated?.parserWarnings ?? live.warnings;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 lg:p-6">
      <header className="rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Flask className="size-5 text-accent" weight="fill" />
            <h1 className="text-sm font-semibold text-ink">UISpec Playground</h1>
          </div>
          <span className="text-xs text-ink-soft">
            paste a definition → the validation UI generates live (parser + merger, no LLM); the annotator is one explicit button
          </span>
          <Link
            href="/"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <ArrowLeft className="size-3.5" weight="bold" /> validation app
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-reject bg-reject-soft px-4 py-2 text-sm text-reject">{error}</div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Left: the agent definition ─────────────────────────── */}
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
          <h2 className="border-b border-line pb-2 text-sm font-semibold text-ink">Agent definition</h2>

          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            System prompt
            <textarea
              className={`${inputCls} min-h-24 leading-relaxed`}
              value={systemPrompt}
              onChange={(e) => setSystem(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            User prompt template — <span className="font-mono">{"{{placeholders}}"}</span> become input fields
            <textarea
              className={`${inputCls} min-h-32 font-mono text-[13px] leading-relaxed`}
              value={template}
              onChange={(e) => setTpl(e.target.value)}
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-soft">Tools — pseudocode signatures, one per row</span>
            {tools.map((tool, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-lg border border-line bg-card p-2">
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputCls} font-mono text-[13px]`}
                    value={tool.signature}
                    placeholder="tool_name(param : type, other : optional(str))"
                    onChange={(e) =>
                      setToolList(tools.map((t, j) => (j === i ? { ...t, signature: e.target.value } : t)))
                    }
                  />
                  <button
                    type="button"
                    title="Remove tool"
                    onClick={() => setToolList(tools.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-md border border-line p-2 text-ink-soft hover:bg-reject-soft hover:text-reject"
                  >
                    <Trash className="size-4" weight="bold" />
                  </button>
                </div>
                <input
                  className={`${inputCls} text-[13px]`}
                  value={tool.description}
                  placeholder="what this tool does (helps the annotator + the model)"
                  onChange={(e) =>
                    setToolList(tools.map((t, j) => (j === i ? { ...t, description: e.target.value } : t)))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setToolList([...tools, { signature: "", description: "" }])}
              className="inline-flex w-fit items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-card"
            >
              <Plus className="size-3.5" weight="bold" /> Add tool
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-warn">
              {warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
        </section>

        {/* ── Right: the generated validation UI, live ───────────── */}
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
            <h2 className="text-sm font-semibold text-ink">{spec.agentTitle}</h2>
            <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
              v{spec.version}
            </span>
            {annotated ? (
              <span className="text-xs text-ink-soft">
                {annotated.annotationSource === "llm"
                  ? `annotated by ${annotated.annotationModel} in ${(annotated.generationMs / 1000).toFixed(1)}s`
                  : `annotator unavailable (${annotated.annotationError ?? "unknown"}) — deterministic labels`}
              </span>
            ) : (
              <span className="text-xs text-ink-soft">deterministic labels — updates live while you type</span>
            )}
            <button
              type="button"
              disabled={annotating}
              onClick={annotateNow}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              <Sparkle className="size-3.5" weight="bold" />
              {annotating ? "Annotating…" : "Annotate with AI"}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-line p-3">
              <h3 className="mb-2 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {spec.inputPanel.title}
              </h3>
              <InputPanel
                spec={spec}
                inputs={previewInputs}
                onInputChange={(k, v) => setPreviewInputs((p) => ({ ...p, [k]: v }))}
              />
            </div>

            <div className="rounded-lg border border-line p-3">
              <h3 className="mb-2 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {spec.actionsPanel.title}
              </h3>
              <div className="flex flex-col gap-2">
                {spec.actionsPanel.actions.map((a) => (
                  <ActionPreviewCard key={a.toolName} action={a} />
                ))}
                {spec.actionsPanel.actions.length === 0 && (
                  <p className="text-sm text-ink-soft">No tools declared — only the generated output would be validated.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-line p-3">
              <h3 className="mb-2 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {spec.outputPanel.title}
              </h3>
              <p className="text-sm italic text-ink-soft">{spec.outputPanel.description}</p>
            </div>

            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-soft">
                UISpec JSON — the contract this preview renders
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-card p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
                {JSON.stringify(spec, null, 2)}
              </pre>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
