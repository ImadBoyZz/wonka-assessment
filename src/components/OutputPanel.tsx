"use client";

import { Check, Copy, PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";
import type { UISpec } from "@/lib/types";

/* Panel 3 — the free-text output ("Suggested Reply" for the example agent).
 * Sending is a human action too: it goes through the API and lands in the
 * audit trail. Nothing is sent automatically. */

export function OutputPanel({
  spec,
  replyText,
  replySent,
  busy,
  onSend,
}: {
  spec: UISpec;
  replyText: string;
  replySent: boolean;
  busy: boolean;
  onSend: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(replyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions) — non-critical.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-xs font-medium text-accent">{spec.outputPanel.description}</p>
      <div className="mt-2 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
        {replyText || <span className="italic text-ink-soft">No text output was generated.</span>}
      </div>
      {replyText && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-3 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent-deep"
          >
            {copied ? <Check className="size-3.5" weight="bold" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            disabled={replySent || busy}
            onClick={onSend}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
          >
            <PaperPlaneTilt className="size-3.5" weight="bold" />
            {replySent ? "Sent (mock)" : "Send reply"}
          </button>
        </div>
      )}
    </div>
  );
}
