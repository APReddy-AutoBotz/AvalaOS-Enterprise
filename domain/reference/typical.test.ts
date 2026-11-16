import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { addTypicalStep, confirmTypical, confirmTypicalRest, dropTypical, ModelOpError, removeStep, startFromTypical } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { buildPdd } from '../docs/pdd.ts';
import { toMarkdown } from '../docs/markdown.ts';
import { AP_INVOICE } from './apInvoice.ts';
import * as typicalRules from './typical.ts';
import { provisionalNote, referenceById, REFERENCES, restToConfirm, toConfirm, typicalChecklist, typicalCounts, typicalElements } from './typical.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const started = (apps: Record<string, string> = {}) => startFromTypical(emptyModel('Supplier invoices'), { elements: typicalElements(AP_INVOICE, apps), from: AP_INVOICE.id }).model;

test('a reference never carries volumes, times, costs, API facts, amounts or names of a real company', () => {
  for (const ref of REFERENCES) {
    const text = JSON.stringify(ref);
    // No figures of any kind in what it says (ids and flow labels aside).
    const prose = [...ref.steps.flatMap(s => [s.name, s.description]), ...ref.rules.flatMap(r => [r.name, r.condition, r.action]),
      ...ref.exceptions.flatMap(x => [x.name, x.trigger, x.handling]), ...ref.gateways.map(g => g.question), ...ref.events.map(e => e.name), ...ref.roles.map(r => r.name), ...ref.systems.map(s => s.name)];
    for (const p of prose) assert.doesNotMatch(p, /\d|%|₹|\$|€|£/, `a figure in: ${p}`);
    // No field where such facts could live.
    assert.doesNotMatch(text, /"(traits|metrics|access|effortMinutes|sharePercent|volume|cost|uiAllowed|remote)"/);
    // No brand, transaction code or person from the sample it was written from.
    assert.doesNotMatch(text, /SAP|MIRO|FB60|MIGO|ME22N|FBL1N|GSTIN|INR|Kaveri|Pune|ServiceNow|SharePoint|Excel|Workday|Meera|Microsoft/);
    // Every application is a placeholder to map.
    for (const s of ref.systems) assert.match(s.name, /^Your /);
  }
});

test('Avala OS never says which reference fits: nothing matches a process by its name; a person picks from the list', () => {
  // A guess from the name offered the supplier invoice process to "Customer invoices" (16 November 2026).
  assert.equal('matchReference' in typicalRules, false);
  for (const ref of REFERENCES) {
    assert.equal('keywords' in ref, false, 'a reference carries no words to match a name with');
    assert.equal(referenceById(ref.id), ref);
    assert.ok(ref.name.trim() && ref.noun.trim());
    assert.match(`a typical ${ref.noun}`, /process$/, 'reads as a sentence: "a typical ... process"');
  }
  assert.equal(referenceById(undefined), null);
  assert.equal(referenceById('customer-invoices'), null);
});

test('starting from the reference: every element typical, the applications mapped to the person\'s own, valid', () => {
  const m = started({ 'sys-sap': 'SAP S/4HANA', 'sys-mailbox': ' ' });
  assert.equal(validateModel(m).valid, true);
  assert.equal(m.steps.length, AP_INVOICE.steps.length);
  assert.ok(m.steps.every(s => s.status === 'typical' && !s.traits));
  assert.ok(m.rules.every(r => r.status === 'typical') && m.exceptions.every(x => x.status === 'typical'));
  const erp = m.systems.find(s => s.id === 'sys-sap')!;
  assert.deepEqual([erp.name, erp.status, erp.access], ['SAP S/4HANA', 'user-confirmed', []], 'named by the person, so theirs; no access assumed');
  assert.deepEqual([m.systems.find(s => s.id === 'sys-mailbox')!.name, m.systems.find(s => s.id === 'sys-mailbox')!.status], ['Your AP mailbox', 'typical']);
  assert.deepEqual(m.meta.metrics, [], 'no figures');
  assert.equal(m.meta.objective.status, 'unknown');
  const c = typicalCounts(m);
  assert.equal(c.step, AP_INVOICE.steps.length);
  assert.ok(c.total > c.step);
  // Only a start: never over a process that has steps.
  assert.throws(() => startFromTypical(gold(), { elements: typicalElements(AP_INVOICE) }), ModelOpError);
});

