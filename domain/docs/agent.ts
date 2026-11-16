// The agent definition document (docs/effort-first-plan.md, part E): what an AI agent in this process
// may do alone, where a person stays, what it may touch, and how it is checked. Written from the model,
// the assessment (steps rated AI-assisted or agentic, or chosen so by a person) and the requirements
// register, like the other documents. Nothing is filled in: limits, accounts, reviewers and test cases
// that the sources do not give are open items, listed again at the end. How it is built is the SDD's.
import type { ProcessModel, Step } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { APPROACH_LABEL, type Approach } from '../assess/scoring.ts';
import { criterionText } from '../requirements/register.ts';
import { IN_MIND_LABEL, WORK_KIND_LABEL } from '../plan/delivery.ts';
import { processWords } from '../plan/intended.ts';
import { DocBuilder, missing, type Cell, type DocTree } from './tree.ts';
import { controlOf, accessText, HUMAN_POINT, known, modeOf, type DocInput } from './common.ts';

/** Approaches that make a step the agent's. */
export const AGENT_APPROACHES: readonly Approach[] = ['agent', 'ai_assist'];

export interface AgentStep { step: Step; approach: Approach; human: string; why: string; byPerson: boolean }

/** The steps the agent takes on, in process order: rated AI-assisted or agentic, or set so by a person. */
export function agentSteps(input: DocInput): AgentStep[] {
  return orderedSteps(input.model).flatMap(s => {
    const md = modeOf(input, s);
    if (!md.approach || !AGENT_APPROACHES.includes(md.approach)) return [];
    return [{ step: s, approach: md.approach, human: md.score ? HUMAN_POINT[md.score.human] : '', why: md.why, byPerson: md.overridden }];
  });
}

