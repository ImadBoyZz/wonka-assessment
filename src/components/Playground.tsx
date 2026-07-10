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
 * appear. The deterministic half of the pipeline (parser + merger) is pure
 * TypeScript with no server dependency, so it runs in the browser on every
 * keystroke. The annotator (the one AI step) sits behind a button and calls
 * the same server pipeline as /api/generate. Nothing here is cached or
 * persisted. */

interface AnnotateResponse {
  uiSpec: UISpec;
  annotationSource: "llm" | "fallback";
  annotationModel?: string;
  annotationError?: string;
  parserWarnings?: string[];
  generationMs: number;
}

/* Prefill: the README's "adding a new agent" example. A third domain on
 * purpose (neither support nor orders), so the playground opens on a
 * definition the app doesn't already ship. */
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
  "w-full rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft";

function ActionPreviewCard({ action }: { action: ToolAction }) {
  return (
    <article className="rounded-md border border-line-strong bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">{action.label}</h3>
        {action.mutating && (
          <span
            title="This action changes external state; it only executes after approval"
            className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-soft"
          >
            <ShieldWarning className="size-3" weight="bold" /> mutating
          </span>
        )}
      </header>
      <ul className="mt-2 flex flex-col gap-1">
        {action.fields.map((f) => (
          <li key={f.key} className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <FieldTypeIcon type={f.type} className="size-3.5 text-ink-faint" />
            <span className="font-medium text-ink">{f.label}</span>
            <span className="font-mono text-[11px]">
              ({f.type}
              {f.required ? "" : ", optional"})
            </span>
          </li>
        ))}
        {action.fields.length === 0 && <li className="text-[12.5px] italic text-ink-faint">No parameters.</li>}
      </ul>
      <footer className="mt-3 flex gap-2">
        <span className="inline-flex h-7 items-center rounded-md bg-approve px-2.5 text-[12px] font-semibold text-panel opacity-50">
          Approve
        </span>
        <span className="inline-flex h-7 items-center rounded-md border border-reject/50 px-2.5 text-[12px] font-semibold text-reject opacity-50">
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
  // definition), so wrap the setters to avoid showing stale labels.
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
    <div className="flex flex-1 flex-col">
      {/* ── App bar ───────────────────────────────────────────────── */}
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex h-12 w-full max-w-screen-2xl items-center gap-2.5 px-4 lg:px-6">
          <Flask className="size-[18px] text-ink" weight="fill" />
          <h1 className="font-mono text-[13px] font-medium tracking-tight text-ink">UISpec Playground</h1>
          <span className="hidden text-[12px] text-ink-faint md:inline">
            the deterministic pipeline live on every keystroke; the annotator is one explicit button
          </span>
          <nav className="ml-auto flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-soft transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-3.5" weight="bold" /> validation app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5">
        {error && (
          <div className="rounded-md border border-reject/40 bg-reject-soft px-3 py-2 text-[12.5px] text-reject-deep">
            {error}
          </div>
        )}

        <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* ── Left: the agent definition ─────────────────────────── */}
          <section className="overflow-hidden rounded-lg border border-line bg-panel">
            <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
              <h2 className="text-[13px] font-semibold text-ink">Agent definition</h2>
              <span className="font-mono text-[11px] text-ink-faint">input</span>
            </header>
            <div className="flex flex-col gap-3 p-3.5">
              <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
                System prompt
                <textarea
                  className={`${inputCls} min-h-24 leading-relaxed`}
                  spellCheck={false}
                  value={systemPrompt}
                  onChange={(e) => setSystem(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
                <span>
                  User prompt template: <span className="font-mono">{"{{placeholders}}"}</span> become input fields
                </span>
                <textarea
                  className={`${inputCls} min-h-32 font-mono text-[12.5px] leading-relaxed`}
                  spellCheck={false}
                  value={template}
                  onChange={(e) => setTpl(e.target.value)}
                />
              </label>

              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-ink-soft">Tools: pseudocode signatures, one per row</span>
                {tools.map((tool, i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line bg-card p-2">
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputCls} font-mono text-[12.5px]`}
                        spellCheck={false}
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
                        className="shrink-0 rounded-md border border-line-strong p-1.5 text-ink-faint transition-colors hover:border-reject/50 hover:text-reject"
                      >
                        <Trash className="size-4" weight="bold" />
                      </button>
                    </div>
                    <input
                      className={`${inputCls} text-[12.5px]`}
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
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-line-strong px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
                >
                  <Plus className="size-3.5" weight="bold" /> Add tool
                </button>
              </div>

              {warnings.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn-deep">
                  {warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Right: the generated validation UI, live ───────────── */}
          <section className="overflow-hidden rounded-lg border border-line bg-panel">
            <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
              <h2 className="text-[13px] font-semibold text-ink">{spec.agentTitle}</h2>
              <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-soft">
                spec v{spec.version}
              </span>
              {annotated ? (
                <span className="font-mono text-[11px] text-ink-faint">
                  {annotated.annotationSource === "llm"
                    ? `annotated by ${annotated.annotationModel} in ${(annotated.generationMs / 1000).toFixed(1)}s`
                    : `annotator unavailable (${annotated.annotationError ?? "unknown"}): deterministic labels`}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-ink-faint">deterministic labels · live while you type</span>
              )}
              <button
                type="button"
                disabled={annotating}
                onClick={annotateNow}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-ink px-2.5 text-[12px] font-semibold text-panel transition-colors hover:bg-ink/85 disabled:opacity-50"
              >
                <Sparkle className="size-3.5" weight="bold" />
                {annotating ? "Annotating…" : "Annotate with AI"}
              </button>
            </header>

            <div className="flex flex-col gap-3 p-3.5">
              <div className="overflow-hidden rounded-md border border-line">
                <h3 className="border-b border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-faint">
                  01 · {spec.inputPanel.title}
                </h3>
                <div className="p-2.5">
                  <InputPanel
                    spec={spec}
                    inputs={previewInputs}
                    onInputChange={(k, v) => setPreviewInputs((p) => ({ ...p, [k]: v }))}
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-line">
                <h3 className="border-b border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-faint">
                  02 · {spec.actionsPanel.title}
                </h3>
                <div className="flex flex-col gap-2 p-2.5">
                  {spec.actionsPanel.actions.map((a) => (
                    <ActionPreviewCard key={a.toolName} action={a} />
                  ))}
                  {spec.actionsPanel.actions.length === 0 && (
                    <p className="text-[13px] text-ink-soft">
                      No tools declared; only the generated output would be validated.
                    </p>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-line">
                <h3 className="border-b border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-faint">
                  03 · {spec.outputPanel.title}
                </h3>
                <p className="p-2.5 text-[13px] italic text-ink-soft">{spec.outputPanel.description}</p>
              </div>

              <details className="group overflow-hidden rounded-md border border-line">
                <summary className="cursor-pointer bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-soft transition-colors hover:text-ink">
                  UISpec JSON: the contract this preview renders
                </summary>
                <pre className="overflow-x-auto bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-glass-ink">
                  {JSON.stringify(spec, null, 2)}
                </pre>
              </details>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
