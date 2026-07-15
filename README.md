# Validation UI Generator

Give this tool the definition of an AI agent (its prompts and its tools) and it builds the review screen a human uses to check the agent's work before anything actually happens. No custom code per agent.

## 1. Purpose

When a company automates work with an AI agent, a person still has to check what the agent wants to do before it happens. Today, that review screen is built by hand for every single project.

This prototype removes that manual step. Point it at an agent definition file and it generates the review screen automatically, with three panels:

1. the inputs the run was started with,
2. every action the agent proposes, each with its own APPROVE / REJECT buttons,
3. the reply the agent wrote.

Why this matters in practice: in the reference project (tens of orders per week, about 15 minutes of manual work each), the review screen was a hand-built React component. With a generator, the next customer's agent costs one definition file instead of a UI build. The human-review layer becomes a reusable product instead of something rebuilt per project.

Two rules from the assignment shaped the whole design:

- *"The goal is not to build a UI for one specific run result"* — so the UI is generated from the agent's definition; run results only fill in the generated screen.
- *"The approach should remain reusable across different automation domains"* — proven here with two working domains (customer support and order processing) going through the same pipeline.

## 2. Requirements

| Tier | Requirement |
|---|---|
| **Necessary** | Generate the UI from the definition, never hardcode it per agent · extract the structure (placeholders, tools, parameter types including `optional(...)`) with plain code, not AI · handle imperfect definitions (the example's typo'd keys and a missing closing parenthesis) · APPROVE/REJECT per action · **nothing executes before a human approves, ever** · action parameters can be edited before approval (the reference project's "all order fields are editable") and are re-checked on the server · empty optional parameters are left off the action cards · every action is logged · API keys stay on the server |
| **Important** | Readable labels, panel titles and field roles come from one AI call that is strictly validated, with a non-AI fallback · two providers with automatic fallback (Anthropic → OpenAI) · the generated screen is cached per definition · a decision can never run twice, even on a double-click, a replayed request or two requests at the same time |
| **Nice-to-have** | Offline mock provider for demos · run status badge (`to_be_validated → confirmed/rejected`) · cache and duration indicator · a warning when the agent sends arguments that were never declared · `/playground`: paste any definition and watch the UI generate live · rule-based risk badges per action (low/medium/high; high asks for a second confirmation click) · `/dashboard`: statistics from the audit log — runs per status, approval/reject rate per tool, how often humans had to correct each field, median time to decision |

## 3. High-Level Design

**Core idea: the AI model helps *prepare* the screen once; it never *decides* what is on it.** In compiler terms: the LLM is a compiler, not a runtime. The expensive, "smart" work happens one time per agent definition and is cached. After that, everything is plain, predictable code — except the agent call itself. The structure of the screen (which fields, which types, what is required) never comes from the model; the wording and presentation never get hardcoded.

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

Legend: solid arrows are data flow, dotted arrows apply everywhere, and the numbers match the data-flow steps below. Each component is marked **[deterministic]** (plain code, same input always gives the same output) or **[AI]** — knowing exactly where the unpredictable part lives was a deliberate design goal.

### Components

1. **Structural Parser** (`src/lib/parser.ts`) — plain code, no AI. It reads the definition and extracts the facts: which `{{placeholders}}` exist, which tools, which parameter types (`float | int | str | bool | optional(T)`; a type it doesn't know becomes a generic field), and the marker where the agent's answer should start (`answer :`). It also survives broken input — the assignment's own second tool signature is missing its closing parenthesis, and the fixture keeps it that way on purpose. Its output is the **AgentSchema**: the single source of truth for what exists. Because no model touches this step, it can never invent fields.
2. **Semantic Annotator** (`src/lib/annotator.ts`) — the only AI step: exactly one call per definition. It only decides presentation: readable labels ("Email Content" for the typo'd key `custome_mail`), panel titles, display hints (a `float` described as "in euros" is shown as a currency field), and which inputs are the main content versus background information — that is why the example UI shows the customer's mail prominently but not the generic instructions. Its answer must match a strict schema (checked with Zod); on a bad answer it gets one retry with the error explained, and if that also fails the pipeline simply continues with auto-generated labels. It cannot add, remove or change fields, because the next step only *looks up* its suggestions.
3. **Merger** (`src/lib/merger.ts`) — plain code. It combines the AgentSchema with the annotations into the **UISpec**, the JSON that describes the screen. It walks over the parser's fields only, so an AI suggestion that conflicts with the real structure loses: a `float` may be displayed as currency but never as free text, and whether a field is required always comes from the parser. Missing labels fall back to the label found in the template, then to a cleaned-up version of the key name.
4. **Renderer** (`src/components/`) — a fixed set of React components draws the UISpec. Only known component types can render, there is no `eval` and no raw HTML, and everything that came from a model is shown as plain escaped text. A field type the renderer doesn't know becomes a normal text box instead of a crash.
5. **Runtime Engine** (`src/app/api/run/route.ts` + `src/lib/providers/`) — fills the prompt template with the reviewer's inputs and calls the model. The tool definitions it sends are built from the **same AgentSchema** the UI came from, so the screen and the tools the model sees can never disagree. Crucially, the run is **side-effect-free**: every tool call the model makes is caught and answered with "queued for human validation", so the model can finish its reply while nothing actually runs. Every call has capped tokens and turns (the assessment keys are shared).
6. **Executor + audit** (`src/lib/executor.ts`, `src/lib/store.ts`) — the executor is a stub with a clean interface; this is where a real backend (ERP, CRM, mail) would plug in. It is called from exactly one place in the code, only after a human clicked APPROVE, and at most once per action — repeating a decision gets HTTP 409 ("already decided"). Before approving, the reviewer can **edit an action's parameters** (fix, then confirm — the reference project's "all order fields are editable"): the card turns into the same input fields as panel 1, and the server re-checks every edited value against the parsed parameter types (`src/lib/edits.ts`) — a number stays a number, a required parameter can't be emptied, and parameters that were never declared can't be edited at all. Every event — run created, edited, approved, rejected, executed, reply sent, status change — is appended to the audit log.

### Data flow (definition → validation UI)

1. `POST /api/generate` reads the agent definition file.
2. The Structural Parser produces the AgentSchema (plain code, always succeeds).
3. The Semantic Annotator makes its one AI call about that schema; the Merger checks and combines the result — or falls back to auto-generated labels.
4. The resulting UISpec is cached, keyed on a hash of the definition — generating again is free until the definition changes.
5. The React renderer draws the three panels from the UISpec. Fields, action cards and the output panel are data, not code.
6. The reviewer fills in the input fields (sample inputs prefill them) and starts a run.
7. The Runtime Engine builds the prompt and calls the provider with the AgentSchema's tool definitions.
8. The model's tool calls come back intercepted: they show up as **pending** action cards, and the generated text lands in the output panel. Nothing has executed.
9. The reviewer approves or rejects each action independently — optionally correcting its parameters first (re-checked on the server, logged as `action_edited`). Every decision is final and logged.
10. Only an APPROVE reaches the executor, exactly once. The suggested reply is likewise only sent by a human click. Throughout all of this, every step appends to the audit log.

### The UISpec contract

The UISpec is the JSON hand-off point between generating and rendering (`src/lib/types.ts`):

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

The prototype is built in Next.js/TypeScript because that was fastest to iterate on, but the contract itself is not tied to any language. In a Python/FastAPI backend the same schemas translate one-to-one to Pydantic models. The contract is the real design; TypeScript is just how this prototype writes it down.

## 4. Setup

Prerequisites: Node 20+.

```bash
git clone <this repo>
cd wonka-assessment
npm install
cp .env.example .env.local   # fill in the provided ANTHROPIC_API_KEY / OPENAI_API_KEY
npm run dev                  # http://localhost:3001
```

Then: pick an agent definition → **Generate validation UI** → **Run agent** → approve or reject each action. There is no database or other infrastructure; local state lives in `.data/` (gitignored). `npm test` runs 50 tests: the parser against the assignment's text exactly as written (typos, missing parenthesis and all), plus the edit-validation, risk-rule and analytics suites. `npm run seed` fills `.data/` with a demo review history so the `/dashboard` page has something to show on a fresh clone (mock data, clearly `demo-` prefixed).

Environment variables (server-side only, never sent to the browser):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Primary provider (annotator + agent runs) |
| `OPENAI_API_KEY` | Fallback provider (agent runs) |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | Optional model overrides (default `claude-opus-4-8` / `gpt-4o`) |

## 5. Adding a new agent — the real test of this system

Drop one JSON file in `fixtures/`. No code changes anywhere:

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

The new agent appears in the dropdown, gets its own generated review screen, and runs through the same approval flow. The two included fixtures show this works across domains: `supernicecompany.json` (the assignment example, kept **exactly as written, typos included**) and `vinventions-orders.json` (an order-processing agent modeled on the reference project: extracting order lines against a pricing matrix, packaging types, extra lines for pallets/freight/rebates, a delivery address, and a missing-artwork exception). The Vinventions fixture deliberately covers only the **order-extraction and validation part** of that case; client identification, artwork identification, quick actions and automatic queueing are out of scope for this prototype.

For an even faster proof, **`/playground`** skips the file entirely: paste or edit a definition and the review screen regenerates **live on every keystroke**. That is possible because the structural half of the pipeline (parser + merger) is plain TypeScript that runs in the browser — no AI involved. The one AI step (the annotator) sits behind an explicit button and reuses the exact same server code; nothing in the playground is cached or saved. The raw UISpec JSON is shown next to the rendered preview, so the contract itself is part of the demo.

## 6. Assumptions

- **The agent definition is trusted input**, written by the team deploying the agent. Run inputs and model output are *not* trusted — see security below. Letting outside users upload definitions would open a new attack surface; that is out of scope here.
- **Which fields matter most can't be derived from structure alone.** The example UI shows the customer's mail but hides the generic instructions and the retrieved Q&A — that judgment comes from the annotator. If annotation fails, the fallback shows *every* field prominently. That is the safe direction: show more, hide nothing.
- **Reject is a decision, not a retry.** Rejecting an action records it and skips execution; it does not send the agent back to try again. Re-running is a separate, deliberate human action (**Run again**), like the reference project's targeted reprocess.
- **The executor is a stub.** There is no real ERP or CRM behind this prototype; the executor interface is where a real backend plugs in. Even the mock only runs after approval — the gate is the point, not the backend.
- **One agent per review screen.** The UISpec can grow into multi-agent flows (a section per pipeline step, each with its own actions, driven by statuses like the reference project's kanban board). That was designed for but deliberately not built within the 4-hour scope.
- **The UI language is English**; amounts get a € hint when a field resolves to `currency`.

## 7. Technical considerations

- **Extensibility** — a new domain is a new definition file, proven live with two domains. A new field type is one entry in the type list plus one renderer case; unknown types already degrade to a text box, so extending is additive rather than risky. The UISpec carries a version number (`version: 1`, also shown as a badge in the UI) so future changes can migrate old specs, and the multi-agent path is a schema extension, not a rewrite.
- **Reliability** — generation cannot fully fail: the structure comes from plain code, and the single AI step is strictly validated, gets one retry, and falls back to auto-generated labels rather than crashing. The model cannot invent or lose fields, by construction. Decisions cannot run twice: all reads and writes for a run go through a per-run lock (`src/lib/lock.ts` — an in-process mutex; a production system would use a database transaction), so two simultaneous requests can't both slip past the "already decided" check. The decision is also saved *before* the executor runs, so even if the process dies mid-execution, replaying the request results in a 409 rather than a second execution.
- **Security** — API keys live in server-side environment variables only: never in the browser, never in logs, never in git (`.env.example` documents them). **The core invariant is that nothing executes before a human approves**: the provider loop acknowledges tool calls without running them, and the executor has exactly one call site, behind the human gate. Model output is treated as untrusted content and always rendered as escaped plain text — no eval, no raw HTML. Prompt injection through run inputs (say, a customer mail that contains instructions for the agent) is handled at the review layer: the actual parameter values are shown clearly on each card, arguments the agent invented are flagged, and whether a tool changes things or only reads is decided by rules from the schema — never by the model. The **risk badges** (`src/lib/risk.ts`) follow the same principle with four rules: read-only and fully declared → low; makes changes → medium; anything outside the declared schema → high; makes changes *and* matches a fraud pattern from the reference case (an amount at or above the per-agent threshold, default €1000, or a contact/address change — the classic invoice-redirect tricks) → high. High-risk approvals ask for a second, explicit confirmation click. The model that proposed an action never grades its own risk. Edited parameters are just as untrusted: the browser only proposes values, and the server re-checks every edit against the parsed types before recording anything — one invalid edit rejects the whole request and the action stays pending. Costs are capped everywhere (max tokens, max turns, fewer retries) because the assessment keys are shared.
- **Observability** — every pipeline step reports on itself: generation time, cache hit or miss, which model annotated, and provider-fallback warnings all surface in the UI. The append-only audit log records every run, decision, execution and status change. A collapsible **trace panel** under each run shows the two phases explicitly: the generation phase (cache hit/miss, duration, annotation source and model) and the run phase (which provider actually answered, model, duration, fallback path, plus the exact system prompt and rendered user prompt the model saw). In production, those two phases are the natural places to attach tracing (Langfuse), and the provider layer is where routing and cost tracking would attach (a Requesty-style gateway). Traces carry prompts and metadata only — never keys. The audit log doubles as an analytics source: **`/dashboard`** reads it (read-only, `src/lib/analytics.ts`) and shows runs per status, approval/reject rates per tool, how often humans corrected each field, and the median time from run to decision. Audit entries carry structured data next to the human-readable text, so the statistics never have to re-parse sentences — the same principle as the generator: structure is never recovered from free text.
- **Performance** — the expensive step (the AI annotation) runs once per definition and is cached on a hash of that definition; regenerating is a cache read (visible in the UI: roughly 5–25 s fresh versus instant on a hit). The run path contains no AI calls except the agent call itself.

## 8. Known limitations / future work

- **Real executor integrations** behind the `ToolExecutor` interface (per-tool endpoints, retries, compensation on partial failure).
- **Multi-agent review screens** — the schema path is described under Assumptions; a kanban-per-status UX like the reference project.
- **Langfuse export** — the in-app trace panel already shows the generation and run phases; shipping them to Langfuse is the remaining wiring.
- **Queue/batch review** (automatically loading the next run) — the `1 / 1` counter is honest about the single-run demo scope.
- The tool-signature parser covers the assignment's type language plus the obvious neighbours; nested types (`list(...)`, objects) currently become a generic field by design and would extend the type list recursively.

## 9. Beyond the requirements (optional bonus)

Extra work included because each piece strengthens the core proposal — every item traces back to the assignment or the reference project, none is a free-floating feature:

- **Edit-before-approve on action parameters** — the reference project's *"all order fields are editable"*: the reviewer corrects and confirms instead of only vetoing. Every edit is re-checked on the server against the parsed types and logged as `action_edited`.
- **Rule-based risk badges** (low/medium/high, high requiring a second confirmation click) — extends the principle "safety judgments never come from the model" from the mutating/read-only classification to risk, using the reference case's fraud patterns (amount thresholds, contact/address changes) as rules.
- **`/playground`** — live proof of *"reusable across different automation domains"*: paste any definition and watch the UI regenerate on every keystroke, which only works because the structural pipeline needs no AI.
- **Per-run trace panel** — the generation phase and run phase visible in the UI: exactly the tracing points the reference stack sends to Langfuse, minus the export wiring.
- **Audit-analytics dashboard** (`/dashboard`) — the reference project's KPI wishes made concrete: runs per status, approval/reject rate per tool, human-correction rate per field (every edit-before-approve is a human overruling the AI — an honest per-field error signal), and the median time from run to decision. Strictly read-only over the audit log; `npm run seed` provides a demo history.
- **Hardened decision path + test suite** — the per-run lock and save-before-execute order keep the approval gate intact under simultaneous requests and crashes; 50 tests cover the parser (against the assignment's text as written), edit validation, the risk rules and the analytics.

## 10. Screenshots

**Assignment example — SuperNiceCompany customer support** (the definition exactly as written, typos included; offline mock run). Things to note: the empty `phone_number` is left off the card, the billing amount gets a € hint, the risk badges are rule-based — the contact change is HIGH and asks for a second confirmation click — every pending card has an **Edit** button, and the trace panel below is expanded to show the generation and run phases:

![SuperNiceCompany validation UI](docs/screenshot-supernicecompany.png)

**Reusability proof — Vinventions-style order processing** (same pipeline, different domain, labeled live by `claude-opus-4-8`). Things to note: tiered pricing applied from the retrieved context, packaging per order line, an extra freight line, five independent approvals with risk badges — the delivery-address change is flagged HIGH — and an exception flag:

![Vinventions validation UI](docs/screenshot-vinventions.png)

**Audit analytics — `/dashboard`** (read-only statistics from the audit log: runs per status, approval/reject rates per tool, human-correction rates per field, median time to decision — seeded demo history):

![Audit analytics dashboard](docs/screenshot-dashboard.png)

## 11. Actual time spent

Roughly **4 hours** end to end: ~1.5 h analysis and design (assignment + reference document, architecture decisions), ~2 h implementation and live testing, ~0.5 h documentation. Built AI-assisted (Claude Code); every architectural decision, trade-off and line of this document was reviewed by hand.
