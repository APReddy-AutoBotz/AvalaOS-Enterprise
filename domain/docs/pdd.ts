// The Process Definition Document: how the process works today and how it will work. Section order
// follows the UiPath default PDD, plus the delivery model. Every table is derived from the Process
// Model and the assessment; nothing is drafted here and nothing is assumed.
import { gaps, orderedSteps } from '../processModel/selectors.ts';
import { DocBuilder, missing, type DocTree } from './tree.ts';
import { accessText, factCell, HUMAN_POINT, known, metricCell, MODE_LABEL, modeOf, names, sourceList, stepNumber, type DocInput } from './common.ts';

const TASK: Record<string, string> = { user: 'Person using a system', manual: 'Manual', service: 'Done by a system', business_rule: 'Automatic check', send: 'Sends', receive: 'Receives' };

export function buildPdd(input: DocInput): DocTree {
  const { model: m, assessment: a } = input;
  const b = new DocBuilder();
  const steps = orderedSteps(m);
  const no = stepNumber(m);
  const roleName = (id: string) => m.roles.find(r => r.id === id)?.name ?? id;

  // ---- 1 Introduction
  b.section('1', 'Introduction', 1);
  b.section('1.1', 'Purpose of this document');
  b.paragraph(`This document describes how "${m.meta.name}" is done today, step by step, and how it will be done once automated. It is the reference for the requirements (FRD) and the solution design (SDD).`);
  b.section('1.2', 'Objectives of the process');
  const objective = known(m.meta.objective);
  if (objective) b.paragraph(objective); else b.open('The objective of the process is not stated.', { kind: 'meta', field: 'objective' });
  b.section('1.3', 'Key contacts');
  const owner = known(m.meta.owner);
  b.table('Key contacts', ['Role', 'Kind', 'Steps'], [
    ...(owner ? [[`Process owner: ${owner}`, 'Owner', '']] : []),
    ...m.roles.filter(r => r.inScope).map(r => [r.name, r.kind.replace('_', ' '), String(m.steps.filter(s => s.roleIds.includes(r.id)).length)]),
  ], 'No roles are recorded yet.');
  if (!owner) b.open('The process owner is not named.', { kind: 'meta', field: 'owner' });
  b.section('1.4', 'Minimum prerequisites for automation');
  const access = m.systems.filter(s => s.inScope && (s.access.length === 0 || s.access.every(x => x.access === 'unknown')));
  b.list([
    ...m.systems.filter(s => s.inScope).map(s => `Access to ${s.name} for the automation (${accessText(s)}).`),
    ...(known(m.meta.profile?.processChange) === null ? ['Confirmation that the process will not change materially in the next six months.'] : []),
  ]);
  for (const s of access) b.note(`How can ${s.name} be accessed (API, UI, file)?`, { kind: 'system', id: s.id, field: 'access' });

  // ---- 2 As-Is
  b.section('2', 'As-Is process', 1);
  b.section('2.1', 'Process overview');
  b.keyValue('Process overview', [
    ['Process name', m.meta.name],
    ['Description', objective ? objective : missing()],
    ['Owner', factCell(m.meta.owner)],
    ['Roles', names(m.roles.filter(r => r.inScope).map(r => r.id), m.roles) || missing()],
    ['Cases handled', metricCell(m, 'volume')],
    ['Hands-on time per case', metricCell(m, 'handling_time')],
    ['People doing the work', metricCell(m, 'fte')],
    ['Cases that leave the standard path', metricCell(m, 'exception_rate')],
    ['Change expected in the next six months', factCell(m.meta.profile?.processChange, v => ({ none: 'None', minor: 'Minor', major: 'Major' })[v])],
    ['Input data', m.dataObjects.length ? m.dataObjects.map(d => d.name).join(', ') : missing()],
    ['Steps', String(steps.length)],
  ]);
  b.section('2.2', 'Applications used');
  b.table('Applications used', ['Application', 'Kind', 'Version', 'Access method and status', 'Robots allowed on screens', 'Screens stable', 'Remote desktop'],
    m.systems.map(s => [s.name, s.kind.replace('_', ' '), s.version ?? missing(), accessText(s), factCell(s.uiAllowed, v => (v ? 'Yes' : 'No')), factCell(s.uiStable, v => (v ? 'Yes' : 'No')), factCell(s.remote, v => (v ? 'Yes' : 'No'))]),
    'No applications are recorded yet.');
  b.section('2.3', 'As-Is process map');
  b.callout('The As-Is map is drawn from the same steps in the Flows stage and will be embedded here.');
  b.section('2.4', 'Detailed As-Is steps');
  b.table('Detailed As-Is steps', ['#', 'Step', 'Description', 'Role', 'Application', 'Input', 'Output', 'Rules', 'Exceptions', 'Time per case', 'Source'],
    steps.map(s => [
      String(no(s.id)), { text: s.name, status: s.status }, s.description || '', s.roleIds.length ? names(s.roleIds, m.roles) : missing(),
      s.systemIds.length ? names(s.systemIds, m.systems) : s.taskType === 'manual' ? 'None (manual)' : missing(),
      s.inputs.join(', '), s.outputs.join(', '), s.ruleIds.map(id => m.rules.find(r => r.id === id)?.name).filter(Boolean).join('; '),
      s.exceptionIds.map(id => m.exceptions.find(e => e.id === id)?.name).filter(Boolean).join('; '),
      factCell(s.traits?.effortMinutes, v => `${v} min`), sourceList(s.sources),
    ]), 'No steps are recorded yet.');
  for (const s of steps) {
    if (!s.roleIds.length) b.note(`Who does "${s.name}"?`, { kind: 'step', id: s.id, field: 'roleIds' });
    if (!s.systemIds.length && s.taskType !== 'manual') b.note(`Which system is used for "${s.name}"?`, { kind: 'step', id: s.id, field: 'systemIds' });
  }
  b.section('2.5', 'Decision points and business rules');
  b.table('Decision points', ['Decision', 'Kind', 'Outcomes'], m.gateways.map(g => [g.question, g.type, m.flows.filter(f => f.from === g.id).map(f => f.label || 'Unlabelled').join(' / ') || missing()]), 'No decision points are recorded.');
  b.table('Business rules', ['Rule', 'Condition', 'Action', 'Source'], m.rules.map(r => [{ text: r.name, status: r.status }, r.condition, r.action, sourceList(r.sources)]), 'No business rules are recorded.');
  b.section('2.6', 'Input data');
  b.table('Input data', ['Input', 'Format', 'Structured', 'Classification'], m.dataObjects.map(d => [d.name, d.format, d.structured === null ? missing() : d.structured ? 'Yes' : 'No', d.classification ?? '']), 'No input data is recorded.');
  b.section('2.7', 'Pain points and current-state gaps');
  b.table('Pain points', ['Pain point', 'Steps', 'Source'], m.painPoints.map(p => [p.text, p.stepIds.map(id => `${no(id)}`).join(', '), sourceList(p.sources)]), 'No pain points are recorded.');

  // ---- 3 To-Be
  b.section('3', 'To-Be process', 1);
  b.section('3.1', 'To-Be process map');
  b.callout('The To-Be map, coloured by delivery mode, is drawn in the Flows stage and will be embedded here.');
  b.section('3.2', 'Delivery model');
  b.paragraph(`${a.verdict}. ${a.split}`);
  b.table('Delivery model', ['#', 'Step', 'Today', 'Future mode', 'Person in the loop', 'Reason'],
    steps.map(s => {
      const md = modeOf(input, s);
      return [String(no(s.id)), s.name, TASK[s.taskType], md.approach ? `${MODE_LABEL[md.approach]}${md.overridden ? ` (set by ${md.by})` : ''}` : 'Already automated',
        md.score && !md.score.alreadyAutomated ? HUMAN_POINT[md.overridden && md.approach === 'human' ? 'does_it' : md.score.human] : '', md.why];
    }), 'No steps to assess yet.');
  b.section('3.3', 'Detailed To-Be steps');
  b.table('Detailed To-Be steps', ['#', 'Step', 'Mode', 'Inputs', 'Outputs', 'System interaction'],
    steps.filter(s => { const md = modeOf(input, s); return md.approach && md.approach !== 'human'; }).map(s => {
      const md = modeOf(input, s);
      const via = md.approach === 'api' ? 'API' : md.approach === 'rpa' ? 'Screens (UI)' : md.approach === 'ai_assist' ? 'AI reads; a person reviews' : 'Agent within set limits';
      return [String(no(s.id)), s.name, MODE_LABEL[md.approach!], s.inputs.join(', '), s.outputs.join(', '), s.systemIds.length ? `${names(s.systemIds, m.systems)} via ${via}` : via];
    }), 'No step is recommended for automation yet.');
  b.section('3.4', 'In scope for automation');
  b.table('In scope for automation', ['#', 'Step', 'Mode', 'Reason'], steps.map(s => ({ s, md: modeOf(input, s) })).filter(x => x.md.approach && x.md.approach !== 'human').map(({ s, md }) => [String(no(s.id)), s.name, MODE_LABEL[md.approach!], md.why]), 'None yet.');
  b.section('3.5', 'Out of scope for automation');
  b.table('Out of scope for automation', ['#', 'Step', 'Reason'], steps.map(s => ({ s, md: modeOf(input, s) })).filter(x => x.md.approach === 'human').map(({ s, md }) => [String(no(s.id)), s.name, md.score?.forNow && !md.overridden ? `For now: ${md.why}` : md.why]), 'None.');
  if (m.meta.scopeOut.length) b.list(m.meta.scopeOut.map(x => `Outside the process: ${x.text}`));
  b.section('3.6', 'Business exception handling');
  const exRows = (kind: 'business' | 'application', prefix: string) => m.exceptions.filter(e => e.kind === kind).map((e, i) => [
    `${prefix}-${String(i + 1).padStart(2, '0')}`, { text: e.name, status: e.status }, e.trigger, e.stepIds.map(id => String(no(id))).join(', '), e.handling || missing(), e.routedToRoleId ? roleName(e.routedToRoleId) : missing(),
  ]);
  b.table('Business exceptions', ['ID', 'Exception', 'Trigger', 'Steps', 'Action', 'Routed to'], exRows('business', 'BE'), 'No business exceptions are recorded.');
  for (const e of m.exceptions.filter(x => !x.routedToRoleId)) b.note(`Who handles the exception "${e.name}"?`, { kind: 'exception', id: e.id, field: 'routedToRoleId' });
  b.section('3.7', 'Application error handling');
  b.table('Application errors', ['ID', 'Error', 'Trigger', 'Steps', 'Action', 'Routed to'], exRows('application', 'AE'), 'No application errors are recorded.');
  if (!m.exceptions.some(e => e.kind === 'application')) b.open('How should the automation handle application errors (system down, time-outs, login failure)?');
  b.section('3.8', 'Reporting and audit');
  b.table('Controls, reporting and audit', ['Control', 'Steps', 'Source'], m.controls.map(c => [c.text, c.stepIds.map(id => String(no(id))).join(', '), sourceList(c.sources)]), 'No controls or reporting needs are recorded.');

  // ---- 4–6
  b.section('4', 'Other observations', 1);
  b.table('Risks noted in the sources', ['Risk', 'Steps', 'Source'], m.risks.map(r => [r.text, r.stepIds.map(id => String(no(id))).join(', '), sourceList(r.sources)]), 'None recorded.');
  b.section('5', 'Sources', 1);
  b.table('Sources', ['Key', 'Title'], input.sources.map(s => [s.key, s.title]), 'No sources were used; the model was entered by hand.');
  b.section('6', 'Open gaps and deferred items', 1);
  for (const q of m.openQuestions.filter(q => q.status === 'open')) b.note(q.question, q.target);
  for (const g of gaps(m)) b.note(g.label, g.target);
  b.table('Open gaps', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open gaps.');

  return {
    type: 'pdd', title: 'Process Definition Document', subtitle: m.meta.name,
    control: [['Process', m.meta.name], ['Revision', input.revision.label], ['Status', input.revision.state === 'approved' ? 'Approved' : 'Working draft'], ['Date', input.revision.date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: b.openItems,
  };
}
