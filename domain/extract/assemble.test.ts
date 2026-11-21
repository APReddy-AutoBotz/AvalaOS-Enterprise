// A way in that exists but is not switched on (owner, 21 November 2026): assembly records it as "reported",
// lists the correction in its report, and the existing interface question is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assembleModel, asksAvailabilityOf, notSwitchedOn, type MergeFactsOutput, type MergeFlowOutput } from './assemble.ts';
import type { Candidate, CandidateSet } from './candidates.ts';
import type { AccessMethod, AccessStatus } from '../processModel/types.ts';

interface StoredAccess { method: AccessMethod['method']; name: string; operations: string[]; access: AccessStatus; sources: { sourceId: string; excerpt: string }[] }
interface StoredRun { run: string; kind: string; ruleQuestions: number; unchanged?: boolean; access: StoredAccess[]; mergeQuestions: { question: string; whyItMatters: string }[] }
const STORED: StoredRun[] = JSON.parse(fs.readFileSync(new URL('./fixtures/stored-access.json', import.meta.url), 'utf8')).runs;

const SAP = 'SAP S/4HANA';
const ref = (sourceId: string, excerpt: string) => ({ sourceId, locator: {}, excerpt });

/**
 * Runs the real assembly on one application's ways in as a stored run recorded them: one candidate per
 * quoted passage with the run's status, the merge's interfaces over them, and the merge's questions.
 */
function assemble(access: StoredAccess[], mergeQuestions: StoredRun['mergeQuestions'] = [], system = SAP) {
  const items: Candidate[] = [
    { id: 'R1', kind: 'role', sourceId: 'call-3', order: 0, ref: ref('call-3', 'AP Clerk'), data: { name: 'AP Clerk', kind: 'person_role' } },
    { id: 'Y1', kind: 'system', sourceId: 'call-3', order: 0, ref: ref('call-3', system), data: { name: system, kind: 'erp' } },
    { id: 'S1', kind: 'step', sourceId: 'call-3', order: 0, ref: ref('call-3', 'Post the invoice'), data: { name: 'Post invoice' } },
  ];
  let n = 0;
  const interfaces: MergeFactsOutput['interfaces'] = access.map(a => {
    const members = a.sources.map(s => {
      const id = `I${++n}`;
      items.push({ id, kind: 'interface', sourceId: s.sourceId, order: n, ref: ref(s.sourceId, s.excerpt), data: { system, method: a.method, name: a.name, operations: a.operations, access: a.access } });
      return id;
    });
    return { system, method: a.method, name: a.name, operations: a.operations, access: a.access, members };
  });
  const sourceIds = [...new Set(items.map(c => c.sourceId))];
  const set: CandidateSet = { sources: sourceIds.map(sourceId => ({ sourceId, title: sourceId, kind: 'transcript' })), items };
  const flow: MergeFlowOutput = {
    roles: [{ key: 'r', name: 'AP Clerk', kind: 'person_role', members: ['R1'] }],
    systems: [{ key: 'y', name: system, kind: 'erp', members: ['Y1'] }],
    steps: [{ key: 's', name: 'Post invoice', description: '', taskType: 'user', roles: ['r'], systems: ['y'], members: ['S1'] }],
    gateways: [], events: [{ key: 'a', kind: 'start', name: 'Start', members: [] }, { key: 'b', kind: 'end', name: 'End', members: [] }],
    flows: [{ from: 'a', to: 's', label: '' }, { from: 's', to: 'b', label: '' }],
  };
  const facts: MergeFactsOutput = { rules: [], exceptions: [], interfaces, metrics: [], conflicts: [], questions: mergeQuestions.map(q => ({ ...q, members: [] })) };
  return assembleModel('Sample', set, flow, facts);
}

/** What the extraction check counts as its expected question (eval/corpus/ap-invoice: q-invoice-api). */
const checkFinds = (questions: { question: string; whyItMatters?: string }[]) =>
  questions.some(q => { const t = `${q.question} ${q.whyItMatters ?? ''}`.toLowerCase(); return t.includes('supplier invoice') && t.includes('api'); });
const invoiceQuestions = (questions: { question: string; target: { kind: string; field?: string } }[]) =>
  questions.filter(q => q.target.kind === 'system' && q.target.field === 'access' && /API_SUPPLIERINVOICE_PROCESS_SRV|supplier invoice API/i.test(q.question));

