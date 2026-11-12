// The Functional Requirements Document: what the solution must do, testably (plan section 4.4).
// Every requirement comes from the register (derived by rule from the model, or edited by a person);
// interfaces, data and controls come from the model. Missing facts are open items, never filler.
import { gaps as modelGaps, orderedSteps } from '../processModel/selectors.ts';
import { NFR_TOPICS } from '../requirements/derive.ts';
import { criterionText, PRIORITY_LABEL, type Requirement } from '../requirements/register.ts';
import { DocBuilder, missing, type DocTree } from './tree.ts';
import { ACCESS_TEXT, sourceList, type DocInput } from './common.ts';

export function buildFrd(input: DocInput): DocTree {
  const m = input.model;
  const reqs = (input.requirements ?? []).filter(r => r.state !== 'retired');
  const active = reqs.filter(r => r.state === 'active');
  const removed = reqs.filter(r => r.state === 'source_removed');
  const steps = orderedSteps(m);
  const no = (id: string) => steps.findIndex(s => s.id === id) + 1;
  const stepList = (ids: string[]) => ids.filter(id => no(id) > 0).map(id => `${no(id)} ${m.steps.find(s => s.id === id)!.name}`).join('; ');
  const fr = active.filter(r => r.kind === 'FR');
  const br = active.filter(r => r.kind === 'BR');
  const nfr = active.filter(r => r.kind === 'NFR');
  const codeOf = (key: string) => active.find(r => r.key === key)?.code;
  const b = new DocBuilder();

  b.section('1', 'Introduction', 1);
  b.paragraph(`This document states what the solution for ${m.meta.name} must do, as requirements that can each be tested. Why the change is made is in the BRD; how the work is done today is in the PDD section "Detailed As-Is steps".`);
  b.keyValue('Requirements', [['Business requirements', String(br.length)], ['Functional requirements', String(fr.length)], ['Non-functional requirements', String(nfr.length)], ['Edited by a person', String(active.filter(r => r.edited).length)]]);

  b.section('2', 'Actors and permissions', 1);
  b.table('People and teams', ['Actor', 'Kind', 'Steps', 'Decides or approves'], m.roles.filter(r => r.inScope).map(r => [
    r.name, r.kind.replace('_', ' '), stepList(steps.filter(s => s.roleIds.includes(r.id)).map(s => s.id)),
    fr.filter(x => x.category === 'human' && x.stepIds.some(id => m.steps.find(s => s.id === id)?.roleIds.includes(r.id))).map(x => x.code).join(', '),
  ]), 'No roles are recorded.');
  b.table('Applications', ['Application', 'Steps', 'Access'], m.systems.filter(s => s.inScope).map(s => [s.name, stepList(steps.filter(x => x.systemIds.includes(s.id)).map(x => x.id)), s.access.length ? s.access.map(a => `${a.method.toUpperCase()}${a.name ? ` ${a.name}` : ''}: ${ACCESS_TEXT[a.access]}`).join('; ') : missing()]), 'No applications are recorded.');
  b.open('Which accounts and permissions will the solution use in each application?', { kind: 'meta', field: 'access' });

  b.section('3', 'Functional requirements', 1);
  if (!fr.length) b.callout('No step is recommended for automation yet, so there are no functional requirements. They appear when the assessment recommends automating a step.');
  for (const r of fr) {
    b.section(`3.${fr.indexOf(r) + 1}`, `${r.code} ${r.title}`);
    b.paragraph(r.statement);
    const exceptions = r.category === 'step' ? r.exceptionIds.map(id => codeOf(`exception:${id}`)).filter(Boolean).join(', ') : '';
    b.keyValue('Details', [
      ['Main flow', stepList(r.stepIds) || missing()],
      ['Rules applied', r.ruleIds.map(id => m.rules.find(x => x.id === id)?.name).filter(Boolean).join('; ') || 'None recorded'],
      ...(r.category === 'step' ? [['Exception flows', exceptions || 'None recorded'] as [string, string]] : []),
      ['Priority', r.priority ? PRIORITY_LABEL[r.priority] : missing()],
      ['Serves', r.traces.join(', ') || missing()],
      ['Why', r.rationale],
      ['Wording', r.edited ? 'Edited by a person' : 'Derived from the process model'],
    ]);
    b.table(`Acceptance criteria for ${r.code}`, ['#', 'Given', 'When', 'Then'], r.acceptance.map((a, i) => [String(i + 1), a.given, a.when, a.then]), 'No acceptance criteria can be written from the model yet.');
    for (const g of r.gaps) b.open(g, r.stepIds[0] ? { kind: 'step', id: r.stepIds[0] } : undefined);
    if (!r.priority) b.note(`What is the priority of ${r.code} (${r.title})?`);
  }
  if (removed.length) {
    b.section(`3.${fr.length + 1}`, 'Requirements whose source was removed');
    b.table('Source removed', ['ID', 'Requirement', 'Edited'], removed.map(r => [r.code, r.statement, r.edited ? 'Yes' : 'No']), '');
    b.callout('These requirements came from steps, rules or exceptions no longer in the process. Retire them, or keep them if they still apply.', 'warning');
  }

  b.section('4', 'Data requirements', 1);
  b.table('Data', ['Data', 'Format', 'Structured', 'Classification', 'Source'], m.dataObjects.map(d => [d.name, d.format || missing(), d.structured === null ? missing() : d.structured ? 'Yes' : 'No', d.classification ?? missing(), sourceList(d.sources)]), 'No data objects are recorded.');
  const io = steps.filter(s => s.inputs.length || s.outputs.length);
  b.table('Inputs and outputs by step', ['#', 'Step', 'Inputs', 'Outputs'], io.map(s => [String(no(s.id)), s.name, s.inputs.join(', ') || missing(), s.outputs.join(', ') || missing()]), 'No step inputs or outputs are recorded.');
  if (m.dataObjects.length) b.open('Which fields of each data object does the solution read and write, with their validation?', { kind: 'data' });

  b.section('5', 'Interface requirements', 1);
  const ifaces = m.systems.flatMap(s => s.access.map(a => ({ s, a })));
  b.table('Interfaces', ['Application', 'Method', 'Interface', 'Operations', 'Status', 'Source'], ifaces.map(({ s, a }) => [s.name, a.method.toUpperCase(), a.name ?? '', a.operations.join(', ') || missing(), { text: ACCESS_TEXT[a.access], status: a.status }, sourceList(a.sources)]), 'No interfaces are recorded.');
  if (ifaces.some(x => x.a.access === 'unknown' || x.a.access === 'reported')) b.callout('Interfaces that are unknown or only reported are not assumed to work; their status is an open item until someone accountable confirms it.', 'warning');
  b.open('How should the solution behave when an application does not respond or returns an error?');

  b.section('6', 'Human-in-the-loop requirements', 1);
  const hitl = fr.filter(r => r.category === 'human');
  b.table('Human decisions and checks', ['ID', 'Decision point', 'Who', 'Allowed outcome'], hitl.map(r => [r.code, stepList(r.stepIds), r.stepIds.flatMap(id => m.steps.find(s => s.id === id)?.roleIds ?? []).map(id => m.roles.find(x => x.id === id)?.name).filter(Boolean).join(', ') || missing(), r.acceptance[0]?.when ?? missing()]), 'No step needs a person in the loop on what is known.');

  b.section('7', 'Logging, audit and reporting requirements', 1);
  b.table('Controls', ['ID', 'Control', 'Steps', 'Source'], m.controls.map(c => [codeOf(`control:${c.id}`) ?? '', c.text, stepList(c.stepIds), sourceList(c.sources)]), 'No controls or reporting needs are recorded.');

  b.section('8', 'Non-functional requirements', 1);
  b.table('Non-functional requirements', ['ID', 'Category', 'Requirement', 'Source'], nfr.map(r => [r.code, r.title, r.statement, r.stepIds.length ? stepList(r.stepIds) : '']), 'No non-functional requirements are stated in the sources.');
  const stated = [...nfr.map(r => r.statement), ...m.meta.metrics.map(x => `${x.label} ${x.kind}`)].join(' ');
  for (const t of NFR_TOPICS) if (!t.cue.test(stated)) b.open(`${t.topic}: ${t.question}`);

  b.section('9', 'Traceability matrix', 1);
  b.table('Traceability', ['Business requirement', 'Functional requirements', 'Steps'], br.map(x => {
    const served = fr.filter(f => f.traces.includes(x.code));
    return [`${x.code} ${x.title}`, served.map(f => f.code).join(', ') || missing('None yet'), stepList([...new Set(served.flatMap(f => f.stepIds))])];
  }), 'No business requirements are recorded; the objective and business rules are where they come from.');

  b.section('10', 'Open questions', 1);
  for (const g of modelGaps(m).filter(g => g.target.kind === 'step' || g.target.kind === 'exception' || g.target.kind === 'rule')) b.note(g.label, g.target);
  b.table('Open questions', ['#', 'Question', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open questions.');

  return {
    type: 'frd', title: 'Functional Requirements Document', subtitle: m.meta.name,
    control: [['Process', m.meta.name], ['Revision', input.revision.label], ['Status', input.revision.state === 'approved' ? 'Approved' : 'Working draft'], ['Date', input.revision.date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: b.openItems,
  };
}

/** The BRD's business requirements section, from the register. */
export function businessRequirementRows(reqs: Requirement[] | undefined) {
  return (reqs ?? []).filter(r => r.kind === 'BR' && r.state === 'active').map(r => [r.code, r.statement, r.priority ? PRIORITY_LABEL[r.priority] : missing(), r.acceptance.map(criterionText).join(' ') || missing()]);
}
