# Avala OS: what is left, and the next work

Written on 16 November 2026, after the fifth release, at the owner's request. It lists everything still open on the platform, sets out the next release as work packages a builder can start on, and gives an order for what follows. The owner builds in one chat and has the result reviewed in another, so every package ends with what the review will check.

This file is kept in two places: `docs/next-plan.md` in the repository (the source of truth) and `claude/next-plan.md` in the owner's project. Change both together. The rules in `AGENTS.md` hold throughout; nothing here changes them.

## 1. Where the platform stands

Live on avalaos.com since the fifth release (16 November 2026): the whole journey from sources to the Delivery board; Ask Avala everywhere, its interview and its suggestions; bring your own AI key; a workspace per client; the parts an organisation uses; the Delivery board on its own with comments, history, labels, sprints and import from Jira; and the whole effort-first plan (fewer questions, the brief, the delivery plan, work not done today, a typical process to start from, the agent document, the test pack with testers' edits, review comments, the effort scorecard).

Proven on real documents so far: two of the owner's own processes (Questionnaire Tooling, Project time writing) and the sample's documents. Each real test found faults the sample had not shown. That is the pattern to expect, and the reason section 4 puts more real processes first.

Releases (owner, 17 November 2026): 65 Netlify credits are left, about 15 a production deploy, so about 4 deploys; 1,000 credits are added on 22 November 2026. From then credits no longer limit releases; changes are still bundled so each release is reviewed on the preview first.

**Update, 26 November 2026: the twelfth release.** What was in `next` after the eleventh release is live: #239 to #244 and #246 (merge commit `28fa072` on `main`, merged by the review chat on the owner's yes at 04:30 UTC). There was no release's own commit: no date changed and "Release dates set" passed as it was. It carries:
- package B's pull requests 3, 4a, 4b and 5a: the discovery session kept for everyone, spoken answers in Ask Avala's Questions tab, the Discovery tab, a gap a person closed staying closed (with Reopen), re-readings that do not pile up questions, and the review's plainer words;
- the content security policy, report-only (#242; see "Content security policy" in `AGENTS.md`);
- the Tiptap upgrade, with "Save with no change saves nothing" (#244);
- the eleventh release's notes (#240).

Where a section below says "in review", "built", "in `next`" or "waits for the release" about these, read "released". **No migration** came with it: `discovery_sessions` had been applied on 24 November 2026.

**The functions.** All five were redeployed from `main` at `28fa072` by "Deploy edge functions" (run `45755637910`, 04:30:31 to 04:30:53 UTC): `journey-ai` version 79, `journey-extract` 82, `journey-invite` 16, `journey-notify` 16, `journey-inquiry` 8. Only `journey-ai` and `journey-notify` load changed files (`triage.ts`, `closedGaps.ts`, `edits.ts`). The functions as they were before it: the branch `claude/functions-before-twelfth-release` at `58ae491`, for all five. CI on `28fa072` passed, the browser tests included.

**Seen signed out on avalaos.com straight after:**
- the report-only policy on `/`, `/privacy`, `/terms`, `/security`, `/demo` and `/signin`, naming the Supabase project and Sentry's EU host, with no enforced header;
- the other headers unchanged, and `/_headers` answering 404;
- no content security policy message in the console on the public pages or any stage of the demo, the section and flow editors opened and closed.

`main` and `next` hold the same code. The extraction check was not run: `journey-extract`'s code did not change.

**The owner's walk** (avalaos.com, "Avala check" only, 05:39 to 11:10 UTC, confirmed from the database by the review chat): 19 AI calls, 86,344 tokens, none failed, nothing approved. That was one reading of two sources (about 51,000), five readings of answers, one draft, three spoken answers on `gpt-transcribe`, and one Ask Avala question (11,853).

**For the next walk:** a reading of a short spoken description and one PDF cost about 51,000 tokens, not the 10,000 to 35,000 the notes estimated. Count a reading of two short sources at about 50,000.

**The content security policy's 14 days** of report-only run from 26 November to 10 December 2026. Enforcement is asked separately, in its own release.

**Sentry, read by the owner on 26 November 2026:** one issue only, `AVALAOS-WEB-2`, "frame-src would block https://app.netlify.com (/.netlify/scripts/cdp)", 10 events, all on previews (Netlify's preview toolbar, left as it is by the owner's choice). **None from production.**

**Still open:** the first weekday email from `journey-notify` 16 (27 November 2026, 03:30 UTC).

**Asked separately, not done:** the migration that closes `model_approve`; revoking TRUNCATE from `authenticated`; the user guide's chapters; package 16's line in `platform.ts` with the full Ask Avala measure on 1 December 2026.

**Update, 24 November 2026: the eleventh release.** What was in `next` after the tenth release is live: #227 to #237, and the release's own commit #238 (`9343e80`), which set `UPDATED.security` and `EVIDENCE_KEPT_SINCE` to 24 November 2026 (merge commit `58ae491` on `main`, merged by the review chat on the owner's yes at 05:18 UTC). It carries:
- package 14's screens (pull requests 3, 4 and 5: approving keeps the documents, earlier approvals and "Keep it as it reads now", the evidence pack's versions, History's lines, the two numbers, Ask Avala's line; section 3f);
- package 16 (closing questions from the Assessment stage; section 3g);
- package B's pull requests 1 and 2 (the rules of guided discovery and the noticing task, nothing on screen);
- "No way in" (#235) and the device rule (#236);
- the brief lines kept by a first reading (#229).

Where a section below says "in review", "built", "in `next`" or "waits for the release" about these, read "released". **No migration** came with it.

**The functions.** All five were redeployed from `main` at `58ae491` by "Deploy edge functions" (run `45332418907`): `journey-ai` version 78, `journey-extract` 81, `journey-invite` 15, `journey-notify` 15, `journey-inquiry` 7. `journey-invite`'s code did not change. The functions as they were before it: the branch `claude/functions-before-eleventh-release` at `0c93807`, for all five.

**Seen signed out on avalaos.com:** the security page's date and line, and the demo's "Approved version 1" with unchanged figures. `main` and `next` hold the same code.

**The extraction check after it** (the builder, on the owner's word):
- **The run:** GitHub → Actions → "Extraction check" on `main` at `58ae491`, case `ap-invoice`, on the platform key, check `1c2655a7` (GitHub run `45332862648`), 24 November 2026, 05:22 to 05:24 UTC, about 2 minutes, 73,847 tokens in and 43,671 out.
- **Every published target passed:** steps found 100% (target 90%), steps correct 95.5% (90%), roles 95.2% (85%), applications 88.9% (85%), quotes 100% of 245 (100%), open questions 90% (80%), ways in overclaimed 0 (0).
- **Ways in corrected by assembly as "not switched on": one.** SAP S/4HANA's `API_SUPPLIERINVOICE_PROCESS_SRV` went from "confirmed absent" to "reported", on call-3's passage "…But we have not activated it in our Gateway." The hand-checked gold records that way in as "reported", so the correction was right; the tenth release's run read it right without one.
- **Not judged:** rules 77.8% (66.7% in the tenth release's run), figures 84.6%, exceptions 100%, conflicts 100%. Questions listed 25 (16 to 22 before), conflicts listed 10 (5 to 8), exception groups 19 (15 to 21). One step more than the gold, "Confirm receipt status"; none missed.

**Decided by the owner:** package 16's line in `domain/assistant/platform.ts` (where questions are answered) and its new measure question wait for the full Ask Avala measure on 1 December 2026; nothing is added before.

**Asked separately, not done:**
- the migration that closes `model_approve`, once the release has been live for a day;
- revoking TRUNCATE from `authenticated`;
- the user guide's chapters in the owner's project.

The release notes are `claude/eleventh-release-notes-24-nov.md` in the owner's project.

**Update, 23 November 2026: the tenth release.** What was in `next` after the ninth release is live: #210 to #224, and the release's own commit #226 (`ff5fda4`), which set the privacy page's date to 23 November 2026 (merge commit `0c93807` on `main`, merged by the review chat on the owner's yes at 05:06 UTC). It carries the reading-split package and the not-switched-on rule (section 3e), the per-minute AI limit and voice on `gpt-transcribe` (sections 3e and 3g), the marketing package without the partner page (Word file properties, teardowns in the demo with none listed, their counting), and package 14's rules and database, which nothing on screen uses yet (section 3f). Where a section below says "in review", "built", "in `next`" or "waits for the release" about these, read "released". Its migrations, `ai_call_admit` (21 November) and `approved_versions` (22 November, about 10:05 UTC), were applied before it. All five server functions were redeployed from `main` at `0c93807` by "Deploy edge functions" (run `45115748212`, 05:06 to 05:07 UTC): `journey-ai` version 77, `journey-extract` 80, `journey-invite` 14, `journey-notify` 14, `journey-inquiry` 6. The functions as they were before it: the branch `claude/functions-before-tenth-release` at `943c89c`, and for `journey-extract` the branch `claude/reading-within-one-answer` (the extraction live before the release). Checked by the owner straight after, on avalaos.com, and confirmed by the review chat from the database and the function's log (06:02 to 06:06 UTC): one Ask Avala question on a process was answered; `app_private.ai_call_starts` holds one row for each of the two calls (the minute limit is counting); one spoken answer on `gpt-transcribe` counted 460 tokens in and 0 out, and the log line reads "transcribe usage form: duration (gpt-transcribe)". So the dated item "the platform key's speech model" is closed (section 3g). The extraction check after it (the builder, on the owner's word): GitHub → Actions → "Extraction check" on `main` at `0c93807`, case `ap-invoice`, on the platform key, run `8090a286` (GitHub run `45130851121`), 23 November 2026, 07:24 to 07:30 UTC, about 5.5 minutes, 72,535 tokens in and 42,957 out. It passed every published target: steps found 95.2% (target 90%), steps correct 100% (90%), roles 95% (85%), applications 94.2% (85%), quotes 100% (100%), open questions 90% (80%), ways in overclaimed 0 (0). Ways in corrected by assembly as "not switched on": none (none was expected on the sample). Not judged: rules 66.7%, figures 84.6%, exceptions 100%, conflicts 100%; questions listed 28 (16 to 22 before), conflicts listed 9 (5 to 8), exception groups 19 (15 to 21); missed one step, "Return invoice to vendor". Rules at 66.7% is below the 72.8% the reading-split package was judged by (a mean of two runs); this is one run, to be read with the next. The allowed-websites header was not checked after this release: the ninth release passed it and this release did not change it (owner). Next: package 14's pull request 3 (section 3f). The release notes are `claude/tenth-release-notes-22-nov.md` in the owner's project.

**Update, 20 November 2026: the ninth release, and the order after it.** Packages 15, 13 (A, B, C) and 12 and the fixes of 19 November (#203 to #208) are live (merge commit `943c89c` on `main`, merged by the owner; the release's own commit is #209). Where a section below says "in `next`", "built" or "this release", read "released". All server functions were redeployed from `main`; the checks passed. The extraction check `ap-invoice` ran by itself straight after, on the platform key (`gpt-5.5`, run `85799b5d`, 2 minutes 52 seconds), and passed: steps found 95.2%, steps correct 95.2%, roles 100%, applications 87.5%, quotes 100%, open questions 90%, ways in overclaimed 0. Seen on the live site: the privacy page's "Last updated 20 November 2026"; a server function answers a call from avalaos.com with no CORS error. The other checks in section 3f ("Before the release") were left to the owner. `main` and `next` hold the same code.

The order from here (owner, 20 November 2026), replacing the order written in sections 3e and 3f: (1) reading sources within the length of one answer (section 3e, "After this release: reading sources within the length of one answer"), with a short plan the owner sends to the review chat before anything is built; (2) the per-minute AI limit; (3) the marketing package without the partner page (the partner page waits for the lawyer); (4) package 14 (section 3f); (5) the Tiptap upgrade; (6) the content security policy, report-only first. No release before 22 November 2026. The full Ask Avala measure runs on 1 December 2026 on the released functions. About 1 million tokens of this month's allowance on the platform key are left (owner, 20 November 2026); it is not raised.

**Changed the same afternoon (owner, 20 November 2026).** After package 14 come the content security policy, then package 16, then the Tiptap upgrade. The order is now: (1) reading sources within the length of one answer; (2) the per-minute AI limit; (3) the marketing package without the partner page; (4) package 14; (5) the content security policy, report-only first; (6) package 16, closing questions from the Assessment stage; (7) the Tiptap upgrade. The content security policy comes before package 16 by choice, to do security work first; package 16 does not depend on it. Package 17, speech to text for Azure OpenAI, is not in the order: it is due before the first workspace on an Azure OpenAI key. Both packages, and two dated items (the platform key's speech model by 15 January 2027; the weekday email's link for open questions before the first organisation on the "Assess" set-up), are in section 3g.

**The order from 23 November 2026 (owner).** Package 14 (section 3f), then package 16 (section 3g), then package B of the discovery spec, guided discovery (its plan is `claude/package-b-plan-23-nov.md` in the owner's project, approved with four changes). The content security policy and the Tiptap upgrade are fitted around them by the first builder chat. Packages 16 and B are built by the second builder chat; no code of theirs starts until package 14's pull request 3 is merged, with one exception: a first reading of the sources keeps the brief lines a person gave in "Tell us in your own words" (`applyChanges` in `domain/extract/rebase.ts`, which no server function loads). Before it, the answers to "Is the work done today?" and "What do you have in mind?" were lost at "Start the process from this" when no application had been typed, because the model still counted as empty.

**Update, 16 November 2026 (late evening): the sixth release.** Sections 3 and 3b and the homepage package (package 7) are live (merge commit `218943a` on `main`, on the owner's word), reviewed first (`claude/review-sixth-release-16-nov.md` and `claude/review-second-bundle-16-nov.md` in the project). Where a section below says "in review", read "released". The server functions were redeployed from `main` (the first run failed on GitHub's rate limit before deploying anything; the second succeeded). Still to be seen: the first weekday email with the new count and comments, compared with My work. What comes next is section 4, with three additions from the reviews: an inquiry form on the homepage (today "Book a walkthrough" opens an email; it needs a server function, a place to keep requests, spam control and a line in the privacy notice: ask first); the evidence pack saying that its count of open questions is every item as recorded (the screens merge repeats); and recording who made a choice of approach by name or id.

**Update, 17 November 2026 (late night): section 3f comes first.** An outside review of the repository was checked finding by finding (`claude/repo-review-analysis.md` in the project). The owner decided: package 15 (only the code in use, with proof), package 13 (soundness fixes), then package 12 (section 3e), one release; package 14 (an approved document is final, a change makes a new version) as the release after. The repository is private since that evening. With the owner: confirm two old keys in the history are deleted at their provider; a monthly spend limit at OpenAI; the rule on `main` in GitHub (the review chat's access cannot set it).

**Update, 17 November 2026 (night): the next work is section 3e**, on the owner's go: counting visits to the public pages (package 12), before marketing starts. A marketing chat works from `claude/marketing-brief.md` in the project; what it needs from the product comes to the development chat as requests.

**Update, 17 November 2026 (evening): the eighth release.** Section 3d (package 10, the tidy-up, #190; package 11, the walkthrough request form, #191), headings that wrap balanced (#184) and the amber first letters in the tour's list of stages (#188, #189) are live (merge commit `bab6440` on `main`, on the owner's word). Where a section below says "in `next`" or "in review", read "released". Reviewed first: the database change read and inspected live, the new function read, both packages tried on the preview, and one real request sent from the preview after the owner agreed to deploy `journey-inquiry` ahead of the release (17:44 India time): it was thanked, stored, and listed in Settings. All five server functions were redeployed from `main` on the first run. Seen on the live site after the release: "Book a walkthrough" opens the request window, the five amber letters, balanced headings. About 35 Netlify credits are left (about 2 deploys) until 1,000 are added on 22 November 2026. Still with the owner: the notice email at hello@avalaos.com was not confirmed, and the test request "Review test (please delete)" is in Settings to delete. Small things found in the review, not fixed: a decided approach can say "80 questions settle them" (true, but alarming: say it per step or soften it); walkthrough requests show their time as "Nov 17, 2026, 5:50 PM" where the product writes "17 November 2026"; the privacy, terms and security pages share one "last updated" date. What the review advises next: run the other AI providers through their check (each needs the owner's key), and an option to hide names and account numbers before text goes to an AI provider.

**Update, 17 November 2026 (afternoon): the next work is section 3d**, on the owner's go: a tidy-up (package 10) and an inquiry form in place of the email link (package 11). Headings that wrap balanced (#184) wait in `next` for the same release. Alongside it the owner tries "Document it as it is" on a real process.

**Update, 17 November 2026: the seventh release.** Section 3c (packages 8 and 9, with the fixes from the review, #181), the homepage tour heading (#174), the wider line above the headline (#180) and the line on documenting a process without the assessment (#182) are live (merge commit `b627552` on `main`, on the owner's word), reviewed first (`claude/review-third-bundle-17-nov.md` in the project). Where a section below says "in review", read "released". The server functions were redeployed from `main` on the first run; from this release the weekday email counts questions and needs by each process's answer and Ask Avala knows the three answers. Seen on the live site after the release: both homepage lines, and the question "What do you want from this process?" in the demo. About 50 Netlify credits are left (about 3 deploys) until 1,000 are added on 22 November 2026. Still to be seen: the first weekday email for a process with a new answer; the Word download of an as-is document; two people on one process. What comes next: section 4, and the small faults in section 2; a later refinement from the review: retire automatically the requirements a decided approach leaves marked "Source removed" when nobody edited them and no work is linked.

**Update, 16 November 2026 (night): the next work is section 3c.** After the release the owner asked whether a team can get its documents without the assessment. It can, with a modest change: a person says what they want from a process, and two new answers are built as packages 8 and 9. One small change is waiting in `next` for the next release: the heading of the homepage tour (#174, "From your documents to a Delivery board").

**Update, 16 November 2026 (late night): section 3c is built and merged into `next`** (package 8, #176; package 9, #177), in review on the open pull request `next` → `main`. No database change. Packages 8 and 9 must go out in one release (see the start of section 3c). What was built, and where it differs from the plan, is at the start of section 3c.

**Update, 16 November 2026 (afternoon):** section 3 is built and merged into `next` (pull requests #162, #163, #164), with no server function or database change. The open pull request `next` → `main` is the preview for the review; nothing is released until the owner says "release". What was built, and where it differs from the plan, is at the start of section 3.

**Update, 16 November 2026 (evening):** section 3b is built and merged into `next` too (pull requests #168, #169, #170). Its two database changes were applied on the owner's yes after rolled-back trials, at 09:53 and 09:54 UTC (`process_source_looks`, `digest_counts_and_comments`); the email server function `journey-notify` changes with the release and was not deployed by hand. One release carries sections 3 and 3b. What was built, and where it differs from the plan, is at the start of section 3b.

## 2. Everything still open

### Small faults, no server or database change

- A typical-process comparison a person asked for, and "Skip for now", are forgotten when the page is left (left as they are on purpose: light conveniences).

The demo's links, "Changed … ago" and the objective asked twice are fixed in package 10 of section 3d (#190), in `next`.

The map's single shape, the repeated look in the sources and the other small faults of the owner's test of 16 November are built (section 3), in review.

### Small faults that need a change to the live server or database (ask first, one by one)

- A failed extraction keeps no detail of what it had read.
- Errors in the server functions are only in the Supabase logs, not in the error monitor.
- The weekday email's link for open questions opens Documents (`domain/work/home.ts`, the stage of the questions need), which the "Assess" set-up does not have. Due before the first organisation on that set-up; `journey-notify` loads that file, so the fix changes the function at a release. Package 16 fixes My work's screen only (section 3g).

The weekday email's count, review comments in it and on My work, and the look in the sources shared by everyone are built (section 3b), in review.

### Features agreed or proposed, not built

| Feature | State |
| --- | --- |
| Push to Jira and Azure DevOps, with status coming back | Not built. The owner has not decided. Today: CSV export for both, CSV import from Jira. |
| Evidence pack for regulated clients | Built (section 3b, package 6), released. |
| Documents without the assessment: "Document it as it is", and "how it will be built is already decided" | Built (section 3c, packages 8 and 9), released 17 November 2026. |
| "Custom software" as an approach, with a solution design for an application | Not built. The owner decides later; larger than section 3c. |
| A fifth set-up for an organisation: documents without the assessment | Not built. A database change; after a real person has used package 8. |
| More typical processes to start from | One only (supplier invoice processing), as a trial. More only after a real person has used the trial. |
| Other AI providers offered to workspaces | Built for Anthropic, Amazon Bedrock, Mistral AI and a company's own endpoint, but offered only to the platform owner until the extraction check has been run on each. OpenAI and Azure OpenAI are offered. |
| Ask Avala: drafts of document sections as suggestions | Not built. Depends on the decision below about a company's own sections. |
| Ask Avala: the interview in place of "Closing the gaps" | Both exist. The owner decides (advice: not yet). |
| Ask Avala: the supervised agent (stage 4) | Not started, on purpose. Gate: stages 1 to 3 in use on three real processes and the measure at its targets for four weeks. |
| A real Excel file (.xlsx) for the test pack | Needs a new library. "Download for Excel" (CSV) opens in Excel. Advice: not now. |
| The board: attachments, the team's own status columns, burndown and cycle time | Not built (step 3 of "The Delivery board on its own"). |
| Flow files: draw.io export, Visio import | Not built. BPMN export, and BPMN, draw.io and picture import, are. |
| Scanned PDFs | Not read. The Sources screen says the file needs text recognition first. |
| An option to hide names and account numbers before text goes to an AI provider | Not built (a risk named in `docs/product-plan.md`, section 11). |
| Process variants, screen recordings and event logs as sources, benefit tracking after delivery, single sign-on (SAML) | Later, as the roadmap orders them. |

### Before the first paying client (the owner's side)

- An employment lawyer's reading of the contract's clauses on outside business and intellectual property.
- The database's plan: the Free plan keeps no backups of its own (a nightly encrypted copy with a restore check stands in). Decide whether to move to a paid plan.
- Payment. Organisations are switched on by the owner by hand; nothing takes money.
- "Book a walkthrough" (before 16 November: "Request a pilot") opens the request window from the release that carries package 11 (section 3d).
- Installation in a company's own cloud is offered on the homepage and has never been done.
- Two-step sign-in on Sentry, and "Allow join requests" off there. Leftover `claude/` branches can be deleted.
- Google and Microsoft sign-in are switched on (both buttons show on the sign-in page, seen 16 November 2026).
- Real names in people's profiles: the evidence pack and the emails show the profile name.

### On the owner's test process

"Project time writing" still carries the objective with its spelling mistakes. Correcting it in "The brief" starts a new draft to approve; the 69 items already on its board keep the old wording.

## 3. The next release: one bundle, three packages

All three change only the screens and the browser's rules. No server function and no database change, so everything can be tried on the preview. Build in this order, one pull request each into `next`.

**Built (16 November 2026), in review.** Each package's "Done when" is met with the tests it names; the details are in `AGENTS.md` (Progress). Where the build differs from the text below, and why:

- Package 1: "Across the page" is in; turning the simple flow on its side needed only the labels of events and decision points moved under and before their shapes, so no flow runs through them. The choice of direction is kept in the person's browser (it changes only how the screen reads); a viewer's choice of shape lasts for the visit and is followed by the documents on screen during it. Choosing the suggested shape removes the stored choice, so the suggestion follows the process again. The sample is six columns (five roles and "No role recorded"), exactly at the limit, so it stays in swimlanes; its swimlane maps are byte-for-byte as before.
- Package 2: a page that opens while any call is under three minutes old and unanswered sends nothing at all, not only those questions (two tabs open on one process would otherwise each send the next batch); it looks once the wait is over. The allowance message shows wherever the look's line does: Ask Avala's "Questions" tab, Closing the gaps and Suggestions.
- Package 3, item 1: the question is kept and asked when the panel is ready, also when it was typed while an answer was coming. Item 5: besides two names put together, the process's own text was being read as one string, so the end of one name and the start of the next counted as a phrase; each piece now keeps a boundary.

### Package 1: the map takes the shape that fits the process

**Why.** The owner's process has 33 steps, 19 of them one role's, and seven columns. A swimlane earns its width when work passes between a few roles. It does not when there is one role, or so many that the page cannot hold them.

**What a person sees.**

- On Flows, a switch above the map: "Swimlanes" and "Simple flow". Under it, one line saying why the shape was chosen when Avala OS chose it ("Drawn as a simple flow: this process has seven roles, more than a page can hold side by side. Switch to swimlanes to see each role's column."), and "Use the suggested shape" once a person has chosen otherwise.
- The simple flow is one column from top to bottom. Each step's box names its role on a small line of its own (the whole name on hover, as other labels). Where the role changes from the step before, that line is darker, so a hand-over is still seen. Decision points, start and end, the To-Be colours, the dot where a person checks, the legend and the labels on paths stay as they are.
- The same shape is used for the As-Is and To-Be maps on Flows, both maps in the PDD on screen, the Word download, and the Markdown text.
- The flow editor stays in swimlanes, because there a step's role is set by the column it sits in. The BPMN download does not change.

**The rule** (a pure function with its reason in words, for example `mapShape(model)` in `domain/flowchart/`; the numbers in one table so they can be changed with a test row):

| When | Shape |
| --- | --- |
| One role, or none, has steps | Simple flow |
| More than six columns would be drawn (roles with steps, plus "No role recorded" when used) | Simple flow |
| Otherwise | Swimlanes |

Six is a working default the owner may change. The sample (five roles) must stay in swimlanes, so the homepage pictures and the demo need no retake; a test keeps that.

**Where a person's choice is kept.** With the process's other decisions, so everyone and every document sees the same shape: a new kind of entry beside a person's choice of approach (`assessments.overrides`, read by `decisionsFromEntries`; the database only requires a list, so no migration). Editors choose; a viewer's switch lasts for the visit. If this turns out not to fit, stop and ask; do not add a table and do not put the choice in the Process Model, where changing it would start a new draft of an approved revision.

**Must not happen.** Switching the shape must not mark any document section "Changed since revision N" or "Needs review": both sides of every comparison are drawn in the same shape.

**Second step, same package: left to right.** A second switch on Flows, "Down the page" and "Across the page", for the simple flow only, for reading on a wide screen and for the picture. Documents stay top to bottom, because a portrait page cannot hold a wide map. Build it as the same layout turned on its side. If it needs more than that to look right, stop, leave it out, and say so in the report.

**Done when.**

- Unit tests: the rule's rows (one role, seven columns, the sample, a person's choice winning); the simple flow draws every step, decision point and path of the swimlane map, with each step's role in its box; no flows recorded still shows the steps in order.
- Browser test: on the sample, the switch changes the map on Flows and in the PDD, the choice is still there after a reload, and no document section turns "Changed".
- The review will check on the preview: the owner's process opens as a simple flow with the reason shown; the Word download carries the same shape; the editor still opens in swimlanes and a saved edit still works.

### Package 2: the automatic look does not repeat itself

**Why.** Each call takes time. When the page is left or reloaded meanwhile, the server still finishes and counts the call, but the browser never gets the answer, and the next page sends the same questions again.

**What changes** (`journey/process/sourceLook.ts`, rules in `domain/assistant/sourceLook.ts`; browser only):

- Before each call, the browser notes which questions went and when.
- A page that opens within three minutes of that note does not send those questions again. After that it sends them once more, because the answer was lost. It never sends the same questions a third time on its own; "Look in the sources" on the Suggestions tab still does when a person presses it.
- When the server says the month's allowance is used up, the panel says so once in plain words instead of stopping silently.

Three minutes and one repeat are working defaults.

**Done when.** Unit tests for the rule (within the wait: nothing sent; after it: sent once; then never again on its own; a new or archived source starts afresh as today). The review will check on the preview with the usage records: reloading a process page four times in a minute adds no call beyond the first.

### Package 3: small faults

One pull request, each with its test:

1. A question typed while Ask Avala is still reading the record is kept and sent when the panel is ready (or the box says "Reading the record…" and cannot be typed in; whichever is simpler, but never a silent loss).
2. Follow-up questions offered after an answer fit what was asked about: a process's questions after an answer about the process behind a board.
3. A long step name wraps in the Process stage's step table.
4. One count of open questions on the Process stage: the tab shows the first list's count, and says how many raw items it merges when the two differ.
5. `groundingIssues` no longer passes two known names put together as one.

Leave the two "forgotten when the page is left" items as they are; they are light conveniences.

### After the three packages

Done on 16 November 2026: the notes are brought up to date here, in `AGENTS.md` and in the project; the pull request `next` → `main` is open as the preview and not merged; the report is with the owner for the review chat.

## 3b. The second bundle, built before the same release (owner, 16 November 2026)

**Built (16 November 2026), in review.** Each package's "Done when" is met with the tests it names; the details are in `AGENTS.md` (Progress). Where the build differs from the text below, and why:

- Package 4: two pages writing at once are kept apart by a write counter on the row (the database counts each write; a write from an older copy is refused, and the page adds its step to the newer copy), so no database function was needed. A page about to send questions also gives up when the newer copy shows another page has just sent some, which closes the gap between deciding and noting. My work, the Processes list and the Portfolio read the server's copy as well, so they count what the email will.
- Package 5: My work shows the comments as one line per process ("2 open review comments on the documents"), opening Documents; the email lists each new comment. Its link opens the document and the section (`?doc=…#section`), which Documents now honours.
- Package 6: read-only, with no Comment, because the database takes comments only on the six existing documents. On the demo's sample the pack lists 31 functional requirements, not 25: the demo carries the walk-through's inputs; the bare sample has 25. Who made a choice of approach is stored as an email address, so the pack says "Not recorded" there (section 2 above).

The owner holds the release until more is built; one release then carries section 3 and this section. Three packages. Two of them change the live database and what a server function does, which the preview cannot show, so these rules hold for both:

- **Only additive changes.** A new table, or new keys in what a database function returns. Each migration is applied before the release, so the released site and the released server functions must keep working unchanged once it is applied.
- **Each migration:** its test in `supabase/tests/`, a rolled-back trial reported to the owner in plain words, the owner's clear yes, then applied. Both migrations may be prepared and trialled at the start, so the owner is asked early; the evidence pack can be built while waiting.
- **A change to what a server function runs goes live with the release, never before.** Do not deploy a function by hand. The report names each function that changes and what it then does differently.

### Package 4: what was looked up in the sources is kept for everyone

**Why.** Found in the review of 16 November: the same three batches of one process's questions were sent twice, 78 seconds apart, from two browsers. Each browser (and each address: the live site, every preview) keeps its own memory of what it looked up. So a second device pays again, two people can see different "found to confirm" counts, and the wait of package 2 holds only inside one browser.

**What changes.**

- One new table, one row per process: the look as the browser keeps it today (the set of sources, the questions looked up, the answers found, what it cost, what was sent and when, when the allowance ran out) and the suggestions set aside with "Not right". Workspace members read it; editors write it; the database records who wrote and when; it goes when the process goes.
- The browser reads the server's copy when a process opens and writes after each step of a look. The copy in the browser stays only for when the server cannot be reached, and for the demo.
- A page reads the server's copy before deciding to look, and the note that questions were sent is written before the call. The three-minute wait and the single repeat then hold across browsers and people.
- A write never loses what another page found: the two are merged (the builder chooses how: read again and add, or a small database function, with a test of two writers).
- "Not right" by one editor holds for everyone, because it is a judgement on the suggestion (a working default the owner may change).
- A browser that already holds a look for a process hands it to the server once, when the server has none for the same sources, so nothing is looked up again after the release.

**Done when.** Unit tests: two looks of the same sources merge with no answer lost; a different set of sources starts afresh; the sent notes and the wait work from the server's copy. A database test: members read, editors write, viewers and other workspaces cannot, the row goes with its process. A browser test with two pages on one process. The review will check with the usage records: the owner's process opened in two browsers within a minute makes one set of calls, and both show the same "found" count and the same effort card.

### Package 5: the weekday email counts what the screens count, and comments reach people

**Why.** The email says every open question (43 on the owner's process) while My work says the few that need people now. And a review comment on a document reaches nobody.

**What changes.**

- **The count.** For each process the email uses the first list, as My work does: what needs people now and the answers found to confirm. Those rules are in `domain/questions/firstList.ts`, which SQL cannot run, so `journey-notify` works the count out itself from each process's current model and the look kept by package 4, with the same functions My work uses. No AI is involved. `needs_digest_input()` returns what that needs as new keys and keeps its existing keys, so the released function is unaffected until the release.
- A process with only "can wait" questions is not a need, as on My work.
- **Comments.** A new open comment on a document section is listed in the weekday email of the people named on the process (analyst, architect, approver), never of its author; only comments new since that person's last email, a few shown with a count of the rest (as assigned work is); a resolved comment is not listed; an email can go for comments alone. Each line gives the document, the section's title, who wrote it (a name, never an email address) and a link to the document.
- **The same on My work.** Open comments show under "Needs you" for the same people by the same rule, so the email never says what the screen does not.

**Underneath.** One migration (the database function, with its test extended), `journey-notify`, `domain/work/digest.ts`, `domain/work/home.ts`. The migration is live once approved; the function with the release.

**Done when.** Unit tests: the email's question count equals My work's for the same process and look; comments that are new, already seen, one's own and resolved; the cap. The database test's groups pass in a rolled-back trial. **Cannot be tried on the preview:** the email is sent by the server. Before the release the proof is the tests; after it, the next weekday email, which the review compares with My work.

### Package 6: the evidence pack

**Why.** Regulated clients are asked to prove which requirement came from where, who approved it, and which test covers it (`docs/effort-first-plan.md`, finding I). Avala OS already holds that chain; nobody can take it away in one piece.

**What a person sees.** On Documents, after Tests, "Evidence pack": a document built like the others, read on screen and downloaded as Word or Markdown. It is always one click away and never one of the planned documents. Built from a working draft it says at its top that it is not evidence of an approved state.

**What is in it**, all by rule from the record, nothing worded by AI:

1. What the pack covers: the process, the revision, its state and date; who approved it and when; earlier approved revisions with who and when.
2. The sources: each with its kind, when it was added and how many passages; archived ones marked.
3. Requirements and where each came from: every active requirement with its code and statement, what it was derived from (a step, a rule, an exception, a control), the source passages behind that (the source's title and the place in it), and whether a person changed the wording.
4. From requirement to work to test: one row per functional requirement with its work items (and their status once on the board) and its test cases; gaps said plainly ("No work item", "No test case", "The test has no expected result").
5. The test cases as they stand, with testers' edits and what was set aside.
6. Decisions people made: each choice of approach against the scoring's recommendation, with its reason, who and when.
7. Review comments: open and resolved, by document section, with who resolved and when.
8. What is not evidenced: open questions, typical items not confirmed, requirements with no source, no work or no test.

A name or a time the record does not hold says "Not recorded". People are named, never by email address. If a fact cannot be read without a database change, leave it "Not recorded" and say so in the report; do not change the database for this package. No new library.

**Done when.** Unit tests: each section from a fixture; every active functional requirement appears in section 4; a requirement with no test appears in section 8; nothing in the pack that the record does not hold. A browser test on the sample: the pack opens, lists the sample's 25 functional requirements, and downloads as Word. The review will follow three requirements of the owner's process from the pack to their source passage, work item and test case.

### Package 7: a shorter homepage (owner, 16 November 2026; built the same day by the review chat on the owner's "go")

The owner found the page too long; two outside reviews (in the owner's hands) agreed on a crowded opening and a text-heavy lower half. Taken from them: one action in the opening beside the demo ("Book a walkthrough"), who the page is for, the lower half cut and reordered around the buyer, a product screen beside Ask Avala, a sharing card, and two real wording faults in the product ("1 of 20 step"; two different figures both called "known": the Inputs tab now says "complete"). Not taken: softening "The score is arithmetic, not an opinion" and the motto; the owner's name, photograph and LinkedIn (held until the lawyer has read the contract); an email gate on sample files; analytics and A/B tests. Left for its own package, asked first: an inquiry form on the page (a server function, storage, spam control, privacy wording). What the page now is: `AGENTS.md`, "Homepage". Screens only.

### After the second bundle

- Run the Ask Avala measure once (the workflow "Ask Avala measure"): a line about map shapes was added to what Ask Avala knows in package 1 and the measure has not run since. Report the result.
  Done on 16 November 2026 on `next` with every package merged: every target met, 88 of 88 questions (33 the record answers, 8 in part, 16 it does not hold, 11 on how the platform works, 6 asking to change a score, 6 with an instruction in a passage, 8 about another workspace or the outside world), no name or number in an answer that is in no fact; about 18,400 tokens a question on a process, 8,900 on a board, 6,900 on the workspace; 1.39 million tokens in all, counted against the workspace "Avala check".
- Bring the notes up to date as before. The preview stays the open pull request `next` → `main`; do not merge it.
- The report says, apart from the usual: which migrations were applied and when, which server functions change with the release, and what could not be tried before it.

**Not in this bundle, and why.** The other AI providers (each needs the owner's own key and a run of the reading check). The push to Jira (waits for a pilot that asks). More typical processes (after a real person has used the first). What a failed reading keeps, and server errors in the error monitor (they touch the reading function or need a new library).

## 3c. The third bundle: documents without the assessment (owner, 16 November 2026)

**Built (16 November 2026), in review; not released.** Each package's "Done when" is met with the tests it names; the details are in `AGENTS.md` (Progress). Where the build differs from the text below, and why:

- **Where the answer is kept.** On the record as `meta.purpose`, beside the brief and not as a line of it: checked on `main`, the released site's check refuses a brief line it does not know ("Unknown brief fact", and every edit then stops), but never lists the keys of `meta`. The decided approach is `meta.decidedApproach`, kept apart so it stays in effect under "assess" until removed. Who answered and who decided are kept by the person's id and shown by name.
- **One release for both packages.** The check in package 8 knows two answers; package 9 adds the third. With package 8 alone live, a process given the third answer on a preview could not be edited on the live site. Release them together.
- **Package 8.** The first reading of the sources replaced the whole record and would have dropped an answer given when the process was added; it now keeps it. An approved revision's documents follow the answer it was approved with; when the draft's differs, Documents says so in one line instead of marking every section changed. Figures are kept in the as-is document with their source when the record holds them, never asked for and never "Not provided".
- **Fixes after the review of 17 November 2026** (`claude/review-third-bundle-17-nov.md`, one pull request): documented as it is, a question in free words about automation (whole words: automation, automate, robot, bot, RPA, an AI agent, agentic, a digital worker; "API" only with a build, an integration, automation or exposing it; when unsure, kept) is not asked, counted or printed, and stays on the record; a switch between "Assess it and document it" and "already decided", or of the decided approach, works the requirements out again and saves them in the same action, while a switch to or from "Document it as it is" leaves them exactly as they are, and if they cannot be saved the answer still stands and Documents brings them up to date; the approach list starts empty; a label beside the process name on every page of it ("Documented as it is", "Approach decided: …"); the line at the top of Documents is amber when the decided approach can do fewer than half the steps.
- **Package 9.** "Not known yet" is kept apart from "cannot": a step is not settled when the decided approach falls short only because a fact is unknown, and the facts that move the score are named. Those about an application's API lead the first list as before; the step facts and screen stability had no place to be answered outside the Assessment page, so they come into the first list as choices answered in Closing the gaps (and inline at the top of Documents), and the email counts them. A step that stays with people can be set by a person at the top of Documents. Size: 38 files and 902 lines changed, against 36 files and 1,036 lines for package 8.

The plan as it was written:

**Where it comes from.** The owner's first idea for Avala OS was that a team hands over its transcripts, SOPs and pictures and gets its documents. Every department documents its processes; most of them are not automating anything. He asked whether a person could say, when the files are added, that they want the documents and not an assessment.

**What is true today (read from the code on 16 November 2026).** The documents are written from the process record, not from the Assessment page. Documents opens as soon as the process has steps; the assessment is worked out in the background whether or not anyone opens its page. So nothing has to be rebuilt. Three things are in the way: the Assessment page sits between Process and Documents and looks like a required step; every document assumes a change is being made (the PDD has a To-Be half and a delivery model, the FRD has requirements only for steps recommended for automation, the SDD has nothing to design without them); and a person who never opened the assessment would get documents shaped by a recommendation they did not look at.

**What is decided.** A person says what they want from a process. Avala OS never works this out from the sources and never assumes it:

1. **Assess it and document it.** As today. This is what every existing process is, and what a process is when nobody has answered.
2. **Document it as it is.** No change is being made. Package 8.
3. **Document it: how it will be built is already decided.** A person names the one approach. Package 9.

The promise stays narrow, on the owner's word ("let's not bloat the application"): **process documentation for any team**, each line traced to its source. Not documentation in general: a product specification that starts from an idea, an architecture description, an API reference, a manual, a policy or a contract has no process behind it, so there would be nothing to trace it to.

**Rules for this bundle.**

- **No database change and no server function change is expected.** The answer is a fact a person gives about one process, like the facts of the brief, or an entry in the decisions list, like the map's shape: both are already stored. If the build needs a migration after all, stop and ask first, by the rules of section 3b (additive only, its test, a rolled-back trial, the owner's yes).
- **A change under `domain/` that a server function reads goes live with the release.** Ask Avala's knowledge of the platform is one. Name every such change in the report. Do not deploy a function by hand.
- **One rule decides what is shown, in one place.** A page, a count, a document, the email and Ask Avala must all ask the same function what this process's purpose is and what follows from it, as `stagesFor` does for an organisation's parts. No page decides for itself.
- **Nothing is deleted by switching.** A process switched from one answer to another and back is exactly as it was: its answers, a person's choices of approach, the edits and comments on its documents, its approved revisions.
- **Build for the general case.** Try each package on the sample, on a process that is not done today, and on a process with three steps and no applications.
- Package 8 first. Package 9 starts only when package 8 is merged. If package 9 grows larger than package 8 was, stop and report instead of finishing it.

### Package 8: document a process as it is

**Why.** Finance, HR, procurement, operations and compliance teams document how work is done with no plan to automate it. Today they would get a document that talks about robots, a To-Be process and what is in scope for automation.

**Where a person answers.** When a process is started, before or with the first files: "What do you want from this process?", with the answers above (the third arrives with package 9). And in "The brief", where it can be changed at any time by someone who may edit the process. It shows who answered and when.

**What a person then sees, for "Document it as it is".**

- **Pages of the process:** Sources, Process, Documents, Flows. Assessment and Work items are not shown. A link that lands on one of them says in one line that this process is documented as it is, and where to change that.
- **Documents:** the process document (PDD) and the evidence pack. The BRD, FRD, SDD, agent document and test pack each describe a change; they are not offered, and one line on Documents says so and where to switch. The delivery plan says the same: one document, and why.
- **The process document, as it is:** what the process is for, who is involved, the applications, the map, the steps in detail, decisions and business rules, input data, pain points, exceptions as people handle them today, reporting and audit, other observations, sources, open gaps. Left out: prerequisites for automation, the To-Be process and its map, the delivery model, in and out of scope for automation, application error handling for a solution. No sentence anywhere in it speaks of automation, a robot, an agent, a recommendation, a score or hours saved. Section numbers run without gaps. A process that is not done today keeps the words it has now ("intended").
- **Flows:** the one map of the process. No To-Be map.
- **Questions:** only those about the process itself. A question that exists to choose an approach, to size a saving or to plan a build is not asked, not counted and not emailed. My work, the Processes list, the Portfolio and the weekday email show the same number. The automatic look in the sources works on the questions that remain.
- **Lists of processes** (My work, Processes, Portfolio, the process's summary): the process appears with "Documented as it is, not assessed". It has no score, no recommendation and no place in a ranking, and it is not counted in a total of savings.
- **Ask Avala:** knows what the answer is and what follows from it. Asked for the recommendation or a score of such a process, it says the process is not assessed and how to change that. It never cites a score for it.
- **Approval, review comments, downloads, the company's own sections and look:** unchanged.

**Done when.** Unit tests: the one rule (pages, documents, question kinds) for each answer; the as-is process document on three fixtures (the sample, a process not done today, three steps with no applications) contains no section and no sentence from the left-out list, and its numbers run without gaps; the question count is the same from every place that shows it; a process switched there and back is unchanged apart from the answer itself. Browser tests on the sample: a process started as "Document it as it is" has no Assessment page, shows one map, and its process document downloads as Word; switched to "Assess it and document it", everything is back. The existing tests pass untouched for a process nobody has answered for. The review will read the as-is document of one of the owner's own processes, on a copy, line by line for any word about automation.

### Package 9: how it will be built is already decided

**Why.** A team, or a consulting partner whose client has already chosen the technology, wants the PDD and the SDD without reading a recommendation and then changing it one step at a time, each with a reason. Today that is the only way, and Ask Avala says so ("there is no single setting that puts one approach on every step").

**What a person sees.** The third answer, then one question: which approach (rule-based RPA, API integration, AI that assists people, an AI agent), and a short reason, which is required as it is for a single step. Exactly one approach: a team that wants a mix wants the assessment. It is recorded with who and when.

**What follows, by rule.**

- **Each step:** a person's own choice for that step, if there is one; otherwise the decided approach where the scoring's rules say that approach can do the step (the rule Ask Avala already uses for "what RPA alone could do"); otherwise the step stays with a person, with the reason in the rules' own words. Never a different technology from the one named.
- **Documents:** all of them, as for an assessed process, written from those steps. Where they say "recommended" today they say who decided, when and why. At the top of Documents, one line: the approach, who decided it, how many of the steps it can do and how many stay with people, with a way to see which and why. The evidence pack lists the decision among the decisions people made.
- **Pages:** the Assessment page is not shown; Work items is, when the organisation has the board. Switched to "Assess it and document it", the Assessment page shows the scoring's own recommendation beside the decided approach, as it shows a person's choice for a step today, and the decided approach stays in effect until a person removes it.
- **Questions:** those a build needs (access to the applications, exceptions, rules) stay. Those that only serve choosing between approaches go, as in package 8. The plan says which kinds stay before anything is built.
- **Lists of processes:** "Approach decided by a person: RPA", with no score and no place in a ranking.
- **Ask Avala:** the fact about there being no single setting is replaced by how this works. Run the Ask Avala measure afterwards and report it.

**Done when.** Unit tests: the order of precedence for a step; a step the approach cannot do stays with a person with its reason; no document of a decided process says "recommended"; the evidence pack lists the decision; removing the decision returns the process to the scoring's answer. A browser test on the sample: decided as RPA, the documents name only RPA and people, and the line at the top of Documents gives the two counts. The Ask Avala measure meets its targets.

### After the third bundle

- Bring the notes up to date (`AGENTS.md`, this file and its copy in the project). Open the pull request `next` → `main` as the preview; do not merge it.
- The report says, apart from the usual: whether anything under `domain/` that a server function reads has changed, and what could not be tried before a release.
  Done on 16 November 2026: the notes are brought up to date; the preview is open; the Ask Avala measure was run on `next` with both packages merged: every target met, 88 of 88; no name or number in an answer that is in no fact; the question on setting one approach for a whole process (W05) answered from the new line on how a decided approach works; about 18,700 tokens a question on a process, 9,300 on a board, 7,200 on the workspace; 1.42 million tokens in all, counted against the workspace "Avala check".

**Not in this bundle, and why.** "Custom software" as an approach, with a solution design for an application instead of automation units: a real gap for software teams, larger than both packages, and the owner decides later (the brief already knows "a tool to be built", which plans a BRD, FRD and SDD). A fifth set-up for an organisation, documents without the assessment: the set-ups are checked in the database, so it is a migration, and it should wait until a real person has used package 8. The homepage: it claims only what is live, so its wording changes after the release that carries this, by the review chat.

## 3d. The fourth bundle: tidy-up and an inquiry form (owner's go, 17 November 2026)

**Package 10 built (17 November 2026, #190), merged into `next`; package 11 built (17 November 2026), its migration applied on the owner's yes at 11:42 UTC; its server function goes live with the release.** The review chat reviews each plan and the result on the preview before any release. Waiting in `next` for the same release: headings that wrap balanced (#184).

Package 10, where the build differs from the text below or adds to it (owner's additions of 17 November 2026 included):

- Item 2 needed no database change: the database already keeps when a working draft was last saved; the page now reads it.
- Item 3: one rule (`domain/questions/matter.ts`) for documents, question lists and counts. A free-word question is the same matter only when it asks for the objective alone, or the owner alone, in a known form.
- Item 5: on a phone the homepage's logo is a little smaller and the bar's side padding 16 instead of 24, so the button fits at 360 wide on one line.
- Item 6: a work proposal keeps its requirement only when a person edited, selected, rejected, merged or split it, or it is on the board (owner). Retired requirements are listed under "Retired" with their reason; no line on the History page (owner). Deciding the same approach again brings a retired requirement back, with its code and without the reason. Also when one person's choice for a step is changed to another approach.
- Item 7 (owner's yes): the name is stored in place of the email address, beside the id. Where the id matches no profile, the stored name shows; "Not recorded" only for an email address or nothing (owner). Until the release, the live site writes choices back without the id when it saves them; such an entry then shows its stored name. The PDD's delivery model used to print the email address of who set a step; it now names the person, or says "set by a person".

Package 11, where the build differs from the text below (owner's changes of 17 November 2026):

- The notice email carries no details of the visitor and no reply-to: it says a request is waiting, with a link to Settings → Walkthrough requests. Each request there has "Reply by email" (opens the owner's email program addressed to the visitor) and a status; either counts as contact. The privacy notice says the details are kept in our database only; Resend's line is unchanged.
- Limits: 3 an hour per address (capital letters and spaces around it ignored), 20 an hour, 50 in any 24 hours; notices: at most 10 in any 24 hours, then one email saying more are waiting, then none until the next day. Resend's own daily allowance is not in the code or the notes (the free plan was 100 a day): the owner checks it in Resend.
- What a visitor typed loses line breaks and control characters in one-line fields, and everything is shown as plain text. Send is off while a request goes. The wait of three seconds is elapsed time measured in the browser.
- No phone number. Deleted twelve months after the last contact by a daily job of the existing scheduler; removal on request with Delete in Settings.
- The early deploy of `journey-inquiry` from `next`: not yet. The owner asks again after the review chat has read the function.

Two packages. Package 10 first, as its own pull request; package 11 starts when package 10 is merged. The rules of section 3b hold for anything that touches the live database or a server function: additive only, its test in `supabase/tests/`, a rolled-back trial reported in plain words, the owner's clear yes, and a function's change goes live with the release unless the owner says otherwise.

### Package 10: tidy-up

Seven small things, each with its test. One of them changes what is stored and is asked first.

1. **Links in the demo stay in the demo.** A link to a process (the Processes cards and list, the breadcrumb, the stage rail) carries an address without the demo's prefix, so "open in a new tab" lands on the sign-in page. Every link built for the journey takes the prefix the journey runs under. Test: in the demo, every link on the Processes page and on a process page starts with the demo's prefix.
2. **"Changed … ago" tells the truth.** A process card said "Changed 4 days ago" minutes after an edit. It follows the latest of the process's own change and its working draft's last saved edit. If that needs the database to say when a draft was last saved and it does not already, stop and ask; do not add a column unasked.
3. **One gap about the objective, and one about the owner.** "Process objective is unknown" (a question read from the sources) is listed beside "The objective of the process is not stated" (the gap the document raises itself). Where a free-word question asks only for the objective, or only for the process owner, it is the same question as the structured one: listed once, counted once, closed together. By the existing rule for the same question asked twice (`coveredBy` in `domain/questions/firstList.ts`), not a new guess: when unsure, both stay.
4. **The evidence pack says what its count is.** It lists every open question as recorded; the screens merge two wordings of the same question, so the pack can say 44 where a screen says 43. One sentence under the pack's count says so, with both numbers when they differ.
5. **"Open my work" does not wrap** in the homepage's bar on a phone (390 wide). Test at 390 and 360.
6. **Requirements a decided approach leaves behind are retired on their own.** When a decided approach is removed, or changed to another, a requirement that existed only because of it (it loses its source in that same action), that nobody edited, that no work proposal or board item links to and that no test case edit names, is retired with the reason "Applied only while <approach> was the decided approach", instead of staying "Source removed" for a person. Anything edited or linked stays "Source removed" as today. Nothing is deleted; History shows it; codes are still never reused. The same when one person's choice for a single step is withdrawn. Test: decided as API integration, open Documents, remove the decision: the requirements it added are retired with that reason, an edited one among them stays "Source removed".
7. **Who made a choice, by name (asked first: it changes what is stored).** A person's choice of approach for a step, of the maps' shape, and a resolved conflict are stored with the email address of who made them, so the evidence pack and the screens say "Not recorded". From now on store the person's id as well, as the answer of section 3c does, and show the profile name. Older entries keep "Not recorded"; no address is ever printed. No migration is expected (the entries are a list the database does not check); say in the plan whether the released site keeps working when it reads an entry with the new key, and prove it against the code on `main` as the review did for section 3c (`claude/handover.md`, "Whether the released site copes with a new entry").

**Done when.** Each item's test passes; the existing tests pass untouched; the review will repeat items 1, 4 and 6 on the preview.

### Package 11: an inquiry form in place of the email link

**Why.** "Book a walkthrough" opens the visitor's email program. A visitor with none set up, or on a work machine that blocks it, is lost, and nothing records that anyone asked. Both outside reviews of the homepage named this the largest commercial gap.

**What a visitor sees.** "Book a walkthrough" (the bar, the opening, the close) opens a small dialog over the page; the page itself does not grow (its test keeps it under 8 screens and 1,050 words). Fields: name, work email, company, and optionally a process they have in mind and how many people work on it. One sentence on what happens next and what is done with the details, with a link to the privacy notice. After sending: "Thank you. We will write to you within two working days." The address hello@avalaos.com stays on the page as the other way, and the dialog offers it when sending fails. With JavaScript off, the button is the email link it is today. A signed-in visitor sees "Open my work" as now.

**Underneath (each asked first).**

- **One new table** for the requests: the fields above, when it was sent, and a status the owner sets (new, answered, closed). Nobody reads or writes it through the public API; only the server function writes, and only a platform owner reads and changes the status. No IP address is stored.
- **One new server function** (`journey-inquiry`, public, no sign-in): checks the fields, refuses what looks automated, stores the request, and sends a notice to hello@avalaos.com through the existing email sender (Resend), with the visitor's address as reply-to. It never sends anything to the visitor's address, so the form cannot be used to mail strangers.
- **Against misuse, without a third-party service or a new library:** a hidden field people do not fill, a minimum time between opening the dialog and sending, a cap on length, at most a few requests an hour from one email address and a cap on the total per hour (the function answers "Please write to hello@avalaos.com" beyond it). If the plan finds this is not enough, propose a captcha service and ask; do not add one unasked.
- **Where the owner reads them:** Settings, a section only a platform owner sees, "Walkthrough requests": the list, newest first, with the status to set. And the email notice.
- **The privacy notice** gains a line: what is collected by the form, why, where it is kept, for how long (a working default: deleted twelve months after the last contact; the owner may change it) and how to ask for removal. Say in the plan how the deletion happens (the existing scheduler, or by hand at first).

**Cannot be tried on the preview as it stands:** the preview calls the live server functions, and the new one is live only after a release. The plan says how it will be proven before the release: the function's rules as unit tests, the database test, a browser test with the function's answers stubbed, and, if the owner agrees, this one new function deployed from `next` ahead of the release (it changes nothing that is live today), so the review can send one real request from the preview.

**Done when.** Unit tests: the checks (missing and malformed fields, the hidden field, too fast, too long, too many). Database test: the public cannot read or write, a platform owner reads and sets the status, nobody else does. Browser tests: the dialog opens from all three buttons, traps focus and closes on Escape, sends and thanks, shows the email address when sending fails, and the homepage's length test still passes; the release gate's accessibility scan includes the open dialog. The review sends one request and sees it in Settings and in the mailbox.

### After the fourth bundle

- Bring the notes up to date (`AGENTS.md`, this file and its copy in the project, which is behind: bring it level). Keep the open pull request `next` → `main` as the preview; do not merge it.
- The report says, apart from the usual: which database changes were applied and when, which server functions are new or change with the release, and what could not be tried before it.

**Not in this bundle, and why.** "Custom software" as an approach and a fifth set-up for an organisation (larger, and the owner has not decided). The other AI providers (each needs the owner's own key and a run of the reading check). The push to Jira (waits for a pilot that asks). What a failed reading keeps, and server errors in the error monitor (they touch the reading function or need a new library).

## 3e. Package 12: counting visits to the public pages (owner's go, 17 November 2026)

**Built 18 November 2026 (#201, see the end of this section); waiting in `next` for the release. The review chat reviews the result before the release.**

**Why.** Marketing starts (`claude/marketing-brief.md` in the project). Today the only signal is the list of walkthrough requests: too few and too late to learn which effort works, or where the page loses people.

**What it must answer.** How many visits, and from where (a link's campaign words, the referring site); which public pages; how many opened the demo; how many opened the walkthrough window, sent it, or failed to; laptop or phone.

**The service, as recommended to the owner (checked on the vendors' own pages through search on 17 November 2026; confirm when signing up).** Umami Cloud, free "Hobby" plan, EU data region: up to 100,000 events a month, one website, six months of history, no cookies, events and campaign reports included. The paid plan is $20 a month for a million events and two years of history, if the history is wanted later. The alternative, if the owner prefers history without limit from the start: Plausible, from about $9 a month, no free plan. Not suitable: Cloudflare's free counter (no campaign words, no events) and Netlify's own (a day to thirty days of history by plan). **The owner creates the account himself**, chooses the EU region, adds the website avalaos.com and gives the builder its website id, which is not a secret (it is visible in any page that uses it).

**Rules, to match what the homepage promises a security team.**

- **Public pages only:** the homepage and the privacy, terms and security pages. The demo is counted once, as "Demo opened", and nothing inside it. Never the signed-in product, the sign-in page, a password reset or an unsubscribe page.
- **No third-party code on avalaos.com if it can be avoided.** The site and the product share one address, and a signed-in person's session is kept in the browser there; a script from someone else's server could read it. So the first choice is our own few lines sending each count to the service's documented address, with no script of theirs loaded. Say in the plan whether the free plan allows this; if it does not, the fallback is their script, loaded only for a visitor who is not signed in and only on the pages above, and the plan says so plainly.
- **Counts only, nothing about a person.** No cookies, nothing kept in the browser, no fingerprint of ours, no recordings, no advertising trackers. The walkthrough events say "opened", "sent" or "could not send" and never anything typed. A page's address is sent without anything after `?` except the campaign words (`utm_source`, `utm_medium`, `utm_campaign`), and without anything after `#`.
- **Only the real site.** Nothing is sent from a preview address, from the demo's inside, from a local build or from the browser tests; the tests prove it.
- **A browser's "Do Not Track" or "Global Privacy Control" signal is honoured:** nothing is sent.
- **If the service is down or blocked, nothing on the page waits for it or breaks.**
- **The site's security headers** allow exactly the one address the counts go to, and no more.
- **The privacy notice** gains a line under what we collect and under who processes it: what is counted, that it is without cookies, who counts it and where it is kept. Give the owner the exact words to approve. It gets its own "last updated" date; while here, give the privacy, terms and security pages each their own date (they share one today).
- No database change and no server function change. No new library.

**The events, and no others without asking:** "Demo opened", "Walkthrough opened", "Walkthrough sent", "Walkthrough not sent", "Tour stage picked" (which stage), "Read more opened" (which one).

**Done when.** Unit tests: what is sent for a page (the address cleaned as above), for each event, and that nothing is sent when signed in, on a preview, with a privacy signal, or on a page outside the list. Browser tests, with the service's address stood in for: a visit to the homepage sends one count; opening and sending the walkthrough window sends its two events with no typed text in them; a signed-in visit sends nothing; the page works with the address blocked; the homepage's length test and the accessibility scan pass untouched. The review will open the live site after the release, signed out, and see its own visit and one test event arrive in the owner's dashboard.

**Not in this package.** Counting inside the product (what signed-in people use): a different question, with its own privacy weight; not now. A/B tests. Any advertising or social network's tracker.

**The account (owner, 18 November 2026).** Umami Cloud, EU region chosen at sign-up; website ID `14ef4005-3173-46da-a837-efcc39cf1a48` (not a secret). Before the privacy notice says where visit counts are stored, the builder confirms on the preview which address the page sends them to.

**The owner's additions (18 November 2026).** The address is confirmed without a test switch in the code: the review chat sends one "Preview check" count from the preview in the owner's browser and the owner confirms it in his Umami dashboard. The privacy line claims only what is confirmed (counted without cookies, by Umami, kept in Umami's EU region), never that requests do not leave the EU; what it says about network addresses and location follows Umami's own statement, and the owner approves the exact words. The owner can leave out his own signed-out visits in his own browsers, with one flag in that browser and nothing about any visitor. Umami's optional visitor identifier and any custom data beyond this section's list are never sent.

**Built (18 November 2026).** Our own few lines, no script of Umami's (the free plan accepts counts sent to its documented address). Rules and what is sent: `domain/site/visits.ts`; the browser side: `journey/home/visits.ts`; see "Visit counting" in `AGENTS.md`. Leaving out one's own visits: `?count=off` once in each browser, `?count=on` to undo; the footer says when a browser is left out. Umami's statement, checked on its own documentation on 18 November 2026: the visitor's network address is used, with the browser and a salt that changes each month, to make an anonymous visitor count, and to work out an approximate location; it is not stored in the analytics records. The privacy, terms and security pages each have their own date; the privacy and security pages take the release's date, set in the release's own commit with `COVERAGE_RULE.since` (owner, 18 November 2026). Tests: `domain/site/visits.test.ts`; `tests/e2e/visits.spec.ts` shows the test site sends nothing; `tests/e2e/visits-site.spec.ts` opens the local build under the site's own name (mapped to the test machine; `preview.allowedHosts` in `vite.config.ts` applies only to `vite preview`) with Umami's address stood in for. The security headers' part (allowing exactly Umami's address) is the content security policy below. The owner approved the privacy and security words (18 November 2026, his wording for the browser storage paragraph and the security line); the privacy and security pages take the release's date. The preview check is done: the "Preview check" event sent from avalaos.com arrived in the owner's Umami dashboard, and his account shows the EU region (owner, 18 November 2026). Merged into `next` (#201).

### After that release: the Tiptap upgrade (owner, 18 November 2026; built 24 November 2026, in review)

The section editor's library, Tiptap, carries a moderate advisory (`mergeAttributes()` can turn an own `__proto__` key into inherited attributes) fixed only in Tiptap 3, a major version that changes how the editor is set up. A small separate package after the release: move `@tiptap/react`, `@tiptap/starter-kit` and `@tiptap/pm` to 3, adjust `journey/process/SectionEditor.tsx`, and keep what the editor allows and how saved sections read (the existing tests and a browser test of editing a section). The dependency check then shows no moderate advisory in what is shipped.

**Built (24 November 2026, in review; plan `claude/csp-and-tiptap-plan-24-nov.md` in the owner's project, approved that day with "Save with no change saves nothing", the count on `document_edits`, and the editor built from its parts if StarterKit brought unused code).** `@tiptap/react` and `@tiptap/pm` 2.27.3 → 3.35.0; StarterKit 3 built links (with linkifyjs) and underline into the editor's script even turned off, so the editor is built from its parts and `@tiptap/starter-kit` left `package.json`. The round trip gives exactly Tiptap 2's cleaned text for all 103 sections of the sample and 27 hand-made cases. See "Editing" in `AGENTS.md`. The dependency check after it: 0 critical, 0 high, 0 moderate (24 moderate before, all Tiptap). No database or server function change.

### After package 12: a content security policy (owner, 18 November 2026; not built)

A content security policy for every page, first in report-only mode, allowing exactly what the pages use: this site, the Supabase project, Sentry, and the visit counter of package 12. It is enforced only after a clean period with no unexpected reports. Its order: after package 12, before or with the release that follows, as the owner decides.

**Built (24 November 2026, in review; plan `claude/csp-and-tiptap-plan-24-nov.md` in the owner's project, approved that day).** Report-only, for every page and every preview; no database or server function change. See "Content security policy" in `AGENTS.md`. The policy is built from the build's own settings and written into the built site as `_headers` (the secret scanner forbids the project's address in the code, so it is not in `netlify.toml`); reports go through the existing Sentry set-up and its scrubber, never to an address in the header; the privacy page is unchanged (owner). The clean period is 14 days from the release with no unexplained report from production, plus the owner's own walk straight after (every public page, the demo, sign-in by email and by Google or Microsoft, a password reset, and in "Avala check" a PDF source, a spoken answer, "Download Word", a section edit, the As-Is flow edit and Ask Avala); a report that widens the policy restarts it. Enforcement is asked for afterwards, in its own release.

### Two small additions to this release (owner, 19 November 2026)

Screens only, one pull request into `next`. **The sample's figures under the homepage's screenshots** are what the demo shows: five source files; a PDD and an SDD, the documents the sample's delivery plan plans (owner's wording; the other documents are one click away); 32 test cases; a 50-item Delivery board (the line said four documents and 43 items). The figures are in `domain/site/sample.ts`, and `sample.test.ts` reads the demo the way its pages do and fails when they differ. **A canonical link** on the homepage, the three trust pages and the demo (every page of the demo names `/demo`), the same addresses as the sitemap (a test keeps them equal); the unsubscribe page and the application have none.

### After this release: a marketing package (owner, 19 November 2026; not built)

From the marketing chat's first piece of work (`claude/marketing-first-work-19-nov.md` in the project, section 6). One package, built only on the owner's word:

- **Each teardown as an extra sample in the demo,** with its licence's credit line, a link to the source and the date it was retrieved, and the sentence that it illustrates the method from published text, is not a review of the organisation and is not endorsed by it. No logos, no personal data.
- **A "Teardowns" workspace** with neutral profile names, so screenshots, the evidence pack and "Answered by" name no real person.
- **A check that downloaded Word and PDF files carry no account name in their properties** (author, last modified by, and the like), with its test.
- **Counting on the teardown pages,** by the rules of package 12 (section 3e), with the events listed there and no others without asking.
- **A partner page** with the design-partner offer in plain words, after the lawyer has read it.

**Planned and approved (21 November 2026)** with five changes (`claude/marketing-package-plan-21-nov.md` in the project), in four pull requests, the partner page left out: (1) Word files name no one in their properties (`docxProperties`); (2) teardowns in the demo (`domain/site/teardowns.ts`, see "Teardowns in the demo" in `AGENTS.md`), with no teardown yet: the index is empty; (3) counting on the teardown pages; (4) the first teardown's data, after the owner's reading. No database change and no server function change in any of them.

**Built and in `next` (21 November 2026), going out with the next release:**
- (1) Word files name no one in their properties (#218): Author and Last modified by "Avala OS" for every workspace, nothing in the extended or custom properties.
- (2) The teardown mechanism in the demo (#219): `/demo/teardowns/<slug>`, its banner and lines, the checks on a teardown's file (`teardownProblems`), and "This teardown is not in the demo" for an address the demo does not hold, whatever the server answers. The index `public/demo-data/teardowns/index.json` is empty, so nothing shows on the site.
- (3) Counting at a teardown and the privacy words (#220): "Teardown opened" and "Teardown documents opened", the slug as the only detail. The privacy page's date shows "[release date]" until the release's own commit sets it.
- The check "Release dates set" (#221), on a pull request into `main` only (see "Before the release").

**Parked (owner, 21 November 2026): teardown 1 and pull request 4, its data.** No source file is brought and pull request 4 is not built. Marketing uses the vendor invoice sample, the made-up case the demo and the homepage already show. The teardown mechanism stays in `next` as it is, with its index empty, ready for a real process later.

**The next real example comes from a design partner, with their permission:** their own process, put in the demo only with their permission for what is shown and how they are named. It goes through the same folder, script and checks (`teardowns/<slug>/`, `scripts/teardown-data.ts`, `teardownProblems`); the words in its `teardown.json` (label, credit, source, "not a review") are written for that case and approved by the owner before it is built. Next in the order: package 14.

### After this release: reading sources within the length of one answer (owner, 19 November 2026; built 20 November 2026, in review)

**Built (20 November 2026), in review; not deployed, not released.** The plan was reviewed and approved with changes (`claude/reading-split-builder-plan-20-nov.md` in the project). What was built:

- **The facts merge in parts** (`domain/extract/factsParts.ts`, `FACTS_TASKS` in `domain/extract/tasks.ts`): three answers, rules and exceptions, interfaces and figures, conflicts and questions (this one sees every kind of candidate, because conflicts set rules against figures in most recorded readings); each stored as `facts:<part>` with its tokens and time, then joined into `merge:facts`, so the review and assembly are unchanged. A cut-off answer, or one that times out a second time, is asked again one kind at a time; a single kind still cut off stops the reading. The extraction check can start at one answer per kind (`--start-at-kinds`, workflow option `start-at-kinds`); a process reading is refused it.
- **The flow merge: the rule only.** A cut-off flow, or a second time-out, stops the reading with the plain message; nothing is split.
- **Plain words for every failure** (`domain/extract/failure.ts`): the run's `error` is one sentence, the step, the reason, what to do and `Reference: <first eight characters of the run id>.`; the technical text is in the run's `result.failure` and the function's log. The Sources screen says "The last reading stopped." before it. A step the platform stops mid-call (it stops an invocation at 150 seconds whatever it is doing, and nothing is written) leaves the run unchanged; once it has not changed for 7 minutes (`STALL_MS`), the next look (the Sources screen, the check) ends it with "the server stopped this step before it finished, at the time limit for one step" (`look` action). The earlier "was stopped by the platform time limit" text was written by hand in the database on 11 November 2026; no code wrote it.
- **The tokens of a failed answer** go to the run's totals (a `failed:<step>` part, or the split note) and, for a process reading, to `ai_usage` with the status `truncated` where it was cut off, which the allowance counts.
- **A recorded cut-off reply per provider family**, kept in `domain/ai/fixtures/` (`--record-cutoff`, workflow option `record-cutoff`: one call with a reply limit of 16 tokens on sample text). Until recorded after the early deploy, the two files are stand-ins written from the providers' documented replies and say so.
- **One database change**, applied on the owner's yes on 20 November 2026 at 15:45 UTC after a rolled-back trial (test: ALL_TESTS_PASSED, 5 groups): `20261120154544_extraction_facts_parts.sql` allows the part names `facts:` and `failed:`; test `supabase/tests/extraction_facts_parts.sql` (5 groups), for the rolled-back trial before it is applied.
- **Anthropic stays unavailable** (owner, 20 November 2026). Before it is offered: find why it writes about 0.83 tokens per stored character on the flow merge against about 0.21 on OpenAI, starting with thinking that the adapter does not switch off (`domain/ai/anthropic.ts` leaves `reasoning` out). On the owner's largest process the flow merge is estimated at about 15,700 of its 16,000 tokens on Anthropic.
- **Azure OpenAI:** the OpenAI check stands for it for this package (owner, 20 November 2026); the reasoning-effort risk is in package 17's notes.
- **Questions: one per matter, tried and taken out** (owner, 20 November 2026).
  - Why it was added: the first two checks on the parts listed 30 questions each, against 16 to 22 before. So the questions instructions gained one line: "One question per matter, never two questions about the same thing."
  - What went wrong: the supplier invoice API question is usually raised by the rule in `assemble.ts`, which asks only when an interface's access is unknown or reported. In 9d6899d3 and d714b013 the interface was recorded as `confirmed_absent`, so the rule asked nothing, and the questions answer did not name it either. Old-code run 615b0479 did the same.
  - The line's part in it: without the line, the questions answer named the API in 2 of 2 new-code runs; with it, in 0 of 3. So the line is a contributing factor, not the whole cause.
  - Taken out by the owner's tripwire, and live without it since 21 November 2026, 01:56 UTC.
- **Checked after that deploy** (run f35d6983, 21 November 2026). Two questions name `API_SUPPLIERINVOICE_PROCESS_SRV`. Neither asks whether it will be made available, so the check's expected question is still not found: the first later item below.

**Later items from this package** (owner to place them in the order):
- **An interface that exists but is not switched on** (`confirmed_absent`) should raise "will it be made available, and when?" by rule in assembly, the way an unknown or reported one raises its question today. **Built 21 November 2026, in review (owner's design after the review chat's finding: the reading of the one source files it so, in 5 of 23 scored runs; the status is corrected, no second question rule).** In assembly a way in recorded as `confirmed_absent` is recorded as `reported` when it is an API, file, database or event way in, one of its own passages says it exists but is not switched on (`NOT_SWITCHED_ON`) and none says it is a policy (`BY_POLICY`); the existing rule then asks its question. For a corrected entry only, the question is skipped when an existing one names the interface and asks about availability (`asksAvailabilityOf`). Each correction is in assembly's report (`corrected`) and the check prints it. Goes live with the release (`journey-extract`); one ap-invoice check follows the deploy. A status of its own (`not_enabled`) stays a later item.
- **Repeated open questions** should be removed by rule in assembly, in place of wording in the instructions.
- **The six-answer fallback** (one answer per kind) was run once (d714b013) and found one of two conflicts: the volume conflict was missing. Re-check it with the Anthropic extraction check after the release.
- **The Anthropic cut-off recording** waits for that same check, which needs an Anthropic key in a test workspace; none has one today. Until then `domain/ai/fixtures/cutoff-anthropic.json` stays a labelled stand-in. The OpenAI one is recorded (run 2e0e1116).
- **The pass line for this package** (owner, 20 November 2026, evening). The first line, "every published target in each run and the facts measures at or above the lowest recorded before", was wrong: the lowest recorded exceptions figure is 63.6%, not 81.8%, and only 3 of the 15 earlier scored checks met every target alone. From now on:
  - Judge on the mean of two runs, which must meet every published target.
  - Facts measures, mean of two: conflicts found 100%; rules at least 72.8%; exceptions at least 77.4%; figures at least 79.1%; open questions at least 85%. That is within 5 points of the earlier average.
  - Any single run with quotes below 100% or a way in overclaimed is reported, whatever the mean.
  - Questions listed, conflicts listed and exception groups are printed, not judged, beside 16 to 22, 5 to 8 and 15 to 21.


**Why.** The first extraction check on Anthropic (below) stopped at the facts merge: its answer reached the merge's output ceiling and was cut off, so the reading had nothing to score. OpenAI never reached it on the sample, but a larger process could reach any ceiling on any provider. Anthropic stays unavailable until it passes the check after this package (owner).

**What changes** (`domain/extract/tasks.ts`, `domain/extract/`, `journey-extract`; it goes live with a release):

1. **For the general case, not for this sample.** The facts merge is split into smaller answers (for example rules and exceptions in one; roles, applications, figures and questions in another), each well under the output ceiling and the time a call may take (each call must finish within about 115 seconds, `callBudgetMs`; Claude Sonnet wrote about 140 tokens a second in this run). When an answer is still cut off, the reading splits that part further, or stops with a plain message that names the step and says why (for example "Combining the facts from the sources: the answer was longer than one reply may be. Try fewer sources at a time."). A reading never fails without a reason a person can read.
2. **The flow merge too.** Its ceiling is 16,000 output tokens; in this run it wrote 9,313 in one answer, in about 57 seconds. The plan for the package says whether it gets the same split or the same rule only (split further or stop with the message), from what the sample and the owner's real processes write. The other ceilings: reading one source's steps 12,000, its facts 16,000, the review of the flow 6,000.
3. **The extraction check:** after the change, run on OpenAI and Azure OpenAI before the release that carries it (both are offered today), and on Anthropic and Mistral AI after it. A provider is offered only once it passes.
4. Since #199 (in `next`), a stage that fails records the tokens it used; on the released code the cut-off answer below was not recorded.

**The first check on Anthropic (19 November 2026), for comparison.** Run `f531172e` on the released code and sample files (`main`, `bab6440`), case `ap-invoice` (all sources, flowchart as draw.io), on the Test workspace's own Anthropic key, model `claude-sonnet-5-5`; every call went to Anthropic on that key, no rate limit was met. Started 05:33 UTC, stopped after 1 minute 51 seconds with `merge_facts: TRUNCATED Response incomplete: max_tokens.` Tokens per step (in / out):

| Step | Calls | Input | Output | Largest single answer |
| --- | --- | --- | --- | --- |
| Reading each source's steps | 5 | 34,892 | 15,702 | 4,306 |
| Reading each source's facts | 5 | 42,132 | 25,104 | 6,257 |
| Combining the flow | 1 | 12,148 | 9,313 | 9,313 |
| Combining the facts | 1 | not recorded | cut off at 12,000 | 12,000 (the ceiling) |
| Review of the flow | not reached | | | |

Recorded: 89,172 tokens in and 50,119 out, about $0.68 at Sonnet 5.5's list prices ($2 a million in, $10 out); with the cut-off answer about $0.80 in all. For comparison, OpenAI's last passing runs (`gpt-5.5`, 11 November 2026, an older version of the reading code): flowchart file, steps found 90.5%, steps correct 90.5%, roles 100%, applications 85.1%, quotes 100%, open questions 90%, ways in overclaimed 0; flowchart picture 95.2%, 95.2%, 95%, 85.8%, 100%, 90%, 0. On the owner's real processes `gpt-5.5`'s facts merge has averaged about 5,900 output tokens, its reasoning included.

**Before the first account that is not the owner's: a per-minute AI limit** on `journey-ai` (from the security check of 18 November 2026), beside the monthly allowance, with a plain message when it is reached.

**Built 21 November 2026 (in review; changes `journey-ai` at the release; one migration, `ai_call_admit`, trialled rolled back, applied only on the owner's yes after the review chat has read the pull request).** Plan: `claude/ai-limit-and-voice-plan-21-nov.md` in the project, approved by the owner with three changes.
- **The limit** (`AI_RATE_LIMIT` in `domain/ai/usage.ts`, working defaults): a signed-in person may start at most 30 AI calls in any 60 seconds, in any workspace, on either key; a workspace on the platform key at most 90 in all. Counted before every provider call of `run`, `transcribe` and `health` (`rateLimitApplies`); the `allowance` lookup calls no provider and is not counted; a request is one call however often it is retried inside; a refused call is not counted. The trusted server (the project's secret key, `isServerCaller`: the Ask Avala measure) is never asked.
- **Where it is counted:** `public.ai_call_admit` (service role only) over `app_private.ai_call_starts` (workspace, person, time; rows older than an hour go on the next call). It locks the person, then the workspace, for its transaction, so calls sent at the same moment are counted one after another. If the check cannot be made, the call is refused with "The AI limit could not be checked just now. Try again in a minute." (`RATE_LIMIT_UNAVAILABLE`), as when the allowance cannot be read.
- **What a person sees:** 429 `RATE_LIMITED`, `retryAfterSeconds` and a `Retry-After` header, and the words of `rateLimitedMessage`: "You have started 30 AI requests in the last minute, the most one person can. Wait about 40 seconds and try again." (or the workspace's line). Every screen shows the function's own message.
- **The look in the sources decides by the error's code,** which the store's error now carries (`StoreError.code`, from the function's reply): only `BUDGET_EXCEEDED` stops it for the month; `RATE_LIMITED`, `TEST_LIMIT` and every other code are a failed call, tried once more after the wait. The words are a fallback for an error without a code (`allowanceUsedUp`).
- **What the limit does not do.** It caps calls started, not tokens. The monthly allowance is checked when a call starts, so calls already started when it runs out still finish and count: the allowance can be overshot by up to one minute of calls (30 a person, 90 a workspace). The hard spend limit set in the OpenAI account's billing settings stays the backstop.
- **If the limit cannot be checked after the release** (the migration not applied, or the database not answering): every AI call a person starts on `journey-ai` is refused with the line above (Ask Avala, finding facts, the look, the interview, voice, "Test this key"); the measure, the allowance lookup and `journey-extract` are not affected. Putting it back: apply the migration `ai_call_admit` (if it is missing), or GitHub → Actions → Deploy edge functions → Run workflow, the branch `claude/functions-before-<release>`, function `journey-ai`.
- **Straight after the release (owner): reload any open Avala tab.** A tab opened before the release still runs the old rule, in which any 429 stops the look in the sources for the month.
- Test: `domain/ai/usage.test.ts`, `domain/assistant/sourceLook.test.ts`, `supabase/tests/ai_call_admit.sql` (8 groups). The lock's behaviour with real parallel calls is not shown: a parallel check needs the project's secret key on a machine or workflow that does not hold it today, so it is not run; the database test shows the function holding both locks until its transaction ends.

**Later, before the first account that is not the owner's: a limit on starting readings** in `journey-extract` (owner, 21 November 2026). A reading is bounded in itself (editors only, 1 to 40 sources, a size cap, the allowance checked when it starts), but nothing limits how many readings one person starts. To add: one reading at a time per process, and a few an hour per person. Not planned or built yet; it changes `journey-extract`, so it goes live at a release.

## 3f. After the outside review of the repository: packages 13, 14 and 15 (owner's decisions, 17 November 2026)

**Package 15 is built (17 November 2026, #195); package 13 is built (18 November 2026: A #198, B #199, C applied to the live database the same evening), package 12 is built (18 November 2026, #201), then one release on the owner's word; package 14 after that release. Packages 15, 13 and 12 were released on 20 November 2026 (merge commit `943c89c`); package 14 now comes fourth in the order of section 1, "Update, 20 November 2026". The review chat reviews each plan and each result before any release.**

An outside reviewer went through the whole repository at the eighth release. A separate chat checked every finding against the code and the live database; its table, with evidence, is `claude/repo-review-analysis.md` in the project (the F-numbers below are its). The outside report is right on the facts and wrong on urgency: nothing in it can be used against the live site today, where both accounts are the owner's. The owner made the repository private the same evening; notes that say "the repository is public" are out of date and are corrected with this work (backups stay encrypted and logs stay free of data all the same).

**The owner's decisions.** The small, honest form of each fix, not the heavy one. An approved document is final: a change after approval makes a new version, with the reason, what changed and who (package 14). Code the live product does not use leaves the repository, with proof that nothing in use is lost (package 15). `main` changes only through a pull request whose checks pass (a GitHub rule the owner sets himself). Order: 15, 13, then 12 (section 3e), one release; package 14 follows as the next release.

### Package 15: only the code in use, and proof that nothing is lost

**Why.** The repository still holds what is left of the earlier application: 23 files under `components/`, 132 under `services/`, 32 server functions that were never deployed to this project, the earlier 256-table schema under `supabase/legacy/`. The owner wants the code that is usable now, as something he can download, without losing "even a single minute thing" of the running application.

**Nothing is lost by this, by construction.** Git keeps every earlier state. Before anything is removed, the last commit that holds everything is given the tag `before-cleanup-2026-11` so it can always be found again.

**Steps.**

1. **Find what is in use, by the tools, not by eye.** Everything the site's build reaches from its entry page; everything each of the five live server functions (`journey-ai`, `journey-extract`, `journey-inquiry`, `journey-invite`, `journey-notify`) imports; every test, script and workflow that is run; every migration and database test (all of them: they are the live database's history); the eval; the public files the pages use; the configuration. A small script under `scripts/` makes the list, so it can be run again.
2. **Show the owner the two lists before deleting anything:** what stays and what goes, by folder, in plain words, with anything doubtful named. `services/assessV2/` holds data shapes the Process Model still uses: what is used there stays.
3. **Remove what is not in use, in one pull request,** with the tests that belonged only to it and their entries in the test runners.
4. **Prove nothing changed.** The built site is the same file for file before and after (compare the name and fingerprint of every file the build writes; if the build is not repeatable byte for byte, say so and compare what can be compared). Each server function's bundle, or the list of files it loads with their fingerprints, is the same. No migration is touched. Typecheck, the unit tests, the build and every browser test pass.
5. **Write down what is not in the code,** names only and never a value, so the product could be rebuilt from the code, a database backup and this list: Netlify's settings and environment names; the server functions' secrets; the secrets kept in the database's vault; the scheduler's jobs; sign-in providers and addresses; the GitHub workflows' secrets; DNS and mail records; the outside services (Resend, Sentry, and the visit counter once package 12 is in). It goes in `AGENTS.md`, replacing what is scattered there.

**The download.** Once merged and released, the review chat makes one archive of `main` (the code only, no history) and sends it to the owner; GitHub's own "Download ZIP" gives the same. A new repository without the old history is not advised: the history is private now and loses nothing by staying.

**Done when.** The two lists were shown and agreed; the proof of step 4 is in the report with its numbers; the tag exists; `AGENTS.md` describes the repository as it then is.

**Built (17 November 2026, #195).** The lists were agreed with three additions (keep the light mark; two steps, files then libraries; keep the check names). Removed: 486 files, the stylesheet's two inherited sources, dead build branches, four removed functions' settings, the inherited test command and its CI steps, and nine libraries (139 packages left the lockfile, none changed version). The proof, by a temporary workflow on each step: of 67 built files before, 44 are byte-identical, 11 scripts and `index.html` differ only in the hashed names of other built files (the stylesheet's new name reaches the entry script, and from it the others' names), the stylesheet lost 298 declarations and gained or changed none, in the same order (147 class names and 21 variables, none named anywhere that stays and none built from parts), and 11 removed pictures are no longer copied; the five server functions load the same 53, 26, 4, 3 and 48 files, every one identical; after step 2 every built file is identical to step 1's, and two builds of the earlier state are identical, so the build is repeatable. 562 unit tests and 99 browser tests pass. The earlier state is the branch `claude/before-cleanup-2026-11`; the session could not create the tag, which the owner adds on that commit. Left for the owner: seven inherited environment names the build still writes into two scripts (removing them changes those scripts by that alone). Found for package 13: the extraction eval reads its sources from the repository's public address, which a private repository refuses.

### Package 13: soundness fixes from the review

One bundle in three parts, each its own pull request. Every item has its test. Where an item changes what a server function runs, the report names the function; it goes live with the release.

**A. Screens and settings only.**

- **The microphone works (F12).** The site's own settings forbid it today, so "speak your answer" fails for everyone. Allow it for the site itself; check the message a person sees when they refuse it in the browser.
- **The README says what the product is** (it says "Nothing here is production-ready").
- **What approval covers is said truthfully (F07, wording only; the real fix is package 14).** Until package 14 is live, the Documents page must not say "The approved document is unchanged" when later edits, choices or settings can change what is shown.
- **What was found in the sources is cleared from the browser at sign-out (F10).**
- **"AI use this month" is never cut short without saying so (F11):** read it in pages, or say when the list is partial.
- **The privacy notice names the AI providers a workspace may connect,** not only the platform's.
- **The secret scanner looks at the folders that exist** (`journey/`, `domain/`), after package 15.

Added by the owner on 18 November 2026, after the review of package 15 and the marketing review:

1. **The microphone is allowed for the site itself only;** camera and location stay off.
2. **The seven old settings names leave the build** (owner's yes). They are read by nothing; removing them changes the two scripts that carried them, and only by those names.
3. **The hand-written rules in `index.css` that no page uses** (for example `.premium-sidebar`, left from the earlier screens) are removed, with the same proof as package 15: the stylesheet loses rules and gains or changes none, and no removed name appears in what stays.
4. **Two demo fixes from the marketing review.** The demo opens on the sample's assessment, with one line pointing to what to look at next. Where the demo says a thing is "not available in local mode", it says in plain words that reading your own files happens in a workspace of your own, and offers the walkthrough.
5. **`robots.txt` and a sitemap are real files.** Today both addresses return the homepage. The builder proposes which public pages the sitemap lists; the owner approves.
6. **A fresh dependency check.** The earlier count of 24 warnings is stale after package 15. The report gives the count by severity, what is safe is fixed, and an automatic check is added so new warnings are seen.

The owner approves the exact words of the Documents line, the privacy notice and the demo's pointer line before part A is merged.

**Built (18 November 2026, #198).** The owner approved the privacy notice as written and the sitemap as proposed, and reworded two lines: the Documents line ("Approved revision R of the process is kept exactly as approved. Its documents are rebuilt each time they are opened, so later section edits, choices and settings appear in them too. Approve this draft to make these changes the approved version.") and the demo's pointer ("You are looking at the sample's assessment: which steps can be done by rules, which need AI and which stay with people, and why. Next, open Documents to see the process document written from it."). The security contact file (`public/.well-known/security.txt`) already existed and is live; it stays as it is and out of the sitemap. Proof and checks: `AGENTS.md`, Progress. Dependency check that day: 0 critical, 4 high (one advisory on a build tool, never shipped, with no fixed release yet), 24 moderate (one Tiptap advisory, fixed only in Tiptap 3); nothing could be fixed within the allowed versions. The browser tests no longer run for a pull request that changes only notes and plans (owner, to save Actions minutes); the two check names are unchanged.

**B. Rules that the server functions carry.**

- **An API covers a step only when that is certain (F09).** Today one shared word, or a five-letter stem, is enough: "Read supplier" counts as able to do "Update supplier", and the step's reason then states "has a confirmed API covering this work", which no source said. When the match is not certain, the step is scored as "not known to be covered", the reason says so, and the question is asked, as already happens for an unrelated operation. A person's own confirmation of an API without listed operations still covers the process (decided). **Before and after, report the sample's figures** (the split of its steps, "what would change the ranking", the portfolio) and those of the owner's two test processes; if the sample's change, the demo's data, its recorded Ask Avala answers and the homepage's pictures and wording are brought in step in the same release. Run the Ask Avala measure afterwards.
- **A workspace's own AI key that has gone missing stops the work with a clear message (F05).** It never falls back to the platform's key: that is our written rule and the homepage's promise.
- **The allowance (F03, the small parts):** it is checked before "Test this key", which records its use; every attempt of a call is counted, not only the last.
- **Reading sources on a workspace's own key does not need the platform's key to exist (F04).**
- **A reply that lacks a list its task requires is refused (F16); a task name must be one of ours (F17).**
- **The extraction check takes the sample's files from the caller** instead of the repository's public address, which a private repository refuses (found in package 15).

Added by the owner on 18 November 2026:

**Condition from part A (owner, 18 November 2026):** the privacy notice now says a workspace with its own key sends its requests "never to OpenAI on our key". That is true only with F05 (a workspace key that has gone missing stops the work and never falls back to the platform key), so F05 must be in the same release as part A.

7. **The two error paths in the AI function that return internal text** return a plain message instead; the detail goes to the function's log only.
8. **Allowed websites.** Today no value is set and every function answers any website. One value cannot be set by hand, because the previews use the same live functions. It becomes a list that covers avalaos.com and this site's previews; the report says which value the owner sets.
9. **The extraction check:** the report says who can start one, and shows that taking the sample's files from the caller does not let anyone else send files to that function.

Added by the owner on 18 November 2026, with his go on part B: the coverage rule runs in the browser, so it shows on the preview; the builder reports the sample's figures before and after from the preview, and the owner looks at his two test processes there before the release. If the sample's figures move, the builder stops and reports before changing the demo's data, its recorded answers or the homepage; new figures and homepage wording need the owner's approval. For processes already assessed the report says what a person sees when the rule changes their figures, an approved one included; nothing changes silently. "Test this key" on a workspace's own key works when the allowance on our key is used up, with its own small limit. Allowed websites: the caller's address only when it is on the list, and "Vary: Origin", with unit tests for avalaos.com, www, a preview address and an outside address. The missing-key rule applies in every function that calls a provider. Before the release, the steps to put the previous functions back and the live checks to run straight after are written down (below).

**Built (18 November 2026, #199, merged into `next`; the server functions change only at the release).**

- **F09, in the browser.** `domain/assess/coverage.ts`: an operation covers a step only when it names the same action as the step's name (the same verb, or one of a short table of verbs with one plain meaning: create, add, register, insert; read, get, retrieve, fetch, view; update, change, amend, edit, modify; delete, remove; approve, authorise; send, email, forward; any other verb matches only itself, so the question is asked and a yes counts) and the same thing (a word in common, whole words, a plural counted as its singular, no stems). The action is the first word of the operation and of the step's name only; every other word is a thing, so "Create vendor" does not cover "Update vendor record" and "Read vendor email" does not cover "Email vendor" (owner's review of #199; the table's words that are also nouns are tested both ways). A person's confirmation of an API without listed operations still covers every step. The sample's figures are identical before and after (no step of the sample was covered by an API). The rule before is kept only to say where today's gives a different answer: such a process shows, until 31 January 2027, a line on the Assessment, on Documents and on its card, in the owner's wording (`coverageNotice`); the date in it is the release's, set in the release's own commit (`COVERAGE_RULE.since`; until then the screens show "[release date]").
- **A yes counts (owner's review of #199).** "Does X have an API that covers <step>?" is answered on the Assessment's "How firm this is" (Answer: Yes or No for one step; for several, the steps are listed and the person ticks the ones the API does) and in the step's panel (Yes or No). A yes adds the step's name to the operations of the API a person confirmed, so the API counts for it; every step answered, yes or no, keeps the question as answered, so it is not asked again, and a no wins over any listed operation (a yes for "Check invoice totals" does not cover "Check invoice tax" left unticked) (`answerApiCoverage` in `domain/processModel/patch.ts`, `apiAnswered` in `coverage.ts`). The saved process keeps its shape, so the released site opens it; there, until the release, the old rule counts the step's name too, except a step whose words are all common to the process or of three letters or fewer. On the live data, the Test workspace's "Vendor Invoice Processing" changes on 7 steps (its mailbox, SharePoint and SAP read-only APIs no longer count as doing "Scan paper invoice", "Log invoice", "Validate vendor", "Request vendor master change", "Enter PO invoice", "Park invoice and request goods receipt" and "Route non-PO approval").
- **F05, in both functions that call a provider** (`journey-ai`, `journey-extract`): `decideConnection` in `domain/ai/providers.ts`; settings saved with no key to read stops with WORKSPACE_KEY_MISSING and the message "This workspace is set to use its own AI key, which can no longer be read. An administrator should enter it again in Settings → AI provider." No other function calls a provider.
- **"Test this key"** (`journey-ai`): on the platform key, checked against the allowance and counted; on a workspace's own key, not held back by our allowance but limited to 10 tests an hour (`KEY_TEST_LIMIT`, `domain/ai/usage.ts`). Every test is logged with its tokens as "Testing the AI key".
- **F03:** a reply tried again after INVALID_OUTPUT is counted with the next one, in both functions; a failed extraction stage logs the tokens it used.
- **F04:** `journey-extract` no longer refuses every request when the platform key is not set.
- **F16, F17:** `verifyExcerpts` reports a missing required list and both functions refuse the reply as INVALID_OUTPUT; a task name must be an own key of the task list (`Object.hasOwn`).
- **Item 7:** the AI settings and allowance lookups return a plain message; the detail goes to the log. `journey-extract`'s "AI not available" no longer passes on a database error's text either.
- **Item 8:** `domain/site/origins.ts`: avalaos.com, www.avalaos.com and this site's Netlify addresses (main, branch and deploy previews); the caller's own address is echoed only when on the list, with "Vary: Origin" on every answer, in all five functions (`withCors`). The owner sets nothing: `ALLOWED_ORIGIN` stays unset, and may later add exact addresses (for example a local address while developing).
- **Item 9:** the extraction check takes the case's files with its start request (`eval/corpus/cases.ts`, the new "Extraction check" workflow and `eval/corpus/check.ts`). Who can start one: only a holder of the project's secret key or database access, because a check is a row in `extraction_runs` no signed-in user can write, started with that row's one-time token. The files are taken only before the run starts, only when they are exactly the case's files, and only when each one's SHA-256, the gold's included, is the one compiled into the function; anything else is refused. So nobody can put other content in front of the AI or the scorer through it.

**Fixes after the review of the preview (owner, 19 November 2026; one pull request, screens and the scoring only).**

- **A person's no rules API integration out for that step.** It used to leave the API "confirmed, not known to cover this work", held at 60, so the step kept "API integration 60/100" with no question left. Now the step is scored as having no API for this work (as an application with no API), the reason says a person confirmed it, and the step falls to its next best approach.
- **What the sources say an API cannot do.** The operations the sources list under an API recorded as absent are shown beside the question about that application ("The sources say SAP S/4HANA has no API to: …"). Where one of them names the same action on the same thing as a step, by the same strict rule, the step is scored as having no API for this work, with the source's words as the reason. Nothing beyond that rule is guessed: "Enter PO invoice" is not "create" or "post" by the rule, so it stays a question. A person's yes wins over the sources.
- **One application is enough.** If any one application a step needs has no API for that work (a person's no, the sources' statement, or no API at all), API integration is ruled out for the step and the reason names that application; the step is no longer asked about the other applications' APIs, since no answer could bring integration back.
- **An API-led headline that rests on held steps says so,** with the number of steps, on the Assessment's headline and on the process card (`apiHeld`, `apiHeldText` in `domain/assess/process.ts`), in the owner's words: "Provisional: N of its M steps wait for an answer about the API. Each is held at 60 out of 100 until someone confirms the API does that work, or says it does not." and "Provisional: N of M API steps wait for an answer about the API."
- On the live "Vendor Invoice Processing" (read 19 November 2026): before, API-led with API integration for 8 steps, all 8 held at 60; after, API integration for 7, all 7 held, and "Post invoice and attach PDF" stays with a person for now (the sources say SAP S/4HANA has no API to post supplier invoices with PO reference, and robots are not allowed on its screens).
- **The sample's figures move (accepted by the owner, 19 November 2026).** SAP S/4HANA is recorded there as having no API, so four steps that use it beside other applications lose API integration (60 to 0): "Check for duplicates", both "Park invoice" steps and "Enter non-PO invoice". API integration falls from second (37) to third (22) and could do 5 steps instead of 9; confirming the APIs would move 5 steps instead of 9, and the SharePoint library is no longer named for it. The verdict, the split (15 / 1 / 4), 80%, one step needing AI and every step's recommendation are unchanged. The demo's recorded answer and the Ask Avala measure's expected answer (W02) follow. The homepage's tour pictures are compared with the preview's demo and those that no longer match are retaken in the same release (owner, 19 November 2026).
- **The full Ask Avala measure on 1 December 2026** (owner): this month's allowance on the platform key cannot hold it (about 1.48 million tokens; 1.15 million were left on 19 November), and the allowance is not raised. On 1 December, when it resets, run the whole set once on the released functions ("Ask Avala measure", Run workflow on `main`, workspace "Avala check") and report it against the targets. Until then: the six questions on the changed figures (A04, A06, A07, W02, W03, W10), run on 19 November on `claude/api-no`, passed 6 of 6, every target met, about 113,000 tokens.

**Before the release: putting the previous functions back, and the live checks.**

- Before merging into `main`, the builder checks that `main`'s last commit message has no `[deploy]` and pushes a branch `claude/functions-before-<release>` at that commit (today `bab6440`). If a function misbehaves after the release: GitHub → Actions → Deploy edge functions → Run workflow, choose that branch and the one function (or all). This puts back that function exactly as it was before the release; nothing in the database changes with it, so nothing else needs undoing.
- Done on 20 November 2026 for the ninth release: the branch `claude/functions-before-ninth-release` points at `bab6440`, whose message has no `[deploy]`; the release's own commit set the three dates to 20 November 2026. Released the same day (merge commit `943c89c`); what was checked straight after is in section 1, "Update, 20 November 2026".
- Done on 22 November 2026 for the tenth release: the branch `claude/functions-before-tenth-release` points at `943c89c`, whose message has no `[deploy]`; `journey-extract`, live then from `aa588d2`, goes back with the branch `claude/reading-within-one-answer`. The release's own commit (#226) set `UPDATED.privacy` to 23 November 2026, the release's day; the other dates were unchanged. Released on 23 November 2026 (merge commit `0c93807`); what was checked straight after is in section 1, "Update, 23 November 2026".
- Done on 24 November 2026 for the eleventh release: the branch `claude/functions-before-eleventh-release` points at `0c93807`, whose message has no `[deploy]`; it puts all five functions back (all five were still the tenth release's deploys). The release's own commit (#238) set `UPDATED.security` and `EVIDENCE_KEPT_SINCE` to 24 November 2026; the other dates were unchanged. Released the same day (merge commit `58ae491`); what was checked straight after is in section 1, "Update, 24 November 2026".
- Done on 26 November 2026 for the twelfth release: the branch `claude/functions-before-twelfth-release` points at `58ae491`, whose message has no `[deploy]`; it puts all five functions back (all five were still the eleventh release's deploys). No release's own commit: no date changed. Released the same day (merge commit `28fa072`); what was checked straight after is in section 1, "Update, 26 November 2026".
- In the release's own commit: set `COVERAGE_RULE.since` in `domain/assess/coverage.ts` to the release date, and the same date as `UPDATED.privacy` and `UPDATED.security` in `domain/site/trust.ts` (since PR 3 of the marketing package the privacy date, and since package 14's pull request 5 the security date, may be that date or later; `EVIDENCE_KEPT_SINCE` in `domain/docs/versions.ts` is that release's date).
- In the release's own commit (from the release that carries the teardowns' counting, marketing package PR 3): set `UPDATED.privacy` in `domain/site/trust.ts` to the release date. Until then the privacy page shows "[release date]" (owner, 21 November 2026).
- The check "Release dates set" (`.github/workflows/release-dates.yml`, owner, 21 November 2026) runs on the pull request into `main` only and fails, naming each one, while any of these dates or `UPDATED.terms` is empty; it blocks the merge only once the owner adds it to the rule on `main` in the repository's settings.
- Straight after the release, first the allowed websites (owner): in the browser's network panel on avalaos.com, a function's answer names https://avalaos.com in Access-Control-Allow-Origin and says Vary: Origin. Then, on avalaos.com with a real account: sign in; read a source (an extraction run on a small process); draft a section's text on Documents; a spoken answer in Closing the gaps or "Tell us in your own words" (Ask Avala's interview takes typed answers only); "Test this key" on a workspace with its own key (and once on the platform key); a walkthrough request from the homepage; one extraction check from the workflow (`ap-invoice`).

**C. The walls between workspaces (the database: additive, its tests, a rolled-back trial, the owner's yes).**

- **A board item can only point at work, a parent and a process of its own workspace (F01),** and confirming proposals refuses an item of another workspace.
- **A workspace cannot be moved to another organisation (F02).**

Added by the owner on 18 November 2026: every link between two rows that each belong to a workspace, not only the board item's (eight in all, found by a read-only check of the live database, none crossing); the check holds whichever side changes; a rolled-back trial with its tests, deleting a process that has board items, proposals, revisions, a document revision and a reading run, and the existing database tests for the model, the documents and the basic rules run with the change in place; the plan and the pull request in general words until the change is applied.

**Built and applied (18 November 2026, on the owner's yes, migration `workspace_walls`, applied at 16:26 UTC).** Each of the eight links now carries its workspace, so both rows must be in the same one, whichever side changes: a link cannot be set into another workspace, and a row that is linked to cannot move to another workspace while the link stands. A reading run that names a process names its workspace too. A workspace cannot be moved to another organisation by anyone signed in, its own admin included; renaming works as before, and a change made directly in the database is still possible for the platform owner. Nothing that deletes or empties a link behaves differently: deleting a process leaves its board items on their board, in their workspace, with the process link emptied, and its proposals, revisions, documents and reading runs go, exactly as before (shown before and with the change in the trial). Confirming proposals needed no change: the database itself now makes an item of another workspace impossible there. No screen, server function or database function moves a process, a proposal or a board item to another workspace (read in the code). The trial, rolled back: the new test (`supabase/tests/workspace_walls.sql`, 8 groups), and with the change in place the tests for confirming proposals (4), the board's comments, history, sprints and labels (6), saving and approving the model (8), document edits (3) and the basic rules (9); without the change, a link into another workspace and a moved workspace were both accepted. After applying, the nine rules were in place and valid, and the new test passed again on the live database (rolled back). No screen and no server function changes.

**Not in package 13, and why.** Two people saving at once (F15) and the database tests in CI (F14): real, medium, their own package once a second person edits. The backup's restore check (F06): the owner decides on the database's paid plan first, whose own backups replace it; until then one small step is welcome, making the check fail when a sign-up trigger or a function did not come back. The heavy forms the report asks for (a token ledger, a staging project, recovery drills, single sign-on): not for one person.

### Package 14: an approved document is final; a change makes a new version

**The owner's words.** "The draft version can have many versions. But the approved one is final and if it has to be changed, a new version with the reason, and what changed, who changed has to be recorded."

**What is true today (F07).** Approval freezes the process record. The documents are rebuilt each time they are opened, from today's section edits, people's choices, requirement wording, company layout and settings, and from Avala OS's own wording as last released. So an "approved" document can change with no mark.

**What a person sees.**

- **Approving keeps the documents exactly as they read at that moment:** every document offered for the process, its text, tables and maps, with who approved and when. Nothing changes them afterwards: not an edit, a choice, a setting, a company layout, nor a later release of Avala OS.
- **Anything changed after approval lives in the working draft,** and the process says "Approved version N · unapproved changes", for a section edit and a person's choice as much as for a change to the process itself.
- **Approving again makes version N+1.** The approver gives the reason for the new version (required from the second version on) and sees what changed since the last approved one, section by section, before confirming. Who and when are recorded.
- **A list of versions on Documents:** number, date, who approved, the reason, what changed. Any version opens as it was and downloads as it was (Word and Markdown).
- **The draft may change as often as needed.** Each saved change is on record with who made it and when; say in the plan what the record holds today for section edits, choices and requirement wording, and the smallest addition that closes a gap.
- **The evidence pack** lists the versions with their reasons, and a pack made from an approved version is kept with it.
- **Versions approved before this existed** have no kept copy. They are labelled so ("approved before copies were kept: shown as built today"), and an approver can keep one as it reads now, with that fact recorded. Nothing is made up after the fact.

**Deleting a process (owner, 18 November 2026).** A process that has a document revision cannot be deleted today (the revision holds on to the process revision it was built from; found in the trial of package 13 C), so package 14 must decide what deleting such a process means and say it on screen.

**Underneath.** The baseline has a table `document_revisions` with no rows; say in the plan whether it fits. A database change is expected: additive, its test, a rolled-back trial, the owner's yes. What is kept is the built document, not only what it was built from, so a release cannot change it.

**Done when.** Unit tests: an approved version is unchanged by each kind of later change; the reason is required; what changed lists exactly the sections that differ. A database test for who may write and that a kept version cannot be altered. Browser tests on the sample: approve, edit a section, see "unapproved changes", approve with a reason, open version 1 and download it as it was. The homepage's line "An approved revision is never changed" is then true of the documents as well.

**Added for package 16 (owner, 20 November 2026).** The confirmation of approving says how many open questions could change the recommendation (the label "Changes the recommendation", repeats merged as Closing the gaps lists them) and how many of those are left with someone. For an approach already decided it says how many settle it ("Settles the decided approach"); for a process documented as it is it says nothing about them. One function returns both numbers, in a new file under `domain/questions/` (not `triage.ts` or `firstList.ts`), with its unit test; package 16 reuses it.

**Planned and building (owner, 21 and 22 November 2026).** The plan is `claude/package-14-plan-21-nov.md` in the owner's project, approved with seven changes. It ships in two releases:

- **The first release:** pull requests 1 to 4.
  - 1, the rules: merged as #223.
  - 2, the migration `approved_versions` and its test: #224, applied 22 November 2026 on the owner's yes.
  - Both were released with the tenth release (23 November 2026), showing nothing on screen; pull requests 3 and 4 come with the next.
  - 3, approving, the tag, the comparison and the list of versions: merged as #228 (23 November 2026), after the review's three fixes and one addition. The preview is the pull request `next` -> `main` (#230), titled so nobody releases it before pull request 4; change g (a large version accepted) is proven there by the owner, in the workspace "Avala check" only.
  - 4, earlier approvals, "Keep it as it reads now" and the demo's refresh: built 23 November 2026 (its plan `claude/package-14-pr4-plan-23-nov.md` in the owner's project, with five details the approved plan left open). An approved revision with no kept copy shows "Approved revision R (before copies were kept)", also when a version exists but the approved revision is newer, and Documents says "Approved before copies were kept: shown as built today". An approver gets "Keep it as it reads now" instead of Approve; Approve still approves a working draft that has edits. It keeps the approved record's documents as they read now, never a working draft, through the live function `keep_version_as_reads_now`. The version records who approved the revision and when, and who kept the copy and when; its documents' control block says "Approved version N, kept after approval". The list shows "Kept after approval, as it read on {date}" and earlier approvals without a copy by revision; the version opened says the copy is not what was approved on that date. The demo's sample is refreshed from the tour walk, which keeps version 1 since pull request 3. No database or server function change.
- **The second release:** pull request 5 (the evidence pack's versions, History, the two numbers, Ask Avala's line): built 24 November 2026, its plan `claude/package-14-pr5-plan-23-nov.md` in the owner's project, approved as written that day. No migration.
  - **The evidence pack** lists the approved versions (who, when, why, kept at or after approval), and approvals with no kept copy by revision, "Approved before copies were kept".
  - **Approve and "Keep it as it reads now" keep the pack with the version.** Its first line says whose approval it records, with the reason typed in the window. It is never compared.
  - **A version kept before this** shows "No evidence pack was kept with this version: packs are kept from {date} on." (`EVIDENCE_KEPT_SINCE`).
  - **History** lists the change record ("Changes to documents and choices", `domain/docs/changeRecord.ts`, read by `listDraftChanges`) and which revision each version kept.
  - **The approval window** from version 2 shows the two numbers (`approvalCountsLine`), as package 16 counts them.
  - **Ask Avala's line `approved`** (`domain/assistant/platform.ts`) says that approving keeps the documents as a version; it changes `journey-ai` and `journey-notify` at the release.
  - **The security page** says "Approved versions of a process and its documents are kept unchanged.", which changes `journey-inquiry`'s bundle at the release.
  - **In the release's own commit,** also set `UPDATED.security` in `domain/site/trust.ts` and `EVIDENCE_KEPT_SINCE` in `domain/docs/versions.ts` to the release date. "Release dates set" names both while they are empty.

Recorded for later, on the owner's word (22 November 2026):

- **Pull request 3: the line for a release.** "Avala OS now writes {k} sections differently" is shown only when the version's inputs index proves it: every input's fingerprint equal, the build different. Where sections differ and neither that nor a recorded change explains it, Documents says so in neutral words; the line is proposed to the owner first.
- **Pull request 3: "Keep it as it reads now"** builds from the approved record, never from a working draft.
- **Pull request 3: an edit saved and then undone.** The tag stays "unapproved changes", and Documents says "Changes were saved since approved version {N}, and the working draft now reads exactly as that version." That line is shown when the tag says "unapproved changes" and no section differs.
- **Pull request 3: the order of reading when approving.** The page reads `version_states` (its `changes_seen`) before it reads the inputs it builds from, then passes `changes_seen` to the approval. A save in between makes the approval refuse and ask for a reload, never keep a copy without it.
- **The notes of the first release say plainly** that versions approved between the two releases keep no evidence pack.
- **A later hardening item, asked for separately:** the role `authenticated` holds TRUNCATE on `processes` and `workspaces` (the default grant). The API cannot use it; revoke it in a later migration.
- **After the release, asked for separately:** a migration that replaces `model_approve` with a refusal to reload the page, so a tab opened before the release cannot approve without a kept copy.

## 3g. Packages 16 and 17, and two dated items (owner, 20 November 2026)

From "Ask Avala discovery: work packages A and B" (the spec, in the owner's project: https://claude.ai/artifact/7cUj4mDoUgg8BvFuS3fngk), after the builder chat's check (`claude/discovery-step1-check-20-nov.md`) and plan (`claude/discovery-step2-plan-20-nov.md`), both reviewed by the review chat. Package B of the spec, guided discovery, gets its own chat later and is not planned here.

### Package 16: closing questions from the Assessment stage (built 23 November 2026, in review)

**Built (second builder chat, 23 November 2026; plan `claude/package-16-plan-23-nov.md` in the owner's project, approved).** Rules in `domain/questions/result.ts`: `assessmentLine` (N is `approvalCounts`' open questions less those left with someone; null for "as it is" and for a decided approach), `couldChange` (the questions the line counts, the focused list), `whoToAsk` (the three groups of the question files, the most decisive first, the name a question is left with) and `meetingResult(before, after)` (two models, each by its own triage; a question set aside for someone is not closed). Screens: the line and **Answer them** in `AssessmentPriority.tsx`; Closing the gaps on the Assessment stage (`AssessmentStage.tsx`, "Back to the assessment", no word of documents where the organisation has none); the focused list, opening on "Several at once" and the result in `GapsAssistant.tsx` (`SeveralAnswers` passes the process as it was before the save); the request to open it from elsewhere in `journey/process/openGaps.ts` (Ask Avala's link in `InterviewPanel.tsx`, My work's "Answer them" in `MyWorkPage.tsx` for an organisation with no Documents stage; Documents listens too). The browser tests' stand-in: `journey/store/standIns.ts` (replies by task name, a log of calls; the rules in `domain/ai/standIn.ts`: only tasks given replies, never a call carrying a source's passages), built in only when `VITE_JOURNEY_STORE=memory` at build time (`__AVALA_STAND_INS__` in `vite.config.ts`), and `scripts/check-no-stand-ins.mjs` after the production build in CI. Found while building, not changed (`triage.ts` is not this package's): an application with no ways in recorded (the sample's office scanner) stays on the list after a free-word answer, because the rule that raises it looks only at its ways in. Test: `domain/questions/result.test.ts`, `domain/ai/standIn.test.ts`, the guard in `domain/work/digest.test.ts`, `tests/e2e/answer-from-assessment.spec.ts`.

**When.** After package 14 and the content security policy are released; the Tiptap upgrade follows it (section 1, the changed order of 20 November 2026). The content security policy comes first by choice, to do security work first; package 16 does not depend on it.

**Why.** On 20 November 2026, 143 of the 156 questions raised on the three live processes were open, and none was with a named person. Closing the gaps, the one screen that reads notes or a transcript against many questions at once, opens only from Documents (`journey/process/DocumentsStage.tsx`), so an organisation on the "Assess" set-up cannot reach it.

**What a person sees.**

- **On the Assessment stage**, under "What would sharpen this most": "N open questions could change the recommendation" ("1 open question could change the recommendation" for one), with **Answer them**. It shows only when N is more than 0. N counts the open questions labelled "Changes the recommendation", repeats merged as Closing the gaps lists them (one question per application about its access), not counting those already left with someone; it is the count package 14 adds. The button opens Closing the gaps on those N questions, a list that is new ("Showing the N that could change the recommendation · Show all"), with "Back to the assessment". The words must not read as the same number as "Questions (N)" in Ask Avala, which counts the first list and the answers found in the sources.
- **In Ask Avala's Questions tab**, for a person who can edit where AI is available: "Answer several from notes or a transcript". It closes the panel and opens Closing the gaps on "Several at once": on the Assessment stage, or on Documents for a process with no Assessment stage (documented as it is, or with the approach decided). The one-question interview is unchanged.
- **After answers read from notes, a transcript or a returned question file are saved:** "N of M open questions closed", and what is left grouped by the kind of person to ask, the same three groups as the question files ("Process owner or SME", "IT or application owner", "Finance or controls"), the questions that could change the recommendation first in each group. A name typed under "Ask someone later" shows on its question. Under it, a link to "Send questions to the people who know". The result shows wherever Closing the gaps is opened, Documents included.
- **My work's "Answer them"** opens the Assessment stage with Closing the gaps when the process has no Documents stage. Today it opens Documents, which says "Not switched on" in the "Assess" set-up. In the screen only; the weekday email's link is a dated item below.

**Rules.** Screens only: no AI task, no database change, no server function change. No change to `triage.ts`, `firstList.ts`, `packs.ts`, `domain/work/home.ts`, `digest.ts`, `purpose.ts` or `platform.ts`; if one proves necessary, stop and ask first (the weekday email counts from them). No verdict line, no new tags, no renamed labels, no change to Approve, no change to scores, ranking or recommendation. A question file per named person is left to package B.

**The browser tests read notes with a stand-in.** The in-browser store has no AI, so in the browser-test build only (`VITE_JOURNEY_STORE=memory`) a stand-in answers the reading of notes with a reply the test gives, and counts the calls. It answers only that reading, never the automatic look in the sources. A check fails if the stand-in is in the released bundle. The demo is not affected.

**Done when.**

- Unit tests: the result's counts, worked out from the process before and after a save; the groups are those of the question files; a typed name shows on its question; the questions that could change the recommendation come first in each group; a process documented as it is lists no question about an application's access.
- A browser test on the sample in an organisation set to "Assess": the line shows N, and its button opens Closing the gaps on the same N questions; several are answered from pasted notes; nothing is saved before Save (no new source, no new edit in History); after Save the result's figures match the saved process; the stand-in counts one AI call, the reading of the notes, so the line and the result add none. The Ask Avala link opens the same screen, and `tests/e2e/assistant.spec.ts` passes unchanged. My work's "Answer them" opens the Assessment stage with Closing the gaps.
- No file a server function loads is changed: the import walk of `scripts/in-use.mjs`, from each `supabase/functions/journey-*/index.ts`, finds none of the pull request's files. A guard test keeps the weekday email's counts for the demo's sample (`public/demo-data/sample.json`) as they are.
- The stand-in is not in the released bundle (the check above, run on `npm run build`).
- When package 16 is released, not before: the line in `domain/assistant/platform.ts` saying where questions are answered, with a run of the Ask Avala measure in that month's allowance (about 1.4 million tokens). Then the user guide's chapters 2, 5 and 10, in the owner's project.

### Package 17: speech to text for Azure OpenAI (not built; due before the first workspace on an Azure OpenAI key)

Not in the order. It is due when the first workspace is to connect its own Azure OpenAI key; no workspace uses its own key today (read on 20 November 2026). Nothing is set up in Azure until then.

**Why.** For a workspace on its own Azure OpenAI key the microphone shows, but the recording is refused with a plain message (`domain/ai/providers.ts`, `can.transcription` false for Azure OpenAI; `supabase/functions/journey-ai/index.ts`, the `transcribe` action).

**First, before anything is built: one real call settles the address.** It is not proven. The code would call `<endpoint>/openai/v1/audio/transcriptions` with the deployment as the model; Microsoft's reference gives `<endpoint>/openai/deployments/<deployment>/audio/transcriptions` with an API version. The owner runs three calls in PowerShell on his own computer, in the folder that holds a recording of 5 to 10 seconds of speech, `test.m4a` (Windows Sound Recorder). The key is typed into a hidden prompt; it is never shown, and never sent to anyone.

```
$res = "https://YOUR-RESOURCE.openai.azure.com"
$dep = "YOUR-SPEECH-DEPLOYMENT"
$sec = Read-Host "Azure key" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
# 1. The address the code would call today
curl.exe -s -w "`nHTTP %{http_code}`n" -H "api-key: $key" -F "model=$dep" -F "file=@test.m4a" "$res/openai/v1/audio/transcriptions"
# 2. The address in Microsoft's reference
curl.exe -s -w "`nHTTP %{http_code}`n" -H "api-key: $key" -F "file=@test.m4a" "$res/openai/deployments/$dep/audio/transcriptions?api-version=2024-10-21"
# 3. The same address with a newer version, so a version error is not read as an address error
curl.exe -s -w "`nHTTP %{http_code}`n" -H "api-key: $key" -F "file=@test.m4a" "$res/openai/deployments/$dep/audio/transcriptions?api-version=2025-04-01-preview"
Remove-Variable key, sec
```

What to send back: the region; the model and version as the Azure portal shows them; the deployment name; whether the resource's address ends `openai.azure.com`, `cognitiveservices.azure.com` or `services.ai.azure.com`; and for each call the line "HTTP …" with the text or the error above it. Never the key.

**Also before the first Azure workspace (owner, 20 November 2026, from the reading-split plan):** the reasoning effort is sent only when the deployment's name shows the model (`takesReasoningEffort` in `domain/ai/providers.ts`). A deployment named, say, "prod-extract" runs at the model's default effort, writes more reasoning inside the same output ceilings and is slower; the check run of 11 November 2026 at medium effort had its flow merge stopped by the time limit. Either the deployment is named so it shows the model (for example `gpt-5.5`), or Settings takes the model behind the deployment, and one extraction check runs on that workspace before it is used.

What it needs on Azure: one resource holding a text deployment and a speech deployment for the audio API (on 20 November 2026, `gpt-4o-mini-transcribe`, version 2025-12-15; not a model the catalog describes as streaming only). Azure offers speech models in fewer regions than text models, so one resource serves both only where its region has both (Microsoft's table of regions: https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability). Not tested by these calls: the browser records WebM, not M4A; the first real recording after the build tests that.

**What changes.** In Settings → AI, for Azure OpenAI: an optional "Speech-to-text deployment" under the deployment name. Filled: spoken answers go to that deployment, on the same key and the same resource. Empty: the microphone is replaced by "Voice input needs a speech-to-text deployment. An admin can add one in Settings, AI.", and no call is made. "Test this key" tests the speech deployment too and says which of the two failed. The audio of a workspace on its own key never goes on the platform key.

**Underneath.** A new column beside the provider and model in `workspace_ai_settings`, with `set_workspace_ai` and `workspace_ai_connection` changed: additive, its test, a rolled-back trial, the owner's yes. `journey-ai` changes (the speech deployment for Azure; "Test this key"); it goes live with a release.

**Done when.** An Azure workspace with the field filled records an answer and sees its text; with it empty it sees the line, and no call is made; a workspace on the platform key and one on an OpenAI key behave as before; the usage row names the workspace's key as its source. Unit tests for the address and the choice of deployment; the database test for the column and who may write it; a browser test for the line.

### Package B: guided discovery (plan `claude/package-b-plan-23-nov.md`, revision 2, approved 23 November 2026)

Six pull requests; `next` can be released after any one of them; the first release advised is pull requests 1 to 5, once the replay has passed.

- **Pull request 1, the rules with no screen (built 23 November 2026, in review).** `domain/discovery/`:
  - `card.ts`: a card shows a quote, a named gap or a conflict, and a target, or it is not built;
  - `checklist.ts`: the first cards, the shape of the process, a card per open conflict;
  - `queue.ts`: the order, by rules only;
  - `inputs.ts`: the assessment's next inputs as fields written with the Inputs view's operations, and the period of a figure read from words by a rule;
  - `answers.ts`: the "Discovery answers" source, the person's words alone with "Answer to: …" as each passage's place; an answer never overwrites a value a person confirmed;
  - `wanted.ts`: the cue words and the held-back rule;
  - `limits.ts`: the cap of 250,000 tokens, 60 calls, three readings;
  - `summary.ts`: when a session ends, and its counts.

  The Process Model gains `meta.wanted` and `raisedBy` on a question (`types.ts`, `validate.ts`; `keepWanted`, `dropWanted`, `raiseConflict` and `raisedBy` on `addQuestion` and `deferQuestion` in `patch.ts`; `record` in `answer.ts`). A first reading keeps `meta.wanted` (`rebase.ts`).

  A value a person confirmed with no quote of its own cannot be one side of a conflict, since each side cites its words and the released check requires it. So the difference is asked as an open question raised by the answer's words.

  `journey-ai`, `journey-extract` and `journey-notify` bundle the changed model files at the release; what they do does not change. The released site copes with the new keys: the proof of the plan's section 12 is kept as `domain/discovery/compat.test.ts`. Nothing changes on screen.
- **Pull request 2, the task and the replay (built 23 November 2026, in review).**
  - `discoveryQuestions` in `domain/discovery/notice.ts`, registered in `domain/ai/tasks.ts`: at most 4,000 tokens out, low reasoning effort. It reads only a person's words (`n:`), with the draft's names (`m:draft`) and what was asked (`a:asked`) beside them.
  - The rules after it (`readNotice`) drop:
    - a quote not from a person's words, or one that repeats the question their answer was given to;
    - a question that is too long, or carries a link, an address or a number to call;
    - one already asked or settled;
    - more than five questions or five wanted statements a call;
    - a wanted statement without a wanting word.

    The target is decided by rule (`targetFor`). Rules decide when an answer is worth noticing (`worthNoticing`).
  - "AI use this month" names it "Discovery".
  - The replay is `eval/discovery/`: two made-up transcripts, the hand-written answers, `replay.ts` with the five measures, `run.ts`, and the workflow "Discovery replay", run by hand with numbers only in its log.
  - `journey-ai` gains the task at the release, or earlier if the owner decides the early deploy. No other task changes.
- **Pull request 3, the migration (built 24 November 2026, in review; not applied).** `supabase/migrations/20261124100000_discovery_sessions.sql`: one table, `discovery_sessions`, one row per session: the process and its workspace (deleted with the process), open or finished, `state` (at most 256 KB as text: the shape answers waiting for the next update, the questions raised and not yet acted on, the wanted statements not yet kept, the questions skipped, the passages already read, the calls, tokens and readings used), a version, who started it and when, who wrote last and when, and when it finished, all set by the database. One trigger: a write must name the version it read (`EDIT_CONFLICT` otherwise; a write that leaves `version` as it is names the current one), counts one more and is stamped; a session stays with its process; a finished session is never changed (`FINISHED`), and a session starts open. At most one open session per process. Members read; editors and admins add and change; nobody deletes by hand. No trigger feeds the change record; nothing existing changes, and the released site and functions read none of it. Test: `supabase/tests/discovery_sessions.sql` (10 groups). After the review (24 November 2026): deleting a person's account clears `started_by` and `updated_by` through the links' `on delete set null`, and the trigger now lets exactly that through as it is (only from the database's own link check, trigger depth above 1; only those two columns, each only from a value to null; no version count, no stamp, open or finished), so an account can always be deleted; a person's own update that clears them is a normal write. Trial on the live database, rolled back, run again after the fix: all 10 groups passed, and what it created matched the same file applied to a scratch database. Applying it waits for the owner's yes.
- **Pull request 3 applied** on the owner's yes, 24 November 2026, about 07:27 UTC (`claude/discovery-sessions-applied-24-nov.md` in the owner's project).
- **Pull request 4, Discovery asking by rule, in two parts** (plan `claude/package-b-pr4-plan-24-nov.md`, approved by the owner on 24 November 2026 with four additions).
  - **4a, the session in both stores and spoken answers (built 24 November 2026, in review).**
    - `domain/discovery/session.ts`: a session's state and its steps.
      - Every write names the version it read (review, 24 November 2026): `commitSessionStep` reads the latest copy, applies the person's step and saves it with that version. On a refusal it applies the step to the newer copy, at most five times, then says so (`BUSY_LINE`). A step adds or removes only its own entries, and keys a later release adds are kept.
      - A step that would take the state past 256 KB writes nothing and says what to do (`FULL_LINE`). The size is counted as the database writes it out (`stateTextLength`).
      - Waiting answers written into a "Discovery answers" source leave the session in the same step (`tookIntoSource`), so a person's words are never kept twice.
      - An open session counts as in use only when written in the last 30 minutes or open in this browser (`sessionInUse`; the look in the sources waits only then, from 4b).
      - "Started by {name} on {date}" (`startedLine`) shows a name, never an email address.
    - Both stores read, start, save and finish a session with its version (`getDiscoverySession`, `startDiscoverySession`, `saveDiscoverySession`, `finishDiscoverySession`). The live store names the version as the row's version and as a filter.
    - Spoken answers:
      - Ask Avala's Questions tab answers in the box with the microphone (`AnswerBox`, which gains `maxLength` and the plain line).
      - The microphone shows only where the workspace's AI turns speech into text (`domain/ai/voice.ts`, `voiceFor`; `journey/process/voice.ts`). Elsewhere it says "Voice input is not available with this workspace's AI provider. Type your answer instead." This applies in Closing the gaps and "Tell us in your own words" too.
    - The browser tests' stand-in hears a recording as the words a test gives under `transcribe` (`standInTranscript`).
    - No database or server function change; no file a server function loads.
    - Test: `domain/discovery/session.test.ts`, `session.store.test.ts`, `domain/ai/voice.test.ts`, `standIn.test.ts`, `tests/e2e/spoken-answers.spec.ts`.
  - **4b, the Discovery tab (built 24 November 2026; merged into `next` as `7629591` on 25 November 2026, on the owner's yes after his walk on the preview).**
    - Ask Avala on a process gains the tab **Discovery** for someone who can edit, where the workspace has AI (`discoveryTab` in `domain/discovery/flow.ts`). On a process with no steps it is the only view; a viewer reads "Someone who can edit this process can start Discovery."; the demo shows one paragraph and nothing to press.
    - Where it starts: "Add and start with Ask Avala" on Processes, and "Or let Ask Avala ask you…" with **Start with Ask Avala** in "No documents? Tell us in your own words" (`journey/process/openDiscovery.ts`).
    - The flow (`journey/process/DiscoveryPanel.tsx`; every rule in `domain/discovery/flow.ts`):
      - The person's own words are kept as a source `own-N` (`ownWordsSource`, shared with "Tell us in your own words") and read as the Sources stage reads.
      - "What I understand so far": the steps with who, where and the words each came from (`stepsWithWords`). **Start the process from this** applies the reading as the Sources stage does.
      - Then one question at a time, with where it came from, why it matters and what it updates. A choice, an input field, or the person's words read by `answerFromNotes`, with "This will record: …".
      - An answer about the shape is kept with the session; the draft changes only at **Update the draft from your answers (N)**, which writes the waiting answers as a "Discovery answers" source and takes them out of the session in the same step, reads that source with those the last reading read (`updateSources`), and shows what would change for the person to apply.
      - "Not known, ask someone" (`leaveWith`), "Not applicable" (`notApplicable`), Skip. A question about the shape left with someone is not asked again (`discoveryQueue`, by target).
      - A confirmed step or application is confirmed as a whole: an answer about any of its fields is held back and says so (`confirmedLine`, through `answerAgainstConfirmed`). Typed words behind such an answer are kept as a source `ans-N` first, so the conflict quotes a real source.
      - An application with no way in recorded is asked with a status per way in and "No way in" (`waysRecordLine`).
      - The session's cap, a full session (`FULL_LINE`), another page writing first (`BUSY_LINE`), the month's allowance used up and the minute limit are each said in plain words. "Started by {name} on {date}" with Finish; Finish with answers waiting offers to keep them as a source first.
    - The look in the sources waits while a session is in use and only then (`discoveryHoldsLook` in `journey/process/discoveryOpen.ts`, used by `useAutoLook`); an abandoned one blocks nothing.
    - The three review points of 24 November 2026: saving or removing the AI provider forgets the cached provider (`forgetVoice`), so the microphone follows without a reload; spoken words past the box's limit say so under it (`cutLine`); a provider that cannot be read leaves the microphone shown, as before 4a (the server still refuses a provider that cannot take speech).
    - The browser tests' stand-in gains a reading of the sources: a reply under `extraction` is the model a test gives, read from every source it is given, with each source's key and passages in the log (`standInReading`). The AI tasks' rule is unchanged: their replies are still refused when source passages are sent. Built only into the browser-test build, checked out of the released one as before.
    - After the review of 24 November 2026:
      - The first cards ("What do you want from this process?", "Is the work done today?") are saved with "Save and read it", never on a click.
      - Who chose is kept: the purpose with the person's id; a resolved conflict with their name and id as the Process stage stores them (`chosenBy`), and its value written as the Questions tab writes it (`conflictValue`, now in `domain/questions/conflictValue.ts` for both).
      - Words kept to read later show again on their card, with when they were kept, can be cleared (`dropLater`), and are counted in "Where discovery stands" ("Kept to read later: N.").
      - A viewer gets no Discovery tab; on a process with no steps the panel says "Someone who can edit this process can start Discovery."
      - Waiting answers stay in the session, marked with their source's key (`takingInto`), until the source is saved, and only then leave it; an answer whose source an earlier attempt saved is taken out and never written again (`waitingAgainst`); Finish finishes only once they are in a source.
    - After the preview of 25 November 2026 (a select of `source_ids`, which a signed-in person may not read, stopped every Sources page):
      - The store no longer reads a run's sources; the session keeps the sources of each reading it starts (`startedReading`, `sourcesRead`). A reading started elsewhere has none, and an update after it reads every active source.
      - What the store selects from a table granted column by column is listed in `domain/store/grantedSelects.ts`: its test checks each column against the migrations' grants and that no other select on such a table exists, and `supabase/tests/store_selects.sql` runs each list as a signed-in member.
      - A Discovery that cannot be opened says so, with "Try again".
    - After the owner's walk of 25 November 2026 ("Not applicable" on "Who does …?" said "This question is already open."): a first reading may store a gap's own question, which triage lists under the question's id. A card built from a gap now stands for the triage item with its key, else the open item on the same target (`coveringItem` in `domain/discovery/queue.ts`), so "Not applicable" closes the stored question, "Not known, ask someone" defers it, a typed answer closes it, and no second copy is added; one card per target. A gap a person closed or left is not asked again (by the stored question's target). A refused write is said on the card in plain words (`notSavedLine`), not at the top.
  - **5a, a gap a person closed, and re-readings (plan `claude/package-b-pr5-plan-25-nov.md`, approved by the owner on 25 November 2026; built the same day, in review). For the twelfth release, with the Discovery tab.**
    - A gap a person closed (its question answered without a value, "Not applicable to this process." for example) is not asked again: an answered question covers its gap in triage, the Questions tab's counts, the PDD and the BRD (`domain/questions/closedGaps.ts`). It opens again only when a person reopens its question. Closing the gaps says "N questions closed by a person are not asked again. Show them", each with its answer and Reopen. Left with someone stays left, as before.
    - Re-readings (keyed on the draft: once it has steps, in Discovery and on the Sources stage alike; a first reading is unchanged), in `proposeChanges` (`questionOffer`): (a) a question on a field already asked about, open, left or answered, is not added; (b) a question about the process as a whole is listed, not ticked; (c) a question about an element as a whole (a step, a rule, an exception) is added when nothing is asked about it, listed not ticked when something is. The review says "N new questions about the process as a whole are not ticked: tick the ones to keep." (`notTickedLine`).
    - The review's words (`domain/extract/reviewWords.ts`), on the Sources stage and in Discovery: no "extraction" or "model", the product's date with the 24-hour clock ("Read again on 25 November 2026 at 21:10. It differs from the draft in 4 places: choose what to take."; Discovery's "Read again with your answers on …" under "What the new reading would change").
    - Server functions: `domain/questions/triage.ts` and the new `domain/questions/closedGaps.ts` are loaded by `journey-ai` and `journey-notify`; they go live with the release only. Nothing else a function loads changes. No database change.
    - Test: `domain/questions/closedGaps.test.ts`, `domain/extract/rebase.test.ts`, `reviewWords.test.ts`, `tests/e2e/closed-gaps.spec.ts`, `tests/e2e/discovery.spec.ts`.
  - **5b, noticing and what you want to change (plan `claude/package-b-pr5b-plan-26-nov.md`, approved by the owner on 26 November 2026 with three additions from the review; built the same day, in review).**
    - Once the description's reading is done, Discovery notices on the person's own words (`own-N` passages) against what that reading understood, once (the passages read are kept in the session's `read`); "Start the process from this" waits for it. A typed or spoken answer that says more than its value (`worthNoticing`) is noticed once. Only the person's words go to `discoveryQuestions`; the call counts against the session's cap, and at the cap or the month's allowance nothing is noticed and the cards by rule go on.
    - The session keeps `raised` (cards raised and not yet acted on, each with its quote and target) and `wanted` (statements not yet kept): `noticedStep`, `dropRaised`, `dropNoticedWanted` in `domain/discovery/session.ts`. The table's `state` keeps any key, so no database change.
    - The queue (`domain/discovery/queue.ts`): a raised question on a field that takes one answer (who does a step, its application, a way in, a figure's unit) is dropped when a question on that target is closed or left, and joins the gap's card on that target when there is one (the card shows the quote as its origin); every other raised question is its own card under "About what you said". `noticeAsked` (`flow.ts`) gives noticing every question the record holds, closed and deferred ones too, and those of the session.
    - "Not applicable" and "Not known, ask someone" record `raisedBy` on a raised card's question (`flow.ts`).
    - What you want to change: in Discovery, each statement with its quote, **Keep** (`keepWantedEdit`, into `meta.wanted` with its quote) and **Not wanted**; on the first reading, "Held back: what you want to change" for each step whose every quote lies inside a statement noticed or kept (`heldBackSteps`), with "Add it as a step instead", only when the work is done today or partly; in The brief on the Process stage, `meta.wanted` with **Make it a requirement** (`domain/requirements/fromWanted.ts`: a business requirement with origin `user`, key `wanted:<id>`, the next free BR code, saved through `saveRequirements`) and **Remove**. The FRD and the BRD list it as any requirement; the As-Is map and the steps are unchanged.
    - `platform.ts`: the `discovery` line ("wants to happen" in place of "should happen", since the measure's test forbids "should" in platform facts) and package 16's `answer-questions` line with "Closing the gaps also lists the questions a person closed, with Reopen." `eval/ask/questions.json`: W11 to W13 (91 questions). `trust.ts`: the privacy words (workspace content and what goes to the AI provider); `UPDATED.privacy` is set by the release's own commit.
    - The browser tests' stand-in answers `discoveryQuestions` given a person's own words kept as sources (`own-N`, `ans-N`) and logs the words it was given (`said`); every other task is refused source passages as before.
    - Server functions: `journey-ai` and `journey-notify` load `platform.ts`; `journey-inquiry` loads `trust.ts`; at the release only. `discoveryQuestions`' instructions and `notice.ts` are unchanged. No database change.
    - Proved against `main` at `28fa072` (a throwaway script): a requirement made by "Make it a requirement" is listed in the BRD's business requirements and traced by the FRD of the released code, its code never collides with derived ones; a session holding `raised` and `wanted` is read by the released `readState`, kept through the released tab's steps, and its queue and summary run.
    - Test: `domain/discovery/noticing.test.ts`, `compat.test.ts`, `eval/discovery/replay.test.ts`, `domain/ai/standIn.test.ts`, `tests/e2e/discovery-noticing.spec.ts`, `tests/e2e/discovery.spec.ts`.
- **Pull requests 5 and 6:** as the plan has them.
- **Asked separately:** the check of about 70,000 tokens on the preview, before 4b merges, through a draft pull request from 4b's branch into `main` titled "Preview only, do not merge". The early deploy of `journey-ai` is no longer needed: the eleventh release deployed version 78, which carries `discoveryQuestions`.

### An application with no way in recorded (built 23 November 2026, in review)

**Built (second builder chat, 23 November 2026; plan `claude/no-way-in-answer-plan-23-nov.md` in the owner's project, approved by the owner with four additions).** Found while building package 16: an application with no ways in recorded (the sample's office scanner) stayed on the list after a free-word answer, because the rule that raises it (`system_access_unknown`) looks only at its ways in. Its question is now a choice (kind `ways`): each way in, or **No way in: a person does this**. Words alone close nothing and are shown plainly ("Your words do not say how the automation reaches ..., so nothing is recorded yet"). Found in review (24 November 2026): a way the assessment does not read, chosen alone ("Email: not available"), closed the question though nobody said the API or the screens could be used; an answer is now built only when the API or the screens are settled or "No way in" is chosen (`settlesWaysIn`), the same for words read from notes and the interview, and the card says "Say whether the API or the screens can be used as well; the recommendation depends on them." The four additions: what Save will record is said before it, and for "No way in" which steps then stay with a person (`waysRecordLine`); an earlier worded answer to the same question is shown on the card; discovery's cards ask it as a choice; and the ways in written are of the existing shape, replayed and edited afterwards as before (the shape proof in `ways.test.ts`). "No way in" also records that robots may not use its screens (`setSystemUiAllowed`), so the assessment holds its steps with a person; for a device the assessment does not score (a scanner), the line says its step keeps its recommendation. Not changed: the question's words, the `answerFromNotes` task's instructions (the question is presented to it as an access question), the database. The functions that load the changed files: `journey-ai` and `journey-notify` (`triage.ts`, `answer.ts`, `notes.ts`, `patch.ts`, `ways.ts`; `interview.ts` in `journey-notify`), so it goes live with a release. Test: `domain/questions/ways.test.ts`, `domain/discovery/queue.test.ts`, `tests/e2e/no-way-in.spec.ts`.

### A device's access question is Detail (built 24 November 2026, in review)

**Built (second builder chat, 24 November 2026; the owner's yes to the rule proposed in `claude/no-way-in-built-and-device-plan-23-nov.md`).** The assessment does not route through a device (`NON_INTEGRABLE`, today `scanner`), yet a scanner's access question was grouped "Changes the recommendation" whenever an open step used it, so it was counted in the Assessment stage's line and in the first list's "now". It is now still asked, for the documents (PDD 2.2 Applications), grouped as Detail, without "Assessment: N steps use it": one rule in `classify` in `domain/questions/triage.ts`, read wherever triage is (the line, the focused list, My work, the weekday email, Ask Avala's first list, discovery). Figures before and after (counts only): the bare sample's line 3 → 2 and first list {3, 0, 9} → {2, 0, 10}; the demo's sample unchanged (line 2, {2, 0, 10}: its scanner question was already Detail); the four live processes unchanged (one read-only, counts-only query: one has a scanner, which raises no question). The demo's data, its recorded Ask Avala answers and the homepage's figures do not move. Discovery: a session on the bare sample can end with the scanner's question still open as Detail. The functions that load `triage.ts`: `journey-ai` and `journey-notify`, so it goes live with a release.

### Package C: meeting preparation and the BA panel (plan `claude/package-c-plan-26-nov.md`, revision 2, approved by the owner on 26 November 2026)

A briefing before a requirements call (what is open, in what order, who on the call can answer it), and a private panel during the call that the analyst feeds with typed or short spoken notes, which suggests the next question with the words it came from and saves nothing until the analyst ends the call and confirms. No meeting platform: the live Teams feed is package D, not planned. No database change, no server function change, no new AI task: it reuses `answerFromNotes`, `discoveryQuestions`, triage, `whoToAsk`, `meetingResult` and the microphone. The owner's changes on approving it: a running call lives on the device (local storage, one key per process; "A call from {time} was not finished: Continue · Discard"; "Download my notes"; removed at Save, Discard and sign-out); the replay's AI runs count against "Test", now, each on the owner's yes, and any trial on a screen is in "Avala check" only; "Stated in your notes" in place of "You said it"; `process_sources.kind` takes "Call notes" with no database change.

- **C1, the rules, no screen (built 26 November 2026, in review).** `domain/meeting/`:
  - `briefing.ts`: the call list from `discoveryQueue`, for the kinds of person on the call (`ownerOf`), a question left with a person on the call first, the analyst's own questions after it, fitted to the call (`fits`: 5 minutes of opening, then 3 a question: 8, 13 and 18 for 30, 45 and 60 minutes), the analyst's moves (`arrange`, `moveItem`), "Not for this call" by `whoToAsk`, where the process stands, what is open, and "Copy the agenda" (`agendaText`, questions only);
  - `panel.ts`: when to read (`readingDue`: at most once a minute, or "Read now"; `readingNotes`: the notes since the last reading and one before), one reading's two calls (`prepareReading`: at most 12 questions from the list, those asked first, and 3 held; `itemFor`: a choice is never read from notes), what came back (`applyReading`: answers kept under their question's key, the hold, noticing's questions held one reading, a failed call counted and its notes sent again), the next question (`nextQuestion`: "Ask it now" first, then one follow-up to the last two notes at most in a row, then the list, then other raised questions, then what was skipped; only questions someone on the call can answer), Asked, Skip, Someone else knows, Not right, and the end reading (`prepareEnd`: every note against at most 60 open questions in two calls; `applyEnd`);
  - `review.ts`: what the review lists (`buildReview`: answers ticked when stated in the notes, not when inferred or a number of cases with no period; questions raised and asked kept open and ticked; left with someone ticked), the notes as a source (`callNotesSource`: `ans-N`, kind "Call notes", one passage per note with its time and who said it as its place, titled "Call notes by {name}, {date}, {start} to {end}"), and the one edit Save writes (`callEdit`, through `buildAnswer`, `answerAgainstConfirmed`, `inputEdit`, `record` with `raisedBy`, `addQuestion` and `deferQuestion`; History's line "Call of {date}: N answers, M questions kept open, K left with someone");
  - `kept.ts`: the call as kept on the device (`callKey`, prefix `avala:call:`; `readCall` reads it without trusting it; `mergeCalls` merges two tabs by note id; notes with their limits of 300 notes and 20,000 characters; `continueCall` builds the list again for a call more than 7 days old; `notesFile` and `notesFileName` for "Download my notes");
  - `limits.ts`: the cap (150,000 tokens and 50 AI calls a call, 20,000 tokens and 3 calls kept for the end reading);
  - `words.ts`: every line of the screens, for the owner's word on the preview.

  Nothing is on screen. No file a server function loads changes (the import walk: `journey-ai` 61 files, `journey-extract` 30, `journey-inquiry` 5, `journey-invite` 4, `journey-notify` 52; none in `domain/meeting/`). The prefix joins `SIGN_OUT_FORGETS` with the screens (C3). Test: `domain/meeting/briefing.test.ts`, `panel.test.ts`, `kept.test.ts`.
- **C2, the replay's call mode:** next, new files only (`eval/discovery/`), runs on "Test" on the owner's yes.
- **C3, the screens:** only after 5b is merged, with 5b's "already asked" context (`PrepContext.asked`).
- **C4, after 5b:** the entry in Discovery, "What you want to change" in the review; the privacy words and a `platform.ts` line only if decided.

### Dated items

- **The platform key's speech model, any time before 15 January 2027. Closed 23 November 2026:** released with the tenth release (`journey-ai` version 77); the owner's check on avalaos.com straight after, confirmed by the review chat from the database and the function's log (06:02 to 06:06 UTC): one spoken answer on `gpt-transcribe` counted 460 tokens in and 0 out, and the log line reads "transcribe usage form: duration (gpt-transcribe)", so `gpt-transcribe` sends the duration form, counted at 20 tokens a second. The 15 December 2026 backstop is not needed. OpenAI shuts down `gpt-4o-transcribe` on 26 February 2027 and names `gpt-transcribe` for audio files.
  - **Tried on 20 November 2026 (owner), on avalaos.com, platform key** (rows in `ai_usage`, times UTC): 13:15 `gpt-4o-transcribe`, done, 207 tokens in and 32 out; 13:19 and 13:22 `gpt-transcribe`, done, the text right, 0 in and 0 out both times; 13:27 `gpt-4o-transcribe` again, done, 259 in and 67 out. The secret `OPENAI_TRANSCRIBE_MODEL` did not exist before; it was added as `gpt-transcribe` for the test and then deleted, so voice is back on the code's default, `gpt-4o-transcribe`.
  - **Found:** `gpt-transcribe` works, but `journey-ai`'s `transcribe` action reads tokens only from `usage.input_tokens` and `usage.output_tokens` (`supabase/functions/journey-ai/index.ts`), and that reply has none there. So its calls are recorded with 0 tokens and are not counted against the monthly allowance. OpenAI's reference gives a transcription's `usage` in one of two forms: tokens (`type: "tokens"`, `input_tokens`, `output_tokens`), or, for models billed by the length of the audio, `type: "duration"` with `seconds`; `gpt-transcribe` is billed by the minute of audio. The duration form is the likely one, but it was not seen: the function keeps only the counts, not the reply.
  - **The switch waits for a fix (built 21 November 2026, see below; plan of 20 November 2026, `claude/speech-model-usage-plan-20-nov.md` in the project, approved by the owner the same day with two additions).** A rule in `domain/ai/usage.ts`, `transcriptionUsage`, turns the reply's `usage` into the row's tokens: the token form as today; the duration form as the seconds times `VOICE_TOKENS_PER_SECOND`, 20 (owner), counted as input; a reply with neither is counted from the recording's size at a stated low rate, so voice is never counted as nothing. The `transcribe` action writes one line to the function's log naming which form it read, `tokens`, `duration` or `neither`, and nothing of the reply's content; `neither` is written as a warning, so an unexpected reply shape is noticed and not quietly estimated. The unit test covers all three forms and replies with nonsense in them. No database change. `journey-ai` changes, so it goes live with a release.
  - **When:** built with the per-minute AI limit (item 2 of the order in section 1), which changes the same function's limits, and released with it. The same release makes `gpt-transcribe` the code's default (owner), so no secret is set; setting `OPENAI_TRANSCRIBE_MODEL` to `gpt-4o-transcribe` puts voice back until 26 February 2027. **Backstop (owner):** if the release with the per-minute AI limit has not happened by 15 December 2026, the speech fix is released on its own, on the owner's yes.
  - **Built 21 November 2026 (in review; changes `journey-ai` at the release; no database change):** `transcriptionUsage`, `transcriptionLogLine`, `VOICE_TOKENS_PER_SECOND` (20), `VOICE_FALLBACK_BYTES_PER_SECOND` (2,000) and the cap `VOICE_TOKEN_CAP` (12,000, ten minutes) in `domain/ai/usage.ts`; the `transcribe` action counts with them and logs the form (`neither` with `console.warn`); `gpt-transcribe` is the code's default; "AI use this month" says "Spoken answers are counted at 20 tokens a second of audio." (`VOICE_COUNT_NOTE`). A token form whose input and output add up to 0 is absent (review chat, 21 November 2026): it falls through to the duration form, else to the estimate from the size, logged as `neither` with the warning, so voice is never counted as nothing. A request the provider refuses (an error status) counts nothing, as before, and writes no line. Test: `domain/ai/usage.test.ts`.
  - **After that release, the owner, on avalaos.com:** record one spoken answer and check its text; check that its row in "AI use this month" shows `gpt-transcribe` and more than 0 tokens, 20 for each second of the recording (if it shows 0, stop and say so). Then the function's log (Supabase → Edge Functions → `journey-ai` → Logs) shows which form `gpt-transcribe` sent; if it says `neither`, the count was estimated from the recording's size: stop and say so.
- **The weekday email's link for open questions, before the first organisation on the "Assess" set-up.** It opens Documents (`domain/work/home.ts`, the stage of the questions need), which that set-up does not have. `journey-notify` loads that file, so the fix changes the function at a release. Package 16 fixes My work's screen only.

## 4. After that release: the order advised

The owner chooses; this is the advice and the reason for each place.

1. **Three more real processes, of different kinds.** This is still the largest risk and the cheapest way to find faults: one with a flowchart picture or a draw.io file, one long call with several speakers, one existing process with volumes and times (so value and payback are exercised). The owner tests, the review chat repeats the test read-only and lists findings, a builder chat fixes. Runs alongside everything else.
2. **The weekday email and comments** (built as package 5 in section 3b). The email counts what the screens count, and a comment on a document reaches the people named on the process. One change to the live database and one server function; a rolled-back trial first, then the owner's yes.
3. **The evidence pack** (built as package 6 in section 3b). Everything in it already exists on the record; it is assembling and a download. Useful to show a regulated client.
4. **The other AI providers.** Run the extraction check on each (the owner types each key into Settings → AI provider himself), then offer those that pass. The homepage follows on its own.
5. **Push to Jira.** The largest item here. Advice: wait for a pilot client that asks for it, since the CSV export already gets work into Jira; then Jira first and one way first (send items, with requirement links), status coming back second. It needs a place for the client's Jira token on the server (encrypted, as AI keys are), a server function and a table for the links: all asked for first.
6. **More typical processes**, once a real person has started from the supplier invoice one.
7. **Ask Avala's open decisions**, then the board's step 3, then the "later" list.

## 5. Decisions for the owner

| Decision | Advice |
| --- | --- |
| The next release is the three packages in section 3 | Yes |
| Hold the release until the second bundle (section 3b) is built | Decided by the owner, 16 November 2026 |
| "Not right" on an answer found in the sources holds for everyone | Yes (a working default) |
| Open review comments show under "Needs you" for the people named on the process | Yes |
| Six columns as the limit before a map becomes a simple flow | Start with six; change after seeing real maps |
| Left to right in the same package | Yes, on screen only, and dropped if it does not look right |
| What Avala OS promises to document | Process documentation for any team, not documentation in general (owner, 16 November 2026) |
| A person says what they want from a process; Avala OS never works it out | Yes (section 3c) |
| The line above the homepage headline names analysis and delivery teams too | Yes (owner, 17 November 2026); in `next` for the next release |
| Push to Jira and Azure DevOps | Wait for a pilot that asks |
| The interview replaces "Closing the gaps" | Not yet |
| A company's own document section may have text per process | Yes, when Ask Avala's section drafts are built |
| A real .xlsx file for the test pack | Not now |
| Delete the Questionnaire Tooling copy in "Test" | The owner's call |
| The database's paid plan, payment, the lawyer | Before the first paying client |

**Asked each time, never assumed:** any change to the live server functions or the live database.