for (const r of STORED.filter(x => x.access.some(a => a.name === 'API_SUPPLIERINVOICE_PROCESS_SRV' && a.access === 'confirmed_absent'))) {
  test(`stored run ${r.run}: the supplier invoice API recorded as not available is corrected to reported and its question asked`, () => {
    const { model, report } = assemble(r.access, r.mergeQuestions);
    const api = model.systems[0].access.find(a => a.name === 'API_SUPPLIERINVOICE_PROCESS_SRV')!;
    assert.equal(api.access, 'reported');
    const c = report.corrected.find(x => x.interface === 'API_SUPPLIERINVOICE_PROCESS_SRV')!;
    assert.deepEqual([c.system, c.before, c.after], [SAP, 'confirmed_absent', 'reported']);
    assert.match(c.passage, /not activated|Available in the product/);
    assert.equal(invoiceQuestions(model.openQuestions).length, 1);
    assert.match(invoiceQuestions(model.openQuestions)[0].question, /^Is API_SUPPLIERINVOICE_PROCESS_SRV \(.*\) available for use from SAP S\/4HANA, and when\?$/);
    assert.ok(checkFinds(model.openQuestions), 'the check finds its expected question');
  });
}

test('each stored run asks what the fixture records about the supplier invoice API, and only the ones listed are corrected', () => {
  const corrected: string[] = [];
  for (const r of STORED) {
    const { model, report } = assemble(r.access, r.mergeQuestions);
    if (report.corrected.length) corrected.push(`${r.run}: ${report.corrected.map(c => c.interface).join(', ')}`);
    assert.equal(r.unchanged ? report.corrected.length : report.corrected.length > 0, r.unchanged ? 0 : true, r.run);
    assert.equal(invoiceQuestions(model.openQuestions).length, r.ruleQuestions, r.run);
    assert.ok(checkFinds(model.openQuestions), `${r.run}: the check finds its expected question`);
  }
  assert.deepEqual(corrected, [
    'cf28ca3e: API_SUPPLIERINVOICE_PROCESS_SRV',
    '615b0479: API_SUPPLIERINVOICE_PROCESS_SRV',
    'a356c63e: API management exposure for supplier invoice API',
    'd3ea1d06: API_SUPPLIERINVOICE_PROCESS_SRV',
    'ba4c3b6a: API_SUPPLIERINVOICE_PROCESS_SRV exposure through API management',
    '9d6899d3: API_SUPPLIERINVOICE_PROCESS_SRV',
    'd714b013: API_SUPPLIERINVOICE_PROCESS_SRV',
    'f35d6983: API_SUPPLIERINVOICE_PROCESS_SRV',
  ]);
});

test('a corrected interface is not asked twice', () => {
  // ba4c3b6a: the reported entry asks first; the corrected entry of the same identifier then finds that question.
  const ba = STORED.find(r => r.run === 'ba4c3b6a')!;
  const { model } = assemble(ba.access);
  assert.equal(invoiceQuestions(model.openQuestions).length, 1);
  // A merge question that names it and asks whether it can be used stops it.
  const nine = STORED.find(r => r.run === '9d6899d3')!;
  const asked = assemble(nine.access, [{ question: 'When will API_SUPPLIERINVOICE_PROCESS_SRV be activated in the Gateway?', whyItMatters: 'Posting depends on it.' }]);
  assert.ok(!asked.model.openQuestions.some(q => q.target.kind === 'system'));
  assert.ok(asked.model.openQuestions.some(q => /activated in the Gateway/.test(q.question)));
  // One that names it without asking about availability does not (f35d6983, cf28ca3e).
  for (const id of ['f35d6983', 'cf28ca3e']) {
    const r = STORED.find(x => x.run === id)!;
    assert.equal(invoiceQuestions(assemble(r.access, r.mergeQuestions).model.openQuestions).length, 1, id);
  }
  // "when" alone does not make a question about availability (review, 21 November 2026).
  const err = assemble(nine.access, [{ question: 'What should happen when API_SUPPLIERINVOICE_PROCESS_SRV returns an error?', whyItMatters: 'Exception handling.' }]);
  assert.equal(invoiceQuestions(err.model.openQuestions).length, 1);
  assert.match(invoiceQuestions(err.model.openQuestions)[0].question, /available for use from SAP S\/4HANA, and when\?$/);
  // Two corrected entries of one interface give one question.
  const twice = assemble([
    { method: 'api', name: 'API_X_SRV', operations: ['post invoices'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'API_X_SRV is in the product but we have not activated it.' }] },
    { method: 'api', name: 'API_X_SRV through the gateway', operations: ['expose it'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'It is not exposed through the gateway yet.' }] },
  ]);
  assert.equal(twice.report.corrected.length, 2);
  assert.equal(twice.model.openQuestions.filter(q => q.target.kind === 'system').length, 1);
});

