"use client";

import { Check, Copy, PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";
import type { UISpec } from "@/lib/types";

/* Panel 3 — the free-text output ("Suggested Reply" for the example agent).
 * Sending is a human action: it goes through the API and into the audit trail,
 * never automatically. Send counts as approving the reply, so it uses the
 * approve color. */

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
      // Clipboard unavailable (permissions); non-critical.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="font-mono text-[11px] text-ink-faint">{spec.outputPanel.description}</p>
      <div className="mt-2.5 flex-1 whitespace-pre-wrap text-[13.5px] leading-[1.65] text-ink">
        {replyText || <span className="italic text-ink-faint">No text output was generated.</span>}
      </div>
      {replyText && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            {copied ? <Check className="size-3.5" weight="bold" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            disabled={replySent || busy}
            onClick={onSend}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-approve px-3 text-[12.5px] font-semibold text-panel transition-colors hover:bg-approve-deep disabled:opacity-50"
          >
            <PaperPlaneTilt className="size-3.5" weight="bold" />
            {replySent ? "Sent (mock)" : "Send reply"}
          </button>
        </div>
      )}
    </div>
  );
}
