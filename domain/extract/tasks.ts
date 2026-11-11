// The extraction passes. Each is a strict-schema task for the AI provider.
//
// 1. Per source, in parallel: `source_facts` (roles, systems, interface mentions, rules, exceptions,
//    explicit metrics, stated unknowns) and `source_steps` (activities and decisions in order).
//    Every item quotes the segment it came from; the server drops any quote it cannot find.
// 2. Across sources: `merge_flow` (roles, systems, steps, decisions, events and the flow between
//    them) and `merge_facts` (rules, exceptions, metrics, interfaces, conflicts, questions).
//    These see only the numbered candidates from pass 1, never source text, and may only group
//    and order them: everything they return points at candidate ids.
import type { TaskDefinition } from '../ai/gateway.ts';

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const numOrNull = { type: ['number', 'null'] } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (properties: Record<string, unknown>) => ({ type: 'array', items: obj(properties) });
const quoted = { segmentId: str, excerpt: str };

export const ROLE_KINDS = ['person_role', 'team', 'external', 'system_actor'] as const;
export const SYSTEM_KINDS = ['erp', 'email', 'document_store', 'spreadsheet', 'workflow', 'portal', 'scanner', 'other'] as const;
export const ACCESS_METHODS = ['api', 'ui', 'file', 'database', 'event', 'email'] as const;
export const ACCESS_STATUSES = ['confirmed', 'reported', 'unknown', 'confirmed_absent'] as const;
export const TASK_TYPES = ['user', 'manual', 'service', 'business_rule', 'send', 'receive'] as const;
export const METRIC_KINDS = ['volume', 'handling_time', 'cycle_time', 'fte', 'exception_rate', 'share', 'other'] as const;

export const sourceFacts: TaskDefinition = {
  id: 'source_facts',
  schemaName: 'source_facts',
  maxOutputTokens: 16000,
  verifyArrays: ['roles', 'systems', 'interfaces', 'rules', 'exceptions', 'metrics', 'unknowns'],
  instructions: `This source is one of several about the same business process. Extract these facts from it:

roles: people, roles, teams and outside parties that perform a step, decide something or receive work in the process. Name the role, not the person: when a person is named, use their role ("AP Team Lead", not "Karthik"). Leave out people who only took part in the meeting, analyse the process or advise on systems (analysts, architects, IT security, functional leads) unless the source says they do a step.
systems: applications, mailboxes, document libraries, spreadsheets, scanners and portals used in the process, each as a whole application. SAP transactions and screens (MIRO, FB60, FBL1N, MIGO, BP), modules, apps inside an application, APIs, gateways and integration layers belong to their application and are not separate systems; mention them under interfaces instead. Documents, procedures and policies are not systems.
interfaces: every statement about how a system can be accessed or integrated: APIs (with their technical name if given), user interfaces, files, databases, events, email. Set "access":
  - "confirmed" only when someone responsible says it is live and usable today;
  - "reported" when it is said to exist (for example in the product) but not activated, not exposed or not confirmed for use;
  - "unknown" when nobody knows or it still has to be checked;
  - "confirmed_absent" when it is said to be unavailable, disabled or not allowed.
  "operations" are what it does, in a few words each ("read purchase orders").
rules: business rules, policies, thresholds and limits, with the condition and the action. Keep the numbers exactly as stated.
exceptions: things that go wrong or need special handling, with what triggers them, how they are handled, and who handles them ("routedTo", a role name or "").
metrics: only numbers the source states: volumes, handling times, cycle times, team sizes, percentages, counts. Use "low" and "high" for a range and "value" for a single number (the other fields null). Never compute or estimate.
unknowns: things the source says are not known, not measured, not decided, still to be confirmed, or asked without an answer. Phrase each as a question.`,
  schema: obj({
    roles: list({ name: str, kind: { type: 'string', enum: ROLE_KINDS }, ...quoted }),
    systems: list({ name: str, kind: { type: 'string', enum: SYSTEM_KINDS }, ...quoted }),
    interfaces: list({ system: str, method: { type: 'string', enum: ACCESS_METHODS }, name: str, operations: strArr, access: { type: 'string', enum: ACCESS_STATUSES }, ...quoted }),
    rules: list({ name: str, condition: str, action: str, ...quoted }),
    exceptions: list({ name: str, kind: { type: 'string', enum: ['business', 'application'] }, trigger: str, handling: str, routedTo: str, ...quoted }),
    metrics: list({ kind: { type: 'string', enum: METRIC_KINDS }, label: str, value: numOrNull, low: numOrNull, high: numOrNull, unit: str, period: str, appliesTo: str, ...quoted }),
    unknowns: list({ question: str, whyItMatters: str, ...quoted }),
  }),
};

