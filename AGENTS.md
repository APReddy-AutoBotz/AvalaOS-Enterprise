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
| `supabase/functions/`, `supabase/migrations/` | Inherited edge functions and schema. A new baseline schema replaces the migrations in WP0.2 |
| `domain/` | New pure domain code (created from Phase 1) |
| `scripts/` | Unit-test runners only |

Legacy code is marked for retirement in `docs/product-plan.md` section 1. Do not build new features on the retire list.

## Commands

```
npm ci
npm run typecheck        # application TypeScript
npm run typecheck:edge   # supabase/functions TypeScript
npm run test:unit        # all unit tests; pass a word to filter, e.g. npm run test:unit -- scoring
npm test                 # typecheck + typecheck:edge + unit tests
npm run build            # production build
npm run dev              # local dev server on port 3000
```

## Definition of done for a pull request

- The "Done when" line of the work package is covered by tests that fail before the change and pass after.
- `npm test` and `npm run build` pass locally and in CI.
- No rule in "Rules that always apply" is broken.
- The pull request description says what changed, how it was verified, and what was not verified.

## History

This repository continues `APReddy-AutoBotz/AvalaOS-Core` from commit `88d0643`. The earlier governance documents, acceptance harnesses and CI workflows remain in that repository and in this repository's git history. They are not instructions for work here.
