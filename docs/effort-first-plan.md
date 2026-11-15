# Avala OS: the effort-first plan

Agreed by the owner on 15 November 2026. Built so far (on the preview, not released): parts D, A, B, C, I and E (one trial reference, AP invoice processing; the owner checks its content before release); the brief's reading task is live on the server (15 November 2026). Part C was built without changing the extraction function: whether the work is done today comes from the brief. It follows the owner's first test on real documents and takes in the owner's ideas: an intake, a choice of documents, an agent document, test cases, a start with no documents, and typical processes to start from.

This file is kept in two places: `docs/effort-first-plan.md` in the repository (the source of truth) and `claude/effort-first-plan.md` in the owner's project. Change both together.

## 1. The one rule

**Avala OS does the work; people confirm it.** A client's team must end up with less to do than before they opened Avala OS, at every step. Each part of this plan is held to four tests:

1. **Never ask what the sources already say.** If a document states it, Avala OS reads it and shows it for one-click confirmation.
2. **Never show a blank form.** Every form arrives filled in, with where each answer came from. The one exception is a start with no documents at all (part A).
3. **Ask each question once, of the right person, in their own tool** (a Word pack, an email, the interview), and never ask the analyst what only the process owner knows.
4. **Hand over in the client's formats** (their Word template, their tracker, their platform's headings), so nobody re-types anything.

## 2. What organisations struggle with today

Each finding is followed by what it means for Avala OS. Sources are numbered at the end.

**A. The wrong work gets automated.** EY reports that as many as 30 to 50% of first RPA projects fail, and names "targeting the wrong processes" first [1]. A survey of executives reported by a trade article put 30% of failed RPA projects down to poor understanding of the process [2].
*For us:* the assessment is the core. It must stay arithmetic, and it must say "this does not need AI" or "do not automate this" as readily as the opposite.

**B. Requirements are where projects are lost.** PMI found that 47% of unsuccessful projects miss their goals because of poor requirements management, and that it wastes $51 million of every $1 billion spent [3][4].
*For us:* requirements with a source on every line, and a visible list of what is still unknown, are worth more than a faster document.

**C. Writing the documents is slow, skilled work, and analysts are the bottleneck.** Practitioners report anything from a few days to several weeks for a PDD and SDD [5]; one estimate is 6 to 12 analyst hours to document one process as it is, plus half as much from the subject expert [6]; a requirements document typically takes two to four weeks [7].
*For us:* the measure that matters is hours from "here are our files" to "documents a reviewer can read". That is the number a client will buy on.

**D. Knowledge lives in people's heads and in meeting recordings.** Vendors' capture tools assume a person performs the process while a recorder watches (UiPath Task Capture builds its PDD that way [8]). That cannot work when the process does not exist yet, which is the normal case for agents.
*For us:* starting from transcripts, notes and requirements, not recordings, is a real difference. It only counts if "not done today" is handled properly (part C).

**E. AI and agent projects stall between pilot and production.** MIT's 2025 study found about 95% of organisations saw no measurable return from generative AI, and blamed brittle workflows and poor fit with daily operations, not the models [9]. Gartner expects over 40% of agent projects to be cancelled by the end of 2027 for cost, unclear value or weak risk controls, and says many "agentic" use cases do not need an agent [10]. A 2026 survey of 650 technology leaders found 78% running an agent pilot and 14% with one scaled [11]; Deloitte finds only 21% have mature governance for agents [12]; Bain's survey of 951 companies names data access and integration as the largest barrier (41%) [13].
*For us:* an agent needs its boundaries, its reviewer, its systems access and its success measure written down before anyone builds. Nobody has a standard document for that: a UiPath forum thread says there is no fixed standard like the PDD and SDD for agent work [14], and the community's "Agent Definition Document" is an early attempt [15].

**F. Processes should be redesigned, not copied.** Deloitte: enterprises stall because they automate tasks designed for human workers [16]. Bain: ask "if we were designing this process from scratch today, what would it look like?" before any technology talk [13].
*For us:* a process with no "as it is" must be a first-class case, not a workaround.

**G. Programmes stall at about twenty automations, with no proper intake.** ISG describes an "RPA wall" at around 20 processes [17]; a guide for centres of excellence lists "no coherent intake process" among the usual symptoms [18].
*For us:* the intake and the portfolio view are what a centre-of-excellence lead buys, more than any single document.

