# Avala OS: what is left, and the next work

Written on 16 November 2026, after the fifth release, at the owner's request. It lists everything still open on the platform, sets out the next release as work packages a builder can start on, and gives an order for what follows. The owner builds in one chat and has the result reviewed in another, so every package ends with what the review will check.

This file is kept in two places: `docs/next-plan.md` in the repository (the source of truth) and `claude/next-plan.md` in the owner's project. Change both together. The rules in `AGENTS.md` hold throughout; nothing here changes them.

## 1. Where the platform stands

Live on avalaos.com since the fifth release (16 November 2026): the whole journey from sources to the Delivery board; Ask Avala everywhere, its interview and its suggestions; bring your own AI key; a workspace per client; the parts an organisation uses; the Delivery board on its own with comments, history, labels, sprints and import from Jira; and the whole effort-first plan (fewer questions, the brief, the delivery plan, work not done today, a typical process to start from, the agent document, the test pack with testers' edits, review comments, the effort scorecard).

Proven on real documents so far: two of the owner's own processes (Questionnaire Tooling, Project time writing) and the sample's documents. Each real test found faults the sample had not shown. That is the pattern to expect, and the reason section 4 puts more real processes first.

Releases (owner, 17 November 2026): 65 Netlify credits are left, about 15 a production deploy, so about 4 deploys; 1,000 credits are added on 22 November 2026. From then credits no longer limit releases; changes are still bundled so each release is reviewed on the preview first.

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

**Not built. For a builder chat; the review chat reviews the plan and the result before any release.**

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

### After that release: the Tiptap upgrade (owner, 18 November 2026; not built)

The section editor's library, Tiptap, carries a moderate advisory (`mergeAttributes()` can turn an own `__proto__` key into inherited attributes) fixed only in Tiptap 3, a major version that changes how the editor is set up. A small separate package after the release: move `@tiptap/react`, `@tiptap/starter-kit` and `@tiptap/pm` to 3, adjust `journey/process/SectionEditor.tsx`, and keep what the editor allows and how saved sections read (the existing tests and a browser test of editing a section). The dependency check then shows no moderate advisory in what is shipped.

### After package 12: a content security policy (owner, 18 November 2026; not built)

A content security policy for every page, first in report-only mode, allowing exactly what the pages use: this site, the Supabase project, Sentry, and the visit counter of package 12. It is enforced only after a clean period with no unexpected reports. Its order: after package 12, before or with the release that follows, as the owner decides.

## 3f. After the outside review of the repository: packages 13, 14 and 15 (owner's decisions, 17 November 2026)

**Package 15 is built (17 November 2026, #195); package 13 parts A and B are built (18 November 2026, #198 and #199), then part C and package 12, one release on the owner's word; package 14 after that release. The review chat reviews each plan and each result before any release.**

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

**Before the release: putting the previous functions back, and the live checks.**

- Before merging into `main`, the builder checks that `main`'s last commit message has no `[deploy]` and pushes a branch `claude/functions-before-<release>` at that commit (today `bab6440`). If a function misbehaves after the release: GitHub → Actions → Deploy edge functions → Run workflow, choose that branch and the one function (or all). This puts back that function exactly as it was before the release; nothing in the database changes with it, so nothing else needs undoing.
- In the release's own commit: set `COVERAGE_RULE.since` in `domain/assess/coverage.ts` to the release date.
- Straight after the release, first the allowed websites (owner): in the browser's network panel on avalaos.com, a function's answer names https://avalaos.com in Access-Control-Allow-Origin and says Vary: Origin. Then, on avalaos.com with a real account: sign in; read a source (an extraction run on a small process); draft a section's text on Documents; a voice answer in the interview; "Test this key" on a workspace with its own key (and once on the platform key); a walkthrough request from the homepage; one extraction check from the workflow (`ap-invoice`).

**C. The walls between workspaces (the database: additive, its tests, a rolled-back trial, the owner's yes).**

- **A board item can only point at work, a parent and a process of its own workspace (F01),** and confirming proposals refuses an item of another workspace.
- **A workspace cannot be moved to another organisation (F02).**

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

**Underneath.** The baseline has a table `document_revisions` with no rows; say in the plan whether it fits. A database change is expected: additive, its test, a rolled-back trial, the owner's yes. What is kept is the built document, not only what it was built from, so a release cannot change it.

**Done when.** Unit tests: an approved version is unchanged by each kind of later change; the reason is required; what changed lists exactly the sections that differ. A database test for who may write and that a kept version cannot be altered. Browser tests on the sample: approve, edit a section, see "unapproved changes", approve with a reason, open version 1 and download it as it was. The homepage's line "An approved revision is never changed" is then true of the documents as well.

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
