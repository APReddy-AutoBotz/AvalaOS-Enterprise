// The Process Definition Document: how the process works today and how it will work. Section order
// follows the UiPath default PDD, plus the delivery model. Every table is derived from the Process
// Model and the assessment; nothing is drafted here and nothing is assumed.
import { orderedSteps } from '../processModel/selectors.ts';
import { closedByPerson, openGapsOf } from '../questions/closedGaps.ts';
import { DocBuilder, missing, type CellInput, type DocTree } from './tree.ts';
import type { MetricKind } from '../processModel/types.ts';
import { buildingSystem, existingSystems, processWords } from '../plan/intended.ts';
import { robotsBlocked } from '../assess/scoring.ts';
import { flowMermaid, flowPicture, modeFromScore } from '../flowchart/svg.ts';
import { shapeInEffect } from '../flowchart/shape.ts';
import { controlOf, decidedIn, ACCESS_TEXT, accessSummary, factCell, HUMAN_POINT, known, metricCell, metricText, MODE_LABEL, modeOf, names, sourceList, stepNumber, type DocInput } from './common.ts';
import { asksQuestion, whatFollows } from '../plan/purpose.ts';
import { decidedSentence } from '../assess/decided.ts';
import { NOT_RECORDED_WHO } from '../assess/decisions.ts';
import { processMetric } from '../processModel/selectors.ts';

const TASK: Record<string, string> = { user: 'Person using a system', manual: 'Manual', service: 'Done by a system', business_rule: 'Automatic check', send: 'Sends', receive: 'Receives' };

