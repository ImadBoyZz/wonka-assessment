"use client";

import { Path } from "@phosphor-icons/react";
import type { RunTrace } from "@/lib/types";

/* Trace panel — one generation span and one run span, the points that would
 * flow to Langfuse in production. Metadata and prompts only: API keys never
 * reach the client. Raw prompts render on the dark blocks, showing what the
 * model actually saw. */

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
    <div className="flex items-baseline gap-2 text-[12.5px]">
      <dt className="w-32 shrink-0 font-mono text-[11px] text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export function TracePanel({ generation, trace }: { generation: GenerationTraceInfo; trace?: RunTrace }) {
  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-panel">
      <summary className="flex cursor-pointer items-baseline gap-2 border-line bg-panel-2 px-3.5 py-2 group-open:border-b">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Path className="size-4 text-ink-faint" weight="bold" />
          Trace
        </h2>
        <span className="font-mono text-[11px] text-ink-faint">
          generation + run spans: the Langfuse tracing points in production
        </span>
      </summary>

      <div className="flex flex-col gap-4 p-3.5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 font-mono text-[11px] text-ink-faint">
              generation span · once per definition
            </h3>
            <dl className="flex flex-col gap-1">
              <Row label="uispec cache">
                {generation.cacheHit ? `hit (${generation.cacheHash})` : `miss → generated (${generation.cacheHash})`}
              </Row>
              <Row label="duration">{(generation.generationMs / 1000).toFixed(1)}s</Row>
              <Row label="annotator">
                {generation.annotationSource === "llm"
                  ? `llm (${generation.annotationModel})`
                  : `deterministic fallback${generation.annotationError ? ` (${generation.annotationError})` : ""}`}
              </Row>
            </dl>
          </section>

          <section>
            <h3 className="mb-2 font-mono text-[11px] text-ink-faint">run span · per validation run</h3>
            {trace ? (
              <dl className="flex flex-col gap-1">
                <Row label="provider">{trace.provider}</Row>
                <Row label="model">{trace.model}</Row>
                <Row label="duration">{(trace.durationMs / 1000).toFixed(1)}s</Row>
                {trace.fallbackPath.length > 0 && (
                  <Row label="fallback path">
                    {trace.fallbackPath.map((w, i) => (
                      <span key={i} className="block text-warn-deep">
                        {w}
                      </span>
                    ))}
                  </Row>
                )}
                {trace.truncated && (
                  <Row label="truncated">
                    <span className="text-warn-deep">turn cap reached; the action list may be incomplete</span>
                  </Row>
                )}
              </dl>
            ) : (
              <p className="text-[12.5px] text-ink-faint">No run yet.</p>
            )}
          </section>
        </div>

        {trace && (
          <div className="flex flex-col gap-2">
            <details className="overflow-hidden rounded-md border border-line">
              <summary className="cursor-pointer px-2.5 py-1.5 font-mono text-[11.5px] text-ink-soft transition-colors hover:text-ink">
                system prompt
              </summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-glass-ink">
                {trace.systemPrompt}
              </pre>
            </details>
            <details className="overflow-hidden rounded-md border border-line">
              <summary className="cursor-pointer px-2.5 py-1.5 font-mono text-[11.5px] text-ink-soft transition-colors hover:text-ink">
                rendered user prompt: the template after placeholder substitution, exactly what the model saw
              </summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-glass-ink">
                {trace.renderedUserPrompt}
              </pre>
            </details>
          </div>
        )}
      </div>
    </details>
  );
}
