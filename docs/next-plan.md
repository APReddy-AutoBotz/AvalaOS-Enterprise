# Avala OS: what is left, and the next work

Written on 16 November 2026, after the fifth release, at the owner's request. It lists everything still open on the platform, sets out the next release as work packages a builder can start on, and gives an order for what follows. The owner builds in one chat and has the result reviewed in another, so every package ends with what the review will check.

This file is kept in two places: `docs/next-plan.md` in the repository (the source of truth) and `claude/next-plan.md` in the owner's project. Change both together. The rules in `AGENTS.md` hold throughout; nothing here changes them.

## 1. Where the platform stands

Live on avalaos.com since the fifth release (16 November 2026): the whole journey from sources to the Delivery board; Ask Avala everywhere, its interview and its suggestions; bring your own AI key; a workspace per client; the parts an organisation uses; the Delivery board on its own with comments, history, labels, sprints and import from Jira; and the whole effort-first plan (fewer questions, the brief, the delivery plan, work not done today, a typical process to start from, the agent document, the test pack with testers' edits, review comments, the effort scorecard).

Proven on real documents so far: two of the owner's own processes (Questionnaire Tooling, Project time writing) and the sample's documents. Each real test found faults the sample had not shown. That is the pattern to expect, and the reason section 4 puts more real processes first.

Releases: 4 production deploys are left until 22 November 2026. Bundle work; one release for section 3.

**Update, 16 November 2026 (afternoon):** section 3 is built and merged into `next` (pull requests #162, #163, #164), with no server function or database change. The open pull request `next` → `main` is the preview for the review; nothing is released until the owner says "release". What was built, and where it differs from the plan, is at the start of section 3.

## 2. Everything still open

### Small faults, no server or database change

- A typical-process comparison a person asked for, and "Skip for now", are forgotten when the page is left (left as they are on purpose: light conveniences).

The map's single shape, the repeated look in the sources and the other small faults of the owner's test of 16 November are built (section 3), in review.

### Small faults that need a change to the live server or database (ask first, one by one)

- The weekday "Needs you" email counts every open question, not the first list (the count is made in SQL, `needs_digest_input`).
- Review comments notify nobody and are not in the weekday email.
- Answers found in the sources are kept per browser, so two people can see different "found" and "only people can answer" counts. Sharing them needs a table.
- A failed extraction keeps no detail of what it had read.
- Errors in the server functions are only in the Supabase logs, not in the error monitor.

### Features agreed or proposed, not built

| Feature | State |
| --- | --- |
| Push to Jira and Azure DevOps, with status coming back | Not built. The owner has not decided. Today: CSV export for both, CSV import from Jira. |
| Evidence pack for regulated clients | Not built. One download: requirements, where each came from, who approved, test cases and their links. |
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

## 4. After that release: the order advised

The owner chooses; this is the advice and the reason for each place.

1. **Three more real processes, of different kinds.** This is still the largest risk and the cheapest way to find faults: one with a flowchart picture or a draw.io file, one long call with several speakers, one existing process with volumes and times (so value and payback are exercised). The owner tests, the review chat repeats the test read-only and lists findings, a builder chat fixes. Runs alongside everything else.
2. **The weekday email and comments.** The email counts what the screens count, and a comment on a document reaches the people named on the process. One change to the live database and one server function; a rolled-back trial first, then the owner's yes.
3. **The evidence pack.** Everything in it already exists on the record; it is assembling and a download. Useful to show a regulated client.
4. **The other AI providers.** Run the extraction check on each (the owner types each key into Settings → AI provider himself), then offer those that pass. The homepage follows on its own.
5. **Push to Jira.** The largest item here. Advice: wait for a pilot client that asks for it, since the CSV export already gets work into Jira; then Jira first and one way first (send items, with requirement links), status coming back second. It needs a place for the client's Jira token on the server (encrypted, as AI keys are), a server function and a table for the links: all asked for first.
6. **More typical processes**, once a real person has started from the supplier invoice one.
7. **Ask Avala's open decisions**, then the board's step 3, then the "later" list.

## 5. Decisions for the owner

| Decision | Advice |
| --- | --- |
| The next release is the three packages in section 3 | Yes |
| Six columns as the limit before a map becomes a simple flow | Start with six; change after seeing real maps |
| Left to right in the same package | Yes, on screen only, and dropped if it does not look right |
| Push to Jira and Azure DevOps | Wait for a pilot that asks |
| The interview replaces "Closing the gaps" | Not yet |
| A company's own document section may have text per process | Yes, when Ask Avala's section drafts are built |
| A real .xlsx file for the test pack | Not now |
| Delete the Questionnaire Tooling copy in "Test" | The owner's call |
| The database's paid plan, payment, the lawyer | Before the first paying client |

**Asked each time, never assumed:** any change to the live server functions or the live database.
