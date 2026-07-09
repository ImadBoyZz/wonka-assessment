# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Technical assessment for Wonka AI: a **Human-in-the-Loop validation UI generator**. It takes an agent definition (system prompt + user prompt template + tool signatures in pseudocode) and generates the three-panel review UI (inputs, per-action APPROVE/REJECT cards, generated reply) with no per-agent code. `README.md` is the English deliverable and describes design + rationale in full; `PLAN.md` and `ANALYSE.md` are internal Dutch design docs (plan decisions, assignment analysis).

## Commands

```bash
npm run dev        # dev server on :3000
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest run (parser suite)
npx vitest run src/lib/parser.test.ts          # single file
npx vitest run -t "pattern"                    # single test by name
```

Env: `.env.local` with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (optional `ANTHROPIC_MODEL` / `OPENAI_MODEL`; defaults `claude-opus-4-8` / `gpt-4o`). **The keys are shared across all assessment candidates** — never commit them, never client-side (`NEXT_PUBLIC_…`), never in logs; keep `max_tokens` and loop turns capped in provider code. No database: local state lives in `.data/` (gitignored) as JSON files + an append-only `audit.jsonl`.

## Architecture

Core idea: **the LLM is a compiler, not a runtime.** Generation (semantic, cached) is strictly separated from run time (deterministic except the agent call). Structure is never produced by an LLM; presentation semantics are never hardcoded.

**Phase A — generation** (`POST /api/generate`, once per definition, cached on `hash(definition)`):

1. `src/lib/parser.ts` — deterministic Structural Parser. Extracts `{{placeholders}}` + preceding labels, parses tool signatures with a small type grammar (`float | int | str | bool | optional(T)`; unknown types degrade to `unknown`), detects the trailing completion marker. Output: `AgentSchema` — the ground truth for keys/types/required.
2. `src/lib/annotator.ts` — the only AI step: one structured-output call producing presentation metadata (human labels, panel titles, type hints like `float`→`currency`, field roles `primary`/`context`/`retrieved`). Zod-validated, one retry with error context, deterministic fallback on failure.
3. `src/lib/merger.ts` — deterministic join of AgentSchema ⋈ annotations into the **UISpec**. It iterates the parser's keys only, so the LLM can never add/drop/retype a field; type hints are constrained to the structural type.
4. `src/components/` — fixed whitelisted registry rendering UISpec JSON (`ValidationApp` orchestrates; `FieldRenderer` maps field types; unknown types render as text input). No eval, no raw HTML; all model output rendered as escaped text.

**Phase B — run time** (`POST /api/run` → `src/lib/providers/`):

- The run route renders the prompt template and calls the provider with tool schemas derived from the **same AgentSchema** that generated the UI (single source of truth — UI and tools can't drift).
- Provider chain (`providers/index.ts`): `auto` = Anthropic → OpenAI fallback, each failure surfaced as a UI warning. The **mock provider is never a silent fallback** — only an explicit choice.
- The provider loop is **side-effect-free**: every tool call is intercepted and acknowledged as "queued for human validation" so the model finishes its reply while nothing executes.

**Decisions** (`POST /api/actions`): the executor (`src/lib/executor.ts`, pluggable stub) has exactly **one call site**, runs only on APPROVE, and at most once per action — a repeated decision returns HTTP 409. Every event appends to the audit log (`src/lib/store.ts`).

Shared types + Zod schemas live in `src/lib/types.ts`; the `UISpec` is the versioned, language-agnostic contract between generation and rendering.

## Invariants (do not break)

- **No tool execution before human approval, ever.** The executor's single call site in `api/actions/route.ts` is the gate.
- Structure comes from the parser, never from the LLM; `mutating` classification is derived deterministically, never delegated to the model.
- Decisions are final and idempotent (409 on replay).
- Every run/decision/execution/status change writes an audit entry.

## Fixtures

Agents are JSON files in `fixtures/` (schema: `FixtureSchema` in types.ts — `definition` feeds the generator; `sampleInputs`/`mockResult` are demo-only). Adding an agent = adding one file; it appears in the dropdown automatically. **`supernicecompany.json` is the assignment text verbatim — its typos (`custome_mail`) and the missing closing parenthesis in the second tool signature are intentional and load-bearing for the parser tests. Never "fix" them.** `parser.test.ts` runs against this verbatim text.
