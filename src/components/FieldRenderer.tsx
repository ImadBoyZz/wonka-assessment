"use client";

import { At, CurrencyEur, FileText, Hash, TextT, ToggleLeft } from "@phosphor-icons/react";
import type { FieldType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Whitelisted field registry — the ONLY mapping from spec to widgets. */
/* The UISpec is data, never code: no eval, no dangerouslySetInnerHTML,*/
/* all values render as escaped React text nodes. An unknown type      */
/* degrades to a plain text input instead of crashing.                 */
/* ------------------------------------------------------------------ */

export function FieldTypeIcon({ type, className }: { type: FieldType; className?: string }) {
  const cls = className ?? "size-4";
  switch (type) {
    case "longtext":
      return <FileText className={cls} weight="bold" />;
    case "email":
      return <At className={cls} weight="bold" />;
    case "currency":
      return <CurrencyEur className={cls} weight="bold" />;
    case "number":
      return <Hash className={cls} weight="bold" />;
    case "boolean":
      return <ToggleLeft className={cls} weight="bold" />;
    default:
      return <TextT className={cls} weight="bold" />;
  }
}

export function FieldInput({
  type,
  value,
  onChange,
  placeholder,
}: {
  type: FieldType;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const base =
    "w-full rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft";

  switch (type) {
    case "longtext":
      return (
        <textarea
          className={`${base} min-h-32 leading-relaxed`}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      );
    case "number":
    case "currency":
      return (
        <input
          type="number"
          step="any"
          className={base}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      );
    case "email":
      return (
        <input
          type="email"
          className={base}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      );
    case "boolean":
      return (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      );
    default:
      // "text" and "unknown" both land here: generic input, never a crash.
      return (
        <input
          type="text"
          className={base}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      );
  }
}

/** Human-readable rendering of a tool-call argument value. */
export function formatArgValue(type: FieldType, value: unknown): string {
  if (type === "currency") return `€ ${String(value)}`;
  // Strict check: the string "false" is truthy — rendering it as "yes" would
  // make a reviewer approve the opposite of what the model asked.
  if (type === "boolean") return value === true || value === "true" ? "yes" : "no";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
