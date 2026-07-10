"use client";

import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import type { Field, UISpec } from "@/lib/types";
import { FieldInput, FieldTypeIcon } from "./FieldRenderer";

/* Panel 1 — the run inputs. Primary fields are expanded; context and
 * retrieved fields are collapsed by default (like the example UI, where only
 * the customer mail is shown and the generic instructions and similar Q&A stay
 * out of view), but every field stays reachable and editable. */

const ROLE_HINT: Record<string, string> = {
  context: "static context",
  retrieved: "retrieved data",
};

function FieldSection({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const isPrimary = (field.role ?? "primary") === "primary";
  const [open, setOpen] = useState(isPrimary);

  return (
    <section className="overflow-hidden rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-panel-2 ${
          isPrimary ? "font-medium text-ink" : "text-ink-soft"
        }`}
      >
        <FieldTypeIcon type={field.type} className="size-3.5 shrink-0 text-ink-faint" />
        <span className="flex-1">{field.label}</span>
        {!isPrimary && field.role && (
          <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[10.5px] text-ink-faint">
            {ROLE_HINT[field.role] ?? field.role}
          </span>
        )}
        {open ? (
          <CaretUp className="size-3.5 shrink-0 text-ink-faint" />
        ) : (
          <CaretDown className="size-3.5 shrink-0 text-ink-faint" />
        )}
      </button>
      {open && (
        <div className="border-t border-line p-2.5">
          <FieldInput
            type={field.type}
            value={value}
            onChange={onChange}
            placeholder={`{{${field.key}}}`}
          />
        </div>
      )}
    </section>
  );
}

export function InputPanel({
  spec,
  inputs,
  onInputChange,
}: {
  spec: UISpec;
  inputs: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {spec.inputPanel.fields.length === 0 && (
        <p className="text-[13px] text-ink-soft">This agent takes no per-run inputs.</p>
      )}
      {spec.inputPanel.fields.map((field) => (
        <FieldSection
          key={field.key}
          field={field}
          value={inputs[field.key] ?? ""}
          onChange={(value) => onInputChange(field.key, value)}
        />
      ))}
    </div>
  );
}
