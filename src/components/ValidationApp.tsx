"use client";

import { ArrowsClockwise, ChartBar, Flask, Lightning, ShieldCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ExecutionResult } from "@/lib/executor";
import type { ProviderPreference } from "@/lib/providers/types";
import type { AuditEntry, RunRecord, RunStatus, UISpec } from "@/lib/types";
import { ActionCard } from "./ActionCard";
import { AuditTrail } from "./AuditTrail";
import { InputPanel } from "./InputPanel";
import { OutputPanel } from "./OutputPanel";
import { TracePanel } from "./TracePanel";

/* Orchestrates the two phases end to end:
 *   generate (definition → UISpec, cached)  →  run (inputs → pending actions)
 *   →  validate (approve/reject per action, send reply)  →  audit trail.
 * All LLM work happens server-side; this component only talks JSON. */

interface FixtureMeta {
  id: string;
  name: string;
  sampleInputs: Record<string, string>;
  hasMockResult: boolean;
  toolCount: number;
}

interface GenerateResponse {
  uiSpec: UISpec;
  annotationSource: "llm" | "fallback";
  annotationModel?: string;
  annotationError?: string;
  parserWarnings?: string[];
  generationMs: number;
  cache: { hit: boolean; hash: string };
}

const STATUS_STYLE: Record<RunStatus, string> = {
  to_be_validated: "bg-accent-soft text-accent-deep",
  confirmed: "bg-approve-soft text-approve-deep",
  rejected: "bg-reject-soft text-reject-deep",
  partially_confirmed: "bg-warn-soft text-warn-deep",
};