**H. What gets built breaks, and nobody wrote down why it was built that way.** In a Forrester study 45% of firms had bots break weekly or more often [19]; licences are only 25 to 30% of what RPA costs to run [20].
*For us:* exceptions, rules and the reasons for each design choice must survive in the documents, and a change to the process must show what it breaks (this exists: "what changes" on every edit).

**I. Regulated industries carry a documentation and testing burden on top.** An FDA audit at a biotech found RPA with missing validation documents, requirement traceability and test evidence [21]. One biopharma measured about 132 hours of manual effort per change, 42 of them preparing and signing test scripts [22].
*For us:* the chain from requirement to work item to test case, with who approved what, is something Avala OS already holds. Test cases are the missing link.

**The competition.** UiPath now has an agent, Cartographer, that turns a "map of work" into a PDD and then an SDD and publishes them to its Automation Hub [23]. It serves UiPath customers on UiPath. Avala OS's ground is different: it is not tied to one platform, it starts from the documents a client already has (or from nothing), it decides the approach by fixed tables that can say "no AI needed", and a named person signs off.

## 3. Inside the organisation: who gets what, ready-made

| Person | What costs them time today | What Avala OS should hand them |
| --- | --- | --- |
| Head of automation / centre of excellence | Sorting ideas, defending which ones to fund | A filled-in brief per idea, a comparable score, a portfolio order, and "what you expected against what the assessment says" |
| Business analyst | Reading everything, chasing answers, writing documents | First documents within the hour, and a short ranked list of what only people can answer |
| Process owner / subject expert | Meetings, and being asked the same thing twice | One pack of their questions, answerable in Word or by voice, never re-asked |
| Solution architect | Finding out what was actually decided | An SDD with open design decisions listed, not hidden |
| Developer | Going back to the analyst with questions | Work items with criteria, in their tracker |
| Tester | Writing test cases from documents by hand | Test cases linked to requirements, exportable |
| Risk, quality, audit | Proving who decided what from which evidence | Sources on every line, approvals, history, the requirement-to-test chain |

## 4. Where Avala OS itself makes people work too much today

Found on the owner's first real documents (15 November 2026), stated plainly:

1. **68 open questions** were put in front of the user after one extraction. That is work, not help.
2. **The process is assumed to be done today.** The documents described a tool to be built; the steps were labelled "As-Is" and the value figures meant nothing.
3. **All four documents are always produced**, wanted or not.
4. **Internal wording** ("model") on the Sources screen. The plainer wording is approved and on hold (`claude/approved-on-hold.md` in the project); build it with part A.
5. **Nothing for testers.**
6. **Hand-over is by file export**, not into the client's tracker.
7. **A client with no documents has nowhere to start.**

## 5. The plan

Each part says what the person sees, what Avala OS does unasked, the most it may ask of them, what changes underneath, and how we will know it worked. The parts are lettered; section 6 gives the order.

### D. Fewer questions, and most of them answered for you (build first)

- **Sees:** "7 things only your people can tell us", not 68. The rest are grouped under "can wait until sign-off".
- **Does unasked:** before showing any question, looks for its answer in the sources (the "Suggestions" work already does this on request; it becomes automatic after extraction, within a token limit); merges duplicates; drops questions the brief already answers; routes each to its likely owner and builds their pack.
- **May ask:** a hard first list: only questions whose answer would change the recommendation or block a document, capped at 7 (the owner may change the number). Everything else waits.
- **Underneath:** rules over the existing question triage; one automatic run of an existing AI task. No database change. Uses AI tokens per extraction: to be measured and shown.
- **Proof:** on the owner's documents, the first list is at or under the cap, and the share of questions answered from sources is reported.

### A. The brief, filled in for you (the owner's intake idea)