test('the confirm pass: we do this, ours is different, we don\'t; each leaves "typical"', () => {
  let m = started();
  const order = toConfirm(m);
  assert.deepEqual(order.slice(0, 2).map(x => x.kind), ['step', 'step']);
  assert.ok(order.findIndex(x => x.kind === 'rule') > order.map(x => x.kind).lastIndexOf('step'));
  m = confirmTypical(m, { kind: 'step', id: 's-log' }).model;
  assert.equal(m.steps.find(s => s.id === 's-log')!.status, 'user-confirmed');
  m = confirmTypical(m, { kind: 'step', id: 's-check', name: 'Check the invoice fields', detail: 'We check the PO number and the tax only.' }).model;
  const changed = m.steps.find(s => s.id === 's-check')!;
  assert.deepEqual([changed.name, changed.description, changed.status], ['Check the invoice fields', 'We check the PO number and the tax only.', 'user-confirmed']);
  const before = m.steps.length;
  m = dropTypical(m, { kind: 'step', id: 's-scan' }).model;
  assert.equal(m.steps.length, before - 1);
  assert.ok(!m.flows.some(f => f.from === 's-scan' || f.to === 's-scan'), 'its neighbours are joined');
  m = dropTypical(m, { kind: 'rule', id: 'br-qty' }).model;
  assert.ok(!m.rules.some(r => r.id === 'br-qty'));
  assert.equal(validateModel(m).valid, true);
  // A confirmed item is a person's own: not dropped or confirmed this way again.
  assert.throws(() => dropTypical(m, { kind: 'step', id: 's-log' }), ModelOpError);
  assert.throws(() => confirmTypical(m, { kind: 'step', id: 's-log' }), ModelOpError);
});

test('the promise holds downstream: documents say "typical, not confirmed"; the assessment is provisional', () => {
  const m = started({ 'sys-sap': 'SAP S/4HANA' });
  const a = assessProcess(m);
  assert.ok(a.assessed > 0);
  assert.match(provisionalNote(m)!, /^Provisional: 21 of 21 steps come from a typical process/);
  const pdd = buildPdd({ model: m, assessment: a, decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'working', date: 'd' } });
  const md = toMarkdown(pdd);
  assert.match(md, /Log invoice \*\(typical, not confirmed\)\*/);
  let all = m;
  for (const s of m.steps) all = confirmTypical(all, { kind: 'step', id: s.id }).model;
  assert.equal(provisionalNote(all), null);
});

test('with documents, the reference is a checklist of what the sources do not mention, added only by a person', () => {
  const g = gold();
  assert.deepEqual(typicalChecklist(g, AP_INVOICE), [], 'the sample has every typical step');
  const without = removeStep(g, { stepId: 's-match' }).model;
  const list = typicalChecklist(without, AP_INVOICE);
  assert.deepEqual(list.map(x => x.name), ['Three-way match']);
  assert.match(list[0].why, /^A typical supplier invoice process has "Three-way match"; your sources do not mention it\.$/);
  const ref = AP_INVOICE.steps.find(s => s.id === 's-match')!;
  const added = addTypicalStep(without, { step: ref }).model;
  assert.equal(added.steps.find(s => s.name === 'Three-way match')!.status, 'typical');
  assert.deepEqual(typicalChecklist(added, AP_INVOICE), []);
  assert.deepEqual(typicalChecklist(emptyModel('x'), AP_INVOICE), [], 'nothing from the sources yet: no checklist');
});

test('the checklist never offers back a step taken out of a process started from the typical one', () => {
  let m = started();
  m = dropTypical(m, { kind: 'step', id: 's-scan' }).model;
  m = confirmTypical(m, { kind: 'step', id: 's-log' }).model;
  assert.equal(m.meta.startedFrom, 'ap-invoice');
  assert.deepEqual(typicalChecklist(m, AP_INVOICE), []);
});