export const sourceSteps: TaskDefinition = {
  id: 'source_steps',
  schemaName: 'source_steps',
  maxOutputTokens: 12000,
  verifyArrays: ['steps', 'decisions'],
  instructions: `This source is one of several about the same business process. List the activities and decisions it describes, in the order they happen.

steps: one per business activity of the process as it runs today, at the level of a procedure step ("Check for duplicates", "Post goods receipt"). Name it with a verb and an object, at most six words. "actors" are the roles that do it (use role names, not people's names) and "systems" the applications used as a whole (SAP, not MIRO), only as the source states them. "taskType": "user" (a person using a system), "manual" (no system), "service" (a system on its own), "business_rule" (an automatic check), "send" or "receive" (a message to or from outside). Include activities by other teams that the process waits for (posting a goods receipt, investigating a variance, approving).
Do not list as steps: small actions inside a step (opening the email, saving the file, attaching the PDF belong to the step they serve); reminders, escalations and waiting (those are rules or exception handling); work outside the process scope (for example payment runs by another team); discussions of systems, APIs, integrations or possible future designs; meeting chatter and opinions.
decisions: points where the path splits, as a yes/no or short question ("Duplicate?"), with each outcome and what happens next in a few words.`,
  schema: obj({
    steps: list({ name: str, description: str, actors: strArr, systems: strArr, taskType: { type: 'string', enum: TASK_TYPES }, ...quoted }),
    decisions: list({ question: str, outcomes: { type: 'array', items: obj({ label: str, then: str }) }, ...quoted }),
  }),
};

export const mergeFlow: TaskDefinition = {
  id: 'merge_flow',
  schemaName: 'merge_flow',
  maxOutputTokens: 16000,
  verifyArrays: [],
  instructions: `You receive numbered candidates extracted from several sources about one business process. Different sources describe the same things in different words. Merge them into one process.

roles: group candidates that mean the same role, including a team and the role that does its work when the sources use them interchangeably (for example "AP team" doing what the AP Clerk does) and a named person with their role. Leave out roles that perform no step, decide nothing and receive no work in this process (meeting participants, analysts, architects, IT security). Name each group with its clearest role name.
systems: one group per application. Transactions, screens, modules, apps, APIs, gateways and integration layers of an application go into that application's group (MIRO, FB60, FBL1N, MIGO, SAP GUI, the Fiori app, SAP Gateway and SAP APIs all belong to SAP S/4HANA). A generic "email" belongs to the mailbox the process uses. Documents and policies are not systems; leave them out. Every role and system you return must have at least one member; list the candidate ids in "members".
steps: one per business activity, in process order, at the level of a numbered procedure step. A typical process has 10 to 30 steps. Candidates marked with § come from a numbered procedure section (§6.12). Each numbered procedure section that describes work gets its own step, even a short one (closing the record), and the steps follow the section order; where a source has a numbered procedure, its steps are the backbone; add the activities other roles perform that the process waits for, and the handling steps of exceptions. A check, lookup or decision made while doing a step (checking bank details while validating a vendor, choosing the GL account while entering an invoice, checking an approver's authority) belongs to that step. When another role can resolve an exception in different ways (for example amending the order, or obtaining a corrected document from the vendor), each way is its own step. Saving, attaching or recording something right after an action is part of that action; updating a record to close the case is its own step when the procedure lists it.
Not steps: receiving the item that starts the process (that is the start event, unless work is done on it, such as scanning paper); outcomes that end or pause the case, such as rejecting, holding or returning it (those are end events or decision outcomes, unless the procedure lists them as a numbered step with its own work); special cases of a step (posting part of an invoice); and work done by teams outside the process scope even when the process waits for it (for example a master data team verifying a change).
Automatic checks a system performs as part of the flow (for example matching an invoice against the order and the receipt) are steps of type "service" or "business_rule".
Name steps in the sources' own words: reuse their terms ("credit note", "goods receipt", "four-eyes review") rather than paraphrasing them.
Before answering, check every step once more: if it is a part of another step's work, merge it into that step. Group every candidate that is part of the same activity into one step, even across sources and wordings: small actions inside an activity (open the email, save the PDF, attach the file, update the status) belong to the activity they serve. Reminders, escalations and follow-ups are not steps. Leave out activities outside the process scope (payment runs, master data changes done by another team, unless the process waits for them) and anything that is a discussion of systems, APIs or future designs. Keep different activities apart: work by different roles is never one step (sending an invoice for approval and approving it are two steps). Name each step with a verb and an object.
"roles" on a step are the role groups that perform it, usually one; do not add a team that contains the performer, or roles that are only informed or consulted. "systems" are all the system groups used in it. Use only what members state. Every step must have at least one member.
gateways: one per distinct decision, grouped the same way, with a short question.
events: one start event and one end event per distinct way the process can finish (for example "Invoice posted", "Invoice returned to vendor"), with candidate ids that mention them in "members" (may be empty).
flows: the sequence between events, steps and gateways, using their keys. Every gateway has a flow for each outcome, labelled with the outcome. Use only orderings and branches the candidates describe; where the order is not stated, follow the numbered procedure.
Keys are short: r1, y1, s1, g1, e1. Use only the candidate ids given.`,
  schema: obj({
    roles: list({ key: str, name: str, kind: { type: 'string', enum: ROLE_KINDS }, members: strArr }),
    systems: list({ key: str, name: str, kind: { type: 'string', enum: SYSTEM_KINDS }, members: strArr }),
    steps: list({ key: str, name: str, description: str, taskType: { type: 'string', enum: TASK_TYPES }, roles: strArr, systems: strArr, members: strArr }),
    gateways: list({ key: str, question: str, members: strArr }),
    events: list({ key: str, kind: { type: 'string', enum: ['start', 'end'] }, name: str, members: strArr }),
    flows: list({ from: str, to: str, label: str }),
  }),
};

