// The brief's words and the delivery plan by rule (docs/effort-first-plan.md, parts A and B).
//
// The brief is a few facts on the process record (`meta.brief`): what this is, whether the work is done
// today, what kind of thing it is, what the team has in mind and which documents are wanted. Each is
// read from the sources with its passage or given by a person; the applications are the model's
// systems. Nothing here reads or guesses: it puts the brief into words and applies a fixed table.
//
// The delivery plan picks the documents from one table:
//   - an agent to be built, or an assessment led by AI-assisted or agentic work: the process document
//     (PDD), the agent document and the SDD;
//   - work not done today (a tool or a new process): BRD, FRD and SDD;
//   - otherwise, work done today, led by RPA, API or people: PDD and SDD.
// BRD and FRD are always one click away. Documents a person chose (`brief.documents`) replace the
// table's choice, and the table's own choice is still said. What the team had in mind is compared
// with the assessment and never changes it.
import type { DoneToday, Fact, InMind, PlannedDoc, ProcessBrief, ProcessModel, WorkKind } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { APPROACH_LABEL, type Approach } from '../assess/scoring.ts';
import { buildingSystem, notDoneToday } from './intended.ts';

export const DONE_TODAY_LABEL: Record<DoneToday, string> = { yes: 'Done today', partly: 'Partly done today', no: 'Not done today' };
export const WORK_KIND_LABEL: Record<WorkKind, string> = { existing_process: 'An existing process', new_process: 'A new process', tool: 'A tool to be built', agent: 'An agent to be built' };
export const IN_MIND_LABEL: Record<InMind, string> = { rpa: 'RPA', api: 'API integration', ai: 'AI that assists people', agent: 'An AI agent', open: 'Not decided yet' };
export const DOC_LABEL: Record<PlannedDoc, string> = { brd: 'Business requirements (BRD)', pdd: 'Process definition (PDD)', frd: 'Functional requirements (FRD)', sdd: 'Solution design (SDD)', agent: 'Agent definition document' };
/** Documents Avala OS can produce today; the agent document comes with part E of the plan. */
export const BUILT_DOCS: readonly PlannedDoc[] = ['brd', 'pdd', 'frd', 'sdd'];
const ORDER: PlannedDoc[] = ['brd', 'pdd', 'agent', 'frd', 'sdd'];

export type BriefKey = 'summary' | 'doneToday' | 'kind' | 'building' | 'applications' | 'inMind' | 'documents';
export const BRIEF_LABEL: Record<BriefKey, string> = {
  summary: 'What this is', doneToday: 'Done today?', kind: 'What kind of thing', building: 'What is being built', applications: 'Applications it touches', inMind: 'What the team has in mind', documents: 'Documents wanted',
};

export interface BriefLine {
  key: BriefKey;
  label: string;
  /** The value in words; null when not known. */
  text: string | null;
  /** Where it came from: read from the sources, confirmed or given by a person, or not known. */
  state: 'read' | 'confirmed' | 'unknown';
  fact?: Fact<unknown>;
}

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** Labels in a list: "API integration and an AI agent", not "and An AI agent". */
const listLabels = (xs: string[]) => listWords(xs.map((x, i) => (i > 0 ? x.replace(/^(An?|The) /, w => w.toLowerCase()) : x)));

function stateOf(f: Fact<unknown> | undefined): BriefLine['state'] {
  if (!f || f.status === 'unknown' || f.value === null) return 'unknown';
  return f.status === 'user-confirmed' ? 'confirmed' : 'read';
}

/** The brief as lines for the screen, in a fixed order. */
export function briefLines(m: ProcessModel): BriefLine[] {
  const b: ProcessBrief = m.meta.brief ?? {};
  const line = <T>(key: Exclude<BriefKey, 'applications'>, f: Fact<T> | undefined, words: (v: T) => string): BriefLine => ({
    key, label: BRIEF_LABEL[key], fact: f as Fact<unknown> | undefined, state: stateOf(f as Fact<unknown> | undefined),
    text: f && f.value !== null && f.status !== 'unknown' ? words(f.value) : null,
  });
  // The application being built is not one the process uses (part C).
  const building = buildingSystem(m);
  const apps = m.systems.filter(s => s.inScope !== false && s.id !== building?.id).map(s => s.name);
  const kind = b.kind && b.kind.status !== 'unknown' ? b.kind.value : null;
  const showBuilding = Boolean(building) || kind === 'tool' || kind === 'agent';
  return [
    line('summary', b.summary, v => v),
    line('doneToday', b.doneToday, v => DONE_TODAY_LABEL[v]),
    line('kind', b.kind, v => WORK_KIND_LABEL[v]),
    ...(showBuilding ? [line('building', b.building, v => m.systems.find(s => s.id === v)?.name ?? 'An application no longer in the process')] : []),
    { key: 'applications', label: BRIEF_LABEL.applications, text: apps.length ? listWords(apps) : null, state: apps.length ? 'read' : 'unknown' },
    line('inMind', b.inMind, v => listLabels(v.map(x => IN_MIND_LABEL[x]))),
    line('documents', b.documents, v => listWords(v.map(x => DOC_LABEL[x]))),
  ];
}