/** Error that carries the response body: a 409 includes the server's current
 *  run state, which the UI adopts instead of going stale. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly payload: { run?: RunRecord }
  ) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string; run?: RunRecord };
  if (!res.ok) throw new ApiError(data.error ?? `${url} failed (${res.status})`, data);
  return data;
}

export function ValidationApp() {
  const [fixtures, setFixtures] = useState<FixtureMeta[]>([]);
  const [fixtureId, setFixtureId] = useState<string>("");
  const [spec, setSpec] = useState<GenerateResponse | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<ProviderPreference>("auto");
  const [run, setRun] = useState<RunRecord | null>(null);
  const [executions, setExecutions] = useState<Record<string, ExecutionResult | null>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fixture = fixtures.find((f) => f.id === fixtureId);

  useEffect(() => {
    fetch("/api/fixtures")
      .then((r) => r.json())
      .then((data: { fixtures: FixtureMeta[] }) => {
        setFixtures(data.fixtures);
        if (data.fixtures.length > 0) setFixtureId(data.fixtures[0].id);
      })
      .catch(() => setError("Could not load agent definitions from /fixtures"));
  }, []);

  const refreshAudit = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/audit?runId=${encodeURIComponent(runId)}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAudit(data.entries);
    } catch {
      // Audit view is best-effort; the log itself lives server-side.
    }
  }, []);

  function selectFixture(id: string) {
    setFixtureId(id);
    setSpec(null);
    setRun(null);
    setInputs({});
    setExecutions({});
    setWarnings([]);
    setAudit([]);
    setError(null);
  }

  async function generate(forceRefresh = false) {
    if (!fixture) return;
    setGenerating(true);
    setError(null);
    setRun(null);
    setAudit([]);
    try {
      const data = await postJson<GenerateResponse>("/api/generate", {
        fixtureId: fixture.id,
        forceRefresh,
      });
      setSpec(data);
      setInputs({ ...fixture.sampleInputs });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function runAgent() {
    if (!fixture) return;
    setRunning(true);
    setError(null);
    setRun(null);
    setExecutions({});
    setAudit([]);
    setWarnings([]);
    try {
      const data = await postJson<{ run: RunRecord; warnings: string[] }>("/api/run", {
        fixtureId: fixture.id,
        inputs,
        provider,
      });
      setRun(data.run);
      setWarnings(data.warnings);
      await refreshAudit(data.run.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setRunning(false);
    }
  }

  async function decide(
    toolCallId: string,
    decision: "approved" | "rejected",
    editedArgs?: Record<string, string>
  ) {
    if (!run || busyAction) return;
    setBusyAction(toolCallId);
    try {
      const data = await postJson<{ run: RunRecord; execution: ExecutionResult | null }>(
        "/api/actions",
        { runId: run.runId, toolCallId, decision, editedArgs }
      );
      setRun(data.run);
      setExecutions((prev) => ({ ...prev, [toolCallId]: data.execution }));
      await refreshAudit(run.runId);
    } catch (err) {
      if (err instanceof ApiError && err.payload.run) {
        setRun(err.payload.run); // 409: adopt the server's authoritative state
        await refreshAudit(run.runId);
      }
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function sendReply() {
    if (!run || busyAction) return;
    setBusyAction("reply");
    try {
      const data = await postJson<{ run: RunRecord }>("/api/reply", { runId: run.runId });
      setRun(data.run);
      await refreshAudit(run.runId);
    } catch (err) {
      if (err instanceof ApiError && err.payload.run) {
        setRun(err.payload.run); // 409: adopt the server's authoritative state
        await refreshAudit(run.runId);
      }
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusyAction(null);
    }
  }

  const ui = spec?.uiSpec;
  const decidedCount = run ? Object.keys(run.decisions).length : 0;

  return (
    <div className="flex flex-1 flex-col">
      {/* ── App bar ───────────────────────────────────────────────── */}
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex h-12 w-full max-w-screen-2xl items-center gap-2.5 px-4 lg:px-6">
          <ShieldCheck className="size-[18px] text-ink" weight="fill" />
          <h1 className="font-mono text-[13px] font-medium tracking-tight text-ink">
            Validation UI Generator
          </h1>
          <span className="hidden text-[12px] text-ink-faint sm:inline">
            agent definition in, review interface out
          </span>
          <nav className="ml-auto flex items-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-soft transition-colors hover:text-ink"
            >
              <ChartBar className="size-3.5" weight="bold" /> analytics
            </Link>
            <Link
              href="/playground"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-soft transition-colors hover:text-ink"
            >
              <Flask className="size-3.5" weight="bold" /> playground
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5">
        {/* ── Generator console ───────────────────────────────────── */}
        <section className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="font-mono text-[11px] text-ink-faint" htmlFor="fixture-select">
            agent definition
          </label>
          <select
            id="fixture-select"
            className="h-8 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-ink"
            value={fixtureId}
            onChange={(e) => selectFixture(e.target.value)}
          >
            {fixtures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.toolCount} tools)
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!fixture || generating}
            onClick={() => generate(false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-panel transition-colors hover:bg-ink/85 disabled:opacity-50"
          >
            <Lightning className="size-4" weight="bold" />
            {generating ? "Generating…" : "Generate validation UI"}
          </button>
          {spec && (
            <span className="font-mono text-[11.5px] text-ink-faint">
              {spec.cache.hit ? (
                <>cache hit · {spec.cache.hash}</>
              ) : (
                <>
                  {(spec.generationMs / 1000).toFixed(1)}s ·{" "}
                  {spec.annotationSource === "llm"
                    ? `annotated by ${spec.annotationModel}`
                    : "deterministic fallback labels"}
                </>
              )}
            </span>
          )}
        </section>

        {spec?.annotationSource === "fallback" && spec.annotationError && (
          <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-deep">
            Annotator unavailable ({spec.annotationError}): using deterministic labels.
          </p>
        )}
        {spec?.parserWarnings && spec.parserWarnings.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-deep">
            {spec.parserWarnings.map((w, i) => (
              <p key={i}>⚠ {w}</p>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-reject/40 bg-reject-soft px-3 py-2 text-[12.5px] text-reject-deep">
            {error}
          </div>
        )}

        {/* ── Generated validation UI ─────────────────────────────── */}
        {ui && (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-semibold tracking-tight text-ink">{ui.agentTitle}</h2>
              <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[11px] text-ink-soft">
                spec v{ui.version}
              </span>
              {run && (
                <span
                  className={`rounded px-1.5 py-px font-mono text-[11px] font-medium ${STATUS_STYLE[run.status]}`}
                >
                  {run.status}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <label className="font-mono text-[11px] text-ink-faint" htmlFor="provider">
                  provider
                </label>
                <select
                  id="provider"
                  className="h-8 rounded-md border border-line-strong bg-panel px-2 text-[12.5px] text-ink"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ProviderPreference)}
                >
                  <option value="auto">auto (Anthropic → OpenAI)</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="mock">mock (offline demo)</option>
                </select>
                <button
                  type="button"
                  disabled={running}
                  onClick={runAgent}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-panel transition-colors hover:bg-ink/85 disabled:opacity-50"
                >
                  <ArrowsClockwise className={`size-4 ${running ? "animate-spin" : ""}`} weight="bold" />
                  {running ? "Running…" : run ? "Run again" : "Run agent"}
                </button>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-warn-deep">
                {warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}

            <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-3">
              {/* Panel 1 — run inputs */}
              <section className="overflow-hidden rounded-lg border border-line bg-panel">
                <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    <span className="mr-2 font-mono text-[11px] font-normal text-ink-faint">01</span>
                    {ui.inputPanel.title}
                  </h2>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {ui.inputPanel.fields.length} field{ui.inputPanel.fields.length === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="p-3.5">
                  <InputPanel spec={ui} inputs={inputs} onInputChange={(k, v) => setInputs((p) => ({ ...p, [k]: v }))} />
                </div>
              </section>

              {/* Panel 2 — proposed actions */}
              <section className="overflow-hidden rounded-lg border border-line bg-panel">
                <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    <span className="mr-2 font-mono text-[11px] font-normal text-ink-faint">02</span>
                    {ui.actionsPanel.title}
                  </h2>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {run ? `${decidedCount}/${run.toolCalls.length} decided` : `${ui.actionsPanel.actions.length} tools`}
                  </span>
                </header>
                <div className="flex flex-col gap-2.5 p-3.5">
                  {!run && (
                    <p className="text-[13px] leading-relaxed text-ink-soft">
                      {ui.actionsPanel.actions.length === 0
                        ? "This agent has no tools; the generated output is the only thing to validate."
                        : "Run the agent to see its proposed actions. Nothing executes without your approval."}
                    </p>
                  )}
                  {run && run.toolCalls.length === 0 && (
                    <p className="text-[13px] text-ink-soft">The assistant proposed no actions for this input.</p>
                  )}
                  {run?.toolCalls.map((call) => (
                    <ActionCard
                      key={call.id}
                      call={call}
                      action={ui.actionsPanel.actions.find((a) => a.toolName === call.toolName)}
                      decision={run.decisions[call.id]}
                      execution={executions[call.id]}
                      busy={busyAction !== null}
                      policy={run.policy}
                      onDecide={(d, editedArgs) => decide(call.id, d, editedArgs)}
                    />
                  ))}
                </div>
              </section>

              {/* Panel 3 — generated output */}
              <section className="flex flex-col self-stretch overflow-hidden rounded-lg border border-line bg-panel">
                <header className="flex items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-3.5 py-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    <span className="mr-2 font-mono text-[11px] font-normal text-ink-faint">03</span>
                    {ui.outputPanel.title}
                  </h2>
                  {run && (
                    <span className="font-mono text-[11px] text-ink-faint">{run.replySent ? "sent" : "draft"}</span>
                  )}
                </header>
                <div className="flex flex-1 flex-col p-3.5">
                  {run ? (
                    <OutputPanel
                      spec={ui}
                      replyText={run.replyText}
                      replySent={run.replySent}
                      busy={busyAction !== null}
                      onSend={sendReply}
                    />
                  ) : (
                    <p className="text-[13px] text-ink-soft">The generated text will appear here after a run.</p>
                  )}
                </div>
              </section>
            </div>

            {spec && (
              <TracePanel
                generation={{
                  cacheHit: spec.cache.hit,
                  cacheHash: spec.cache.hash,
                  generationMs: spec.generationMs,
                  annotationSource: spec.annotationSource,
                  annotationModel: spec.annotationModel,
                  annotationError: spec.annotationError,
                }}
                trace={run?.trace}
              />
            )}

            <AuditTrail entries={audit} />
          </>
        )}

        {!ui && !generating && (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-panel px-6 py-16">
            <div className="flex max-w-2xl flex-col items-center gap-5 text-center">
              <ol className="flex flex-col items-start gap-2.5 text-[13.5px] text-ink sm:items-center">
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-ink-faint">01</span>
                  Pick an agent definition above
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-ink-faint">02</span>
                  Generate its validation UI: structure parsed deterministically, labels annotated once
                </li>
                <li className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-ink-faint">03</span>
                  Run the agent, then review: correct, approve or reject every proposed action
                </li>
              </ol>
              <p className="text-[12.5px] text-ink-faint">
                The three-panel interface is produced from the definition alone, with no per-agent code.
                Nothing executes before a human approves it.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
