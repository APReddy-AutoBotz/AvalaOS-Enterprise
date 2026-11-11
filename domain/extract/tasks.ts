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

roles: people, roles, teams and outside parties that do or decide something in the process. Name the role, not the person ("AP Clerk", not "Sunita"). Leave out meeting attendees who only ask questions.
systems: applications, mailboxes, shared folders, spreadsheets, scanners and portals used in the process. Use the most specific name the source gives.
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

steps: one per activity a person or system performs, at the level of a procedure step ("Check for duplicates", "Post goods receipt"). Name it with a verb and an object, at most six words. "actors" are the roles that do it and "systems" the systems used, only as the source states them. "taskType": "user" (a person using a system), "manual" (no system), "service" (a system on its own), "business_rule" (an automatic check), "send" or "receive" (a message to or from outside). Include activities by other teams (for example receiving goods, approving) when the source describes them. Leave out meeting chatter, opinions and wishes for the future.
decisions: points where the path splits, as a yes/no or short question ("Duplicate?"), with each outcome and what happens next in a few words.`,
  schema: obj({
    steps: list({ name: str, description: str, actors: strArr, systems: strArr, taskType: { type: 'string', enum: TASK_TYPES }, ...quoted }),
    decisions: list({ question: str, outcomes: { type: 'array', items: obj({ label: str, then: str }) }, ...quoted }),
  }),
};

export const mergeFlow: TaskDefinition = {
  id: 'merge_flow',
  schemaName: 'merge_flow',
  maxOutputTokens: 14000,
  verifyArrays: [],
  instructions: `You receive numbered candidates extracted from several sources about one business process. Different sources describe the same things in different words. Merge them into one process.

roles and systems: group candidates that mean the same role or system. Give each group a clear name (the most specific candidate name) and list its candidate ids in "members". Every role and system you return must have at least one member.
steps: one per distinct activity, in process order, at the level of a procedure step. Group candidates that describe the same activity, even across sources and wordings; do not split one activity into several steps or merge different activities. Name each with a verb and an object. "roles" and "systems" are keys of your role and system groups, only where a member states them. Every step must have at least one member.
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

export const EXTRACTION_TASKS = { sourceFacts, sourceSteps, mergeFlow, mergeFacts };