/** Whether every line read from the sources is confirmed (applications are confirmed in the Process stage). */
export const briefConfirmed = (m: ProcessModel) => briefLines(m).filter(l => l.key !== 'applications').every(l => l.state !== 'read');
/** Whether anything of the brief is known yet. */
export const hasBrief = (m: ProcessModel) => briefLines(m).some(l => l.key !== 'applications' && l.state !== 'unknown');

export { notDoneToday } from './intended.ts';

export type Track = 'existing' | 'ai' | 'new';

export interface DocLine {
  doc: PlannedDoc;
  label: string;
  /** In the plan (shown first) or offered (one click away). */
  planned: boolean;
  reason: string;
  /** Whether Avala OS produces it today. */
  available: boolean;
}

export interface DeliveryPlan {
  track: Track;
  /** Why this track, in a sentence, with where each fact came from. */
  why: string;
  docs: DocLine[];
  /** The documents the table would choose, when a person chose others. */
  ruleWouldPlan: PlannedDoc[] | null;
  /** What the team expected against what the assessment says; null when nothing was expected. */
  expectation: string | null;
  /** What the plan rests on that nobody has said yet. */
  unknowns: string[];
}

const RULE_DOCS: Record<Track, PlannedDoc[]> = { existing: ['pdd', 'sdd'], ai: ['pdd', 'agent', 'sdd'], new: ['brd', 'frd', 'sdd'] };
const LEAD_TO_MIND: Partial<Record<Approach, InMind>> = { rpa: 'rpa', api: 'api', ai_assist: 'ai', agent: 'agent' };
const from = (f: Fact<unknown> | undefined) => (f?.status === 'user-confirmed' ? 'confirmed by a person' : 'from the sources');

/** The track by the table, and why. */
export function trackOf(m: ProcessModel, a: ProcessAssessment | null): { track: Track; why: string } {
  const b = m.meta.brief ?? {};
  const kind = b.kind && b.kind.status !== 'unknown' ? b.kind.value : null;
  const done = b.doneToday && b.doneToday.status !== 'unknown' ? b.doneToday.value : null;
  if (kind === 'agent') return { track: 'ai', why: `An agent is to be built (${from(b.kind)}), so it gets its own document beside the process and the solution design.` };
  if (notDoneToday(m)) {
    const what = done === 'no' ? `The work is not done today (${from(b.doneToday)})` : `It is ${WORK_KIND_LABEL[kind!].toLowerCase()} (${from(b.kind)})`;
    return { track: 'new', why: `${what}, so there is no current process to document: the requirements come first, then the solution design.` };
  }
  if (a?.lead === 'agent' || a?.lead === 'ai_assist') return { track: 'ai', why: `The assessment leads with ${APPROACH_LABEL[a.lead]}, so the agent's boundaries, reviewer and access are written down beside the process.` };
  // Only a brief that says so makes it work done today; otherwise the plan says it is assumed.
  const today = done === 'yes' || done === 'partly' ? `The work is ${done === 'partly' ? 'partly ' : ''}done today (${from(b.doneToday)})` : 'Nobody has said yet whether the work is done today, so it is treated as done today';
  const lead = a?.lead ? ` and the assessment leads with ${APPROACH_LABEL[a.lead]}` : '';
  return { track: 'existing', why: `${today}${lead}: the process as it runs and the solution design are what a build needs.` };
}

