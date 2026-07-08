"use client";

import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import type { Field, UISpec } from "@/lib/types";
import { FieldInput, FieldTypeIcon } from "./FieldRenderer";

/* Panel 1 — "Informations". Primary fields (the per-run input a reviewer
 * must see) are expanded; context/retrieved fields are collapsed by default,
 * mirroring the example UI where only the customer mail is visible while
 * generic instructions and similar Q&A stay out of view — but every field
 * remains reachable and editable. */

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
    <section className="overflow-hidden rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium ${
          isPrimary ? "bg-accent-soft text-accent-deep" : "bg-card text-ink-soft"
        }`}
      >
        <FieldTypeIcon type={field.type} />
        <span className="flex-1">{field.label}</span>
        {!isPrimary && field.role && (
          <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
            {ROLE_HINT[field.role] ?? field.role}
          </span>
        )}
        {open ? <CaretUp className="size-4" /> : <CaretDown className="size-4" />}
      </button>
      {open && (
        <div className="bg-panel p-3">
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
    <div className="flex flex-col gap-3">
      {spec.inputPanel.fields.length === 0 && (
        <p className="text-sm text-ink-soft">This agent takes no per-run inputs.</p>
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
