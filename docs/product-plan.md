# AvalaOS Core — Product Review and Completion Plan

Reviewed 11 Nov 2026 against `AvalaOS-Core` at `88d0643`. Figures are omitted from this Markdown copy.

## 1. Verdict

AvalaOS Core does not yet deliver the journey you described: the control and evidence scaffolding is deep, but extraction, step-level recommendation, documents, flows and work items are thin, duplicated or missing. None of the six required behaviours is fully met today (section 6).

The review covers GitHub `main` at commit `88d0643` (PR #352, 1 Nov 2026). Your local folder `D:\avalaos-core-pr216-current` is an older snapshot, so GitHub is the baseline for this plan.

**What the repository is made of**

| Area | Lines | Share |
| --- | --- | --- |
| Acceptance scripts and harnesses (`scripts/`) | 134,000 | 27% |
| Governance and evidence documents (`docs/`, 742 files) | 124,000 | 25% |
| Database migrations and edge functions (`supabase/`, 256 tables) | 86,000 | 17% |
| Tests (`tests/`, `testing/`) | 81,000 | 16% |
| Domain and client services (`services/`) | 46,500 | 9% |
| User interface (`components/`) | 23,000 | 5% |

The last 50 commits on `main` are all acceptance-harness fixes; none changes what a user can do. There are 35 Playwright configs, 28 CI workflows and 324 npm scripts. The status page records AI providers as OFF, so no real document has been generated from a real source in an accepted run.

**Three root causes**

1. **There is no single process model.** Assess V1 holds 19 slider answers, Assess V2 holds “primitives”, ingestion holds flat “candidates”, Studio holds five text sections, Delivery holds proposal items. They are joined by immutable handoffs, so a correction in one place cannot reach the others.
2. **Two generations of every module are live at once.** V1 and V2 Assess render on the same page. Legacy Docs Forge and governed Studio both generate documents. The normal Delivery board and the governed Delivery workbench hold different items.
3. **Content was treated as a risk to contain, not a capability to build.** Documents are five sections of plain text, transcript suggestions may only write a process name or description, and work items are document headings.

**The plan in one paragraph**

Duplicate the repository, slim it, and build one canonical, editable **Process Model** per process: steps, roles, systems, rules, exceptions, open questions, each with source references. Assessment, BRD/PDD/FRD/SDD, As-Is/To-Be flows and work proposals become projections of that model, with dependency tracking so edits mark downstream outputs “needs review”. UiPath’s newest product, Cartographer, is aiming at the same idea, a single [Map of Work](https://docs.uipath.com/delegate/standalone/latest/user-guide/cartographer-overview), which is the benchmark to beat. Five phases, roughly 12 weeks of focused Sonnet/Opus implementation (section 8).

**Keep, rebuild, retire**

| Decision | What | Why |
| --- | --- | --- |
| Keep | Auth, tenant and workspace foundation; the Delivery board UI; the Assess V2 data shapes; interaction-readiness rules; excerpt anchoring; template editor; DOCX/PDF renderer | Sound and reusable |
| Rebuild | Extraction, step-level assessment, document templates and generation, flow diagrams, work-item derivation, the Assess workspace UI | This is the product value and it is missing |
| Retire from the main path | V1 guided questionnaire, V2 raw authoring form, legacy Docs Forge fallback content, source-set / bundle / handoff ceremony, the governed Delivery tab inside Enterprise Intelligence | Duplicates, or steps a user should never see |

## 2. Codebase review

The stack is sound (React 19, Vite, Tailwind, Supabase Postgres with edge functions, Mermaid), but each lifecycle module exists twice and the two copies do not share data.

**What a user meets today, module by module**

| Module | Path A (older) | Path B (newer, “canonical”) | What the user experiences |
| --- | --- | --- | --- |
| Assess | `components/assess/GuidedAssessmentView.tsx` + `services/scoringEngine.ts`: 19 sliders, one process-level score | `components/assess-v2/AssessV2Workspace.tsx` + `services/assessV2/evaluator.ts`: hand-entered primitives, assets, interactions, “exact claim IDs” | Both render on one page (`ProcessDetailStubView.tsx` embeds the V2 workspace under the V1 result). Labels include “V2”, “PR 1E”, “schema version”, “evidence hash” |
| Ingestion | `components/enterprise/AssessTranscriptCandidateReview.tsx`: flat candidates | `components/assess-v2/AssessSupportingDocumentIntake.tsx`: typed proposals against a target catalog | Eight gated actions from upload to apply: store source, commit source set, lock bundle, analyse, review, preview, resolve conflicts, apply |
| Studio | `DocsForgeView.tsx` + `services/geminiProvider.ts` + `docGenerationGuard.ts`: browser-side generation with rich templates (`data/docTemplates.ts`) | `StudioArtifactWorkspace.tsx` + `supabase/functions/_shared/studioArtifact*.ts`: server generation, BRD/FRD/PDD only | Two editors. The governed one exposes “commit immutable revision” and “advanced canonical JSON import” |
| Delivery | `BoardsView.tsx` + `DeliveryProvider.tsx`: the normal board, tasks with status | `GovernedDeliveryWorkspace.tsx`: proposals, packages, approvals | The governed workbench is a tab inside Assess → Enterprise Intelligence, not the board. Its items have proposal states only, never “In progress” or “Done” |

**Structural problems that block the journey**

| # | Problem | Evidence | Consequence |
| --- | --- | --- | --- |
| 1 | No shared process representation | Five unrelated shapes: `AssessmentResponses`, `AssessmentCaseV2`, extraction candidates, `sections[].body` strings, delivery `proposalItems` | Edits do not propagate; every hop re-summarises text |
| 2 | Source text is base64-encoded before it reaches the model | `frameUntrustedSource()` in `supabase/functions/_shared/enterpriseIntelligenceAi.ts` sends `BASE64URL` chunks and tells the model to decode them | Models decode long base64 unreliably; extraction fidelity drops and excerpts fail verification |
| 3 | PDF and DOCX parsing is hand-rolled | `extractPdfText()` in `enterpriseIntelligenceIngestion.ts` regex-scans raw PDF streams as Latin-1 and collapses whitespace; DOCX goes through `stripXml()` | No pages, headings, tables or numbering survive; many real PDFs yield little or no text |
| 4 | Flowcharts cannot be ingested | No BPMN, draw.io, Visio or image parser anywhere in `services/` or `supabase/functions/` | One of your three named source types is unsupported |
| 5 | The server document templates are five text sections | Migration `20260828120000_governed_multisource_studio_pr_b.sql` line 860: BRD = Summary, Objectives, Scope, Requirements, Risks | No tables, no step list, no requirement IDs, no diagrams, no SDD |
| 6 | Fallback content is invented | `docGenerationGuard.ts`: “Reduce manual handling effort … by 50-80%”, generic application lists, one fixed seven-node Mermaid flow for every process | Breaks your “do not invent” rule and hides extraction failures |
| 7 | Delivery proposals are document headings | Migration `20260831062024_governed_delivery_monitor_pr_c.sql` lines 797–803 | BRD sections become Epics titled “Summary”, “Objectives”; acceptance criteria are always `[]` |
| 8 | Agent instructions route every session through governance documents | `AGENTS.md`, `PLANS.md`, `docs/00_SOURCE_OF_TRUTH.md` | Sonnet or Opus spends its context on evidence language instead of product code |
| 9 | `App.tsx` is one 75 KB component holding routing and state | `App.tsx` (1,756 long lines) | Every feature PR touches the same file; high merge and regression risk |

**What is worth keeping**

- `services/assessV2/types.ts`: primitives, edges, decision points, exception paths, application assets and interactions are the right vocabulary for a process model.
- `evaluateInteractionReadiness()` in `evaluator.ts`: sensible rules for API, UI, event and write-safety readiness.
- Excerpt anchoring in `assessDocumentMapping.ts`: the server checks that a quoted excerpt occurs in the source. This is the correct anti-hallucination control.
- `data/docTemplates.ts`: the PDD, SDD and ADD section lists already follow UiPath conventions and only need to become typed.
- The Delivery board components, the tenant and auth layer, `safeMarkdown.ts`, and the private DOCX/PDF renderer.

## 3. Assess module review

No: neither engine produces the outcome you want. V1 runs and is deterministic, but it gives wrong recommendations in common cases and invents costs. V2 has the right data shape, but its recommendation is close to a fixed lookup and its headline decision is one constant sentence.

I executed both engines from the repository with `tsx`: seven synthetic profiles through `calculateAssessmentScores()` and the repo’s own AP invoice fixture through `evaluateAssessmentV2()`.

### 3.1 V1 scoring engine (`services/scoringEngine.ts`)

| Test profile | Engine output | Why it is wrong |
| --- | --- | --- |
| Structured, rule-based, system readiness 5 (API-ready) | “RPA-first Automation” | RPA and API tie at 89.8; RPA wins by object order. An API-ready process must be API-first |
| Same process, data sensitivity 4 (ordinary personal data) | Category “RPA-first Automation”, priority “Blocked - Governance Risk”, risk tier “Limited” | Three fields contradict each other. Any single rating of 4 on sensitivity blocks the process |
| Legacy system, readiness 2 (no API) | “Workflow + APIAutomation Assist”, “Tier 1 - Strategic Quick Win”, build cost 250,000, savings 178,750 | Recommends API where none is ready, penalises RPA by 20 points exactly where it is the usual bridge, and calls a first-year loss a quick win |
| 20 manual hours a year, savings 715 against build 30,000 | “RPA-first Automation”, “Ready for Delivery” | The “Monitor / Deprioritize” gate fires but the final category ignores it |
| Judgment 5, goal ambiguity 5, risk 4 | “API-first Automation” | Human-Led fit scores 91 but is never a candidate; the human-led gate needs both ambiguity and risk at exactly 5 |
| Fully deterministic, structured, no unstructured input | GenAI adjusted score 63.2, above the 60 threshold the engine uses to name a secondary technology | Value and confidence add about 51 points to every technology, so the engine can never say “AI unnecessary” |

**Defects in the formulas**

- **Invented money.** `DEFAULT_AVERAGE_HOURLY_COST = 65`, build costs of 30,000 / 75,000 / 150,000 / 250,000, run-cost ratios of 15 / 20 / 28% and capture rates of 55 / 40 / 25% are hard-coded. These flow into the Decision Pack as savings, payback and net benefit.
- **Only five technologies compete.** RAG, Document Intelligence, HITL, Process Redesign and Human-Led are scored and then discarded. “Do nothing” and “simple rules, no AI” cannot win.
- **Value and confidence do not discriminate.** They add the same amount to every option, so ranking is technology fit minus ad-hoc penalties. The “why not others” text cites “cost penalties” that are not in the ranking.
- **API feasibility is a slider.** `systemReadiness` (1–5) mixes API availability, stability and access. No system, operation or evidence is named.
- **Cliffs and scale bugs.** RPA halves when judgment moves from 2 to 3. GenAI and Agentic use `(5 - x) / 5` while every other inverse term uses `(6 - x) / 5`.
- **Self-rated evidence.** Evidence quality and stakeholder coverage are sliders the author sets; they are not derived from attached sources. Template fit multiplies confidence by 1.1.
- **Placeholder handoff content.** `createHandoffPack()` writes pain points as “Manual effort, Cycle-time pressure, Rework risk” and systems as “Captured in assessment systems section” for every process, plus four generic backlog items.
- **Process level only.** There are no steps, so no step can be marked human, API, rules or AI.

### 3.2 V2 evaluator (`services/assessV2/evaluator.ts`)

| Finding | Evidence from the run | Effect |
| --- | --- | --- |
| Headline decision is a constant | `executiveDecision` is “Use a controlled hybrid operating model…” for the fixture and again after every step fact is flipped to false | No process-level recommendation exists |
| Alternatives and “what would change the decision” are constants | Four fixed strings each, identical for every case | Explanations are not about this process |
| Component choice is a lookup by step type | `componentMap`: Extract → Document Intelligence, Retrieve → Native API, Route → Workflow. One or two booleans only gate eligibility | Facts barely influence the answer |
| The agent is the fallback | With rule facts false, the “Exception investigation” step (marked Human-Led) receives “Bounded Agent” as its only component | Opposite of least-complex-first |
| No “keep manual” outcome | Steps with no eligible component return `components: []` | “AI unnecessary” and “stays human” are never stated |
| API and RPA are both attached | “PO and GRN validation” gets Deterministic Rules + Native API Integration + RPA / UI Automation | No API-first preference |
| Undocumented API counts as ready | `apiReadiness()` returns Ready when `apiDocumented` and `errorContract` are false; only `null` is checked | Overstates integration readiness |
| Evidence can never be verified here | `verified()` returns `false` unconditionally; the reference fixture reports 43 evidence gaps and “Provisional” | Every decision looks unfinished |
| Finalisation demands content | A case must have an edge, decision, exception, asset, interaction and evidence | A simple process forces the user to invent an exception |
| Effort and volume are ignored | `volumeShare` and `manualEffort` on a step are never read | No sense of which steps matter |
| Conventional ML and RAG are unreachable | Present in the `Component` type, absent from `componentMap` | Dead options |

### 3.3 What a correct assessment must produce

UiPath Automation Hub is the reference for a defensible, input-driven assessment. It computes feasibility from process and application stability, automation potential from input structure, variability and digitisation, and ease of implementation from those plus process length and application count. Benefits multiply potential by as-is hours, and currency uses the customer’s own employee cost ([algorithm](https://docs.uipath.com/automation-hub/automation-cloud/latest/user-guide/information-about-the-detailed-assessment-algorithm)). Nothing monetary is assumed by the tool.

The replacement engine works step first, then rolls up. Each step is evaluated down a least-complex-first ladder and stops at the first rung that fits.

| Rung | Recommendation | Fires when | AI needed? |
| --- | --- | --- | --- |
| 1 | Eliminate or simplify first | Step is rework, duplicate entry or a pain point with no output of its own | No |
| 2 | Keep human | Physical action, policy or legal judgment, or accountable decision stated in sources | No |
| 3 | Deterministic rules or workflow | Rules are stated and stable; inputs are structured and digital | No, stated explicitly as “AI unnecessary” |
| 4 | API integration | Step reads or writes a system and an API covering the operation is **confirmed** | No |
| 4a | API-first candidate, unconfirmed | API is reported or unknown | Not decided; raises the open question “Confirm API for system X, operation Y” |
| 5 | UI automation (RPA) as a bridge | API confirmed absent and UI reported stable | No |
| 6 | Document extraction with validation | Input is unstructured or scanned and fields must be captured | Yes, narrow |
| 7 | AI assistance with human review | Language drafting, summarising or classification with no stable rules | Yes |
| 8 | Bounded agent | All five necessity conditions are true (reuse V2 rules AGENT-001 to 005) | Yes |

Every step result carries: the mechanism, a human-judgment marker (none, review, approve, decide), the facts and source references used, each rejected rung with its reason, and the unknown facts that would change the answer. Irreversible, financial or high-impact writes force a human approval point regardless of mechanism (reuse V2 rules INT-005 to 007).

The process-level result is derived, never typed: a composition summary (for example “7 of 12 steps need no AI: 5 API, 2 rules; 2 need extraction; 3 stay human”), gates (discovery needed, redesign first, hold for instability, not worth automating), and benefit in hours only where volume and effort were supplied. Currency appears only if the user enters a cost rate. Build cost is a user input or “not estimated”.

## 4. Document quality against industry practice

The governed Studio documents are far below a UiPath PDD or a standard BRD: each is five free-text sections, there is no SDD, and nothing is tabular, numbered or diagrammed. The richer templates in `data/docTemplates.ts` are closer to the benchmark but are used only by the legacy browser path.

**Today versus benchmark**

| Document | Governed Studio today | Benchmark | Main gaps |
| --- | --- | --- | --- |
| BRD | Summary, Objectives, Scope, Requirements, Risks | ISO/IEC/IEEE 29148 business requirements specification: goals, scope, success criteria, constraints, expected outcomes ([overview](https://www.modernrequirements.com/?p=32595)) | No requirement IDs, priorities, stakeholders, rules, assumptions, success measures or traceability |
| PDD | Summary, Process, Roles, Controls, Exceptions | UiPath default PDD: introduction, process overview, applications, As-Is map, detailed As-Is steps, To-Be map, in and out of scope, business and application exception handling, reporting ([UiPath](https://docs.uipath.com/task-capture/standalone/2022.4/user-guide/details-about-the-pdd)) | No step table, no applications table, no maps, no To-Be, no exception tables |
| FRD | Summary, Functional requirements, Rules, Interfaces, Acceptance criteria | ISO 29148 system/software requirements practice: uniquely identified, verifiable requirements with attributes | Requirements are prose; nothing is individually testable or traceable |
| SDD | Does not exist as a governed type | UiPath generates the SDD only from an approved PDD and the same confirmed model, pausing at architecture checkpoints ([UiPath](https://docs.uipath.com/delegate/standalone/latest/user-guide/generating-an-sdd)) | Entire document missing |

UiPath’s current PDD also carries a delivery model table (step, current mode, future mode), a future-state map colour-coded by automation mode, source attribution, and open gaps with deferred items ([UiPath](https://docs.uipath.com/delegate/standalone/latest/user-guide/to-be-design-and-pdd-generation)). That is the bar for “best in the industry”.

### 4.1 How documents will be built

Each document becomes a typed template: an ordered list of sections, each made of blocks. Blocks have a kind and a declared data dependency.

| Block kind | Produced by | Example |
| --- | --- | --- |
| Derived table | Deterministic render from the Process Model; no AI | Detailed As-Is steps, applications used, exception handling, requirements, traceability matrix |
| Derived diagram | The flow generator (section 5) | As-Is map, To-Be map, solution architecture |
| Narrative | AI drafting from the model JSON only, with element IDs cited; a grounding check rejects any role, system, number or rule not present in the model | Executive summary, process overview, qualitative benefits |
| Authored | The user | Sign-off notes, organisational context |
| Open item | Derived from open questions | “API availability for SAP invoice posting is not confirmed (owner: unassigned)” |

A missing fact never becomes filler. It renders as an open item in place, and is listed again in the document’s Open Questions section.

### 4.2 BRD: why, and what the business needs

| # | Section | Form | Built from |
| --- | --- | --- | --- |
| 0 | Document control: version, status, authors, reviewers, approval, change log | Table | Revision history |
| 1 | Executive summary | Narrative | Objective, composition summary, gates |
| 2 | Business context and problem statement | Narrative + pain-point table with sources | Pain points, metrics |
| 3 | Objectives and success measures | Table: objective, measure, baseline, target, owner | Stated objectives; baseline only if sourced; target shown as “proposed” until a user confirms |
| 4 | Scope: in, out, boundaries | Two tables | Scope lists, step boundaries, trigger and end states |
| 5 | Stakeholders and RACI | Table | Roles |
| 6 | Current-state summary | Narrative + link to PDD As-Is | Step list (summarised, not repeated) |
| 7 | Business requirements | Table: BR-ID, statement, rationale, priority (MoSCoW), source, acceptance measure | Requirement records |
| 8 | Business rules | Table: rule ID, condition, action, source | Business rules |
| 9 | Assumptions, constraints, dependencies | Three tables | Facts with status “assumed”; systems; controls |
| 10 | Risks and issues | Table: risk, cause, impact, mitigation, owner | Risk records, high-impact steps |
| 11 | Benefits | Narrative; quantified rows only where inputs exist | Volumes and effort supplied by the user |
| 12 | Open questions | Table | Open questions |
| A | Glossary; traceability (objective → BR → FR) | Tables | Requirement links |

### 4.3 PDD: how the process works today and tomorrow

This follows the UiPath default PDD order and adds the delivery model and mode-coloured To-Be map.

| # | Section | Form | Built from |
| --- | --- | --- | --- |
| 1.1–1.4 | Purpose, objectives, key contacts, minimum prerequisites | Narrative + tables | Meta, roles, open prerequisites |
| 2.1 | Process overview | Key-value table: full name, area, department, description, roles, schedule and frequency, items per period, handling time, peak periods, FTEs, exception rate, input data, output data | Meta and metrics; unknown values shown as “Not provided” and raised as questions |
| 2.2 | Applications used | Table: application, version, language, client type, access method (API / UI / file / unknown, with confirmation status), comments | Systems |
| 2.3 | As-Is process map | BPMN diagram with lanes | Steps, gateways, flows, roles |
| 2.4 | Detailed As-Is steps | Table: step number, name, description, role, application, input, output, rule or decision, exception, handling time, source | Steps |
| 2.5 | Decision points and business rules | Table | Gateways, rules |
| 2.6 | Input data description | Table: input, format, structured or not, source, sample reference | Data objects |
| 2.7 | Pain points and current-state gaps | Table | Pain points |
| 3.1 | To-Be process map | BPMN diagram, colour-coded by mode | To-Be steps with assessment result |
| 3.2 | Delivery model | Table: step, current mode, future mode, mechanism, human-judgment point, reason | Assessment step results |
| 3.3 | Detailed To-Be steps | Table: step, trigger, inputs, outputs, mode, system interaction | To-Be steps |
| 3.4–3.5 | In scope and out of scope for automation | Tables with reasons | Assessment step results |
| 3.6 | Business exception handling | Table: BE-ID, exception, step, parameters, action, routed to | Exceptions (business) |
| 3.7 | Application error handling | Table: AE-ID, error, step, parameters, action, retries | Exceptions (application) |
| 3.8 | Reporting and audit | Table: report, content, audience, frequency | Controls, stated reporting needs |
| 4–6 | Other observations; additional sources; open gaps and deferred items | Lists and tables | Sources, open questions |

### 4.4 FRD: what the solution must do, testably

| # | Section | Form | Built from |
| --- | --- | --- | --- |
| 1 | Introduction, scope, references to BRD and PDD | Narrative | Meta |
| 2 | Actors and permissions | Table | Roles, systems |
| 3 | Functional requirements | One card per FR: FR-ID, title, “The solution shall…”, trigger, preconditions, main flow (To-Be step IDs), alternate and exception flows, rules applied, data, acceptance criteria (Given / When / Then), priority, traces to BR-ID | Requirement records derived from To-Be steps, rules, exceptions |
| 4 | Data requirements | Table: entity, field, type, validation, source | Data objects, step inputs and outputs |
| 5 | Interface requirements | Table: system, operation, direction, method, method status (confirmed / reported / unknown), data exchanged, error behaviour | System interactions |
| 6 | Human-in-the-loop requirements | Table: decision point, who, what they see, allowed actions, SLA if stated | Human-judgment markers |
| 7 | Logging, audit and reporting requirements | Table | Controls |
| 8 | Non-functional requirements | Table: NFR-ID, category, requirement, measure, source | Only stated NFRs; each missing category becomes an open question |
| 9 | Traceability matrix | Table: BR → FR → To-Be step → work item | Links |

### 4.5 SDD: how it will be built

The SDD is implementation-oriented and must not mirror the PDD. It can only be generated once a PDD revision is approved, as UiPath requires. Where a design fact is not in the sources, the section holds a proposal marked “Proposed, not confirmed” or an open design decision. Nothing technical is asserted without a source.

| # | Section | Form | Built from |
| --- | --- | --- | --- |
| 0 | Document control, distribution, sign-off | Tables | Revision history |
| 1 | Solution overview and architecture | Narrative + component diagram | Mechanisms grouped into automation units |
| 2 | Automation units | One card per unit: purpose, steps covered, mechanism, trigger and schedule, inputs, outputs, dependencies | To-Be steps clustered by mechanism and system |
| 3 | Integration design | Table per interface: system, operation, method, authentication, idempotency, rate limits, error contract; unknowns flagged | System interactions and readiness facts |
| 4 | Data design | Tables: entities, mappings, classification, retention | Data objects |
| 5 | Business rules implementation | Table: rule ID, where implemented | Rules |
| 6 | Exception and error handling design | Strategy narrative + tables for known business and application exceptions, retry policy | Exceptions |
| 7 | Human-in-the-loop design | Table: task, queue or inbox, form fields, escalation | Human-judgment markers |
| 8 | Security and access | Table: identity, least privilege, secrets (names only), data protection | Readiness facts, controls |
| 9 | Logging, monitoring and reporting | Tables | Controls |
| 10 | Environments and development prerequisites | Table | Systems, open items |
| 11 | Test strategy: unit, integration, UAT scenarios per exception path | Table | Exceptions, acceptance criteria |
| 12 | Deployment and operations runbook outline | Narrative | Proposed |
| 13 | **Open design decisions** | Table: question, options, proposal, owner, status | Every unknown design fact |
| A | Agent design appendix, only when a step is assigned to an agent: purpose and KPIs, prompts and contexts, guardrails, tools, escalations ([community ADD template](https://forum.uipath.com/t/add-agent-definition-document-in-agentic-automation-a-new-way-to-define-an-agent/5475853)) | Cards | Agent step results |

### 4.6 Rules that keep the four documents distinct and trustworthy

- **One home per fact.** Detailed steps live in the PDD, requirements in the FRD, design in the SDD. Other documents summarise and link; a cross-document overlap check fails generation above a similarity threshold.
- **A pre-handoff quality checklist**, modelled on UiPath’s ([checklist](https://docs.uipath.com/delegate/standalone/latest/user-guide/refining-and-quality-checklist)): every step names a role and a specific system; every decision has at least two named paths; every rule has a condition and an action; every exception has a routing destination; the map matches the step table; no section contains “TBD” or “placeholder”; key facts carry source attribution.
- **Professional export.** DOCX with a cover page, document control table, automatic table of contents, numbered headings, captioned tables and figures, embedded diagrams, headers and footers with version and status. PDF from the same render. A draft watermark appears until the revision is approved.
- **Platform packs later.** The default wording is technology-neutral. A UiPath pack renames sections to the exact UiPath PDD and SDD headings.

## 5. Flow diagrams

Mermaid `flowchart TD` text cannot reach Visio or draw.io quality, so the flows move to BPMN 2.0 generated from the Process Model and edited on a real canvas. Today the governed Studio path has no diagram at all, and the legacy path falls back to one fixed seven-node flow for every process.

**What is wrong with the current diagrams**

| Issue | Evidence | Effect |
| --- | --- | --- |
| Free-text Mermaid written by the model | `services/geminiProvider.ts` asks for “Mermaid.js flowchart TD code” as a string | No link to steps; a wrong arrow cannot be traced or corrected structurally |
| No swimlanes, events, task types or typed gateways | Plain boxes and diamonds | Does not show who does what, which is the first thing a reviewer looks for |
| Not editable as a diagram | Users edit raw Markdown in `WorkspaceView.tsx` | Fails “editable As-Is/To-Be flows” |
| Fixed fallback flow | `standardMermaid()` in `docGenerationGuard.ts` | An invented process is shown when generation fails |
| No standard export | SVG only through the renderer | Cannot be opened in a process tool |

### 5.1 Target design

| Concern | Decision | Reason |
| --- | --- | --- |
| Source of truth | The Process Model graph: steps, gateways, flows, lanes | One edit updates step tables, both maps and work items |
| Notation | BPMN 2.0, descriptive subset: pool, lanes, start / end / intermediate events, user / manual / service / business-rule / send / receive tasks, exclusive and parallel gateways, collapsed sub-process, data object, annotation | The ISO/OMG standard that Visio and draw.io stencils both follow |
| Canvas | `bpmn-js` modeler embedded in React ([bpmn.io](https://bpmn.io/toolkit/bpmn-js/)); `bpmn-moddle` to read and write XML | Open, embeddable viewer and editor with SVG export |
| Layout | `elkjs` layered layout, lanes as partitions, left to right; happy path on one straight line, exceptions drop below | Deterministic, no manual untangling |
| Quality gate | `bpmnlint` with custom rules (5.2) | Bad diagrams are flagged before they reach a document |
| Size | About seven to nine shapes per level; larger processes collapse phases into sub-processes ([7±2 guideline](https://imtpolicy.sp.alberta.ca/standards/Supporting%20Documents/Business%20Process%20Modelling%20Implementation%20Guide%20v1.pdf)) | Readability on one page |
| To-Be colouring | Fill by mode, with a legend: fully automated, assisted, agent, human review, manual, as UiPath does ([UiPath](https://docs.uipath.com/delegate/standalone/latest/user-guide/to-be-design-and-pdd-generation)) | The delivery model is visible at a glance |
| Mermaid | Kept only as a read-only text export | Useful in Markdown and wikis |

_[Figure in the source document: illustrative To-Be swimlane · three lanes, one decision, colour by mode]_

The happy path runs straight along the top lane; the exception drops to the people who handle it and rejoins before posting. This sketch shows the conventions only; the product renders true BPMN shapes through `bpmn-js`.

### 5.2 Style rules the linter enforces

These come from BPMN Method and Style ([Bruce Silver](https://www.trisotech.com/?p=19505)) and common modelling practice.

| Rule | Check |
| --- | --- |
| Every activity is labelled verb + object (“Validate invoice”) | Label present; first word is a verb from the model; no “Process”, “Handle” alone |
| An exclusive gateway follows an activity and is labelled as a question; its gates are labelled Yes / No or with end states | Gateway has a preceding task; all outgoing flows labelled |
| Parallel gateways and merges are not labelled | Label absent |
| Exactly one start event per level; a message start is labelled “Receive …”, a timer start with its frequency | Count and label pattern |
| Multiple end events are each labelled with the end state (“Invoice posted”, “Invoice rejected”) | Distinct names |
| Every task sits in exactly one lane; lane names are roles or systems from the model | Lane reference valid |
| No dangling nodes; every path reaches an end event | Graph reachability |
| Split and join gateways match | Structural check |
| No more than nine shapes per level before collapsing | Count |

### 5.3 Editing and round trip

- **Structure edits** on the canvas (add, rename or delete a task; redirect a flow; move a task to another lane) are parsed back with `bpmn-moddle`, diffed against the model and saved as model edits. Dependent document sections are marked “needs review”.
- **Layout edits** (moving shapes, bending connectors) are saved as diagram layout only and never mark anything stale.
- **Regeneration** after a model change keeps user layout for unchanged elements and lays out only new ones.
- As-Is and To-Be are two graphs in the model. The To-Be starts as a copy of the As-Is with the assessment applied, and the user confirms it before To-Be step detail is drafted. UiPath treats this confirmation as mandatory for the same reason.

### 5.4 Import and export

| Direction | Format | Approach |
| --- | --- | --- |
| Export | `.bpmn` (BPMN 2.0 XML with diagram interchange) | Native from `bpmn-js`; opens in Camunda Modeler, Signavio, Bizagi and other BPMN tools |
| Export | SVG and PNG | For DOCX and PDF embedding |
| Export | `.drawio` | A small exporter writes draw.io’s own XML with its BPMN shapes and swimlanes. draw.io does not read BPMN XML ([bpmn.io forum](https://forum.bpmn.io/t/converting-draw-io-flows-to-bpmn-io-flows-en-masse/14330)) |
| Export | Visio | Via the draw.io file or SVG. Visio has no native BPMN XML import or export ([Microsoft](https://learn.microsoft.com/en-us/answers/a/11531080)) |
| Import | `.bpmn` | Parse with `bpmn-moddle` straight into the model; highest fidelity |
| Import | `.drawio` / draw.io `.xml` | Parse vertices, edges and swimlane containers; map shape styles to step, gateway, event; unmapped shapes become questions |
| Import | `.vsdx` | Unzip, read page XML shapes and connects; phase 2 |
| Import | PNG, JPG, PDF flowchart | Vision model extraction; every element is marked “inferred from image” and must be confirmed |

## 6. Gap analysis against the six required behaviours

Four behaviours are not met and two are partly met. Work package numbers refer to section 8.

| # | Required behaviour | What happens today | Status | Closed by |
| --- | --- | --- | --- | --- |
| 1 | One Assess experience, one current assessment, current document per type, versions in history, approved versus working draft | V1 result and V2 workspace render on the same process page. Users see engine, schema, rule-set, decision, handoff and receipt versions inline. Approved revisions are preserved (immutable version tables exist), but “working draft” is not a plain concept: users “commit immutable revisions” | Not met | WP1.2, WP1.3, WP2.4 |
| 2 | Ingest real transcripts, SOPs and flowcharts; show references, gaps and uncertainty; edits persist and drive assessment and documents | Text, VTT, SRT, CSV, XLSX, text PDF and DOCX are accepted, and excerpts are anchored. But source text is base64-encoded into the prompt, PDF and DOCX parsing loses structure, flowcharts are unsupported, and transcript candidates may only set a process name or description (`assessApply.ts` rejects every other target). There is no step list to edit, and missing information is not collected as questions | Not met | WP0.4, WP1.4–WP1.7 |
| 3 | Recommend at process and step level; support “AI unnecessary”, API-first, human judgment; explain reasons and alternatives; invent nothing | V1 is process-level only, cannot say “AI unnecessary”, prefers RPA on an API-ready process and invents hourly cost, build cost and savings. V2 is step-level but a type lookup, with a constant headline and constant alternatives; API and RPA are both attached; an agent is the fallback | Not met | WP2.1–WP2.3 |
| 4 | Useful, distinct BRD/PDD/FRD/SDD and editable As-Is/To-Be flows; preserve edits; mark dependents “needs review” and let the user choose; missing design facts stay explicit | Governed documents are five text sections each; no SDD; no flows. Edits are preserved as new immutable versions. Staleness exists only for a whole source package, not per section, and there is no “keep mine / take update” choice. The legacy path fills gaps with invented baseline text | Not met | WP3.1–WP3.7 |
| 5 | Actionable work-item proposals with descriptions, acceptance criteria and requirement links; unassigned fields allowed; headings are not epics | Proposals are one item per document section: BRD sections become Epics, FRD sections Stories, PDD sections Tasks, titled by the heading, with `acceptanceCriteria: []`. The board’s `Task` type requires start and due dates | Partly met (proposal mechanics exist; content is wrong) | WP4.1, WP4.3 |
| 6 | Review, edit and select proposals before confirmation; confirmed items appear once on the normal Delivery board with persistent status and detail | Accept, reject and edit exist in the governed workbench, but that workbench lives under Enterprise Intelligence and its items never reach `BoardsView`. The legacy import path does create board tasks and persists status, but from a different source (legacy generated work items), and its duplicate guard is keyed to a generation digest and item positions, not to a reviewed proposal | Partly met (two halves that do not connect) | WP4.2–WP4.4 |

**The pattern behind all six.** Each gap is the absence of one shared, editable model plus the presence of a second, older path. Section 7 fixes the first; the retire list in section 1 fixes the second.

## 7. Target architecture and data model

Everything hangs off one versioned Process Model per process; sources write into it, people correct it, and every output is a projection that records which parts of the model it used.

_[Figure in the source document: target architecture · sources and people write to one model; four outputs are projections]_

Sources and people both write into the model. Assessment, documents, flows and work proposals read from it and record which parts they used; only confirmed proposals become board items.

### 7.1 The Process Model

A single JSON document per revision, typed in `domain/processModel.ts` and validated with a JSON schema. It generalises the existing V2 shapes.

| Part | Fields | Notes |
| --- | --- | --- |
| `meta` | name, objective, trigger, end states, scope in, scope out, frequency, volume, handling time, peak periods, FTEs | Each numeric is a Fact (below); absent means unknown, never zero |
| `roles[]` | id, name, kind (person role, team, external party, system actor) | Lanes in the diagram |
| `systems[]` | id, name, version, client type, owner, `access[]`: method (api, ui, file, database, event), status (confirmed, reported, unknown, confirmed-absent), operations covered | Drives API-first without assuming an API exists |
| `steps[]` | id, sequence, name (verb + object), description, role, systems, task type, primitive type (reuse V2’s 15 types), inputs, outputs, rule IDs, effort per case, volume share, facts | One list for As-Is; a second list `toBe.steps[]` created on demand |
| `gateways[]`, `flows[]` | gateway type and question; flow from, to, condition label, default, exception | The diagram graph |
| `rules[]` | id (BRL-001), condition, action | Each must have both |
| `exceptions[]` | id, kind (business, application), trigger, step, handling, routed to | Feeds PDD 3.6 and 3.7 |
| `dataObjects[]` | id, name, format, structured, classification |  |
| `painPoints[]`, `controls[]`, `risks[]` | text plus links to steps |  |
| `openQuestions[]` | id, target (element and field), question, why it matters, owner, status (open, answered, deferred), answer | Missing information lives here |
| `conflicts[]` | field, competing values with their sources, resolution | When two sources disagree |

**Facts and provenance.** Any extracted or entered value is stored as a Fact:

```
{ value, status: "stated" | "inferred" | "user-confirmed" | "assumed" | "unknown",
  sources: [{ sourceId, versionId, locator: { page?, heading?, lineStart?, lineEnd?, timestamp?, speaker?, cell?, shapeId? }, excerpt }],
  editedBy?, editedAt? }
```

A user edit sets status to `user-confirmed` and keeps the earlier value in history. Re-extraction never overwrites a `user-confirmed` fact; it raises a conflict instead. This is what makes corrections persist.

### 7.2 Revisions: one working draft, preserved approvals

| Table | Purpose | Key rules |
| --- | --- | --- |
| `process_model_revisions` | `process_id`, `rev_no`, `state` (working, approved, superseded), `model` jsonb, `model_hash`, `based_on`, `approved_by`, `approved_at` | A partial unique index allows exactly one `working` row per process. Approving copies working into a new immutable `approved` row and supersedes the previous one. Approved rows reject updates by trigger |
| `process_model_edits` | Revision, JSON Patch, actor, timestamp, origin (user, extraction, diagram, import) | The history and audit view reads this; nothing else needs a version shown in the main UI |
| `assessments` | Process, model revision and hash, rules version, `result` jsonb, `overrides` jsonb, `state` (current, stale) | One current row per process; recomputed on demand because the engine is a pure function |
| `requirements` | id (BR-, FR-, NFR-), type, statement, rationale, priority, acceptance criteria, links to steps, rules, exceptions, questions, `origin` (derived, user), `state` | First-class records so traceability is real |
| `documents`, `document_revisions` | Type (brd, pdd, frd, sdd); revision state as above; `sections` jsonb | One current document per type per process |
| `flow_diagrams` | Kind (as-is, to-be), `bpmn_xml`, `layout`, `model_hash` | Layout survives regeneration |
| `work_item_proposals` | Batch, type, title, description, acceptance criteria, requirement IDs, step IDs, parent, `derivation_key`, `state` (proposed, edited, selected, rejected, confirmed), `confirmed_task_id` |  |
| `delivery_work_items` (existing board table) | Add `origin_proposal_id` (unique, nullable), `requirement_ids`, `acceptance_criteria`; make owner, estimate, start and due nullable | The unique constraint is what guarantees “appears once” |

Row-level security on every table checks workspace membership through the existing tenant functions. The internal versions the user should not see (rules version, template version, hashes) stay in these rows and surface only in a History drawer.

### 7.3 Dependency tracking: “needs review” without losing edits

Each document section, diagram and proposal stores a list of selectors into the model (for example `steps[*]`, `systems[*].access`, `rules[*]`, `assessment.steps[*].mechanism`) and the hash of the selected data at generation time.

1. A model edit is saved.
2. The server recomputes the selector hashes for every dependent output of that process.
3. Where a hash differs, the output is marked `needs_review` with the reason (“Step 4 role changed from AP Clerk to AP Lead”).
4. The user opens “Review updates” and, per section, chooses **keep mine**, **take update**, or **merge** with a side-by-side diff.

Derived tables regenerate exactly. Narrative blocks the user has edited are never overwritten silently: the new draft is offered beside theirs. Approved revisions are never touched; a change after approval starts a new working draft.

### 7.4 Application structure

| Layer | Location | Rule |
| --- | --- | --- |
| Pure domain | `domain/`: processModel, patch, assess (rules as data), requirements, docs (templates, renderers), bpmn (generate, layout, diff), proposals | No I/O, no React; unit-tested with fixtures; shared by browser and edge functions |
| Server | `supabase/functions/journey-*`: ingest, extract, assess, generate-document, export, proposals, confirm | Each validates input with the domain schema and writes through one RPC per command with optimistic concurrency (`expected_rev`) |
| Client data | `features/*/api.ts` with TanStack Query | Replaces the state held in `App.tsx` for these routes |
| UI | `features/process-workspace/`: Sources, Process, Assessment, Documents, Flows, Work proposals, History | One route per process: `/process/:id/:stage` |
| AI | One gateway function; source text passed as delimited plain text; JSON-schema structured output; server-side excerpt verification | Provider key in server secrets; no browser keys |

## 8. Implementation plan

Six phases and 29 work packages take the product from today to the full journey; each package is sized for one Sonnet or Opus pull request with its own tests. The 12-week span is my estimate for one person directing the models full time, not a commitment.

_[Figure in the source document: roadmap · six phases, each closed by one exit gate]_

Phases run in order because each consumes the previous one’s output. Inside Phase 1 the parsers (1.4), flowchart import (1.6) and workspace shell (1.3) can run in parallel; inside Phase 3 the BPMN work (3.6) can run beside the document work (3.2 to 3.5).

**Ground rules for every work package**

- Pure domain code first (`domain/`), then the server command, then the UI. Domain code has no I/O and is unit-tested.
- No default, sample or “baseline” content may be written into a user’s model or document. Unknown stays unknown and becomes an open question.
- No internal version, hash, schema or pull-request label in any primary view. A lint test greps the built UI strings.
- Every package ends with a passing `npm run typecheck && npm test && npm run build` and, from Phase 1, `npm run eval`.
- **Opus** for model design, rules, prompts, SQL security and anything with subtle invariants. **Sonnet** for UI, parsers, renderers, exports and tests against a written spec.

### Phase 0: Foundation (week 1)

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 0.1 Duplicate and slim | New repository (section 10). Remove from `main`: `docs/quality`, `docs/planning`, acceptance harness scripts, all but one Playwright config, all but one CI workflow. Replace `AGENTS.md` with an 80-line product brief: goal, the six behaviours, directory map, commands, definition of done | One CI workflow (typecheck, unit, build, one e2e) is green; a new agent session needs only `AGENTS.md` and one WP spec | Sonnet |
| 0.2 Schema baseline | Trace what login, tenant context and the Delivery board actually read (`tenant-context` function, `has_workspace_capability`, `deliveryAdapter.ts`). Produce one `baseline.sql` with only those tables, plus section 7.2 tables. Apply to a new Supabase project | Sign-in, workspace switch and the board work on the fresh project; table count is in the tens, not 256 | Opus |
| 0.3 Golden corpus and eval | `eval/corpus/<case>/sources/*` with a hand-checked `expected.model.json`. Six cases: AP invoice exceptions (VTT transcript + DOCX SOP); employee onboarding (PDF SOP + draw.io flowchart); customer refund (two transcripts that contradict each other); vendor master change (`.bpmn` + SOP); a scanned PDF (must fail cleanly as “needs OCR”); a trivial low-volume process. `npm run eval` prints a scorecard | Scorer reports step precision and recall, role and system accuracy, share of facts with a verified excerpt, fabricated-entity count and open-question recall | Opus writes cases and scorer; you approve the cases |
| 0.4 AI gateway | `supabase/functions/journey-ai`: `runStructured({ task, schema, segments })`. Plain text in delimited segments with IDs; JSON-schema output; retry and token budget per workspace; provider and model from server environment. Delete the base64 framing. No fallback text on failure: return an error state | Mocked-provider unit tests pass; a live smoke test returns schema-valid output for the AP case | Sonnet |

Proposed eval targets, to be tuned on the corpus: step recall and precision at least 0.90; role and system assignment at least 0.85; 100% of stored facts carry an excerpt that verifies; zero fabricated systems or numbers; at least 0.80 of the expected gaps raised as questions.

### Phase 1: Process Model, ingestion and one workspace (weeks 2–4) — behaviours 1 and 2

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 1.1 Process Model domain | `domain/processModel/`: `types.ts`, `schema.json`, `validate.ts`, `patch.ts` (addStep, updateFact, moveStep, removeStep with flow re-link, addFlow, answerQuestion, resolveConflict; each returns a JSON Patch), `selectors.ts`, `hash.ts`, `fromAssessV2.ts` | Every operation keeps the model valid (property test); the repo’s AP V2 fixture converts to a valid model | Opus |
| 1.2 Persistence | Migration for 7.2. RPCs: `model_save_patch(process_id, expected_seq, patch)`, `model_approve`, `model_start_draft`, `model_history`. Immutability trigger on approved rows; RLS by workspace membership | SQL tests: concurrent patches give one conflict; approved rows cannot change; exactly one working draft per process | Opus |
| 1.3 Workspace shell | Route `/process/:id/:stage` with stages Sources, Process, Assessment, Documents, Flows, Work items. Header chip: “Working draft” or “Approved revision 3 · unapproved changes”. History drawer lists revisions, edits and all internal versions. V1 and V2 panels leave the process page | Playwright: one assessment surface per process; strings “V2”, “PR 1”, “schema version”, “hash” absent outside History | Sonnet |
| 1.4 Parsers with locators | `domain/ingest/parsers/` returning `Segment[]` (`id`, kind, text, locator). PDF with `pdfjs-dist` (page, line); DOCX with `mammoth` (headings, numbered lists, tables); VTT and SRT (timestamp, speaker); XLSX (reuse existing); TXT and Markdown. Scanned PDF returns a “needs OCR” state | Fixture tests: numbered SOP steps keep their order and numbers; every segment resolves to the right page or timestamp | Sonnet |
| 1.5 Grounded extraction | Passes: inventory (roles, systems, data); steps and flow per chunk; rules, decisions, exceptions; explicit metrics only; cross-chunk and cross-source merge that records conflicts. Each item cites segment IDs and a verbatim excerpt; the server verifies the excerpt (reuse the anchoring in `assessDocumentMapping.ts`) and drops what fails. A **deterministic** gap pass then raises questions: step without role or system, decision with one path, system with unknown access method, missing volume or effort | Eval targets met; zero unverified facts stored; contradictions in the refund case appear as conflicts, not silent picks | Opus |
| 1.6 Flowchart import | `.bpmn` through `bpmn-moddle`; `.drawio` XML (vertices, edges, swimlanes); image or PDF flowchart through a vision call with every element marked inferred | Model → `.bpmn` → import returns the same graph; the draw.io sample imports with correct lanes | Sonnet; Opus for the vision prompt |
| 1.7 Review and edit UI | Process stage. Step grid with inline edit, reorder, add, delete; status badge per field (stated, inferred, confirmed, unknown). Source panel shows the excerpt in context. Tabs: Steps, Roles and systems, Rules and decisions, Exceptions, Data, Open questions (answer inline), Conflicts (choose a value). Autosave as patches. Re-running extraction opens a change set to accept or reject | Playwright: change a step’s role, reload, value persists; answering a question sets the fact to confirmed; re-extraction does not overwrite it | Sonnet |

### Phase 2: Assessment (weeks 5–6) — behaviour 3

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 2.1 Step rules engine | `domain/assess/rules.ts`: the ladder in 3.3 as data (`id`, rung, predicate over facts, outcome, reason template). `evaluateStep()` returns mechanism, mode, AI necessity, human-judgment marker, reasons with fact and source references, each rejected rung with its reason, and the unknown facts that would change the result. Carry over V2 interaction rules with fixes: an undocumented API is conditional, not ready; an agent is never a fallback; “no eligible automation” returns “Keep human” with the reason | At least 60 table-driven cases pass, including the six failing profiles from 3.1 with the corrected expected outcome | Opus |
| 2.2 Roll-up, gates and benefit | Composition summary; gates with named, documented thresholds (discovery needed, redesign first, hold for instability, not worth automating); automation potential weighted by effort, or “not computable: effort missing on N steps”; benefit in hours from supplied volume and effort; currency only from a user-entered rate. Delete every hard-coded cost and rate | Unit tests pass; a test fails the build if a monetary literal appears under `domain/assess` | Opus |
| 2.3 Assessment UI | Process summary card; step table (step, recommendation, AI needed, human point, confidence, main reason). Row detail: reasons with source links, alternatives and why each was rejected, “what would change this”, and an override control that requires a rationale and shows “Overridden by …” | Playwright: a rules-only step shows “AI unnecessary” with its reason; an unknown API shows “API-first candidate” and a linked open question; an override survives reload and re-evaluation | Sonnet |
| 2.4 Retire old surfaces | Remove `GuidedAssessmentView` and `AssessV2Workspace` from navigation. One-time importer from an existing V2 case to a model. V1 results stay read-only under History | No route reaches the old screens; importing the AP fixture yields a model with nine steps | Sonnet |

### Phase 3: Documents and flows (weeks 7–9) — behaviour 4

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 3.1 Requirements derivation | Deterministic rules: each automated To-Be step yields an FR; each rule a BR or an FR constraint; each exception an alternate flow; each human-judgment marker a human-in-the-loop FR; each stated control an NFR or FR; each objective a BR. AI words only the statement and acceptance criteria from model facts. IDs are stable and never reused; user edits win on regeneration, matched by derivation key | Every FR links to at least one step; an edited FR survives regeneration; removing a step marks its FR “source removed” rather than deleting it | Opus |
| 3.2 Templates and deterministic renderers | `domain/docs/templates/{brd,pdd,frd,sdd}.ts` exactly as section 4. Block renderers produce a document tree (heading, paragraph, table, figure, callout, open item) | Snapshot tests; the PDD step table has one row per step; an empty input renders “Not provided” plus an open item, never filler | Sonnet |
| 3.3 Narrative, grounding and checklist | One prompt per narrative block, fed model JSON only. Grounding validator: every role, system, number and rule in the text must exist in the model. Banned-filler check. Cross-document overlap check. The pre-handoff checklist from 4.6 as a panel | Across the corpus: zero ungrounded entities; overlap under threshold; checklist failures listed with links to the offending element | Opus |
| 3.4 Document editor | Documents stage with a tab per selected type showing the current document. Section status chips: fresh, edited by you, needs review, n open items. Rich-text editing for narrative and authored blocks (TipTap). Derived tables edit the model: a cell edit issues a model patch | Playwright: edit a narrative, regenerate the section, the edit is kept until “take update” is chosen | Sonnet |
| 3.5 Dependency and staleness | Selectors and hashes per section, diagram and proposal (7.3). On model save, mark dependents. “Review updates” screen: per item keep mine, take update or merge, with a diff. An approved document is never changed; a new working revision opens | Changing a step’s role flags PDD 2.4 and 3.2, the linked FR, the To-Be map and linked proposals, and nothing else | Opus |
| 3.6 BPMN flows | Model to BPMN XML; `elkjs` layout with lanes; `bpmn-js` modeler component; `bpmnlint` rules from 5.2; structure diff back to model; To-Be mode colours and legend; auto-collapse above nine shapes | Lint passes on every corpus case; adding a task on the canvas adds a step in the grid; layout moves persist and flag nothing | Opus |
| 3.7 Exports | DOCX from the document tree with the `docx` library: cover, document control, table of contents, numbered headings, captioned tables and figures, header and footer, draft watermark. PDF and Markdown. `.bpmn`, `.drawio`, SVG, PNG | A reviewer opens the DOCX in Word: contents update, numbering is correct, diagrams are embedded and legible | Sonnet |

### Phase 4: Work proposals and Delivery (weeks 10–11) — behaviours 5 and 6

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 4.1 Proposal derivation and quality gate | Epic per automation unit (To-Be steps sharing mechanism and system). Story per FR, with description (current behaviour, target behaviour, systems, data, rules) and acceptance criteria from the FR, its rules and exception handling. Enabler tasks per interface (access, test environment). A Spike or Decision item per open question that blocks a requirement, such as “Confirm API coverage for vendor lookup”. Control and UAT items per human-judgment point and exception path. Owner, estimate and dates are null. Gate: reject a title that matches any template heading, fewer than two testable criteria, or no requirement or step link | On the AP case: no title equals a section heading; every story links an FR; every FR is covered or marked “not planned” | Opus |
| 4.2 Proposal review UI | Work items stage: tree of epics, stories and tasks; inline edit; select; reject with reason; merge and split; requirement chips; “Unassigned · Not estimated · No date” shown plainly; “Confirm n selected to project …” | Playwright: edit two, reject one, select five, confirm; exactly five are created | Sonnet |
| 4.3 Confirm to board | One RPC creates `delivery_work_items` rows with `origin_proposal_id` (unique), keeps parent and child links, and sets proposals to confirmed. Replays are no-ops. `Task` start, due and owner become optional; Calendar and Timeline show undated items in an “Unscheduled” group | Double submit and replay create no duplicates (SQL and e2e); confirmed items appear in To Do on `BoardsView` | Opus for the RPC; Sonnet for the UI |
| 4.4 Board persistence and trace | Confirmed items use the same server adapter as other tasks for status and detail updates. `TaskDetailModal` shows acceptance criteria, linked requirements (opening the FRD section) and source steps. If a linked requirement changes later, the task shows “Upstream changed” with a diff and is never edited automatically | E2e: move a card, reload, status kept; edit a description, reload, kept; change the linked FR, banner appears | Sonnet |

### Phase 5: Hardening (week 12)

| WP | Build | Done when | Model |
| --- | --- | --- | --- |
| 5.1 Journey test | One Playwright spec covering all six behaviours on a local database with recorded AI responses, plus a nightly live `npm run eval` | The spec is the release gate and runs in under ten minutes | Sonnet |
| 5.2 Approval and roles | Author, reviewer and approver as workspace capabilities. One approval per revision, with an optional second approver setting. An audit view built from `process_model_edits` and approval records | An approver who is also the author is blocked only when the setting requires it | Opus |
| 5.3 Polish | Empty, loading and error states for every stage; virtualised step grid for long processes; accessibility pass; a guided sample process for first use | No stage shows a blank or raw error; axe checks pass | Sonnet |

### How to brief the model for each package

Give each session the same four things, and nothing from the old governance documents.

1. **Context:** `AGENTS.md`, sections 3, 4, 5 or 7 of this plan as relevant, and the named files.
2. **Spec:** the Build cell above, expanded with the exact types or section tables it implements.
3. **Tests first:** the Done-when cell written as failing tests before implementation.
4. **Stop conditions:** stop and ask if the work needs a schema change outside the package, a new dependency, or any generated default content.

## 9. Features that make the product stand out

The differentiator is honesty with traceability: a tool that says “you do not need AI here”, shows the sentence that proves it, and keeps documents, flows and backlog in step. The features below build on that, ordered by when they fit.

| Feature | What it does | Why it matters | When |
| --- | --- | --- | --- |
| Click-through evidence | Every table cell, requirement and recommendation opens the source excerpt it came from | Reviewers trust what they can check; no competitor document does this on paper | In plan (WP1.7, 3.4) |
| “AI unnecessary” as a first-class result | Step and process badges, with the simpler mechanism named and the reason | Matches your positioning, “Evaluate before you automate”; most tools only score upward | In plan (WP2.1) |
| Gap-closing interview | A guided chat that asks only the open questions, in priority order, and writes answers to the model as confirmed facts | Turns a half-complete transcript into a complete model in one sitting | First after v1 |
| Change impact preview | Before saving an edit: “this affects PDD 2.4, FR-007 and three work items” | Makes “needs review” predictable instead of surprising | First after v1; reuses WP3.5 selectors |
| Readiness score and checklist | One number per process from the 4.6 checklist, with the failing items | A clear “is this ready to hand over?” answer | In plan (WP3.3) |
| Organisation system registry | A workspace-level list of systems with confirmed access methods and covered operations, reused across processes | API-first recommendations improve with use and never rely on the model’s guess | First after v1 |
| Portfolio matrix | Processes plotted by automation potential and ease, both derived from step results | The prioritisation view UiPath Automation Hub is known for, built on better inputs | Second wave |
| Platform packs | Export presets for UiPath (exact PDD and SDD headings), Power Automate and a neutral default | Consultants deliver in the client’s house format | Second wave |
| Tracker push | Send confirmed items to Jira or Azure DevOps with requirement links; status sync back | Teams keep their tracker; AvalaOS stays the source of intent | Second wave |
| Review comments and suggestions | Comment and suggest on document sections; approver sees unresolved threads | Replaces the Word-and-email review loop | Second wave |
| Process variants | Capture variants of a step sequence by region or product, with a diff view | Real processes are rarely one path | Later |
| Recording and event-log intake | Screen-recording capture and process-mining event logs as sources | Completes the set of discovery inputs | Later |
| Benefit tracking | Record realised hours after delivery against the supplied baseline | Closes the loop without inventing savings | Later |

Not recommended for now: autonomous agents that build the automation, live telemetry, and any guaranteed-ROI calculator. Each conflicts with the “invent nothing” rule or distracts from the core journey.

## 10. Repository strategy

Yes: freeze the current repository and continue in a duplicate under a new name. The existing history and evidence stay intact, and the new repository can drop well over half of its files without argument.

**Why duplicate rather than continue or fork**

| Option | Result | Verdict |
| --- | --- | --- |
| Keep working in `AvalaOS-Core` | 28 workflows, 742 governance documents and an agent brief that sends every session through them | Slow and distracting |
| GitHub fork | Stays linked to the parent’s fork network; meant for contributing back, not for an independent successor | Not suitable |
| “Use as template” | Copies files but drops history | Loses blame on code you keep |
| **Mirror duplicate** | Full history and branches in an independent repository | Recommended |

**Steps**

1. In `AvalaOS-Core`, tag the current head: `git tag legacy-final-2026-11 88d0643 && git push origin legacy-final-2026-11`.
2. Create a new empty private repository on GitHub. Do not add a README or licence.
3. Mirror it, as GitHub documents ([duplicating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository)):

```
git clone --bare https://github.com/APReddy-AutoBotz/AvalaOS-Core.git
cd AvalaOS-Core.git
git push --mirror https://github.com/APReddy-AutoBotz/<NEW-NAME>.git
cd .. && rm -rf AvalaOS-Core.git
```

4. Archive `AvalaOS-Core` in GitHub settings so it becomes read-only. Pull requests, issues and Actions history remain there as the record.
5. Clone the new repository to a new local folder. Leave `D:\avalaos-core-pr216-current` untouched; it is already behind `main`.
6. Copy your `.env.*.local` files by hand. They are git-ignored and are not in either repository.
7. Create a **new Supabase project** and a **new Netlify site** for the new repository, and set fresh Actions secrets. The old hosted environment then cannot be changed by new work.
8. Run WP0.1 as the first pull request: slim the tree, replace `AGENTS.md`, reduce CI to one workflow.

**What does not come across.** Open pull requests, issues, branch protection, Actions secrets and environments are not copied by a mirror push. Errors about `refs/pull/*` during the push are expected and can be ignored.

**Name.** Avoid “v2” in the name, since the product itself is removing “V2” labels. Candidates: `AvalaOS`, `AvalaOS-Platform`, `avalaos-app`. The npm package name and `metadata.json` change in the same first pull request.

## 11. Risks and open questions

The largest risk is extraction quality, because every later stage inherits it; the eval corpus in WP0.3 exists to make that risk measurable from week 1.

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Extraction misses or merges steps on long, messy transcripts | High | Chunked multi-pass extraction, excerpt verification, the gap pass, and eval targets that block merges when they regress |
| The schema baseline (WP0.2) turns out to be entangled with many of the 256 tables | Medium | Time-box to three days. Fallback: keep the existing database and add the new tables beside it, hiding old surfaces in the UI only |
| Round-tripping canvas edits back to the model corrupts the graph | Medium | Restrict the canvas to the descriptive BPMN subset; reject edits the diff cannot map and explain why |
| Users edit documents heavily, then a model change floods them with “needs review” | Medium | Selector precision test in WP3.5; bulk “update all derived tables”; change impact preview |
| `bpmn-js` licence terms do not suit a commercial product | Low to medium | Read the bpmn.io licence before WP3.6. Fallback: React Flow with custom BPMN shapes and the same `elkjs` layout |
| Confidential process content is sent to an AI provider | Depends on customers | Provider and region configurable per workspace; a redaction option for names and account numbers; clear disclosure in the Sources stage |
| Scope creep back into governance machinery | High, given history | The six behaviours are the only acceptance test for v1; anything else waits |

**Decisions I need from you**

- [ ] Which AI provider and model may be switched on for extraction and drafting, and with what monthly budget? The journey cannot work with providers off.
- [ ] Clean database for the new repository (recommended), or keep the existing 256-table schema and build beside it?
- [ ] How much approval ceremony does v1 need: one approver per revision (recommended), or separate reviewer and approver with enforced separation of duties?
- [ ] Should default document wording be technology-neutral (recommended) or UiPath-first?
- [ ] Which flowchart formats matter most to your first users: BPMN files, draw.io, Visio, or images?
- [ ] Can you supply three to six real or realistic source packs (transcript, SOP, flowchart) for the eval corpus? Synthetic cases alone will overstate quality.
- [ ] Is there any live user data in the current hosted environment that must be migrated, or can the new product start empty?
- [ ] Repository name, and whether `AvalaOS-Core` should be archived immediately or after Phase 1.

## 12. Sources

Repository evidence is from `APReddy-AutoBotz/AvalaOS-Core` at `88d0643`, read and executed on 11 Nov 2026. External pages below were opened on the same date.

| Topic | Source |
| --- | --- |
| UiPath default PDD sections | [Details about the PDD, UiPath Task Capture](https://docs.uipath.com/task-capture/standalone/2022.4/user-guide/details-about-the-pdd) |
| UiPath To-Be design, automation modes, PDD contents | [TO-BE design and PDD generation](https://docs.uipath.com/delegate/standalone/latest/user-guide/to-be-design-and-pdd-generation) |
| UiPath PDD quality checklist | [Refining your PDD and the quality checklist](https://docs.uipath.com/delegate/standalone/latest/user-guide/refining-and-quality-checklist) |
| UiPath SDD generation and prerequisites | [Generating an SDD](https://docs.uipath.com/delegate/standalone/latest/user-guide/generating-an-sdd) |
| UiPath single model (“Map of Work”) | [Cartographer overview](https://docs.uipath.com/delegate/standalone/latest/user-guide/cartographer-overview) |
| UiPath assessment factors and benefit formulas | [Detailed Assessment Algorithm, Automation Hub](https://docs.uipath.com/automation-hub/automation-cloud/latest/user-guide/information-about-the-detailed-assessment-algorithm) |
| Agent design document sections (community) | [ADD in Agentic Automation, UiPath forum](https://forum.uipath.com/t/add-agent-definition-document-in-agentic-automation-a-new-way-to-define-an-agent/5475853) |
| Requirements documents family | [ISO/IEC/IEEE 29148 overview, Modern Requirements](https://www.modernrequirements.com/?p=32595) |
| BPMN labelling and gateway style rules | [BPMN Style Rules, Bruce Silver](https://www.trisotech.com/?p=19505) |
| Diagram size guideline | [Business Process Modelling Implementation Guide, Government of Alberta](https://imtpolicy.sp.alberta.ca/standards/Supporting%20Documents/Business%20Process%20Modelling%20Implementation%20Guide%20v1.pdf) |
| BPMN web modeler | [bpmn-js, bpmn.io](https://bpmn.io/toolkit/bpmn-js/) |
| draw.io and BPMN XML | [bpmn.io forum thread](https://forum.bpmn.io/t/converting-draw-io-flows-to-bpmn-io-flows-en-masse/14330) |
| Visio and BPMN XML | [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/11531080) |
| Duplicating a repository | [GitHub Docs](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository) |

Section headings for the classic UiPath PDD and SDD tables (process overview fields, applications columns, exception tables) follow the templates already mirrored in the repository’s `data/docTemplates.ts`; I did not open an official copy of those Word templates.

## Roadmap after the first public release (agreed November 2026)

Released: the journey from sources to the Delivery board, people and roles, My work, merge and split, the release gate, the logo, the public homepage with the real-screen tour, invite-only sign-up, and the domain avalaos.com.

Released on 14 November 2026 (second release): all of Phase A; from Phase B bring your own key, the AI use screen, "Needs you" and "assigned to you" emails, a workspace per client, error monitoring and the nightly backup; from Phase C Ask Avala on a process, change impact and the applications list; the parts an organisation uses; the Delivery board's second step; the application shell and the lighter look. Still open: proof on real processes (Phase B), and from Phase C the rest of Ask Avala, the tracker push, review comments on document sections and platform packs.

### Phase A: finish the public face

- Trust pages: privacy, terms, security.
- Google and Microsoft sign-in.
- A demo workspace: the sample invoice case, read-only.
- Invitation and confirmation emails from the avalaos.com domain (check the current sender first).

### Phase B: safe to put in front of clients

- Bring your own key (BYOK), below. First in this phase: it ends the dependence on the owner's personal AI credits.
- Prove source reading on three to five real processes and fix what breaks (the largest risk in this plan).
- A screen for AI use and limits per workspace.
- Email notifications for "Needs you".
- Per-process access, so a client sees only its own processes (done, November 2026, as a workspace per client: people see only the workspaces they are in, which the database already enforces; grants on single processes inside one workspace stay possible later).
- Error monitoring and a backup check (done, November 2026: a nightly encrypted dump with a restore check, because the Free plan keeps no backups; Sentry's free plan for errors in the browser, while the edge functions' errors stay in the Supabase logs for now).

### Phase C: features that add the most value

1. The Avala assistant, below, starting read-only. It absorbs the gap-closing interview.
2. Change impact preview (built, November 2026: before a delete or a canvas save, and straight after an inline edit, since edits save as they are made).
3. Organisation system registry (built, November 2026, as one list per workspace, since a workspace is one client: Settings → Applications; a process that names an application on the list offers its facts and a person accepts them, and a process's application can be added to the list).
4. Tracker push to Jira and Azure DevOps with status coming back.
5. Review comments on document sections.
6. Platform packs (UiPath, Power Automate).

Later: process variants, recordings and event logs as sources, benefit tracking, single sign-on (SAML) for large clients.

### Bring your own key (BYOK)

- Each workspace chooses its AI provider and supplies its own key or endpoint: OpenAI, Azure OpenAI, Anthropic, Amazon Bedrock, Mistral AI (its light models suggested), or an OpenAI-compatible endpoint the company already runs. The platform default remains for workspaces that set none, within its monthly budget.
- Keys are written by an admin, stored encrypted on the server, and never returned to the browser (show only the last four characters and when it was last used). All calls keep going through `journey-ai`; nothing else may call a provider.
- Each task in `domain/ai/tasks.ts` declares what it needs (text, vision, transcription). A provider that lacks one turns that feature off with a plain message, never a silent fallback to the platform key.
- Usage is metered per workspace and per provider. A "test this key" button checks it before saving.
- The eval (`eval/README.md`) is run for each supported provider before it is offered: extraction quality differs between models.

### The Avala assistant

An assistant on top of the platform, in the way Rovo sits on Jira, using the workspace's own model through the same gateway.

- It answers questions about a process from the model, the assessment, the documents and the board, and every answer cites where it came from (a step, a requirement, a source passage).
- It never decides. Scores stay arithmetic from the fixed tables; the assistant explains them and cannot change them.
- It changes nothing on its own. Anything it proposes (an answer to an open question, a section draft, a work item) goes through the existing patch operations and review screens, and a person confirms it. It acts with the signed-in person's role and no more.
- Source documents are untrusted: text inside a transcript or procedure is content to read, never an instruction to the assistant.
- Order: (1) read-only questions with citations (built, November 2026: "Ask Avala" on a process; next, everywhere on the platform); (2) the gap-closing interview, asking the open questions in priority order; (3) proposals a person confirms. No autonomous multi-step actions until the first three are in use. The stages, what each needs and how each is measured are in "Ask Avala: the plan" below.

### Ask Avala: the plan (agreed November 2026, after the November release)

Ask Avala is the one assistant of the platform. This is the order it is built in, what each stage needs, and what stays out. The rules in "The Avala assistant" above hold for every stage.

**Where it stands (stage 0, live).** On a process, Ask Avala answers one question at a time from that process's record. The facts are built in the browser, by rule, from what the signed-in person can read (`domain/assistant/ask.ts`), and go to `journey-ai` as numbered segments; the gateway keeps only sentences whose quote is found in the fact they cite. Nothing is stored: the usage log holds the task, the tokens and the outcome, never the question or the answer. It does not remember the question before, it is not in the demo (the demo has no server AI), and it has no quality measure of its own yet.

**What it will never do, at any stage.** Approve a revision. Invite, remove or change a person. Send an email or a message. Change a score or recommend against the scoring tables. Answer from outside the one workspace, or from the open web. Use a client's content to train anything. Act on text inside a source document as if it were an instruction.

#### Stage 1: Ask Avala everywhere, read-only

One amber "Ask Avala" button in the top bar, in place of the button on the process page. It answers about where the person is, and the panel says so ("Asking about: Vendor invoice processing"), with one click to widen to the whole workspace.

| Where the person is | What it answers from |
| --- | --- |
| A process | That process, as today |
| The Delivery board | The board: items with their type, status, owner, priority, due date, sprint, labels and parent; what is blocked, on hold or overdue |
| My work, Processes, Portfolio, Settings | The workspace: one summary per process (where it stands, who is named, what is open, the assessment in short, its place in the portfolio, the applications it uses), the applications list, the people and their roles (names, never email addresses), and the board |

- **Facts, by rule.** New pure modules beside `ask.ts` build the workspace and board facts from what the pages already read (`loadProcessFacts`, `buildPortfolio`, the applications list, the board). Counts and totals are computed by rule and given as facts ("12 items are in progress, 3 of them overdue"), because a model miscounts a long list. When there are more facts than fit, the summaries stay and the rest are chosen by how well they match the question, as source passages are today.
- **Sources stay local.** A process's source passages and step-level facts are added only when the question names that process.
- **Follow-up questions.** The last two questions and answers of the open panel go along as context that can never be cited, so "and who owns it?" works. Still nothing is saved; closing the panel forgets it.
- **Citations lead somewhere.** A sentence about a process opens that process; about an item, the item; about an application, the applications list; about the portfolio, the Portfolio view.
- **The demo.** Three recorded answers per scope on the sample case, marked "Recorded answer on the sample case", so a visitor sees what an answer looks like. The demo still calls no AI.
- **Server.** New registered tasks in `domain/ai/tasks.ts` (`askWorkspace`, `askBoard`); `journey-ai` is deployed once for this stage, with the owner's go-ahead. No database change.
- **Order of work:** (1) the measure below; (2) the button and the panel in the shell, the process scope moved into it unchanged; (3) board scope; (4) workspace scope and follow-ups; (5) recorded answers in the demo.
- **Done when:** the measure meets its targets on the platform's default model; each scope has unit tests for its facts and a browser test for its panel; a viewer gets answers only from what a viewer can read (test).

#### The measure (built first, kept for every stage)

A question set on the sample case (`eval/ask/`), scored by script, run before any change to the facts, the instructions or the model, and once for each AI provider a workspace can choose.

| Kind of question | What must happen | Target |
| --- | --- | --- |
| The record answers it | The answer cites the fact that holds the answer | 85% or more |
| The record answers part of it | Answers that part and names what is missing | 85% or more |
| The record does not hold it | No sentences; says what is missing | 95% or more |
| Asks to change or recompute a score | Explains the score and changes nothing | Every time |
| A source passage carries an instruction | Reported as content, never followed | Every time |
| Asks about another workspace or the outside world | Says the record does not hold it | Every time |

Also recorded for each run: tokens per question by scope (the cost a workspace sees) and any name or number in an answer that is in no fact (`groundingIssues`; the target is none). The first run on the live process scope is the baseline; the targets are adjusted once, with the owner, if the baseline shows they are wrong.

#### Stage 2: the interview

Ask Avala closes the gaps with the person instead of waiting to be asked. It takes over what "Closing the gaps" does today (`journey/process/GapsAssistant.tsx`), which then has one home.

- It asks the open questions in the order that matters (`triage`: first those that change the recommendation, then those needed for sign-off, then detail), one at a time, and says why each matters and what an answer could move (`changeImpact`).
- The person answers in their own words. A new task (`interpretAnswer`) turns the answer into the value the question's field takes and quotes the person's words for it; the gateway checks the quote against the answer. An answer that fits no value gets one follow-up question, never a guess.
- It shows "This will record: …" with the one-line impact, and the person presses Save. The write is the existing operation (`closeQuestions`, `answerQuestion`, `setStepTrait`, `setAccessStatus`, `setProcessMetric`, `deferQuestion` with an owner), marked as confirmed by that person. A viewer or an approver is told who can answer instead.
- Question packs for people outside the platform stay as they are.
- No database change: answers live in the process record.
- **Done when:** a person can clear the questions that change the recommendation from the panel alone; each recorded answer shows the words it came from; twenty answer interpretations are in the measure and none records a value the person did not state.

#### Stage 3: proposals a person confirms

Ask Avala may suggest a change; a person reviews it on the screen that already exists for that kind of change, and confirms it there.

- **Kinds, in this order:** an answer to an open question that a source already states (with the passage; `answerFromNotes` does this today); a draft of a document section (`draftNarrative`); a work item the requirements call for and the proposals lack; an application's facts to bring in from the applications list.
- **Shape:** a card in the panel saying what, why (the cited facts) and what it changes downstream (`changeImpact`), with "Review and apply" (opens the existing review with the suggestion filled in) and "Dismiss". Nothing is applied from the panel itself.
- **Who:** it suggests only what the signed-in person's role may do (`can` in `domain/people/roles.ts`).
- **The record:** History shows "Suggested by Ask Avala, confirmed by <person>". If that needs a new column, it is one small migration, asked for first.
- **Done when:** each kind has its unit tests and one browser test; the measure has a set of "should suggest" and "should not suggest" cases, and nothing is suggested that the record does not support.

#### Stage 4: the Avala agent (supervised, several steps): not started until its gate is met

- **Gate:** stages 1 to 3 in use on at least three real processes; the measure at its targets for four weeks; the owner decides.
- **Shape:** a person gives a goal ("get this process ready for sign-off"). Avala writes the plan as a list of steps and shows it. It runs the reading steps on its own and stops at every change for the person to confirm, as in stage 3. A run has a log, a limit on steps and on AI use, and a Stop button.
- **Needs:** a table for runs, so a run survives a closed browser, and a server function that acts with the person's own sign-in, never with the service key. Both are a database and server change, asked for first.
- **Out even then:** the "never" list at the top of this plan.

#### Across all stages

- **Access.** Facts are built from what the signed-in person can read, so an answer cannot hold more than they may see. A workspace is the boundary: nothing crosses it.
- **Cost.** Every question is metered per workspace on the "AI use this month" screen under its task. A workspace on its own key pays its provider and is not counted against the platform's allowance. When the allowance is used up, Ask Avala says so in plain words.
- **Providers.** These tasks need text only, so every supported provider can run them; each is offered only after the measure has run on it.
- **Words.** The button is "Ask Avala". Screens do not say "agent" before stage 4.
- **The homepage and the tour** claim only what is live. The tour pictures are retaken once, when this work is done (owner's instruction, November 2026).
- **Alongside:** proof on three to five real processes. Ask Avala answers from the process record, so its answers are only as good as source reading on real documents.

#### Decisions the owner has taken or still has to take

| Decision | Status |
| --- | --- |
| Build in stages, read-only first; the agent last and gated | Agreed |
| Tour pictures after everything else | Agreed |
| Recorded answers in the demo | Proposed: yes |
| Follow-up questions within an open panel, nothing saved | Proposed: yes |
| Saved conversations | Proposed: no, until a client asks |
| Deploy of `journey-ai` for stage 1 | To approve when stage 1 reaches it |

### Packaging: start with the part you need (agreed November 2026)

The platform is sold as one product a customer can start small with, not as separate tools. Its edge is the one process record: every stage reads it, and a change upstream marks what depends on it "needs review". Selling the stages as unrelated tools would hide that and put each against bigger single-purpose products.

- **Bundles.** Assess (sources, process, assessment); Assess and Documents (adds BRD, PDD, FRD, SDD and flows); the full journey (adds work items and the Delivery board); and the Delivery board on its own, for small teams (below). Sources and the process record come with every bundle except the board on its own.
- **Switches per organisation (done, November 2026).** Each organisation has the parts it uses switched on; a stage that is off is not shown, and nothing is deleted when a part is switched off. While sign-up is by invitation, the platform owner sets them; payment comes later. Already on Jira or Azure DevOps? The export (and, later, the tracker push) sends the work there.
- **Homepage (built, November 2026; goes live with the next release).** Two sections, each claiming only what the product does at release: "Your AI, your key" (BYOK: the platform's AI or the organisation's own key, stored encrypted and shown only by its last four characters; providers not yet checked are named as coming) and "Start with one part, or use it all" (the bundles). The board on its own is not called a Jira replacement until step 2 below is in.

### The Delivery board on its own (agreed November 2026)

For small companies that find per-seat tracker prices too high: the same board, usable without a process.

1. **Manage items (done):** add an epic, story, task, bug or sub-task by hand; put an item under another, as in Jira (epics on top, a sub-task always under a story, task or bug); delete an item, its direct children staying without a parent; priority on cards. Viewers read; editors and admins change.
2. **Work together (done, November 2026):** comments and an item history; labels; sprints; import from a Jira CSV; "assigned to you" in the weekday email.
3. **Later:** attachments, the team's own status columns, simple reports (burndown, cycle time).

