// The Solution Design Document: how it will be built (plan section 4.5). Written from the model, the
// assessment and the requirements register once a revision is approved. Nothing technical is asserted
// without a source: authentication, schedules, environments and the like are open design decisions
// until someone records them. It summarises the PDD and FRD by reference rather than repeating them.
import type { ProcessModel, Step } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { APPROACH_LABEL, type Approach } from '../assess/scoring.ts';
import { criterionText } from '../requirements/register.ts';
import { DocBuilder, missing, type DocTree } from './tree.ts';
import { ACCESS_TEXT, modeOf, sourceList, type DocInput } from './common.ts';

export interface AutomationUnit { id: string; approach: Approach; systemIds: string[]; steps: Step[] }

/** To-Be steps the solution takes on, grouped by approach and main application, in process order. */
export function automationUnits(input: DocInput): AutomationUnit[] {
  const units: AutomationUnit[] = [];
  for (const s of orderedSteps(input.model)) {
    const { approach } = modeOf(input, s);
    if (!approach || approach === 'human') continue;
    const main = s.systemIds[0] ?? '';
    let u = units.find(x => x.approach === approach && (x.systemIds[0] ?? '') === main);
    if (!u) { u = { id: `AU-${String(units.length + 1).padStart(2, '0')}`, approach, systemIds: [], steps: [] }; units.push(u); }
    u.steps.push(s);
    for (const id of s.systemIds) if (!u.systemIds.includes(id)) u.systemIds.push(id);
  }
  return units;
}