- **Sees:** after the first files are read, a one-screen brief: what this is in two lines; whether the work is done today; what kind of thing it is (existing process, new process, tool or agent to be built); which applications it touches; what the team has in mind (RPA, API, AI, an agent, or "tell us"); which documents are wanted.
- **Does unasked:** fills in every line from the sources, each with the passage it came from.
- **May ask:** one confirmation of the whole brief; at most the lines the sources are silent on.
- **With no documents at all** (owner, 15 November): the same brief as a short form for the few fixed facts (name, department, whether the work is done today, applications, what they have in mind), plus "Tell us in your own words": the person types or speaks for a few minutes about how the work goes. That description is saved as the first source (notes and voice are already read as sources), and the steps are read from it. From here the client may also start from a typical process (part I).
- **Underneath:** stored as facts on the process record, like every other fact (source, or confirmed by a person). No new database table. The reading is one more extraction task, so the extraction server function changes: **needs the owner's yes at the time.**
- **Proof:** on the owner's real documents the brief must come back saying "not done today; a tool to be built", unprompted.

### B. The delivery plan, by rule

- **Sees:** one panel: "For this process: these stages, these documents, these questions first", each line with its reason, each changeable.
- **Does unasked:** picks from a fixed table. RPA or API on existing work: PDD and SDD. Agent or AI-assisted: process document, agent document, SDD. New tool, nothing done today: BRD, FRD, SDD. BRD and FRD stay one click away for clients whose auditors want them. The requirements list always exists underneath, because work items and test cases are built from it.
- **Expectation against assessment:** what the team had in mind is recorded as an expectation, never as the decision. After scoring, Avala OS says where they agree and where they do not ("an agent was expected; 15 of 20 steps are plain rules").
- **May ask:** nothing.
- **Underneath:** a rule table and a per-process choice of documents. No database change expected; to confirm when built.
- **Proof:** a unit test per row of the table; on the sample case the plan must read as an analyst would write it.

### C. Work that is not done today

- **Sees:** "Intended process" in place of "As-Is" everywhere; one map; no "hours saved" figure. Value becomes "what this would take by hand" from an expected volume and time per case a person enters, shown as a range while unknown.
- **Does unasked:** scores each intended step with the same tables (the facts it weighs, such as structured input, complete rules and need for judgment, describe the work, not its history). The tool being built is no longer listed as an existing application.
- **May ask:** expected volume and time per case, only if the client wants a value figure.
- **Underneath:** extraction instructions, assessment wording, documents and maps. Extraction server function: **needs the owner's yes at the time.** A live measured run before and after, on the sample and on the owner's documents.
- **Proof:** the owner's own documents produce a sensible intended process and a recommendation that does not treat the tool as today's work.

### I. A typical process to start from (a trial with one process)

Agreed by the owner on 15 November 2026 as a change to the rule "invent nothing": a typical pattern may be offered, but only labelled and only until people confirm it.

- **Sees:** "Start from a typical process". The steps, rules and exceptions of the reference process appear, each marked **Typical** with where it came from. A quick confirm pass asks, step by step: "we do this", "we don't", "ours is different". Their applications replace the placeholders.
- **Does unasked:** offers the reference when the process name matches; with documents present, uses the reference as a checklist ("a typical AP process has a three-way match; your documents do not mention one").
- **Rules that keep the promise:**
  - Reference processes are written by us and checked by the owner before they ship. Nothing is pulled from the web for a client.
  - Everything from a reference carries the Typical label, as content read from a flowchart image carries "Inferred" today.
  - Anything unconfirmed shows in documents as "Typical, not confirmed", and the approver sees how much is unconfirmed before signing off.
  - The assessment is shown as provisional until steps are confirmed.
  - Never taken from a reference: volumes, times, costs, or whether an application has an API. Value figures are never built on a typical number.
- **Trial:** one reference process, AP invoice processing, built from the hand-checked sample case. Try it with a person who has no documents. Expand to five only if they reach useful documents faster and the confirm pass feels natural. Suggested five: AP invoice processing, vendor set-up, bank reconciliation, employee onboarding, customer onboarding checks for banking (the owner may change these to what the first clients do).
- **Homepage:** the line "Nothing is invented" becomes, in substance, "Nothing is invented; a typical pattern stays labelled as typical until your people confirm it" when this ships.
- **Underneath:** a new status for facts ("typical") in the process record and the checks that read it; the reference files in the repository. No database change expected.
- **Built (15 November 2026, preview):** as above, with the homepage line changed in the next release. The checklist is offered only for a process read from sources, so a step taken out with "We don't" is never suggested again. "Skip for now" leaves an item typical without answering.
- **Proof:** no document states a typical item as a fact; a test keeps volumes, times, costs and API facts out of every reference.

### E. The agent document

