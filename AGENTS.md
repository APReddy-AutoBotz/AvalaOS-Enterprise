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
| `supabase/functions/journey-ai/` | The AI gateway edge function (deployed, `verify_jwt = false`, authenticates the caller itself) |
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

- Done: WP0.1 repository slimmed; WP0.2 baseline schema applied; WP0.3 eval corpus (AP invoice case) and scorer; WP0.4 AI gateway (`domain/ai/`, edge function `journey-ai`, `ai_usage` table); WP1.1 Process Model domain (`validate`, `patch`, `selectors`, `hash`, `fromAssessV2`); WP1.2 model persistence RPCs.
- Changed from the plan in WP0.2: the inherited tenant model and schema were not carried over. Their 20 RPCs and 22 edge functions depend on the full inherited schema, so the new database has a small tenancy model of its own. The inherited screens therefore run only in local demo mode until each is replaced.
- AI calls go only through `journey-ai`. Add a task to `domain/ai/tasks.ts`; never send prompts from the client. Secrets: `OPENAI_API_KEY`; optional `OPENAI_MODEL` (default `gpt-5.5`), `OPENAI_REASONING_EFFORT` (default `low`), `AI_MONTHLY_TOKEN_BUDGET` (default 2,000,000 per workspace), `ALLOWED_ORIGIN`.
- Edit a Process Model only through `domain/processModel/patch.ts`: each operation takes a valid model and returns the next model plus its JSON Patch, or throws `ModelOpError`.
- Save model edits only through the RPCs: `model_start_draft(process)`, `model_save_patch(revision, expected_seq, patch, origin, summary)`, `model_approve(revision, expected_seq)`, `model_history(process)`. Errors come back as HTTP 409 (stale `expected_seq` or approved revision), 403, 404 or 422. On 409, reload the draft and re-run the operation.
- Next: WP1.3 workspace shell, WP1.4 parsers.

## Definition of done for a pull request

- The "Done when" line of the work package is covered by tests that fail before the change and pass after.
- Typecheck, the tests relevant to the change, and `npm run build` pass in CI.
- No rule in "Rules that always apply" is broken.
- The pull request description says what changed, how it was verified, and what was not verified.

## History

This repository continues `APReddy-AutoBotz/AvalaOS-Core` from commit `88d0643`. The earlier governance documents, acceptance harnesses and CI workflows remain in that repository and in this repository's git history. They are not instructions for work here.