test('the last card: roles and applications named and confirmed with the decision points, once the steps are done', () => {
  let m = started({ 'sys-sap': 'SAP S/4HANA' });
  assert.throws(() => confirmTypicalRest(m), ModelOpError);
  for (const x of toConfirm(m)) m = confirmTypical(m, { kind: x.kind, id: x.id }).model;
  const rest = restToConfirm(m);
  assert.ok(rest.roles.length > 0 && rest.gateways > 0 && rest.events > 0);
  assert.ok(!rest.systems.some(s => s.id === 'sys-sap'), 'a mapped application is already the person\'s');
  assert.throws(() => confirmTypicalRest(m), /name of your application/);
  const names = Object.fromEntries(rest.systems.map(s => [s.id, `${s.name.replace(/^Your /, 'Our ')}`]));
  m = confirmTypicalRest(m, { names }).model;
  assert.equal(typicalCounts(m).total, 0);
  assert.equal(provisionalNote(m), null);
  assert.equal(validateModel(m).valid, true);
});

test('taking a typical step out takes with it what only it needed: its application and a decision that decides nothing', () => {
  let m = started();
  assert.ok(m.systems.some(s => s.id === 'sys-scanner') && m.gateways.some(g => g.id === 'g-paper'));
  m = dropTypical(m, { kind: 'step', id: 's-scan' }).model;
  assert.ok(!m.systems.some(s => s.id === 'sys-scanner'), 'no step uses the scanner any more, so nobody is asked to name it');
  assert.ok(!m.gateways.some(g => g.id === 'g-paper'), '"Paper invoice?" led to the same step both ways');
  assert.ok(m.flows.some(f => f.from === 'e-start' && f.to === 's-log'), 'the start now leads straight to the next step');
  assert.ok(!m.flows.some(f => f.from === 'g-paper' || f.to === 'g-paper'));
  assert.equal(validateModel(m).valid, true);
  // An application other steps still use stays, and so does a decision that still has two ways out.
  m = dropTypical(m, { kind: 'step', id: 's-return' }).model;
  assert.ok(m.systems.some(s => s.id === 'sys-mailbox'));
  assert.ok(m.gateways.some(g => g.id === 'g-complete'));
  // An application the person named is theirs: it is never taken out this way.
  let named = started({ 'sys-scanner': 'Kodak i3000' });
  named = dropTypical(named, { kind: 'step', id: 's-scan' }).model;
  assert.ok(named.systems.some(s => s.id === 'sys-scanner'));
});

test('the last card has no dead end: an application the company does not have is taken out, not named', () => {
  let m = started({ 'sys-sap': 'Oracle Fusion' });
  for (const x of toConfirm(m)) m = confirmTypical(m, { kind: x.kind, id: x.id }).model;
  // "We don't use it": off every step that named it, and gone from the card.
  assert.ok(m.steps.some(s => s.systemIds.includes('sys-tracker')));
  m = dropTypical(m, { kind: 'system', id: 'sys-tracker' }).model;
  assert.ok(!m.systems.some(s => s.id === 'sys-tracker') && !m.steps.some(s => s.systemIds.includes('sys-tracker')));
  assert.ok(!restToConfirm(m).systems.some(s => s.id === 'sys-tracker'));
  assert.throws(() => dropTypical(m, { kind: 'system', id: 'sys-sap' }), ModelOpError, 'a named application is the person\'s own');
  // A step deleted in the step table leaves its application unused: it is not asked about, and confirming takes it out.
  m = removeStep(m, { stepId: 's-scan' }).model;
  assert.ok(m.systems.some(s => s.id === 'sys-scanner'));
  assert.ok(!restToConfirm(m).systems.some(s => s.id === 'sys-scanner'));
  const names = Object.fromEntries(restToConfirm(m).systems.map(s => [s.id, s.name.replace(/^Your /, 'Our ')]));
  m = confirmTypicalRest(m, { names }).model;
  assert.ok(!m.systems.some(s => s.id === 'sys-scanner'));
  assert.equal(typicalCounts(m).total, 0);
  assert.equal(validateModel(m).valid, true);
});

test('documents say at the top when typical items remain, and stop saying it once all are confirmed', () => {
  const m = started({ 'sys-sap': 'SAP S/4HANA' });
  const input = (model: ProcessModel) => ({ model, assessment: assessProcess(model), decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'approved' as const, date: 'd' } });
  const top = buildPdd(input(m)).control.find(c => c.key === 'Typical content');
  assert.match(top!.value, /^\d+ items come from a typical process and are not confirmed by the company's people\./);
  assert.match(toMarkdown(buildPdd(input(m))), /Typical content: \d+ items come from a typical process/);
  assert.equal(buildPdd(input(gold())).control.some(c => c.key === 'Typical content'), false);
});