export function buildSdd(input: DocInput): DocTree {
  const m: ProcessModel = input.model;
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const sys = (id: string) => m.systems.find(s => s.id === id)?.name ?? id;
  const units = automationUnits(input);
  const unitOf = (stepId: string) => units.find(u => u.steps.some(s => s.id === stepId))?.id;
  const reqs = (input.requirements ?? []).filter(r => r.state === 'active');
  const frOf = (key: string) => reqs.find(r => r.key === key)?.code;
  const used = [...new Set(units.flatMap(u => u.systemIds))];
  const b = new DocBuilder();
  const decisions: { text: string; options: string; section: string }[] = [];
  const decide = (text: string, options = '', target?: Parameters<DocBuilder['open']>[1]) => {
    b.open(text, target);
    if (!decisions.some(d => d.text === text)) decisions.push({ text, options, section: b.sections.at(-1)?.number ?? '' });
  };

  b.section('1', 'Solution overview and architecture', 1);
  b.paragraph(units.length
    ? `The solution for ${m.meta.name} has ${units.length} automation ${units.length === 1 ? 'unit' : 'units'} covering ${units.reduce((n, u) => n + u.steps.length, 0)} of ${steps.length} steps. The remaining steps stay with people, as set out in the PDD section "Delivery model". What each unit must do is in the FRD.`
    : `No step of ${m.meta.name} is recommended for automation yet, so there is nothing to design. The PDD section "Delivery model" shows why.`);
  b.table('Automation units', ['Unit', 'Approach', 'Applications', 'Steps'], units.map(u => [u.id, APPROACH_LABEL[u.approach], u.systemIds.map(sys).join(', ') || missing(), u.steps.map(s => String(no(s.id))).join(', ')]), 'No automation units.');
  if (units.length > 1) decide('Do the automation units run as one process or as separate jobs handing work over through a queue?', 'One process; separate jobs with a work queue');

  b.section('2', 'Automation units', 1);
  units.forEach((u, i) => {
    b.section(`2.${i + 1}`, `${u.id} ${APPROACH_LABEL[u.approach]}${u.systemIds[0] ? ` in ${sys(u.systemIds[0])}` : ''}`);
    const first = u.steps[0];
    const start = m.events.find(e => e.kind === 'start');
    b.keyValue('Unit', [
      ['Purpose', u.steps.map(s => s.name).join('; ')],
      ['Steps covered', u.steps.map(s => `${no(s.id)} ${s.name}`).join('; ')],
      ['Approach', APPROACH_LABEL[u.approach]],
      ['Starts when', no(first.id) === 1 && start ? start.name : no(first.id) > 1 ? `Step ${no(first.id) - 1} is done` : missing()],
      ['Inputs', [...new Set(u.steps.flatMap(s => s.inputs))].join(', ') || missing()],
      ['Outputs', [...new Set(u.steps.flatMap(s => s.outputs))].join(', ') || missing()],
      ['Applications', u.systemIds.map(id => { const s = m.systems.find(x => x.id === id)!; return `${s.name} (${s.access.length ? s.access.map(a => `${a.method.toUpperCase()} ${ACCESS_TEXT[a.access]}`).join(', ') : 'access not recorded'})`; }).join('; ') || missing()],
      ['Requirements', u.steps.map(s => frOf(`step:${s.id}`)).filter(Boolean).join(', ') || missing()],
    ]);
    decide(`When and how often does ${u.id} run (on arrival, on a schedule, or started by a person)?`, 'On arrival; on a schedule; started by a person');
  });
  if (!units.length) b.callout('No automation units.');

  b.section('3', 'Integration design', 1);
  const ifaces = used.flatMap(id => { const s = m.systems.find(x => x.id === id)!; return s.access.map(a => ({ s, a })); });
  b.table('Interfaces used by the solution', ['Application', 'Method', 'Interface', 'Operations', 'Status', 'Authentication', 'Error behaviour', 'Source'],
    ifaces.map(({ s, a }) => [s.name, a.method.toUpperCase(), a.name ?? '', a.operations.join(', ') || missing(), { text: ACCESS_TEXT[a.access], status: a.status }, missing(), missing(), sourceList(a.sources)]), 'No interfaces are recorded for the applications the solution uses.');
  for (const id of used) {
    const s = m.systems.find(x => x.id === id)!;
    decide(`How does the solution sign in to ${s.name}, and with which account?`, 'Service account; named robot account; API credentials', { kind: 'system', id });
    if (s.access.some(a => a.access === 'unknown' || a.access === 'reported')) decide(`Which ${s.name} interfaces are confirmed for this work by their owner?`, '', { kind: 'system', id });
    if (s.uiAllowed?.status !== 'unknown' && s.uiAllowed?.value === false) b.callout(`Robots may not drive the screens of ${s.name} (${sourceList(s.uiAllowed.sources) || 'stated'}): integration must use another method.`, 'warning');
  }
  if (used.length) decide('What does the solution do when an application is slow or returns an error: retry how often, then hand over to whom?', 'Retry then hand over to a person; stop and alert');

  b.section('4', 'Data design', 1);
  b.table('Data', ['Data', 'Format', 'Structured', 'Classification', 'Retention'], m.dataObjects.map(d => [d.name, d.format || missing(), d.structured === null ? missing() : d.structured ? 'Yes' : 'No', d.classification ?? missing(), missing()]), 'No data objects are recorded.');
  if (m.dataObjects.length) decide('How long is each piece of data kept by the solution, and where?', '', { kind: 'data' });
  if (m.dataObjects.some(d => !d.classification)) decide('How is each data object classified (public, internal, confidential, personal)?', 'Public; internal; confidential; personal', { kind: 'data' });

  b.section('5', 'Business rules implementation', 1);
  b.table('Where each rule is applied', ['Rule', 'Business requirement', 'Applied in', 'Steps'], m.rules.map(r => {
    const at = steps.filter(s => s.ruleIds.includes(r.id));
    const unitsFor = [...new Set(at.map(s => unitOf(s.id)).filter(Boolean))];
    return [r.name, frOf(`rule:${r.id}`) ?? '', unitsFor.join(', ') || (at.length ? 'By a person' : missing()), at.map(s => String(no(s.id))).join(', ')];
  }), 'No business rules are recorded.');

  b.section('6', 'Exception and error handling design', 1);
  for (const kind of ['business', 'application'] as const) {
    b.table(kind === 'business' ? 'Business exceptions' : 'Application exceptions', ['Exception', 'Requirement', 'Detected in', 'Handling', 'Routed to'], m.exceptions.filter(e => e.kind === kind).map(e => [
      e.name, frOf(`exception:${e.id}`) ?? '', [...new Set(e.stepIds.map(id => unitOf(id) ?? `step ${no(id)}`))].join(', ') || missing(), e.handling || missing(), e.routedToRoleId ? m.roles.find(r => r.id === e.routedToRoleId)?.name ?? missing() : missing(),
    ]), kind === 'business' ? 'No business exceptions are recorded.' : 'No application exceptions are recorded.');
  }
  if (units.length) decide('What is the retry policy for application errors (how many tries, how far apart)?', '');

  b.section('7', 'Human-in-the-loop design', 1);
  const hitl = reqs.filter(r => r.category === 'human');
  b.table('Human tasks', ['Requirement', 'Task', 'Who', 'Where they receive it', 'Escalation'], hitl.map(r => [r.code, r.title, r.stepIds.flatMap(id => m.steps.find(s => s.id === id)?.roleIds ?? []).map(id => m.roles.find(x => x.id === id)?.name).filter(Boolean).join(', ') || missing(), missing(), missing()]), 'No human checks are required by the requirements.');
  if (hitl.length) decide('Where do people receive tasks from the solution (work queue, shared mailbox, or an app), and who picks up unanswered ones?', 'Work queue; shared mailbox; task app');

  b.section('8', 'Security and access', 1);
  b.table('Access per application', ['Application', 'Identity', 'Permissions needed', 'Robots allowed on screens', 'Secrets (names only)'], used.map(id => {
    const s = m.systems.find(x => x.id === id)!;
    const ops = [...new Set(units.flatMap(u => u.steps).filter(x => x.systemIds.includes(id)).map(x => x.name))];
    return [s.name, missing(), ops.join('; '), s.uiAllowed && s.uiAllowed.status !== 'unknown' && s.uiAllowed.value !== null ? (s.uiAllowed.value ? 'Yes' : 'No') : missing(), missing()];
  }), 'The solution uses no applications yet.');

  b.section('9', 'Logging, monitoring and reporting', 1);
  b.table('Controls the solution must evidence', ['Requirement', 'Control', 'Steps'], m.controls.map(c => [frOf(`control:${c.id}`) ?? '', c.text, c.stepIds.map(id => String(no(id))).join(', ')]), 'No controls are recorded.');
  if (units.length) decide('Who watches the solution day to day, and which alerts and reports do they need?', '');

  b.section('10', 'Environments and development prerequisites', 1);
  b.table('Environments', ['Application', 'Version', 'Test environment', 'Test data'], used.map(id => { const s = m.systems.find(x => x.id === id)!; return [s.name, s.version ?? missing(), missing(), missing()]; }), 'No applications are used yet.');
  if (used.length) decide('Which test environments and test data are available for each application?', '');

  b.section('11', 'Test strategy', 1);
  const scenarios = [
    ...reqs.filter(r => r.kind === 'FR').flatMap(r => r.acceptance.map((a, i) => [`${r.code}.${i + 1}`, criterionText(a), r.code])),
  ];
  b.table('Acceptance test scenarios', ['Scenario', 'Given, when, then', 'Requirement'], scenarios, 'No acceptance criteria are recorded yet, so no scenarios can be listed.');
  b.paragraph('Proposed, not confirmed: each automation unit is tested on its own first, then end to end with the applications, then by the business against the scenarios above. Every exception path above has at least one scenario.');

  b.section('12', 'Deployment and operations', 1);
  b.table('Run and support', ['Unit', 'Starts when', 'Supported by', 'If it fails'], units.map(u => [u.id, no(u.steps[0].id) > 1 ? `Step ${no(u.steps[0].id) - 1} is done` : m.events.find(e => e.kind === 'start')?.name ?? missing(), missing(), missing()]), 'No automation units.');
  if (units.length) decide('Who supports the solution in production, and how are changes released?', '');

  const agents = units.filter(u => u.approach === 'agent');
  if (agents.length) {
    b.section('13', 'Agent design', 1);
    for (const u of agents) {
      b.keyValue(`${u.id} agent`, [['Purpose', u.steps.map(s => s.name).join('; ')], ['Tools', u.systemIds.map(sys).join(', ') || missing()], ['Guardrails', missing()], ['Escalates to', missing()]]);
      decide(`What may the agent in ${u.id} never do, and when must it hand over to a person?`, '');
    }
  }

  b.section(agents.length ? '14' : '13', 'Open design decisions', 1);
  for (const q of m.openQuestions.filter(q => q.status === 'open' && (q.target.kind === 'system' || q.target.kind === 'data'))) b.note(q.question, q.target);
  b.table('Open design decisions', ['#', 'Decision', 'Options', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, decisions.find(d => d.text === o.text)?.options ?? '', o.section ?? '']), 'No open design decisions.');

  return {
    type: 'sdd', title: 'Solution Design Document', subtitle: m.meta.name,
    control: [['Process', m.meta.name], ['Revision', input.revision.label], ['Status', input.revision.state === 'approved' ? 'Approved' : 'Working draft'], ['Date', input.revision.date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: b.openItems,
  };
}