test('only the existing skip applies to an interface that was not corrected', () => {
  // b9b97ce8: the reported entry is named by a merge question that asks whether it can be used: no rule question, as before.
  const b9 = STORED.find(r => r.run === 'b9b97ce8')!;
  const { model, report } = assemble(b9.access, b9.mergeQuestions);
  assert.equal(report.corrected.length, 0);
  assert.equal(invoiceQuestions(model.openQuestions).length, 0);
  // An unknown interface named by a question that does not ask about availability is still skipped (name alone).
  const named = assemble([{ method: 'api', name: 'API_Y_SRV', operations: ['read orders'], access: 'unknown', sources: [{ sourceId: 'call-3', excerpt: 'There is API_Y_SRV, I think.' }] }],
    [{ question: 'Which team owns API_Y_SRV?', whyItMatters: 'x' }]);
  assert.equal(named.model.openQuestions.filter(q => /API_Y_SRV/.test(q.question)).length, 1);
});

test('never corrected: screens, policies, interfaces that do not exist, and a gate', () => {
  const cases: [string, StoredAccess][] = [
    ['screens, a policy (sample)', { method: 'ui', name: 'SAP GUI scripting', operations: ['UI automation'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'SAP GUI scripting is disabled on production by policy.' }] }],
    ['screens, even when not activated', { method: 'ui', name: 'New screens', operations: ['enter invoices'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'The new entry screen is not activated yet.' }] }],
    ['a tool that did not stick (sample)', { method: 'ui', name: 'OCR pilot', operations: ['extract invoice data'], access: 'confirmed_absent', sources: [{ sourceId: 'call-1', excerpt: "We had a pilot with an OCR tool in 2024, maybe eight months. It didn't stick." }] }],
    ['an interface that does not exist (made up)', { method: 'api', name: 'Direct interface to the time system', operations: ['send hours'], access: 'confirmed_absent', sources: [{ sourceId: 'call-2', excerpt: 'No, not as an implemented interface; we send a reviewed file instead.' }] }],
    ['no such check (made up)', { method: 'api', name: 'Daily total check', operations: ['check totals'], access: 'confirmed_absent', sources: [{ sourceId: 'call-2', excerpt: 'There is no daily total check in that configuration.' }] }],
    ['a gate, not a switch (sample)', { method: 'api', name: 'API management layer exposure', operations: ['expose APIs to other systems'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'nothing is exposed to other systems without going through our API management layer.' }] }],
    ['only "not available in this system" (review)', { method: 'api', name: 'API_V_SRV', operations: ['post'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'API access is not available in this system.' }] }],
    ['switched off and a policy', { method: 'api', name: 'API_Z_SRV', operations: ['post'], access: 'confirmed_absent', sources: [{ sourceId: 'call-3', excerpt: 'API_Z_SRV is not activated, and calls from outside are not allowed.' }] }],
  ];
  for (const [label, a] of cases) {
    const { model, report } = assemble([a]);
    assert.equal(report.corrected.length, 0, label);
    assert.equal(model.systems[0].access[0].access, 'confirmed_absent', label);
  }
});

test('the words: which passages say an interface exists but is not switched on', () => {
  const way = (excerpt: string, method: AccessMethod['method'] = 'api'): AccessMethod => ({ method, operations: [], access: 'confirmed_absent', status: 'stated', sources: [ref('s', excerpt)] });
  for (const yes of ['But we have not activated it in our Gateway.', 'Available in the product, not available in our landscape.', 'It is not yet enabled.', 'The file drop is switched off.', 'The event feed exists in the standard product.', 'The interface is inactive.'])
    assert.ok(notSwitchedOn(way(yes)), yes);
  for (const no of ['There is no API for that.', 'It does not exist.', 'Disabled on production by policy.', 'nothing is exposed to other systems without going through our API management layer.'])
    assert.equal(notSwitchedOn(way(no)), null, no);
  // "Not available in this system" alone can mean it does not exist (review, 21 November 2026).
  assert.equal(notSwitchedOn(way('API access is not available in this system.')), null);
  assert.equal(notSwitchedOn(way('Not available in our landscape.')), null);
  assert.equal(notSwitchedOn(way('not activated', 'email')), null);
  assert.equal(notSwitchedOn({ ...way('not activated'), access: 'unknown' }), null);
  assert.equal(notSwitchedOn({ ...way('not activated'), sources: [] }), null, 'a person\'s answer with no passage');
});

test('asking about availability: the identifier when the name holds one, else the whole name', () => {
  const a = (name: string): AccessMethod => ({ method: 'api', name, operations: [], access: 'reported', status: 'stated', sources: [] });
  assert.ok(asksAvailabilityOf('Is API_SUPPLIERINVOICE_PROCESS_SRV (post) available for use from SAP, and when?', a('API_SUPPLIERINVOICE_PROCESS_SRV exposure through API management')));
  assert.ok(!asksAvailabilityOf('Which interface should be used if API_SUPPLIERINVOICE_PROCESS_SRV is absent?', a('API_SUPPLIERINVOICE_PROCESS_SRV')));
  assert.ok(asksAvailabilityOf('When will the attachment API be active?', a('attachment API')));
  assert.ok(!asksAvailabilityOf('When will it be active?', a('attachment API')));
});