const REASON: Record<Track, Partial<Record<PlannedDoc, string>>> = {
  existing: { pdd: 'How the work runs today and how it will run, step by step.', sdd: 'How the solution is built.', brd: 'One click away, for reviewers or auditors who want business requirements.', frd: 'One click away, for reviewers or auditors who want functional requirements.' },
  ai: { pdd: 'The process the agent works in, and where people stay.', agent: 'What the agent may do alone, what needs a person, its access, and how it is tested.', sdd: 'How the solution is built.', brd: 'One click away, for reviewers or auditors who want business requirements.', frd: 'One click away, for reviewers or auditors who want functional requirements.' },
  new: { brd: 'What the business needs from the new work, with its goals.', frd: 'What the solution must do, requirement by requirement.', sdd: 'How the solution is built.', pdd: 'Describes work as it is done; nothing is done today.', agent: 'An agent was in mind: what it may do alone, what needs a person.' },
};

/** The delivery plan for a process, by the table, with what it rests on. */
export function deliveryPlan(m: ProcessModel, a: ProcessAssessment | null): DeliveryPlan {
  const b = m.meta.brief ?? {};
  const { track, why } = trackOf(m, a);
  const rule = RULE_DOCS[track];
  // Only a person's choice replaces the table; documents the sources ask for are added to it.
  const wanted = b.documents && b.documents.status !== 'unknown' && b.documents.value?.length ? b.documents.value : null;
  const chosen = wanted && b.documents!.status === 'user-confirmed' ? wanted : null;
  const asked = wanted && !chosen ? wanted : [];
  const planned = new Set([...(chosen ?? rule), ...asked]);
  const inMind = b.inMind && b.inMind.status !== 'unknown' ? (b.inMind.value ?? []) : [];
  const offered = ORDER.filter(d => !planned.has(d) && (d !== 'agent' || inMind.includes('agent') || track === 'ai'));
  const docs: DocLine[] = [...ORDER.filter(d => planned.has(d)), ...offered].map(doc => ({
    doc, label: DOC_LABEL[doc], planned: planned.has(doc), available: BUILT_DOCS.includes(doc),
    reason: chosen && planned.has(doc) ? `Wanted (${from(b.documents)}). ${REASON[track][doc] ?? ''}`.trim()
      : asked.includes(doc) && !rule.includes(doc) ? `Asked for in the sources; confirm or change it in the brief. ${REASON[track][doc] ?? ''}`.trim()
      : REASON[track][doc] ?? (planned.has(doc) ? '' : 'One click away.'),
  }));
  const same = chosen && chosen.length === rule.length && chosen.every(d => rule.includes(d));
  const unknowns: string[] = [];
  if (!b.doneToday || b.doneToday.status === 'unknown') unknowns.push('Whether the work is done today: fill it in on the brief (Process stage); if it is not done today, the plan changes to requirements first.');
  if (!b.kind || b.kind.status === 'unknown') unknowns.push('What kind of thing this is (an existing process, a new one, a tool or an agent) is not known yet.');
  return { track, why, docs, ruleWouldPlan: chosen && !same ? rule : null, expectation: expectation(inMind, a), unknowns };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the team had in mind against what the assessment says, in one sentence, from the counts only.
 * "An agent was expected; 15 of 20 steps are plain rules (RPA or API) and 1 needs an agent."
 */
export function expectation(inMind: InMind[], a: ProcessAssessment | null): string | null {
  const expected: InMind[] = inMind.filter(x => x !== 'open');
  if (!expected.length) return null;
  const said = `${listLabels(expected.map(x => IN_MIND_LABEL[x]))} ${expected.length === 1 ? 'was' : 'were'} expected`;
  if (!a || a.assessed === 0) return `${said}; there are no steps to compare it with yet.`;
  const c = a.counts;
  const rules = (c.rpa ?? 0) + (c.api ?? 0);
  const parts = [
    rules ? `${plural(rules, 'step is', 'steps are')} plain rules (RPA or API)` : '',
    c.ai_assist ? `${plural(c.ai_assist, 'step needs', 'steps need')} AI to assist` : '',
    c.agent ? `${plural(c.agent, 'step needs', 'steps need')} an agent` : '',
    c.human ? `${plural(c.human, 'step stays', 'steps stay')} with people` : '',
  ].filter(Boolean);
  const split = `of ${a.assessed} ${a.assessed === 1 ? 'step' : 'steps'} scored, ${listWords(parts)}`;
  const lead = a.lead ? LEAD_TO_MIND[a.lead] : undefined;
  if (lead && expected.includes(lead)) return `As expected: the assessment leads with ${APPROACH_LABEL[a.lead!]} (${split}).`;
  if (!a.lead) return `${said}; the assessment recommends no automation approach yet (${split}).`;
  return `${said}; the assessment leads with ${APPROACH_LABEL[a.lead]} instead (${split}). The assessment decides; the expectation is kept for the record.`;
}