export function buildPdd(input: DocInput): DocTree {
  // A process documented as it is gets the document of how the work is done, and nothing about a change.
  // The model the document is built from decides: an approved revision follows the answer it was approved with.
  if (!whatFollows(input.model).future) return buildPddAsIs(input);
  const { model: m, assessment: a } = input;
  const b = new DocBuilder();
  const steps = orderedSteps(m);
  const no = stepNumber(m);
  const roleName = (id: string) => m.roles.find(r => r.id === id)?.name ?? id;
  // Both maps in the shape every screen draws them in; documents always run down the page.
  const shape = input.mapShape ?? shapeInEffect(m, input.decisions).shape;

  // ---- 1 Introduction
  b.section('1', 'Introduction', 1);
  b.section('1.1', 'Purpose of this document');
  const words = processWords(m);
  const building = buildingSystem(m);
  b.paragraph(words.intended
    ? `This document describes how "${m.meta.name}" is intended to work, step by step, and how each step would be done. Nothing of it is done today, so it describes no current process. It is the reference for the requirements (FRD) and the solution design (SDD).`
    : `This document describes how "${m.meta.name}" is done today, step by step, and how it will be done once automated. It is the reference for the requirements (FRD) and the solution design (SDD).`);
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
  // The application being built is not one the automation needs access to (part C).
  const used = existingSystems(m);
  const access = used.filter(s => s.inScope && (s.access.length === 0 || s.access.every(x => x.access === 'unknown')));
  b.list([
    ...used.filter(s => s.inScope).map(s => `Access to ${s.name} for the automation (${accessSummary(s)}).`),
    ...(known(m.meta.profile?.processChange) === null ? ['Confirmation that the process will not change materially in the next six months.'] : []),
  ]);
  for (const s of access) b.note(`How can ${s.name} be accessed (API, UI, file)?`, { kind: 'system', id: s.id, field: 'access' });

  // ---- 2 As-Is (the intended process when nothing is done today)
  b.section('2', words.process, 1);
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
  const robots = (s: typeof m.systems[number]) => {
    const f = s.uiAllowed;
    if (f && f.status !== 'unknown' && f.value !== null) return factCell(f, v => (v ? 'Yes' : 'No'));
    const ban = s.access.find(a => a.method === 'ui' && a.access === 'confirmed_absent' && robotsBlocked({ ...s, access: [a] }));
    return ban ? { text: `No (${ban.name}: not available)`, status: ban.status } : missing();
  };
  if (building) b.callout(`${building.name} is what is being built, so it is not listed as an application the process uses.`);
  b.table('Applications used', ['Application', 'Kind', 'Version', 'Access', 'Robots allowed on screens', 'Screens stable', 'Remote desktop'],
    used.map(s => [s.name, s.kind.replace('_', ' '), s.version ?? missing(), accessSummary(s), robots(s), factCell(s.uiStable, v => (v ? 'Yes' : 'No')), factCell(s.remote, v => (v ? 'Yes' : 'No'))]),
    'No applications are recorded yet.');
  const ifaces = m.systems.flatMap(s => s.access.map(a => ({ s, a })));
  if (ifaces.length > m.systems.length) {
    b.table('Interfaces and transactions', ['Application', 'Method', 'Interface or transaction', 'Used for', 'Status', 'Source'],
      ifaces.map(({ s, a }) => [s.name, a.method.toUpperCase(), a.name ?? '', a.operations.join(', '), { text: ACCESS_TEXT[a.access], status: a.status }, sourceList(a.sources)]), '');
  }
  b.section('2.3', words.intended ? words.map : 'As-Is process map');
  {
    const f = flowPicture(m, { shape, title: `${words.map} of ${m.meta.name}` });
    if (m.steps.length) b.figure(words.intended ? words.map : 'As-Is process map', { svg: f.svg, width: f.width, height: f.height, mermaid: flowMermaid(m, undefined, shape) });
    else b.callout('No steps are recorded, so there is no map yet.');
    if (m.steps.length && !m.flows.length) b.open('How do the steps connect: which step follows which, and where does the process branch?');
  }
  b.section('2.4', words.steps);
  b.table(words.steps, ['#', 'Step', 'Description', 'Role', 'Application', 'Input', 'Output', 'Rules', 'Exceptions', 'Time per case', 'Source'],
    steps.map(s => [
      String(no(s.id)), { text: s.name, status: s.status }, s.description || '', s.roleIds.length ? names(s.roleIds, m.roles) : missing(),
      s.systemIds.length ? names(s.systemIds, m.systems) : s.taskType === 'manual' ? 'None (manual)' : missing(),
      s.inputs.join(', '), s.outputs.join(', '), s.ruleIds.map(id => m.rules.find(r => r.id === id)?.name).filter(Boolean).join('; '),
      s.exceptionIds.map(id => m.exceptions.find(e => e.id === id)?.name).filter(Boolean).join('; '),
      factCell(s.traits?.effortMinutes, v => `${v} min`), sourceList(s.sources),
    ]), 'No steps are recorded yet.');
  for (const s of steps) {
    if (!s.roleIds.length && !closedByPerson(m, { kind: 'step', id: s.id, field: 'roleIds' })) b.note(`Who does "${s.name}"?`, { kind: 'step', id: s.id, field: 'roleIds' });
    if (!s.systemIds.length && s.taskType !== 'manual' && !closedByPerson(m, { kind: 'step', id: s.id, field: 'systemIds' })) b.note(`Which system is used for "${s.name}"?`, { kind: 'step', id: s.id, field: 'systemIds' });
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
  {
    const modes = new Map(m.steps.map(s => { const x = modeOf(input, s); return [s.id, modeFromScore(x.approach, Boolean(x.score?.alreadyAutomated), x.score?.human)] as const; }));
    const f = flowPicture(m, { modes, shape, title: `To-Be map of ${m.meta.name}` });
    if (m.steps.length) b.figure('To-Be process map, coloured by delivery mode', { svg: f.svg, width: f.width, height: f.height, mermaid: flowMermaid(m, modes, shape) });
    else b.callout('No steps are recorded, so there is no map yet.');
  }
  b.section('3.2', 'Delivery model');
  // Decided for the whole process: who decided, when and why, in place of the scoring's verdict.
  const dec = decidedIn(input);
  b.paragraph(dec ? `${decidedSentence(dec, input.names)} ${a.split}` : `${a.verdict}. ${a.split}`);
  b.table('Delivery model', ['#', 'Step', 'Today', 'Future mode', 'Person in the loop', 'Reason'],
    steps.map(s => {
      const md = modeOf(input, s);
      return [String(no(s.id)), s.name, TASK[s.taskType], md.approach ? `${MODE_LABEL[md.approach]}${md.overridden ? ` (set by ${md.by && md.by !== NOT_RECORDED_WHO ? md.by : 'a person'})` : ''}` : 'Already automated',
        md.score && !md.score.alreadyAutomated ? HUMAN_POINT[md.overridden && md.approach === 'human' ? 'does_it' : md.score.human] : '', md.why];
    }), 'No steps to assess yet.');
  b.section('3.3', 'Detailed To-Be steps');
  b.table('Detailed To-Be steps', ['#', 'Step', 'Mode', 'Inputs', 'Outputs', 'System interaction'],
    steps.filter(s => { const md = modeOf(input, s); return md.approach && md.approach !== 'human'; }).map(s => {
      const md = modeOf(input, s);
      const via = md.approach === 'api' ? 'API' : md.approach === 'rpa' ? 'Screens (UI)' : md.approach === 'ai_assist' ? 'AI reads; a person reviews' : 'Agent within set limits';
      return [String(no(s.id)), s.name, MODE_LABEL[md.approach!], s.inputs.join(', '), s.outputs.join(', '), s.systemIds.length ? `${names(s.systemIds, m.systems)} via ${via}` : via];
    }), dec ? `${dec.label}, the approach decided, can do no step yet.` : 'No step is recommended for automation yet.');
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
  for (const e of m.exceptions.filter(x => !x.routedToRoleId && !closedByPerson(m, { kind: 'exception', id: x.id, field: 'routedToRoleId' }))) b.note(`Who handles the exception "${e.name}"?`, { kind: 'exception', id: e.id, field: 'routedToRoleId' });
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
  for (const g of openGapsOf(m)) b.note(g.label, g.target);
  b.table('Open gaps', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open gaps.');

  return {
    type: 'pdd', title: 'Process Definition Document', subtitle: m.meta.name,
    control: controlOf(input),
    sections: b.sections, openItems: b.openItems,
  };
}

/**
 * The process document for a process documented as it is (domain/plan/purpose.ts): what the process is
 * for, who is involved, the applications, the map, the steps, decisions and rules, input data, pain
 * points, exceptions as people handle them, reporting and audit, other observations, sources and open
 * gaps. Nothing in it speaks of a change to the process or of how it could be done otherwise; section
 * numbers run without gaps. Figures are shown when the record holds them and never asked for.
 */
function buildPddAsIs(input: DocInput): DocTree {
  const m = input.model;
  const b = new DocBuilder();
  const steps = orderedSteps(m);
  const no = stepNumber(m);
  const roleName = (id: string) => m.roles.find(r => r.id === id)?.name ?? id;
  const shape = input.mapShape ?? shapeInEffect(m, input.decisions).shape;
  const words = processWords(m);
  const building = buildingSystem(m);
  let top = 0, sub = 0;
  const chapter = (title: string) => { top += 1; sub = 0; b.section(String(top), title, 1); };
  const section = (title: string) => { sub += 1; b.section(`${top}.${sub}`, title); };

  chapter('Introduction');
  section('Purpose of this document');
  b.paragraph(words.intended
    ? `This document describes how "${m.meta.name}" is intended to work, step by step: who does each step, with which application, and the rules and exceptions that apply. Nothing of it is done today, so it describes no current process.`
    : `This document describes how "${m.meta.name}" is done today, step by step: who does each step, with which application, and the rules and exceptions that apply. It is the reference for how the work is done.`);
  section('Objectives of the process');
  const objective = known(m.meta.objective);
  if (objective) b.paragraph(objective); else b.open('The objective of the process is not stated.', { kind: 'meta', field: 'objective' });
  section('Key contacts');
  const owner = known(m.meta.owner);
  b.table('Key contacts', ['Role', 'Kind', 'Steps'], [
    ...(owner ? [[`Process owner: ${owner}`, 'Owner', '']] : []),
    ...m.roles.filter(r => r.inScope).map(r => [r.name, r.kind.replace('_', ' '), String(m.steps.filter(s => s.roleIds.includes(r.id)).length)]),
  ], 'No roles are recorded yet.');
  if (!owner) b.open('The process owner is not named.', { kind: 'meta', field: 'owner' });

  chapter(words.process);
  section('Process overview');
  // A figure is shown with its source when the record holds it; one it does not hold is left out, not asked for.
  const figure = (label: string, kind: MetricKind): [string, CellInput][] => {
    const x = processMetric(m, kind);
    return x && (x.value !== null || x.range) ? [[label, { text: `${metricText(x)}${x.sources.length ? ` (source: ${sourceList(x.sources)})` : ''}`, status: x.status }]] : [];
  };
  b.keyValue('Process overview', [
    ['Process name', m.meta.name],
    ['Description', objective ? objective : missing()],
    ['Owner', factCell(m.meta.owner)],
    ['Roles', names(m.roles.filter(r => r.inScope).map(r => r.id), m.roles) || missing()],
    ...figure('Cases handled', 'volume'),
    ...figure('Hands-on time per case', 'handling_time'),
    ...figure('People doing the work', 'fte'),
    ...figure('Cases that leave the standard path', 'exception_rate'),
    ['Input data', m.dataObjects.length ? m.dataObjects.map(d => d.name).join(', ') : missing()],
    ['Steps', String(steps.length)],
  ]);
  section('Applications used');
  const used = existingSystems(m);
  if (building) b.callout(`${building.name} is what is being built, so it is not listed as an application the process uses.`);
  b.table('Applications used', ['Application', 'Kind', 'Version', 'Used in steps'],
    used.map(s => [s.name, s.kind.replace('_', ' '), s.version ?? '', steps.filter(x => x.systemIds.includes(s.id)).map(x => String(no(x.id))).join(', ')]),
    'No applications are recorded.');
  section(words.intended ? words.map : 'As-Is process map');
  {
    const f = flowPicture(m, { shape, title: `${words.map} of ${m.meta.name}` });
    if (m.steps.length) b.figure(words.intended ? words.map : 'As-Is process map', { svg: f.svg, width: f.width, height: f.height, mermaid: flowMermaid(m, undefined, shape) });
    else b.callout('No steps are recorded, so there is no map yet.');
    if (m.steps.length && !m.flows.length) b.open('How do the steps connect: which step follows which, and where does the process branch?');
  }
  section(words.steps);
  const timed = steps.some(s => known(s.traits?.effortMinutes) !== null);
  b.table(words.steps, ['#', 'Step', 'Description', 'Role', 'Application', 'Input', 'Output', 'Rules', 'Exceptions', ...(timed ? ['Time per case'] : []), 'Source'],
    steps.map(s => [
      String(no(s.id)), { text: s.name, status: s.status }, s.description || '', s.roleIds.length ? names(s.roleIds, m.roles) : missing(),
      s.systemIds.length ? names(s.systemIds, m.systems) : s.taskType === 'manual' ? 'None (manual)' : missing(),
      s.inputs.join(', '), s.outputs.join(', '), s.ruleIds.map(id => m.rules.find(r => r.id === id)?.name).filter(Boolean).join('; '),
      s.exceptionIds.map(id => m.exceptions.find(e => e.id === id)?.name).filter(Boolean).join('; '),
      ...(timed ? [known(s.traits?.effortMinutes) !== null ? factCell(s.traits?.effortMinutes, v => `${v} min`) : ''] : []), sourceList(s.sources),
    ]), 'No steps are recorded yet.');
  for (const s of steps) {
    if (!s.roleIds.length && !closedByPerson(m, { kind: 'step', id: s.id, field: 'roleIds' })) b.note(`Who does "${s.name}"?`, { kind: 'step', id: s.id, field: 'roleIds' });
    if (!s.systemIds.length && s.taskType !== 'manual' && !closedByPerson(m, { kind: 'step', id: s.id, field: 'systemIds' })) b.note(`Which system is used for "${s.name}"?`, { kind: 'step', id: s.id, field: 'systemIds' });
  }
  section('Decision points and business rules');
  b.table('Decision points', ['Decision', 'Kind', 'Outcomes'], m.gateways.map(g => [g.question, g.type, m.flows.filter(f => f.from === g.id).map(f => f.label || 'Unlabelled').join(' / ') || missing()]), 'No decision points are recorded.');
  b.table('Business rules', ['Rule', 'Condition', 'Action', 'Source'], m.rules.map(r => [{ text: r.name, status: r.status }, r.condition, r.action, sourceList(r.sources)]), 'No business rules are recorded.');
  section('Input data');
  b.table('Input data', ['Input', 'Format', 'Structured', 'Classification'], m.dataObjects.map(d => [d.name, d.format, d.structured === null ? missing() : d.structured ? 'Yes' : 'No', d.classification ?? '']), 'No input data is recorded.');
  section('Pain points and current-state gaps');
  b.table('Pain points', ['Pain point', 'Steps', 'Source'], m.painPoints.map(p => [p.text, p.stepIds.map(id => `${no(id)}`).join(', '), sourceList(p.sources)]), 'No pain points are recorded.');
  section('Business exception handling');
  const exRows = (kind: 'business' | 'application', prefix: string) => m.exceptions.filter(e => e.kind === kind).map((e, i) => [
    `${prefix}-${String(i + 1).padStart(2, '0')}`, { text: e.name, status: e.status }, e.trigger, e.stepIds.map(id => String(no(id))).join(', '), e.handling || missing(), e.routedToRoleId ? roleName(e.routedToRoleId) : missing(),
  ]);
  b.paragraph('The cases that leave the standard path, and how people handle them today.');
  b.table('Business exceptions', ['ID', 'Exception', 'Trigger', 'Steps', 'Action', 'Handled by'], exRows('business', 'BE'), 'No business exceptions are recorded.');
  if (m.exceptions.some(e => e.kind === 'application')) b.table('When an application fails', ['ID', 'Problem', 'Trigger', 'Steps', 'Action', 'Handled by'], exRows('application', 'AE'), '');
  for (const e of m.exceptions.filter(x => !x.routedToRoleId && !closedByPerson(m, { kind: 'exception', id: x.id, field: 'routedToRoleId' }))) b.note(`Who handles the exception "${e.name}"?`, { kind: 'exception', id: e.id, field: 'routedToRoleId' });
  section('Reporting and audit');
  b.table('Controls, reporting and audit', ['Control', 'Steps', 'Source'], m.controls.map(c => [c.text, c.stepIds.map(id => String(no(id))).join(', '), sourceList(c.sources)]), 'No controls or reporting needs are recorded.');

  chapter('Other observations');
  b.table('Risks noted in the sources', ['Risk', 'Steps', 'Source'], m.risks.map(r => [r.text, r.stepIds.map(id => String(no(id))).join(', '), sourceList(r.sources)]), 'None recorded.');
  chapter('Sources');
  b.table('Sources', ['Key', 'Title'], input.sources.map(s => [s.key, s.title]), 'No sources were used; the process was entered by hand.');
  chapter('Open gaps and deferred items');
  // Only what is asked of this process: a question that serves an assessment is not listed (it stays on the record).
  for (const q of m.openQuestions.filter(q => q.status === 'open' && asksQuestion(m, q))) b.note(q.question, q.target);
  for (const g of openGapsOf(m)) if (asksQuestion(m, { target: g.target, question: g.label })) b.note(g.label, g.target);
  b.table('Open gaps', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open gaps.');

  return { type: 'pdd', title: 'Process Definition Document', subtitle: m.meta.name, control: controlOf(input), sections: b.sections, openItems: b.openItems };
}
