"use client";

import { Path } from "@phosphor-icons/react";
import type { RunTrace } from "@/lib/types";

/* Trace panel — the observability story made visible. One generation span +
 * one run span, exactly what would flow to Langfuse in production (the README
 * calls the annotator and agent calls "the natural Langfuse tracing points").
 * Metadata and prompts only: API keys never reach the client, and provider
 * failures arrive as the same sanitized warnings the toolbar already shows. */

export interface GenerationTraceInfo {
  cacheHit: boolean;
  cacheHash: string;
  generationMs: number;
  annotationSource: "llm" | "fallback";
  annotationModel?: string;
  annotationError?: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="w-32 shrink-0 font-mono text-[11px] text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export function TracePanel({ generation, trace }: { generation: GenerationTraceInfo; trace?: RunTrace }) {
  return (
    <details className="rounded-xl border border-line bg-panel p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
        <Path className="size-4 text-accent" weight="bold" />
        Trace
        <span className="text-xs font-normal text-ink-soft">
          — generation + run spans (the Langfuse tracing points in production)
        </span>
      </summary>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Generation span (once per definition)
          </h3>
          <dl className="flex flex-col gap-1">
            <Row label="uispec cache">
              {generation.cacheHit ? `hit (${generation.cacheHash})` : `miss → generated (${generation.cacheHash})`}
            </Row>
            <Row label="duration">{(generation.generationMs / 1000).toFixed(1)}s</Row>
            <Row label="annotator">
              {generation.annotationSource === "llm"
                ? `llm (${generation.annotationModel})`
                : `deterministic fallback${generation.annotationError ? ` — ${generation.annotationError}` : ""}`}
            </Row>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Run span (per validation run)
          </h3>
          {trace ? (
            <dl className="flex flex-col gap-1">
              <Row label="provider">{trace.provider}</Row>
              <Row label="model">{trace.model}</Row>
              <Row label="duration">{(trace.durationMs / 1000).toFixed(1)}s</Row>
              {trace.fallbackPath.length > 0 && (
                <Row label="fallback path">
                  {trace.fallbackPath.map((w, i) => (
                    <span key={i} className="block text-warn">
                      {w}
                    </span>
                  ))}
                </Row>
              )}
              {trace.truncated && (
                <Row label="truncated">
                  <span className="text-warn">turn cap reached — action list may be incomplete</span>
                </Row>
              )}
            </dl>
          ) : (
            <p className="text-xs text-ink-soft">No run yet.</p>
          )}
        </section>
      </div>

      {trace && (
        <div className="mt-3 flex flex-col gap-2">
          <details className="rounded-lg border border-line p-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-soft">System prompt</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
              {trace.systemPrompt}
            </pre>
          </details>
          <details className="rounded-lg border border-line p-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-soft">
              Rendered user prompt — template after placeholder substitution, exactly what the model saw
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
              {trace.renderedUserPrompt}
            </pre>
          </details>
        </div>
      )}
    </details>
  );
}
