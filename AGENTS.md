# AvalaOS Enterprise: agent brief

Read this file and the one work-package spec you were given. Nothing else is required reading.

## Product goal

A working, reviewable journey for one business process:

supported source documents → editable assessment → useful BRD / PDD / FRD / SDD and As-Is / To-Be flows → reviewed work proposals → persistent Delivery board items.

## The six behaviours that define "done"

1. One Assess experience and one current assessment per process. One current document per selected type. Engine, schema, handoff and record versions appear only in History. Approved revisions are preserved and clearly distinct from the working draft.
2. Ingest real transcript, SOP and flowchart content. Show source references, missing information and uncertainty. Users can edit extracted fields and steps; edits persist and drive assessment and documents.
3. Recommend at process and step level. Support "AI unnecessary", API-first where an API is confirmed, and human judgment where it belongs. Explain reasons and alternatives.
4. Generate useful, distinct BRD / PDD / FRD / SDD and editable flows. Preserve user edits. When inputs change, mark dependent outputs "needs review" and let the user choose. Missing design facts stay explicit questions or proposals.
5. Generate actionable work-item proposals with descriptions, acceptance criteria and requirement links. Owner, estimate and dates may be unassigned. Document headings are never work items.
6. Users review, edit and select proposals before confirming. Confirmed items appear once on the normal Delivery board and keep status and detail updates.

## Rules that always apply

- **Invent nothing.** No default, sample or "baseline" content in a user's model or document. No assumed API, policy, cost, ROI, volume or evidence. Unknown stays unknown and becomes an open question.
- **One model.** The Process Model is the single source for assessment, documents, flows and proposals. Do not add a second representation of a process.
- **No internal labels in primary views.** Version numbers, hashes, schema names and PR numbers belong in History only.
- **Pure domain first.** Logic goes in `domain/` with no I/O and no React, with unit tests. Then the server command. Then the UI.
- **Server holds secrets.** AI provider keys and service-role keys never reach the browser or the repository.
- **Small pull requests.** One work package per pull request, with its tests. Do not add governance, evidence or status documents.

## Stop and ask before

- changing the database schema outside your work package;
- adding a dependency;
- deleting or rewriting product code that your work package does not name;
- anything that would write generated default content.

## Where things are

| Path | What it is |
| --- | --- |
| `docs/product-plan.md` | The review and the full plan: target templates (section 4), flow design (5), data model (7), work packages (8) |
| `App.tsx`, `components/`, `services/` | The existing application, inherited from AvalaOS Core. Being replaced route by route |
| `services/assessV2/` | Data shapes and interaction-readiness rules that the Process Model reuses |
| `services/scoringEngine.ts` | Legacy V1 scoring. Do not extend it |
| `supabase/migrations/` | The live schema, applied to the AvalaOS Enterprise Supabase project. Access is by workspace membership (`admin`, `editor`, `viewer`, plus `can_approve`) |
| `supabase/tests/*.sql` | Behaviour checks for the schema (`baseline_rules.sql`) and model persistence (`model_persistence.sql`). Run the ones your migration touches against the database; each rolls back |
| `supabase/functions/journey-ai/`, `journey-extract/` | The AI gateway and the extraction pipeline (deployed by GitHub Actions, `verify_jwt = false`, they authenticate callers themselves) |
| `supabase/functions/` (others), `supabase/legacy/` | Inherited edge functions and the inherited 256-table schema. Reference only, not deployed |
| `domain/` | New pure domain code. `domain/processModel/types.ts` is the Process Model |
| `eval/` | The extraction eval: a synthetic source pack per case, its hand-checked gold model, and the scorer. See `eval/README.md` |
| `scripts/` | Unit-test runners only |

Legacy code is marked for retirement in `docs/product-plan.md` section 1. Do not build new features on the retire list.

## Commands

```
npm ci
npm run typecheck        # application TypeScript
npm run typecheck:edge   # supabase/functions TypeScript
npm run test:new         # tests for new code (domain/, eval/); fast, run them on every change
npm run eval -- ap-invoice [model.json]   # score an extracted Process Model against the gold
npm run test:unit        # inherited unit tests; only when touching inherited code
npm test                 # typecheck + typecheck:edge + test:new
npm run build            # production build
npm run dev              # local dev server on port 3000
```

