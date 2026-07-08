# Validation UI Generator

Generates a **Human-in-the-Loop validation interface** from an AI agent definition — the prompting structure, expected inputs and available tools — instead of hand-building a UI per automation.

## 1. Purpose

Every agent automation ends the same way: a human reviews what the agent wants to do before it happens. Today that validation UI is built per project, by hand. This prototype turns the agent **definition** into the validation UI automatically: point it at a definition file and it produces the three-panel review screen — run inputs, proposed actions with per-action APPROVE/REJECT, and the generated reply — with **no per-agent code**.

Framed in delivery terms: for a case like the reference project (tens of orders per week, ~15 minutes of manual work each, ROI measured in months), the validation UI is a hand-built React component. With a generator, the next customer agent costs a definition file instead of a UI build — the Human-in-the-Loop layer becomes a reusable product asset instead of a per-project deliverable.

Two hard constraints from the assignment drove the design:

- *"The goal is not to build a UI for one specific run result"* — generation works from the agent definition; run results only populate the generated shell.
- *"The approach should remain reusable across different automation domains"* — proven here with two live domains (customer support and order processing) through the same pipeline.

## 2. Requirements

| Tier | Requirement |
|---|---|
| **Necessary** | Generate the UI from the definition (never hardcode per agent) · deterministic extraction of structure (placeholders, tools, parameter types — including `optional(...)`) · tolerate imperfect definitions (the example's typo'd keys and a missing closing parenthesis) · per-action APPROVE/REJECT · **no tool execution before human approval, ever** · empty optional parameters omitted from action cards · full audit trail on every action · API keys server-side only |
| **Important** | Semantic quality (human labels, panel titles, field roles) via one validated LLM call with a deterministic fallback · provider abstraction with automatic fallback (Anthropic → OpenAI) · UISpec cached per definition · idempotent decisions (a double-click can never execute twice) |
| **Nice-to-have** | Offline mock provider for demos · run state machine badge (`to_be_validated → confirmed/rejected`) · cache/duration indicator · undeclared-argument flagging on action cards |

## 3. High-Level Design

**Core idea: the LLM is a compiler, not a runtime.** Generation (expensive, semantic, cacheable) is strictly separated from run time (deterministic apart from the agent call itself). Structure is *never* produced by an LLM; presentation semantics are *never* hardcoded.

```mermaid
flowchart TB
    subgraph A["PHASE A — GENERATION TIME (once per definition, cached)"]
        DEF["Agent definition (JSON)<br/>system prompt · prompt template · tool signatures"]
        P1["1· Structural Parser<br/>[deterministic]"]
        AS["AgentSchema<br/>(ground truth: keys, types, required)"]
        P2["2· Semantic Annotator<br/>[AI — 1 structured-output call]"]
        P3["3· Merger<br/>[deterministic]"]
        SPEC["UISpec (JSON contract)"]
        CACHE[("UISpec cache<br/>keyed on hash(definition)")]
        P4["4· Renderer<br/>[React, whitelisted registry]"]
        DEF -->|"(1) READ"| P1 --> AS
        AS -->|"(2) READ"| P2
        AS -->|"(3)"| P3
        P2 -->|"annotations (validated)"| P3
        P3 --> SPEC -->|"(4) WRITE"| CACHE
        SPEC -->|"(5)"| P4
    end
    subgraph B["PHASE B — RUN TIME (per validation run)"]
        HUMAN(["Human reviewer"])
        RT["5· Runtime Engine<br/>[deterministic + agent call]"]
        PROV["Provider layer<br/>Anthropic → OpenAI fallback · mock"]
        CARDS["Pending action cards + reply"]
        EX["6· Executor stub<br/>[pluggable]"]
        AUDIT[("Audit log<br/>append-only")]
        HUMAN -->|"(6) fills inputs, runs"| RT
        AS -.->|"same tool schemas — no drift"| RT
        RT -->|"(7) PUSH"| PROV
        PROV -->|"(8) intercepted tool calls"| CARDS
        CARDS -->|"(9) APPROVE / REJECT"| HUMAN
        HUMAN -->|"(10) approve only"| EX
        RT & EX & HUMAN -.->|"cross-cutting: every event"| AUDIT
    end
```