export function buildAgent(input: DocInput): DocTree {
  const m: ProcessModel = input.model;
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const ours = agentSteps(input);
  const ids = new Set(ours.map(a => a.step.id));
  const roleNames = (roleIds: string[]) => roleIds.map(id => m.roles.find(r => r.id === id)?.name).filter(Boolean).join(', ');
  const words = processWords(m);
  const b = new DocBuilder();

  // ---- 1 Purpose and scope
  b.section('1', 'Purpose and scope', 1);
  b.paragraph(ours.length
    ? `This document sets out what an AI agent would do in "${m.meta.name}": the ${ours.length} of ${steps.length} steps it takes on, where a person stays, what it may use, and how its work is checked. These are the steps rated AI-assisted or agentic in the assessment${ours.some(a => a.byPerson) ? ', or set so by a person' : ''}. The ${words.intended ? 'intended process' : 'process'} as a whole is in the PDD; how the solution is built is in the SDD.`
    : `This document sets out what an AI agent would do in "${m.meta.name}". On what is known, no step is rated AI-assisted or agentic, so the agent has no steps yet. They appear here when the assessment rates a step for AI, or a person sets one so.`);
  const objective = known(m.meta.objective);
  const brief = m.meta.brief;
  const inMind = brief?.inMind && brief.inMind.status !== 'unknown' && brief.inMind.value?.length ? brief.inMind : null;
  const kind = brief?.kind && brief.kind.status !== 'unknown' && brief.kind.value ? brief.kind : null;
  b.keyValue('The agent at a glance', [
    ['Objective of the process', objective ? { text: objective, status: m.meta.objective.status } : missing()],
    ['What kind of thing', kind ? { text: WORK_KIND_LABEL[kind.value!], status: kind.status } : missing()],
    ['What the team has in mind', inMind ? { text: inMind.value!.map(v => IN_MIND_LABEL[v]).join(', '), status: inMind.status } : missing()],
    ['Steps it takes on', ours.length ? `${ours.length} of ${steps.length}` : 'None yet'],
    ['Agentic AI', String(ours.filter(a => a.approach === 'agent').length)],
    ['AI-assisted automation', String(ours.filter(a => a.approach === 'ai_assist').length)],
  ]);
  if (!objective) b.note('The objective of the process is not stated.', { kind: 'meta', field: 'objective' });
  if (!ours.length) {
    if (inMind?.value?.includes('agent')) b.callout('The team has an AI agent in mind, but no step is rated for AI on what is known. Either the steps the agent would take on are not described yet, or plainer automation fits them better: the assessment says which.', 'warning');
    b.open('Which steps should the agent take on?');
  }

  // ---- 2 What the agent does
  b.section('2', 'What the agent does', 1);
  b.table('Steps the agent takes on', ['#', 'Step', 'Approach', 'Reads', 'Produces', 'Where a person stays', 'Why'], ours.map(a => [
    String(no(a.step.id)), { text: a.step.name, status: a.step.status }, APPROACH_LABEL[a.approach], a.step.inputs.join(', ') || missing(), a.step.outputs.join(', ') || missing(), a.human || missing(), a.why,
  ]), 'No step is rated for the agent yet.');
  for (const a of ours) {
    if (!a.step.inputs.length) b.note(`What does step ${no(a.step.id)} (${a.step.name}) start from: which documents or data?`, { kind: 'step', id: a.step.id });
  }

  // ---- 3 The steps around it
  b.section('3', 'The steps around it', 1);
  b.paragraph('The other steps, and who or what does them, so the hand-overs to and from the agent are clear.');
  b.table('Other steps', ['#', 'Step', 'Done by', 'Who'], steps.filter(s => !ids.has(s.id)).map(s => {
    const md = modeOf(input, s);
    const by = md.score?.alreadyAutomated ? 'Already done by a system' : md.approach ? APPROACH_LABEL[md.approach] : missing();
    return [String(no(s.id)), { text: s.name, status: s.status }, by, roleNames(s.roleIds) || missing()];
  }), 'Every step is the agent\'s.');

  // ---- 4 Decisions and rules
  b.section('4', 'Decisions and rules it applies', 1);
  const rules = m.rules.filter(r => ours.some(a => a.step.ruleIds.includes(r.id)));
  b.table('Rules at the agent\'s steps', ['Rule', 'When', 'Then', 'Steps'], rules.map(r => [
    { text: r.name, status: r.status }, r.condition || missing(), r.action || missing(), ours.filter(a => a.step.ruleIds.includes(r.id)).map(a => String(no(a.step.id))).join(', '),
  ]), 'No rules are recorded at the agent\'s steps.');
  const decisions = m.gateways.filter(g => m.flows.some(f => f.to === g.id && ids.has(f.from)));
  b.table('Decision points right after the agent\'s steps', ['Decision', 'After step'], decisions.map(g => [
    { text: g.question, status: g.status }, m.flows.filter(f => f.to === g.id && ids.has(f.from)).map(f => String(no(f.from))).join(', '),
  ]), 'No decision point follows the agent\'s steps.');
  if (rules.length || decisions.length) b.open('Which of these decisions may the agent make alone, and which must a person approve before they take effect?');

  // ---- 5 Handing over to a person
  b.section('5', 'When it hands over to a person', 1);
  const checked = ours.filter(a => a.human && a.human !== HUMAN_POINT.none);
  b.table('Where a person checks or decides', ['#', 'Step', 'The person', 'Who'], checked.map(a => [String(no(a.step.id)), a.step.name, a.human, roleNames(a.step.roleIds) || missing()]), 'No step of the agent is rated as needing a person on what is known.');
  const exceptions = m.exceptions.filter(e => e.stepIds.some(id => ids.has(id)));
  b.table('Exceptions at the agent\'s steps', ['Exception', 'Comes up when', 'Handled by', 'Goes to'], exceptions.map(e => [
    { text: e.name, status: e.status }, e.trigger || missing(), e.handling || missing(), e.routedToRoleId ? m.roles.find(r => r.id === e.routedToRoleId)?.name ?? missing() : missing(),
  ]), 'No exceptions are recorded at the agent\'s steps.');
  for (const e of exceptions) if (!e.routedToRoleId) b.note(`Who receives "${e.name}" when the agent hands it over?`, { kind: 'exception', id: e.id });
  if (ours.length) b.open('When the agent is unsure of a case, how does it say so, and who picks the case up, how quickly?');

  // ---- 6 Applications and access
  b.section('6', 'Applications it uses and its access', 1);
  const used = [...new Set(ours.flatMap(a => a.step.systemIds))].map(id => m.systems.find(s => s.id === id)!).filter(Boolean);
  b.table('Applications', ['Application', 'At steps', 'Access recorded', 'Robots on its screens'], used.map(s => [
    { text: s.name, status: s.status }, ours.filter(a => a.step.systemIds.includes(s.id)).map(a => String(no(a.step.id))).join(', '), accessText(s),
    s.uiAllowed && s.uiAllowed.status !== 'unknown' && s.uiAllowed.value !== null ? { text: s.uiAllowed.value ? 'Allowed' : 'Not allowed', status: s.uiAllowed.status } : missing(),
  ]), 'The agent\'s steps name no applications.');
  for (const s of used) {
    if (s.uiAllowed && s.uiAllowed.status !== 'unknown' && s.uiAllowed.value === false) b.callout(`Robots may not use the screens of ${s.name}: the agent must reach it another way.`, 'warning');
    b.open(`With which account does the agent work in ${s.name}, and may it change data there or only read it?`, { kind: 'system', id: s.id });
  }

  // ---- 7 Data
  b.section('7', 'Data it reads and produces', 1);
  const dataRows: Cell[][] = [];
  const seen = new Set<string>();
  for (const [name, way] of [...ours.flatMap(a => a.step.inputs.map(x => [x, 'Reads'] as const)), ...ours.flatMap(a => a.step.outputs.map(x => [x, 'Produces'] as const))]) {
    const key = `${name.toLowerCase()}|${way}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = m.dataObjects.find(x => x.name.toLowerCase() === name.toLowerCase());
    dataRows.push([{ text: name }, { text: way }, d?.classification ? { text: d.classification, status: d.status } : missing()]);
  }
  b.table('Data', ['Data', 'Reads or produces', 'Classification'], dataRows, 'No inputs or outputs are recorded at the agent\'s steps.');
  if (dataRows.some(r => r[2].missing)) b.open('How is the data the agent handles classified, and may it be sent to the AI service the agent uses?', { kind: 'data' });

  // ---- 8 Limits and controls
  b.section('8', 'Limits and controls', 1);
  const controls = m.controls.filter(c => c.stepIds.some(id => ids.has(id)));
  b.table('Controls at the agent\'s steps', ['Control', 'Steps'], controls.map(c => [{ text: c.text, status: c.status }, c.stepIds.filter(id => ids.has(id)).map(id => String(no(id))).join(', ')]), 'No controls are recorded at the agent\'s steps.');
  if (ours.length) {
    b.open('What must the agent never do in this process?');
    b.open('Up to what limit (an amount, a number of cases, a kind of case) may the agent act without a person?');
    b.open('What does a wrong action by the agent cost, and can it be undone?');
  }

  // ---- 9 Testing
  b.section('9', 'How its work is checked before it goes live', 1);
  const reqs = (input.requirements ?? []).filter(r => r.state === 'active' && r.kind === 'FR' && r.stepIds.some(id => ids.has(id)));
  b.table('Acceptance scenarios from the requirements', ['Scenario', 'Given, when, then', 'Requirement'], reqs.flatMap(r => r.acceptance.map((a, i) => [`${r.code}.${i + 1}`, criterionText(a), r.code])), 'No acceptance criteria are recorded for the agent\'s steps yet.');
  if (ours.length) {
    b.paragraph('Proposed, not confirmed: the agent is first tried on past cases whose right outcome is known, then run beside people (people decide; the agent\'s answer is compared), and works on its own only once the agreed share of right outcomes is reached.');
    b.open('Which past cases, with their known right outcomes, can the agent be tested on?');
    b.open('What share of right outcomes is good enough before the agent works without a person checking each case?');
  }

  // ---- 10 Running it
  b.section('10', 'Running and watching it', 1);
  if (ours.length) {
    b.open('Who watches the agent\'s work day to day, and what do they see (each decision and why, cases handed over, errors)?');
    b.open('Who may stop the agent, and how?');
  } else b.callout('Nothing to run yet: the agent has no steps.');

  // ---- 11 Open questions
  b.section('11', 'Open questions', 1);
  for (const q of m.openQuestions.filter(q => q.status === 'open' && ((q.target.kind === 'step' && q.target.id && ids.has(q.target.id)) || (q.target.kind === 'system' && used.some(s => s.id === q.target.id))))) b.note(q.question, q.target);
  b.table('Open questions', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open questions.');

  return {
    type: 'agent', title: 'Agent Definition Document', subtitle: m.meta.name,
    control: controlOf(input),
    sections: b.sections, openItems: b.openItems,
  };
}