## Tests

- Test what the change can break, not everything every time.
- New code gets fast `node:test` tests beside it (`*.test.ts`), run by `npm run test:new`. Database rules are checked by the SQL files in `supabase/tests/`.
- The inherited unit tests (`npm run test:unit`) run in CI only when inherited code, its runners or the dependencies change. Do not add to them.
- When inherited code is retired, delete its tests in the same pull request.

## Progress

- Done: WP0.1 repository slimmed; WP0.2 baseline schema applied; WP0.3 eval corpus (AP invoice case) and scorer; WP0.4 AI gateway (`domain/ai/`, edge function `journey-ai`, `ai_usage` table); WP1.1 Process Model domain (`validate`, `patch`, `selectors`, `hash`, `fromAssessV2`); WP1.2 model persistence RPCs; WP1.4 parsers (`domain/ingest/`); WP1.5 grounded extraction (`domain/extract/`, edge function `journey-extract`, `extraction_runs`); WP1.6 flowchart import (`domain/flowchart/`); WP1.7 review and edit UI (`journey/process/`), sources (`process_sources`) and re-extraction (`domain/extract/rebase.ts`); WP2.1–2.3 assessment (`domain/assess/`, `journey/process/AssessmentStage.tsx`).
- Changed from the plan in WP0.2: the inherited tenant model and schema were not carried over. Their 20 RPCs and 22 edge functions depend on the full inherited schema, so the new database has a small tenancy model of its own. The inherited screens therefore run only in local demo mode until each is replaced.
- AI calls go only through `journey-ai`. Add a task to `domain/ai/tasks.ts`; never send prompts from the client. Secrets: `OPENAI_API_KEY`; optional `OPENAI_MODEL` (default `gpt-5.5`), `OPENAI_REASONING_EFFORT` (default `low`), `AI_MONTHLY_TOKEN_BUDGET` (default 2,000,000 per workspace), `ALLOWED_ORIGIN`.
- Edit a Process Model only through `domain/processModel/patch.ts`: each operation takes a valid model and returns the next model plus its JSON Patch, or throws `ModelOpError`.
- Save model edits only through the RPCs: `model_start_draft(process)`, `model_save_patch(revision, expected_seq, patch, origin, summary)`, `model_approve(revision, expected_seq)`, `model_history(process)`. Errors come back as HTTP 409 (stale `expected_seq` or approved revision), 403, 404 or 422. On 409, reload the draft and re-run the operation.
- Read uploaded files with `parseFile` in `domain/ingest/parsers/index.ts`. It returns ordered segments with locators, or a state (`needs_ocr`, `unsupported`, `empty`, `error`); it never throws. PDFs need pdf.js passed in.
- Dependencies: the agent workspace cannot reach npm. Change `package.json` on a `claude/` branch and `.github/workflows/lockfile.yml` commits the regenerated lockfile; pull it before the next push.
- Extraction runs in stages in `journey-extract` (per-source passes, two merges, a review, assembly), tracked in `extraction_runs`. Prompts live in `domain/extract/tasks.ts`. Measure any prompt or merge change with live eval runs (`eval/README.md`).
- Edge functions deploy from GitHub (`.github/workflows/deploy-functions.yml`): on main, and on `claude/` branches when the commit message contains `[deploy]`.
- Flowcharts: `parseFile` reads draw.io and BPMN into one segment per lane and shape (`locator.shapeId`, label on the first line), so they go through the same extraction. Images return `needs_vision`: send them to the `readFlowchart` task in `journey-ai` (`{ task, image: dataUrl }`), turn the result into segments with `readingToGraph` and `graphToSegments`, and pass the source to extraction with `inferred: true`; what only it supports stays "inferred". Export flows with `modelToBpmn` (`domain/flowchart/bpmn.ts`).
- Eval cases in `journey-extract`: `ap-invoice` (calls, SOP, draw.io), `ap-invoice-image` (the PNG instead of the draw.io), `ap-invoice-no-flow`.
- Sources: the browser parses uploads and stores segments in `process_sources` (archive, never delete). `journey-extract` `create` takes `sourceIds` of that table.
- Bring an extraction into a model only through `proposeChanges` / `applyChanges` (`domain/extract/rebase.ts`): confirmed elements are never overwritten (a conflict is recorded), removals are opt-in.
- The journey screens read and write only through `journey/store` (`JourneyStore`); the memory store backs the browser tests and has no AI.
- Assessment is one deterministic scoring model (no AI decides anything): `scoreStep` (`domain/assess/scoring.ts`) gives each step a 0-100 score per approach (RPA, API, AI-assisted, agentic, keep with a person) from the `WEIGHTS`, `VALUES`, `CAPS` and `COMPLEXITY_PENALTY` tables; `assessProcess` (`domain/assess/process.ts`) derives the ranking, verdict, the "why" wording and the cautions. RPA is the default where no API is confirmed. Change behaviour only by changing those tables, with a test row. No monetary value may appear under `domain/assess` (a test enforces it). Facts are read from sources by the `stepTraits` task and edited with `setStepTrait`; overrides and the rate are stored in `assessments` (see `domain/assess/decisions.ts`). The report is `journey/process/AssessmentReport.tsx`.
- Assessment inputs and priority: the process profile (`meta.metrics`, `meta.profile`), applications (API status, stable screens, remote desktop) and step facts are edited in one Inputs view (`journey/process/AssessmentInputs.tsx`) through `setProcessMetric`, `setProfileFact`, `setSystemApi`, `setSystemRemote` and `setStepTrait`. `prioritise` (`domain/assess/priority.ts`) derives readiness, ease of implementation (`EASE_WEIGHTS`, `EASE_VALUES`, `EASE_MULTIPLIERS`), value in hours, the value-against-ease placement (`PRIORITY`) and the two 80/20 views (standard path, steps to start with). Same rule as the scoring: change behaviour only in those tables, with a test.
- Whole-process numbers come from `processMetric` (`domain/processModel/selectors.ts`): the metric marked for the process, else the only figure of that kind the sources give. Where the sources give several, a person chooses with `adoptProcessMetric`. `assumeEvenEffort` records step times as 'assumed' facts; the value card flags them.
- Missing inputs give bounds, never blanks and never guesses: ease is a range while facts are unknown, value is an upper bound from whatever exists (step times, else volume and time per case, else people), the placement lists every quadrant the bounds still allow, and `nextInputs` names what to add first. Keep this when adding inputs: an unknown widens a range; it does not stop the result and is not filled with a default.
- Step facts can be answered once for the whole process (`meta.profile.typical`, `setTypicalTrait`); read a step's fact with `stepTrait` (`domain/processModel/selectors.ts`), which falls back to that answer, never `step.traits` directly. A process known only as a whole is assessed as one real step named after it.
- Portfolio (`domain/assess/portfolio.ts`, `journey/pages/Portfolio.tsx`): every process's own assessment side by side, ordered by placement then hours, with the 80/20 of hours across processes. It reads models through the store and stores nothing.
- Workspace settings (`domain/assess/settings.ts`, table `workspace_settings`, admins write): hours per full-time person, the value line and the ease line. Pass them to `assessProcess(model, { settings })`; they change value, placement and the portfolio, never the recommended approach.
- Cost and payback (`domain/assess/payback.ts`): only from the hourly cost, build cost and running cost a person enters (stored as `cost` and `rate` entries in `assessments.overrides`). An upper bound on hours gives only the best-case payback.
- Change expected, remote desktop and whether robots may drive an application's screens (`uiAllowed`; false caps RPA at 0) are read by the `profileFacts` task (`domain/assess/profileFacts.ts`) from the passages that mention them, alongside the step facts.
- WP2.4 done: only the journey is built and routed; the earlier app (`App.tsx`, `components/`, `services/`) is no longer an entry point. Its code stays until the parts the plan keeps (the Delivery board, renderers) are carried over in their own work packages; then it is deleted.
- Documents (WP3.2, in progress): `domain/docs/tree.ts` (document tree, `DocBuilder`: a missing fact is a "Not provided" cell or an open item, and every open item is listed again at the end), `pdd.ts` and `brd.ts` (sections as in plan section 4, derived only from the model, the assessment and entered decisions), `markdown.ts`. Shown read-only in `journey/process/DocumentsStage.tsx`.
- Open questions are triaged by rule in `domain/questions/triage.ts` (merged per system, already-known set aside, grouped by what an answer changes, likely owner) and answered in `journey/process/GapsAssistant.tsx` (opened from Documents). Answers go through patch operations (`closeQuestions`, `deferQuestion`, `setAccessStatus`, `routeException`, `updateFact`); documents are never edited to answer a gap.
- Answers from notes or voice: `journey-ai` has a `transcribe` action (audio data URL, `OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-transcribe`) and the `answerFromNotes` task (`domain/questions/notes.ts`); proposals are confirmed by a person, and the notes are saved as a source `ans-N` before the answers are written.
- Word export: `domain/docs/docx.ts` renders a document tree with the `docx` library (loaded on demand in the browser); `DocxStyle` carries font, accent colour and organisation name for branding.
- Agreed order (Nov 2026): triage and guided answers; then typed notes and voice through `journey-ai` (an answer session is saved as a source); Word export with the `docx` library (approved); company templates (branding, then structure); question packs per owner; then FRD and SDD.
- Branding: `domain/docs/branding.ts` (organisation, font, accent, logo, company Word template read by `readWordTemplate`); stored per workspace in `document_settings` (admins write, members read); edited in Settings → "How documents look"; applied on screen and to the Word download (`docxStyleFrom`).
- Section structure: `domain/docs/layout.ts` applies a per-type `DocLayout` (rename, hide, reorder top-level sections, add the company's own sections) after the builder and renumbers; the open-items list cannot be hidden and keeps every item. `suggestLayout` matches a Word template's headings to sections by rule; a person reviews it in Settings → "Document sections" before saving. Cross-references between documents use section titles, not numbers.
- Question packs: `domain/questions/packs.ts` builds one pack per owner from the triage (refs B1, T1, F1…), renders it as a document tree (`type: 'questions'`, Word or Markdown), and `replyNotes` reads a returned pack's answered rows; the reply goes through the `answerFromNotes` review in `journey/process/QuestionPacks.tsx` and `GapsAssistant`.
- Requirements (WP3.1): `domain/requirements/derive.ts` derives BR (objective, each rule), FR (each step recommended for automation, each human check, each exception) and NFR (each stated control) by rule, wording only from model text; `register.ts` `reconcile` matches them to the stored ones by derivation key (IDs never reused, a person's edit wins, a removed source is marked "source removed"). Stored in the baseline `requirements` table. The FRD (`domain/docs/frd.ts`) and the BRD's business requirements read the register; edits in `journey/process/RequirementsPanel.tsx`. Missing NFR topics are open questions. AI wording of statements is not added yet.
- SDD (`domain/docs/sdd.ts`): automation units (To-Be steps grouped by approach and main application), integration, data, rules, exceptions, human tasks, security, monitoring, environments, test scenarios from the FRD's acceptance criteria, run and support, an agent section when an agent is used, and open design decisions with options. Technical facts not in the model are open design decisions, never assumed. Shown once a revision is approved; a working draft can be previewed, marked as not for sign-off.
- Next (approved Nov 2026: new tables, TipTap, deleting the old app): flows, delete the old app code, editing with TipTap.

## Definition of done for a pull request

- The "Done when" line of the work package is covered by tests that fail before the change and pass after.
- Typecheck, the tests relevant to the change, and `npm run build` pass in CI.
- No rule in "Rules that always apply" is broken.
- The pull request description says what changed, how it was verified, and what was not verified.

## History

This repository continues `APReddy-AutoBotz/AvalaOS-Core` from commit `88d0643`. The earlier governance documents, acceptance harnesses and CI workflows remain in that repository and in this repository's git history. They are not instructions for work here.