Legend: solid arrows = data flow (READ/PUSH as labeled) · dotted = cross-cutting · numbers refer to the data-flow steps below. Components are labeled **[deterministic]** vs **[AI]** — where non-determinism lives is a first-class architecture question here.

### Components

1. **Structural Parser** (`src/lib/parser.ts`) — deterministic. Extracts `{{placeholders}}` (regex + template-label capture), parses tool signatures with a small grammar (`float | int | str | bool | optional(T)`, unknown types degrade to a generic field), detects the trailing completion marker (`answer :`). Recovers from broken syntax — the assignment's own second tool signature is missing its closing parenthesis, and the fixture keeps it that way. Output: **AgentSchema**, the ground truth. Structure cannot hallucinate because no model touches it.
2. **Semantic Annotator** (`src/lib/annotator.ts`) — AI, exactly one structured-output call per definition. Produces presentation metadata only: human labels ("Email Content" for the typo'd key `custome_mail`), panel titles, field-type hints (`float` + "in euros" → currency), and placeholder roles (`primary` / `context` / `retrieved` — why the example UI shows the customer mail but not the generic instructions). Zod-validated; one retry with the validation error as context; on failure the pipeline continues with deterministic labels. It can never add, drop or retype a field: the merger iterates the parser's keys and merely looks up annotations.
3. **Merger** (`src/lib/merger.ts`) — deterministic. Joins AgentSchema ⋈ annotations into the **UISpec**. Type hints are constrained to the structural type (a `float` may present as `currency`, never as `text`; `required` always comes from the parser). Missing annotations fall back to the template label, then `titleCase(key)`.
4. **Renderer** (`src/components/`) — a fixed, whitelisted component registry that renders UISpec JSON. No `eval`, no `dangerouslySetInnerHTML`; every value is an escaped text node. Unknown field types render as a plain text input rather than crashing.
5. **Runtime Engine** (`src/app/api/run/route.ts` + `src/lib/providers/`) — renders the prompt template with the reviewer's inputs and calls the provider with tool schemas derived from the **same AgentSchema** that generated the UI (one source of truth — the UI can never disagree with the tools the model was given). The provider loop is **side-effect-free**: every tool call the model makes is intercepted and acknowledged as *queued for human validation*, letting the model finish its reply while nothing executes. Capped turns and `max_tokens` on every call (the assessment keys are shared).
6. **Executor + audit** (`src/lib/executor.ts`, `src/lib/store.ts`) — the executor is a pluggable interface with a mock implementation, called from exactly one place, only after a human clicked APPROVE, and at most once per action (replays get HTTP 409). Every event — run created, approved, rejected, executed, reply sent, status change — appends to the audit log.

### Data flow (definition → validation UI)

1. `POST /api/generate` reads the agent definition file (READ).
2. Structural Parser produces the AgentSchema (deterministic, always succeeds).
3. Semantic Annotator makes one structured-output LLM call about that schema (AI); the Merger validates and joins the result — or degrades to deterministic labels.
4. The resulting UISpec is written to the cache, keyed on `hash(definition)` (WRITE) — later generates are cache hits until the definition changes.
5. The React renderer draws the three panels from the UISpec — fields, action cards and output panel are data, not code.
6. The reviewer fills the input fields (sample inputs prefill them) and starts a run (internal trigger).
7. The Runtime Engine renders the user prompt and calls the provider chain with the AgentSchema's tool schemas (PUSH).
8. Tool calls come back intercepted — they appear as **pending** action cards; the generated text lands in the output panel. Nothing has executed.
9. The reviewer approves or rejects each action independently; every decision is final and audited.
10. Only an APPROVE reaches the executor (exactly once); the suggested reply is likewise only sent by a human click. Cross-cutting: every step appends to the audit trail.

### The UISpec contract

The language-agnostic JSON at the boundary between generation and rendering (`src/lib/types.ts`):

```ts
interface UISpec {
  version: 1;
  agentTitle: string;
  inputPanel:  { title: string; fields: Field[] };
  actionsPanel: { title: string; actions: ToolAction[] };
  outputPanel: { title: string; type: "generated-text"; description: string };
}
interface Field      { key: string; label: string; type: FieldType; required: boolean; role?: "primary" | "context" | "retrieved" }
interface ToolAction { toolName: string; label: string; mutating: boolean; fields: Field[] }
type FieldType = "text" | "longtext" | "number" | "currency" | "email" | "boolean" | "unknown";
```

This prototype is Next.js/TypeScript for iteration speed; the contract is deliberately implementation-neutral. In a Python/FastAPI backend the Zod schemas translate 1:1 to Pydantic models (`UISpecSchema` ↔ `class UISpec(BaseModel)`) — the contract is the design, TypeScript is just this prototype's spelling of it.

## 4. Setup

Prerequisites: Node 20+.

```bash
git clone <this repo>
cd wonka-assessment
npm install
cp .env.example .env.local   # fill in the provided ANTHROPIC_API_KEY / OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Then: pick an agent definition → **Generate validation UI** → **Run agent** → approve/reject each action. No database or other infrastructure; local state lives in `.data/` (gitignored). `npm test` runs the parser suite against the assignment's verbatim text — typos, missing parenthesis and all.

Environment variables (server-side only, never exposed to the client):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Primary provider (annotator + agent runs) |
| `OPENAI_API_KEY` | Fallback provider (agent runs) |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | Optional model overrides (default `claude-opus-4-8` / `gpt-4o`) |

## 5. Adding a new agent — the actual test of this system

Drop one JSON file in `fixtures/` — no code changes anywhere:

```jsonc
{
  "id": "deploy-approval-agent",
  "name": "Deploy Approval",
  "definition": {
    "system_prompt": "You are a release agent ...",
    "user_prompt_template": "Change summary :\n{{change_summary}}\nPipeline status :\n{{pipeline_status}}\ndecision :",
    "tools": [
      { "signature": "trigger_deploy(environment : str, version : str)", "description": "deploys the given version" },
      { "signature": "rollback(reason : optional(str))", "description": "rolls back the previous release" }
    ]
  },
  "sampleInputs": { "change_summary": "…", "pipeline_status": "…" },
  "mockResult": { "toolCalls": [], "replyText": "…" }
}
```

(`sampleInputs` prefills the demo; `mockResult` powers the offline mock provider — both optional.)

It appears in the dropdown, generates its own validation UI, and runs through the same approval flow. The two included fixtures demonstrate this across domains: `supernicecompany.json` (the assignment example, **verbatim, typos included**) and `vinventions-orders.json` (an order-processing agent modeled on the reference project: order-line extraction against a pricing matrix, delivery address, missing-artwork exception).

## 6. Assumptions

- **The agent definition is trusted developer input** (written by the team deploying the agent). Run inputs and model outputs are *not* trusted — see security below. Multi-tenant definition upload would make the definition itself an injection surface; out of scope here.
- **Placeholder roles need semantics.** The example UI shows the customer mail but hides generic instructions and retrieved Q&A — that distinction isn't derivable structurally. It comes from the annotator; if annotation fails, the fallback shows *every* field prominently (safe direction: show more, hide nothing).
- **Reject is a decision, not a retry.** Rejecting an action records it and skips execution; it does not re-prompt the agent. A targeted "reprocess" is a separate human action (**Run again**), mirroring the reference project's surgical reprocess.
- **The executor is a stub.** There is no real ERP/CRM behind this prototype; the executor interface is where a real backend plugs in. The mock still runs strictly post-approval — the gate is the point, not the backend.
- **One agent per validation screen.** The UISpec extends naturally to multi-agent flows (a `sections: AgentSection[]` level per pipeline step, each with its own actions, driven by a state machine like the reference's kanban states) — designed for, deliberately not built in a 4-hour scope.
- **UI language is English**; amounts render with a € hint when the type resolves to `currency`.

## 7. Technical considerations

- **Extensibility** — new domain = new definition file (proven live with two domains). New field types are one entry in the type registry + one renderer case; unknown inputs already degrade gracefully, so extension is additive. The UISpec is versioned (`version: 1`, the badge in the UI) for forward migration, and the multi-agent path is a schema extension, not a rewrite.
- **Reliability** — the generation pipeline cannot hard-fail: structure is deterministic, and the only AI step is Zod-validated with one error-context retry and a deterministic fallback (degraded labels, never a crash). The LLM cannot invent or lose fields by construction (the merger iterates parser keys only). Decisions are idempotent server-side — a double-click or replayed request returns 409 instead of executing twice.
- **Security** — keys live in server-side env vars only, never client-side, never logged, gitignored (`.env.example` documents them). **No side effect before approval is the core invariant**: the provider loop acknowledges tool calls without executing; the executor has exactly one call site, behind the human gate. Model output is untrusted content — rendered as escaped text through a whitelisted registry (no eval, no raw HTML). Prompt injection via run inputs (e.g. a malicious customer mail instructing the agent) is mitigated at the review layer: resolved parameter values are shown prominently on each card, undeclared arguments are flagged, and the mutating/read-only classification of a tool is derived deterministically from the schema — never delegated to the model. Costs are bounded (capped `max_tokens`, capped loop turns, reduced retries — the assessment keys are shared).
- **Observability** — every pipeline step reports itself (generation duration, cache hit/hash, annotation source and model, provider fallback warnings surface in the UI), and the append-only audit trail records every run, decision, execution and status change ("full audit trail on every action"). In production the annotator and agent calls are the natural Langfuse tracing points; the provider layer is the gateway seam (Requesty-style) where routing/cost tracking attach.
- **Performance** — the expensive step (LLM annotation) runs once per definition and is cached on `hash(definition)`; regeneration is a cache read (visible in the UI: ~5–25s fresh vs instant hit). The run path contains zero LLM calls except the agent call itself. The UISpec cache also makes generation idempotent.

## 8. Known limitations / future work

- **Editable action parameters before approve** (the reference's "all order fields are editable") — the UISpec already carries per-parameter types; the edit affordance and a re-validation step are the missing pieces.
- **Real executor integrations** behind the `ToolExecutor` interface (per-tool endpoints, retries, compensation).
- **Multi-agent validation screens** — schema path described in Assumptions; kanban-per-state UX like the reference project.
- **Trace viewer / Langfuse integration** for the annotator and agent calls.
- **Queue/batch review** (auto-load next run) — the `1 / 1` counter is honest about the single-run demo scope.
- Tool-signature grammar covers the assignment's type language plus obvious neighbours; nested/composite types (`list(...)`, objects) currently degrade to a generic field by design and would extend the registry recursively.

## 9. Screenshots

**Assignment example — SuperNiceCompany customer support** (verbatim definition, typos included; live run via `claude-opus-4-8`; note the omitted empty `phone_number` and the € type hint on the billing amount):

![SuperNiceCompany validation UI](docs/screenshot-supernicecompany.png)

**Reusability proof — Vinventions-style order processing** (same pipeline, different domain: tiered pricing applied from retrieved context, four independent approvals, exception flagging):

![Vinventions validation UI](docs/screenshot-vinventions.png)

Demo video: _link to be added on submission_.

## 10. Actual time spent

Roughly **4 hours** end to end: ~1.5h analysis and design (assignment + reference document, architecture decisions), ~2h implementation and live testing, ~0.5h documentation. Built AI-assisted (Claude Code); every architectural decision, trade-off and line of this document was reviewed by hand.
