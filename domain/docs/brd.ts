// The Business Requirements Document: why the process is being changed and what the business
// needs. It summarises and links to the PDD rather than repeating the step detail. Every figure
// comes from the model, the assessment or a person's entry.
import { gaps, orderedSteps } from '../processModel/selectors.ts';
import { paybackOf } from '../assess/payback.ts';
import { QUADRANT } from '../assess/priority.ts';
import { DocBuilder, missing, type DocTree } from './tree.ts';
import { known, metricCell, sourceList, type DocInput } from './common.ts';

const hrs = (n: number) => Math.round(n).toLocaleString('en');

export function buildBrd(input: DocInput): DocTree {
  const { model: m, assessment: a } = input;
  const p = a.priority;
  const b = new DocBuilder();
  const objective = known(m.meta.objective);
  const owner = known(m.meta.owner);

  b.section('1', 'Executive summary', 1);
  b.paragraph(`Recommended for ${m.meta.name}: ${a.verdict}. ${a.takeaway}`);
  b.list([
    a.split,
    `Readiness: ${p.readiness.label}. ${p.readiness.reasons.join(' ')}`,
    p.value.computable ? `${p.value.value!.exact ? '' : 'Up to '}${p.value.value!.exact && Math.round(p.value.value!.hours[0]) !== Math.round(p.value.value!.hours[1]) ? `${hrs(p.value.value!.hours[0])} to ` : ''}${hrs(p.value.value!.hours[1])} hands-on hours a year could be automated.` : `The hours that could be automated are not known yet: ${p.value.reason}`,
    p.placement.placed ? `Priority: ${QUADRANT[p.placement.quadrant!].label}. ${QUADRANT[p.placement.quadrant!].text}` : `Priority is not settled yet. ${p.placement.reason}`,
  ]);
  for (const c of a.cautions.filter(c => c.fired)) b.callout(`${c.label}. ${c.reason}`, 'warning');

  b.section('2', 'Business context and problem statement', 1);
  if (objective) b.paragraph(objective); else b.open('The business objective of the process is not stated.', { kind: 'meta', field: 'objective' });
  b.table('Pain points', ['Pain point', 'Source'], m.painPoints.map(x => [x.text, sourceList(x.sources)]), 'No pain points are recorded.');

  b.section('3', 'Objectives and success measures', 1);
  b.table('Objectives and success measures', ['Objective', 'Measure', 'Baseline', 'Target', 'Owner'], [
    [objective ?? missing(), missing(), missing(), missing(), owner ?? missing()],
  ], '');
  b.open('Which measures show the change succeeded, with their baseline and target?');
  b.table('Figures stated in the sources', ['Figure', 'Value', 'Applies to', 'Source'], m.meta.metrics.filter(x => x.status !== 'unknown').map(x => [x.label, `${x.value ?? (x.range ? `${x.range[0]} to ${x.range[1]}` : '')} ${x.unit}`.trim(), x.appliesTo ?? '', sourceList(x.sources)]), 'No figures are stated.');

  b.section('4', 'Scope', 1);
  b.table('In scope', ['Item', 'Source'], m.meta.scopeIn.map(x => [x.text, sourceList(x.sources)]), 'Nothing is recorded as in scope.');
  b.table('Out of scope', ['Item', 'Source'], m.meta.scopeOut.map(x => [x.text, sourceList(x.sources)]), 'Nothing is recorded as out of scope.');
  const start = m.events.find(e => e.kind === 'start'), ends = m.events.filter(e => e.kind === 'end');
  b.keyValue('Boundaries', [['Starts when', start?.name ?? missing()], ['Ends when', ends.map(e => e.name).join('; ') || missing()]]);

  b.section('5', 'Stakeholders', 1);
  b.table('Stakeholders', ['Role', 'Kind', 'Steps they do', 'In scope'], [
    ...(owner ? [[owner, 'Process owner', '', 'Yes']] : []),
    ...m.roles.map(r => [r.name, r.kind.replace('_', ' '), String(m.steps.filter(s => s.roleIds.includes(r.id)).length), r.inScope ? 'Yes' : 'No']),
  ], 'No roles are recorded.');
  if (!owner) b.open('Who owns the process and signs off this document?', { kind: 'meta', field: 'owner' });

  b.section('6', 'Current-state summary', 1);
  const steps = orderedSteps(m);
  b.paragraph(`Today the process has ${steps.length} steps carried out by ${m.roles.filter(r => r.inScope).length} roles across ${m.systems.length} applications. It handles ${metricCell(m, 'volume').text.toLowerCase() === 'not provided' ? 'a volume that is not yet stated' : metricCell(m, 'volume').text}. The step-by-step detail is in the PDD section "Detailed As-Is steps".`);

  b.section('7', 'Business requirements', 1);
  b.callout('Business requirements with IDs, priorities and acceptance measures are derived together with the functional requirements and will appear here.');

  b.section('8', 'Business rules', 1);
  b.table('Business rules', ['ID', 'Rule', 'Condition', 'Action', 'Source'], m.rules.map((r, i) => [`R-${String(i + 1).padStart(2, '0')}`, { text: r.name, status: r.status }, r.condition, r.action, sourceList(r.sources)]), 'No business rules are recorded.');

  b.section('9', 'Assumptions, constraints and dependencies', 1);
  const assumed = [
    ...m.steps.filter(s => s.status === 'assumed').map(s => `Step "${s.name}"`),
    ...m.steps.filter(s => s.traits?.effortMinutes?.status === 'assumed').map(s => `Time of "${s.name}" (${s.traits!.effortMinutes!.value} min, spread from the time per case)`),
    ...m.rules.filter(r => r.status === 'assumed').map(r => `Rule "${r.name}"`),
  ];
  b.table('Assumptions to confirm', ['Assumption'], assumed.map(x => [x]), 'No working assumptions are recorded.');
  const constraints = [
    ...m.systems.filter(s => known(s.uiAllowed) === false).map(s => [`Robots may not drive the screens of ${s.name}.`, sourceList(s.uiAllowed!.sources) || 'Confirmed by a person']),
    ...m.systems.flatMap(s => s.access.filter(x => x.method === 'api' && x.access === 'confirmed_absent').map(() => [`${s.name} has no API for this work.`, sourceList(s.sources)])),
    ...m.controls.map(c => [c.text, sourceList(c.sources)]),
  ];
  b.table('Constraints', ['Constraint', 'Source'], constraints, 'No constraints are recorded.');
  b.table('Dependencies', ['Dependency', 'Steps affected'], a.apiSwitch.steps ? [[`Confirming the API of ${a.apiSwitch.systems.join(', ')}`, String(a.apiSwitch.steps)]] : [], 'No open dependency changes the recommendation.');

  b.section('10', 'Risks and issues', 1);
  b.table('Risks', ['Risk', 'Source'], m.risks.map(r => [r.text, sourceList(r.sources)]), 'No risks are recorded.');

  b.section('11', 'Benefits', 1);
  const pb = paybackOf(p.value, input.decisions.rate, input.decisions.costs);
  b.keyValue('Benefits', [
    ['Hands-on hours a year automation could take', p.value.computable ? `${p.value.value!.exact ? '' : 'Up to '}${hrs(p.value.value!.hours[1])}` : missing()],
    ['Value a year', pb.computable ? `${pb.value!.exact ? '' : 'Up to '}${pb.value!.currency} ${hrs(pb.value!.value[1])}` : missing('Not provided (no hourly cost entered)')],
    ['Build cost', input.decisions.costs?.build != null ? `${input.decisions.rate?.currency ?? ''} ${hrs(input.decisions.costs.build)}`.trim() : missing('Not estimated')],
    ['Payback', pb.computable && pb.value!.months.best !== null ? (pb.value!.months.worst === null ? `From ${pb.value!.months.best} months` : pb.value!.months.worst === 'never' ? `${pb.value!.months.best} months at best` : `${pb.value!.months.best}${pb.value!.months.worst !== pb.value!.months.best ? ` to ${pb.value!.months.worst}` : ''} months`) : missing()],
  ]);

  b.section('12', 'Open questions', 1);
  for (const q of m.openQuestions.filter(q => q.status === 'open')) b.note(q.question, q.target);
  for (const g of gaps(m)) b.note(g.label, g.target);
  b.table('Open questions', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open questions.');

  return {
    type: 'brd', title: 'Business Requirements Document', subtitle: m.meta.name,
    control: [['Process', m.meta.name], ['Revision', input.revision.label], ['Status', input.revision.state === 'approved' ? 'Approved' : 'Working draft'], ['Date', input.revision.date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: b.openItems,
  };
}
