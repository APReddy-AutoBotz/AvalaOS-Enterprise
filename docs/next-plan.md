# Avala OS: what is left, and the next work

Written on 16 November 2026, after the fifth release, at the owner's request. It lists everything still open on the platform, sets out the next release as work packages a builder can start on, and gives an order for what follows. The owner builds in one chat and has the result reviewed in another, so every package ends with what the review will check.

This file is kept in two places: `docs/next-plan.md` in the repository (the source of truth) and `claude/next-plan.md` in the owner's project. Change both together. The rules in `AGENTS.md` hold throughout; nothing here changes them.

## 1. Where the platform stands

Live on avalaos.com since the fifth release (16 November 2026): the whole journey from sources to the Delivery board; Ask Avala everywhere, its interview and its suggestions; bring your own AI key; a workspace per client; the parts an organisation uses; the Delivery board on its own with comments, history, labels, sprints and import from Jira; and the whole effort-first plan (fewer questions, the brief, the delivery plan, work not done today, a typical process to start from, the agent document, the test pack with testers' edits, review comments, the effort scorecard).

Proven on real documents so far: two of the owner's own processes (Questionnaire Tooling, Project time writing) and the sample's documents. Each real test found faults the sample had not shown. That is the pattern to expect, and the reason section 4 puts more real processes first.

Releases: 4 production deploys are left until 22 November 2026. Bundle work; one release for sections 3 and 3b (the owner holds the release until 3b is built, 16 November 2026).

**Update, 16 November 2026 (afternoon):** section 3 is built and merged into `next` (pull requests #162, #163, #164), with no server function or database change. The open pull request `next` → `main` is the preview for the review; nothing is released until the owner says "release". What was built, and where it differs from the plan, is at the start of section 3.

**Update, 16 November 2026 (evening):** section 3b is built and merged into `next` too (pull requests #168, #169, #170). Its two database changes were applied on the owner's yes after rolled-back trials, at 09:53 and 09:54 UTC (`process_source_looks`, `digest_counts_and_comments`); the email server function `journey-notify` changes with the release and was not deployed by hand. One release carries sections 3 and 3b. What was built, and where it differs from the plan, is at the start of section 3b.

## 2. Everything still open

### Small faults, no server or database change

- A typical-process comparison a person asked for, and "Skip for now", are forgotten when the page is left (left as they are on purpose: light conveniences).

The map's single shape, the repeated look in the sources and the other small faults of the owner's test of 16 November are built (section 3), in review.

### Small faults that need a change to the live server or database (ask first, one by one)

- A failed extraction keeps no detail of what it had read.
- Errors in the server functions are only in the Supabase logs, not in the error monitor.
- A person's choice of approach (and of the maps' shape, and a resolved conflict) is stored with the email address of who made it, so the evidence pack says "Not recorded" for who. Recording the person's name, or their id, from now on is a small change to what is stored (found while building package 6).

The weekday email's count, review comments in it and on My work, and the look in the sources shared by everyone are built (section 3b), in review.

### Features agreed or proposed, not built

| Feature | State |
| --- | --- |
| Push to Jira and Azure DevOps, with status coming back | Not built. The owner has not decided. Today: CSV export for both, CSV import from Jira. |
| Evidence pack for regulated clients | Built (section 3b, package 6), in review. |
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
- "Request a pilot" is an email link until a form exists.
- Installation in a company's own cloud is offered on the homepage and has never been done.
- Two-step sign-in on Sentry, and "Allow join requests" off there. Leftover `claude/` branches can be deleted.
- To confirm: Google and Microsoft sign-in are switched on in Supabase (the page shows a button only for a provider that is).

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

### After the second bundle

- Run the Ask Avala measure once (the workflow "Ask Avala measure"): a line about map shapes was added to what Ask Avala knows in package 1 and the measure has not run since. Report the result.
  Done on 16 November 2026 on `next` with every package merged: every target met, 88 of 88 questions (33 the record answers, 8 in part, 16 it does not hold, 11 on how the platform works, 6 asking to change a score, 6 with an instruction in a passage, 8 about another workspace or the outside world), no name or number in an answer that is in no fact; about 18,400 tokens a question on a process, 8,900 on a board, 6,900 on the workspace; 1.39 million tokens in all, counted against the workspace "Avala check".
- Bring the notes up to date as before. The preview stays the open pull request `next` → `main`; do not merge it.
- The report says, apart from the usual: which migrations were applied and when, which server functions change with the release, and what could not be tried before it.

**Not in this bundle, and why.** The other AI providers (each needs the owner's own key and a run of the reading check). The push to Jira (waits for a pilot that asks). More typical processes (after a real person has used the first). What a failed reading keeps, and server errors in the error monitor (they touch the reading function or need a new library).

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
| Push to Jira and Azure DevOps | Wait for a pilot that asks |
| The interview replaces "Closing the gaps" | Not yet |
| A company's own document section may have text per process | Yes, when Ask Avala's section drafts are built |
| A real .xlsx file for the test pack | Not now |
| Delete the Questionnaire Tooling copy in "Test" | The owner's call |
| The database's paid plan, payment, the lawyer | Before the first paying client |

**Asked each time, never assumed:** any change to the live server functions or the live database.