- **Sees:** for a process where an agent is recommended or expected, an "Agent definition document" (working name, the owner may change it): purpose and how success is measured; the agent's role in the process; what it may do alone and what needs a person's approval; the applications and tools it may use, and with what access; what it reads; when and how it hands over to a person; how it is tested (example cases with expected outcomes); what a wrong action costs; how it is watched in use.
- **Does unasked:** fills every section the sources and the assessment support. A section the sources say nothing about is a listed open question, never invented text.
- **May ask:** only the boundary questions (what it may do alone, who reviews), because nobody can infer those.
- **Underneath:** a fifth document type built like the other four; agent facts on the process record. No database change expected.
- **Proof:** on the owner's documents and on one agent case written for the test set, a reviewer can tell from the document alone what the agent may and may not do.
- **Built (15 November 2026, preview):** `domain/docs/agent.ts`, the Documents tab "Agent" (shown when the delivery plan lists the document, planned or one click away). The agent's steps are those in effect AI-assisted or agentic, a person's choice included. Eleven sections: purpose and scope, what it does, the steps around it, decisions and rules, hand-overs to a person, applications and access, data, limits and controls, checking before go-live, running it, open questions. Every boundary fact the sources do not give (what it may never do, its limit, a wrong action's cost, its account per application, test cases, the share of right outcomes, who watches and who may stop it) is an open question. Word and Markdown downloads work. Not yet: editing its sections (needs the document-edits table to accept a fifth type: a database change, to be asked), the hand-over checklist and the change-impact list (they still cover the four documents), agent facts recorded on the process (answers go in the open questions for now).

### F. The test pack

- **Sees:** from an approved revision, a list of test cases: what is tested, steps, data, expected result, the requirement it proves. For an agent: example inputs with expected outcomes, including cases it must refuse or hand over. Download as Excel; later, into the tracker.
- **Does unasked:** derives them by rule from the acceptance criteria, rules, exceptions and human checks that the requirements already carry (the SDD's test scenarios exist today in outline). One case per criterion, plus one per exception path.
- **May ask:** nothing to produce it; a tester edits and adds.
- **Underneath:** rules; one new table to keep testers' edits (**needs the owner's yes**, with a rolled-back trial first).
- **Proof:** every functional requirement on the sample has at least one test case; none tests something no requirement states.

### G. Hand-over in the client's tools

- **Review comments on document sections** (approved by the owner on 15 November): reviewers comment where they read. One new table; a rolled-back trial is shown before it is applied.
- **Push to Jira and Azure DevOps** (the owner has not yet said yes or no). Work items and, later, test cases go straight into the tracker, with status coming back.
- **For regulated clients:** one "evidence pack" download: requirements, where each came from, who approved, test cases and their links.

### H. The effort scorecard

- **Sees:** per process: time from first upload to first documents; questions asked of people; questions answered from sources; documents produced; open items left.
- **Why:** it is the proof a pilot client takes to their management, and the evidence the homepage and sales conversations need. It also keeps us honest against the rule in section 1.
- **Underneath:** counted from records that already exist. No database change expected.

## 6. Order

1. **D** (fewer questions). The largest effort problem a real user met; no server or database change.
2. **A and B** (the brief, the no-documents start, the delivery plan), with the approved wording changes.
3. **C** (work not done today).
4. **I** (a typical process to start from, as a one-process trial).
5. **E** (agent document).
6. **F** (test pack), with **review comments** from G.
7. **H** (scorecard) alongside, since it only counts.
8. **Tracker push** when the owner decides.

Releases: about six production deploys remain (15 November 2026). Two releases are enough for this plan: one after steps 1 to 3, one after 4 to 7. Everything is tried on the preview first. Server and database changes cannot be held on the preview (it shares the live server and database), so each is named, measured and approved one by one.

## 7. What this plan deliberately does not do

- It does not let a stated preference ("we want an agent") override the scoring.
- It does not write text for a section the sources do not support.
- It does not add a long intake form. A form is work.
- It does not pull process content from the web for a client.
- It does not copy UiPath's document one for one; it covers the same ground and adds boundaries, review and testing, which the forum thread shows teams are missing.

## 8. Decisions

**Decided by the owner, 15 November 2026:** the rule in section 1; the order in section 6; the no-documents start; the typical-process trial with its rules and the homepage wording; review comments on document sections.

**Working defaults the owner may change:** the cap of 7 first questions; the name "Agent definition document"; the five suggested reference processes.

**Still open:** the Jira and Azure DevOps push; whether the Ask Avala interview replaces "Closing the gaps" (advice: not yet); whether a company's own document section may have text per process (advice: yes).

**Asked each time, never assumed:** any change to the live server functions or the live database.

## Sources

1. EY, "Get ready for robotic process automation": https://ey.com/en_qa/financial-services-emeia/get-ready-for-robotic-process-automation
2. "Turning RPA pilots into production" (reports an ABBYY survey of 400 executives): https://www.portotheme.com/?p=41855
3. PMI, "Requirements Management: Core Competency for Project and Program Success": https://www.pmi.org/learning/thought-leadership/pulse/core-competency-project-program-success
4. ProjectManagement.com, "Bad Requirements, Bad Results" (PMI 2014 figures): https://www.projectmanagement.com/articles/285528/bad-requirements--bad-results
5. UiPath forum, "Best practice writing documentation": https://forum.uipath.com/t/best-practice-writing-documentation/531430
6. Tyner Blain, "Estimating the effort of documenting an as-is process": https://tynerblain.com/2006/09/28/estimating-as-is/
7. Andersen, "BA artifacts in software development": https://andersenlab.com/blueprint/ba-artifacts-in-software-development-ins-outs
8. UiPath documentation, Task Capture in Automation Hub: https://docs.uipath.com/automation-hub/automation-cloud/latest/user-guide/documenting-your-ideas-using-task-capture
9. Virtualization Review on MIT NANDA, "The GenAI Divide": https://virtualizationreview.com/articles/2025/08/19/mit-report-finds-most-ai-business-investments-fail-reveals-genai-divide
10. Gartner press release, 25 June 2025: https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027
11. AI News, "Why most enterprise agent pilots never reach deployment": https://www.artificialintelligence-news.com/news/why-most-enterprise-agent-pilots-never-reach-deployment/
12. Novelis, "The agent adoption gap" (cites Deloitte's 2026 State of AI in the Enterprise): https://novelis.io/research-lab/the-agent-adoption-gap-why-enterprises-pilot-everything-and-deploy-nothing/
13. Bain, "Your AI budget is growing. Your returns aren't. Here's why": https://www.bain.com/insights/your-ai-budget-is-growing-your-returns-arent-heres-why/
14. UiPath forum, "What is standard project documentation of AI agentic automation?": https://forum.uipath.com/t/what-is-standard-project-documentation-of-ai-agentic-automation/5733152
15. UiPath forum, "ADD (Agent Definition Document) in agentic automation": https://forum.uipath.com/t/add-agent-definition-document-in-agentic-automation-a-new-way-to-define-an-agent/5475853
16. Deloitte Tech Trends 2026, agentic AI strategy: https://www.deloitte.com/global/en/insights/topics/technology-management/tech-trends/2026/agentic-ai-strategy.html
17. ISG, "Enterprise automation: the worst performing thing is the most important thing": https://isg-one.com/articles/enterprise-automation-the-worst-performing-thing-is-the-most-important-thing
18. Naviant, "How to build an intelligent automation center of excellence": https://naviant.com/blog/intelligent-automation-center-of-excellence/
19. Forrester study commissioned by Tricentis (2020), as reported: https://devops.com/rpa-reality-check-new-forrester-research-identifies-barriers-to-rpa-scalability/
20. Simform, "RPA to agentic AI migration" (cites HfS Research): https://www.simform.com/blog/rpa-to-agentic-ai-migration/
21. DZone, "RPA validation in life sciences": https://dzone.com/articles/rpa-validation-life-sciences
22. Veeva customer story, "Biopharma cuts validation effort": https://www.veeva.com/customer-stories/biopharma-cuts-validation-efforts-by-55-with-new-processes/
23. UiPath documentation, Cartographer, "Generating an SDD": https://docs.uipath.com/cartographer/standalone/latest/user-guide/generating-an-sdd

Notes on the evidence: several figures come from vendor-commissioned or secondary reports (2, 11, 12, 19, 20, 22) and two are old (6, 19). They agree in direction with the primary sources (1, 3, 9, 10, 13, 16), which carry the argument. MIT's 95% figure is from preliminary research and is not a universal failure rate.