export const mergeFacts: TaskDefinition = {
  id: 'merge_facts',
  schemaName: 'merge_facts',
  maxOutputTokens: 12000,
  verifyArrays: [],
  instructions: `You receive numbered candidates extracted from several sources about one business process. Merge duplicates and find disagreements.

rules, exceptions, interfaces, metrics: group candidates that state the same thing; list their ids in "members". Keep different things apart. For metrics, "chosen" is the member whose value best represents the group. For interfaces, keep the most cautious access status among the members unless a member clearly states a newer confirmation.
conflicts: where candidates give different values for the same thing (for example two different tolerances, or two different monthly volumes), add a conflict with a one-sentence summary naming both values and the candidate ids that disagree. Do not pick a winner.
questions: what someone would still need to know to assess and automate this process: every "unknowns" candidate, plus missing volumes or handling times for a path, unclear owners or turnaround times, unconfirmed interfaces, and unhandled cases. One question each, with why it matters. "members" are the candidate ids it comes from (may be empty).
Use only the candidate ids given.`,
  schema: obj({
    rules: list({ name: str, condition: str, action: str, members: strArr }),
    exceptions: list({ name: str, kind: { type: 'string', enum: ['business', 'application'] }, trigger: str, handling: str, routedTo: str, members: strArr }),
    interfaces: list({ system: str, method: { type: 'string', enum: ACCESS_METHODS }, name: str, operations: strArr, access: { type: 'string', enum: ACCESS_STATUSES }, members: strArr }),
    metrics: list({ label: str, chosen: str, members: strArr }),
    conflicts: list({ summary: str, about: { type: 'string', enum: ['rule', 'metric', 'interface', 'other'] }, members: strArr }),
    questions: list({ question: str, whyItMatters: str, members: strArr }),
  }),
};

export const reviewFlow: TaskDefinition = {
  id: 'review_flow',
  schemaName: 'review_flow',
  // A short input and the judgement that most affects precision, so more reasoning here.
  reasoningEffort: 'medium',
  maxOutputTokens: 6000,
  verifyArrays: [],
  instructions: `You review the step list of a merged business process before it is shown to analysts. Each step shows its key, name, description, roles and the candidate statements it was built from.

A good step list has one step per business activity at the level of a numbered procedure step. Check every step and return only the corrections:
merges: a step that is part of another step's work goes into that step ("into" is the other step's key). Typical cases: a check, lookup or choice made while doing a step; saving, attaching or recording right after an action; a request that is the second half of the same action (park the invoice and request the receipt).
removals: a step that is not an activity of this process. "kind" is "outcome" (the case ends, waits or is turned away: rejected, held, returned when nothing else is done), "outside_scope" (work done by a team outside the process, for example verifying a master data change), or "not_an_activity" (a special case of another step, a discussion, or a duplicate of the start event).
Rules for corrections:
- Merge only into a step performed by the same role. Work by one role never goes into another role's step (saving the approval evidence is the clerk's work, not part of the approver's step).
- Never merge or remove a step that has its own number in a procedure (for example "6.12 Close the record"), or one that raises a request in another system.
- Remove a step whose only work is to end, hold or turn away the case (rejecting a duplicate, putting an invoice on hold, returning a rejected approval), even when someone is told, unless the procedure describes it as a separate activity with its own instructions.
- Keep steps that the process waits on from other roles (posting a goods receipt, approving, investigating a variance, amending an order, requesting a corrected document) and automatic checks a system performs.
- When in doubt, keep the step. Give a short reason for each correction.`,
  schema: obj({
    merges: list({ step: str, into: str, reason: str }),
    removals: list({ step: str, kind: { type: 'string', enum: ['outcome', 'outside_scope', 'not_an_activity'] }, reason: str }),
  }),
};

export const EXTRACTION_TASKS = { sourceFacts, sourceSteps, mergeFlow, mergeFacts, reviewFlow };
