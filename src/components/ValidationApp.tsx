"use client";

import { ArrowsClockwise, Flask, Lightning, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ExecutionResult } from "@/lib/executor";
import type { ProviderPreference } from "@/lib/providers/types";
import type { AuditEntry, RunRecord, RunStatus, UISpec } from "@/lib/types";
import { ActionCard } from "./ActionCard";
import { AuditTrail } from "./AuditTrail";
import { InputPanel } from "./InputPanel";
import { OutputPanel } from "./OutputPanel";

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
  confirmed: "bg-approve text-white",
  rejected: "bg-reject text-white",
  partially_confirmed: "bg-warn text-white",
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 lg:p-6">
      {/* ── Generator toolbar ─────────────────────────────────────── */}
      <header className="rounded-xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkle className="size-5 text-accent" weight="fill" />
            <h1 className="text-sm font-semibold text-ink">Validation UI Generator</h1>
          </div>
          <span className="text-xs text-ink-soft">agent definition →</span>
          <select
            className="rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink"
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
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
          >
            <Lightning className="size-4" weight="bold" />
            {generating ? "Generating…" : "Generate validation UI"}
          </button>
          {spec && (
            <span className="text-xs text-ink-soft">
              {spec.cache.hit ? (
                <>spec cache hit ({spec.cache.hash})</>
              ) : (
                <>
                  generated in {(spec.generationMs / 1000).toFixed(1)}s ·{" "}
                  {spec.annotationSource === "llm"
                    ? `annotated by ${spec.annotationModel}`
                    : "deterministic fallback labels"}
                </>
              )}
            </span>
          )}
          <Link
            href="/playground"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <Flask className="size-3.5" weight="bold" /> playground
          </Link>
        </div>
        {spec?.annotationSource === "fallback" && spec.annotationError && (
          <p className="mt-2 text-xs text-warn">
            Annotator unavailable ({spec.annotationError}) — using deterministic labels.
          </p>
        )}
        {spec?.parserWarnings?.map((w, i) => (
          <p key={i} className="mt-2 text-xs text-warn">
            ⚠ {w}
          </p>
        ))}
      </header>

      {error && (
        <div className="rounded-lg border border-reject bg-reject-soft px-4 py-2 text-sm text-reject">
          {error}
        </div>
      )}

      {/* ── Generated validation UI ───────────────────────────────── */}
      {ui && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-ink">{ui.agentTitle}</h2>
            <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
              v{ui.version}
            </span>
            {run && (
              <span
                className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${STATUS_STYLE[run.status]}`}
              >
                {run.status}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-ink-soft" htmlFor="provider">
                provider
              </label>
              <select
                id="provider"
                className="rounded-md border border-line bg-panel px-2 py-1 text-xs text-ink"
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
                className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <ArrowsClockwise className={`size-4 ${running ? "animate-spin" : ""}`} weight="bold" />
                {running ? "Running…" : run ? "Run again" : "Run agent"}
              </button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-line bg-panel px-4 py-2 text-xs text-warn">
              {warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}

          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Panel 1 — Informations */}
            <section className="rounded-xl border border-line bg-panel p-4">
              <header className="mb-3 flex items-center justify-between border-b border-line pb-2">
                <h2 className="text-sm font-semibold text-ink">{ui.inputPanel.title}</h2>
              </header>
              <InputPanel spec={ui} inputs={inputs} onInputChange={(k, v) => setInputs((p) => ({ ...p, [k]: v }))} />
            </section>

            {/* Panel 2 — Actions */}
            <section className="rounded-xl border border-line bg-panel p-4">
              <header className="mb-3 border-b border-line pb-2">
                <h2 className="text-sm font-semibold text-ink">{ui.actionsPanel.title}</h2>
              </header>
              {!run && (
                <p className="text-sm text-ink-soft">
                  {ui.actionsPanel.actions.length === 0
                    ? "This agent has no tools — the generated output is the only thing to validate."
                    : "Run the agent to see its proposed actions. Nothing executes without your approval."}
                </p>
              )}
              {run && run.toolCalls.length === 0 && (
                <p className="text-sm text-ink-soft">The assistant proposed no actions for this input.</p>
              )}
              <div className="flex flex-col gap-3">
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

            {/* Panel 3 — Generated output */}
            <section className="flex flex-col rounded-xl border border-line bg-panel p-4">
              <header className="mb-3 border-b border-line pb-2">
                <h2 className="text-sm font-semibold text-ink">{ui.outputPanel.title}</h2>
              </header>
              {run ? (
                <OutputPanel
                  spec={ui}
                  replyText={run.replyText}
                  replySent={run.replySent}
                  busy={busyAction !== null}
                  onSend={sendReply}
                />
              ) : (
                <p className="text-sm text-ink-soft">The generated text will appear here after a run.</p>
              )}
            </section>
          </div>

          <AuditTrail entries={audit} />
        </>
      )}

      {!ui && !generating && (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line p-12 text-center text-sm text-ink-soft">
          Pick an agent definition and generate its validation UI.
          <br />
          The three-panel interface below is produced from the definition alone — no per-agent code.
        </div>
      )}
    </div>
  );
}
