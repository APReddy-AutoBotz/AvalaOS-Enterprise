import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProcessModel, type RunTask } from './pipeline.ts';
import { cautiousAccess } from './assemble.ts';
import { buildCandidates, factsListing, flowListing } from './candidates.ts';
import { validateModel } from '../processModel/validate.ts';
import type { IngestSegment } from '../ingest/segment.ts';

const seg = (id: string, sourceId: string, text: string, locator: Record<string, string | number>): IngestSegment => ({ id, sourceId, kind: 'paragraph', text, locator });

const SOP = [
  seg('sop:1', 'sop', '6.2 Log the invoice in the AP tracker.', { section: '6.2' }),
  seg('sop:2', 'sop', '6.5 Check for duplicates in SAP. The AP Clerk searches FBL1N.', { section: '6.5' }),
  seg('sop:3', 'sop', '5.1 Price tolerance: 2% or INR 5,000, whichever is lower.', { section: '5.1' }),
  seg('sop:4', 'sop', 'Volume reference: approximately 8,500 invoices per month.', { section: '8' }),
];
const CALL = [
  seg('c1:1', 'call-1', 'Sunita: First I log it in the tracker, then I check SAP for duplicates.', { timestamp: '00:02:15', speaker: 'Sunita Rao' }),
  seg('c1:2', 'call-1', 'Vikram: The supplier invoice API exists in S/4 but is not activated. PO read API is live.', { timestamp: '00:00:51', speaker: 'Vikram Shah' }),
  seg('c1:3', 'call-1', 'Meera: around nine to ten thousand invoices a month. SAP is set to five percent tolerance.', { timestamp: '00:01:08', speaker: 'Meera Iyer' }),
];

const empty = { roles: [], systems: [], interfaces: [], rules: [], exceptions: [], metrics: [], unknowns: [] };
const fake: RunTask = async (task, input) => {
  const usage = { input: 10, output: 5 };
  const sourceId = 'segments' in input ? input.segments[0].sourceId : '';
  switch (task.id) {
    case 'source_facts':
      return { usage, data: sourceId === 'sop' ? {
        ...empty,
        roles: [{ name: 'AP Clerk', kind: 'person_role', segmentId: 'sop:2', excerpt: 'The AP Clerk searches FBL1N.' }],
        systems: [{ name: 'SAP S/4HANA', kind: 'erp', segmentId: 'sop:2', excerpt: 'Check for duplicates in SAP.' }, { name: 'AP tracker', kind: 'spreadsheet', segmentId: 'sop:1', excerpt: 'Log the invoice in the AP tracker.' }],
        rules: [{ name: 'Price tolerance', condition: '2% or INR 5,000, whichever is lower', action: 'post', segmentId: 'sop:3', excerpt: 'Price tolerance: 2% or INR 5,000, whichever is lower.' }],
        metrics: [{ kind: 'volume', label: 'Invoices per month', value: 8500, low: null, high: null, unit: 'invoices/month', period: 'FY average', appliesTo: '', segmentId: 'sop:4', excerpt: 'approximately 8,500 invoices per month' }],
        // An invented quote: must be dropped before it becomes a candidate.
        exceptions: [{ name: 'Fraud', kind: 'business', trigger: 'x', handling: 'y', routedTo: '', segmentId: 'sop:1', excerpt: 'Fraud is handled by the CFO.' }],
      } : {
        ...empty,
        systems: [{ name: 'SAP', kind: 'erp', segmentId: 'c1:1', excerpt: 'I check SAP for duplicates' }],
        interfaces: [
          { system: 'S/4', method: 'api', name: 'Supplier invoice API', operations: ['create invoices'], access: 'confirmed', segmentId: 'c1:2', excerpt: 'The supplier invoice API exists in S/4 but is not activated.' },
          { system: 'S/4', method: 'api', name: 'Supplier invoice API', operations: ['create invoices'], access: 'reported', segmentId: 'c1:2', excerpt: 'The supplier invoice API exists in S/4 but is not activated.' },
          { system: 'SAP', method: 'api', name: 'PO read API', operations: ['read purchase orders'], access: 'confirmed', segmentId: 'c1:2', excerpt: 'PO read API is live.' },
        ],
        rules: [{ name: 'SAP tolerance', condition: '5%', action: 'block', segmentId: 'c1:3', excerpt: 'SAP is set to five percent tolerance.' }],
        metrics: [{ kind: 'volume', label: 'Invoices per month', value: null, low: 9000, high: 10000, unit: 'invoices/month', period: 'recent months', appliesTo: '', segmentId: 'c1:3', excerpt: 'around nine to ten thousand invoices a month' }],
        unknowns: [{ question: 'When will the supplier invoice API be activated?', whyItMatters: 'API-first', segmentId: 'c1:2', excerpt: 'is not activated' }],
      } };
    case 'source_steps':
      return { usage, data: sourceId === 'sop' ? {
        steps: [
          { name: 'Log invoice', description: 'Record in tracker', actors: ['AP Clerk'], systems: ['AP tracker'], taskType: 'user', segmentId: 'sop:1', excerpt: 'Log the invoice in the AP tracker.' },
          { name: 'Check for duplicates', description: 'Search SAP', actors: ['AP Clerk'], systems: ['SAP'], taskType: 'user', segmentId: 'sop:2', excerpt: 'Check for duplicates in SAP.' },
        ],
        decisions: [{ question: 'Duplicate?', outcomes: [{ label: 'Yes', then: 'stop' }, { label: 'No', then: 'continue' }], segmentId: 'sop:2', excerpt: 'Check for duplicates in SAP.' }],
      } : {
        steps: [{ name: 'Log in tracker', description: '', actors: ['AP Clerk'], systems: ['tracker'], taskType: 'user', segmentId: 'c1:1', excerpt: 'First I log it in the tracker' }],
        decisions: [],
      } };
    case 'merge_flow':
      return { usage, data: {
        roles: [{ key: 'r1', name: 'AP Clerk', kind: 'person_role', members: ['R1'] }, { key: 'r2', name: 'CFO', kind: 'person_role', members: [] }],
        systems: [{ key: 'y1', name: 'SAP S/4HANA', kind: 'erp', members: ['Y1', 'Y3'] }, { key: 'y2', name: 'AP tracker', kind: 'spreadsheet', members: ['Y2'] }],
        steps: [
          { key: 's1', name: 'Log invoice', description: 'Record it in the tracker.', taskType: 'user', roles: ['r1'], systems: ['y2'], members: ['S1', 'S3'] },
          { key: 's2', name: 'Check for duplicates', description: 'Search SAP.', taskType: 'user', roles: ['r1', 'r2'], systems: ['y1'], members: ['S2'] },
          { key: 's3', name: 'Approve with the CFO', description: 'Invented.', taskType: 'user', roles: ['r2'], systems: [], members: ['S99'] },
        ],
        gateways: [{ key: 'g1', question: 'Duplicate?', members: ['D1'] }],
        events: [{ key: 'e1', kind: 'start', name: 'Invoice received', members: [] }, { key: 'e2', kind: 'end', name: 'Invoice not posted', members: ['D1'] }, { key: 'e3', kind: 'end', name: 'Continue', members: [] }],
        flows: [
          { from: 'e1', to: 's1', label: '' }, { from: 's1', to: 's2', label: '' }, { from: 's2', to: 'g1', label: '' },
          { from: 'g1', to: 'e2', label: 'Yes' }, { from: 'g1', to: 'e3', label: 'No' },
          { from: 's2', to: 's3', label: '' }, { from: 'e2', to: 's1', label: '' }, { from: 's1', to: 's1', label: '' }, { from: 'zz', to: 's1', label: '' },
        ],
      } };
    case 'merge_facts':
      return { usage, data: {
        rules: [{ name: 'Price tolerance', condition: '2% or INR 5,000', action: 'post', members: ['B1'] }, { name: 'SAP tolerance', condition: '5%', action: 'block', members: ['B2'] }],
        exceptions: [{ name: 'Fraud', kind: 'business', trigger: 'x', handling: 'y', routedTo: 'CFO', members: ['X1'] }],
        interfaces: [
          { system: 'SAP S/4HANA', method: 'api', name: 'Supplier invoice API', operations: ['create invoices'], access: 'confirmed', members: ['I1', 'I2'] },
          { system: 'SAP S/4HANA', method: 'api', name: 'PO read API', operations: ['read purchase orders'], access: 'confirmed', members: ['I3'] },
        ],
        metrics: [{ label: 'Invoices per month', chosen: 'M2', members: ['M1', 'M2'] }],
        conflicts: [
          { summary: 'Tolerance: 2% in policy, 5% in SAP.', about: 'rule', members: ['B1', 'B2'] },
          { summary: 'Volume: 8,500 vs 9,000 to 10,000 per month.', about: 'metric', members: ['M1', 'M2'] },
          { summary: 'Not really a conflict.', about: 'other', members: ['B1'] },
        ],
        questions: [{ question: 'When will the supplier invoice API be activated?', whyItMatters: 'API-first design.', members: ['U1'] }],
      } };
    case 'review_flow':
      return { usage, data: { merges: [], removals: [] } };
  }
  throw new Error(`unexpected task ${task.id}`);
};

const SOURCES = [
  { sourceId: 'sop', title: 'SOP', kind: 'docx', segments: SOP },
  { sourceId: 'call-1', title: 'Discovery call', kind: 'vtt', segments: CALL },
];

test('extraction builds a valid model in which every element cites a verified quote', async () => {
  const { model, report } = await extractProcessModel(fake, 'Vendor invoice processing', SOURCES);
  assert.equal(validateModel(model).valid, true);
  assert.deepEqual(model.steps.map(s => s.name), ['Log invoice', 'Check for duplicates']);
  const log = model.steps[0];
  assert.deepEqual(log.sources.map(s => [s.sourceId, s.locator.section ?? s.locator.timestamp]), [['sop', '6.2'], ['call-1', '00:02:15']]);
  for (const el of [...model.steps, ...model.roles, ...model.systems, ...model.rules, ...model.gateways, ...model.meta.metrics]) {
    assert.ok(el.sources.length > 0, `${'name' in el ? el.name : el.id} has no source`);
    for (const s of el.sources) {
      const text = [...SOP, ...CALL].map(x => x.text).join('\n').toLowerCase();
      assert.ok(text.includes(s.excerpt.toLowerCase()), `unverified quote: ${s.excerpt}`);
    }
  }
  assert.equal(report.droppedQuotes.length, 1, 'the invented exception quote is dropped');
  assert.equal(model.exceptions.length, 0, 'and so is the exception built on it');
  assert.ok(report.dropped.some(d => d.includes('CFO')), 'a role without candidates is dropped');
  assert.ok(report.dropped.some(d => d.includes('Approve with the CFO')), 'a step without real candidates is dropped');
  assert.deepEqual(model.steps[1].roleIds.length, 1, 'role keys that were dropped do not survive');
});

test('flows keep only valid connections between kept elements', async () => {
  const { model } = await extractProcessModel(fake, 'P', SOURCES);
  const names = new Map([...model.events, ...model.steps].map(n => [n.id, n.name] as [string, string]).concat(model.gateways.map(g => [g.id, g.question])));
  assert.deepEqual(model.flows.map(f => `${names.get(f.from)} -> ${names.get(f.to)}${f.label ? ` [${f.label}]` : ''}`), [
    'Invoice received -> Log invoice', 'Log invoice -> Check for duplicates', 'Check for duplicates -> Duplicate?',
    'Duplicate? -> Invoice not posted [Yes]', 'Duplicate? -> Continue [No]',
  ]);
  const start = model.events.find(e => e.kind === 'start')!;
  assert.equal(start.status, 'inferred');
  assert.deepEqual(start.sources, model.steps[0].sources.slice(0, 1), 'an event without its own candidate cites its neighbour');
});

test('an interface is confirmed only when every source says so; unconfirmed ones become questions', async () => {
  const { model } = await extractProcessModel(fake, 'P', SOURCES);
  const sap = model.systems.find(s => s.name === 'SAP S/4HANA')!;
  const byName = Object.fromEntries(sap.access.map(a => [a.name, a.access]));
  assert.deepEqual(byName, { 'Supplier invoice API': 'reported', 'PO read API': 'confirmed' });
  assert.ok(model.openQuestions.some(q => /supplier invoice API/i.test(q.question)));
  assert.equal(model.openQuestions.filter(q => /supplier invoice API/i.test(q.question)).length, 1, 'duplicate questions are merged');
  assert.deepEqual([
    cautiousAccess(['confirmed', 'confirmed'], 'confirmed'), cautiousAccess(['confirmed', 'unknown'], 'confirmed'),
    cautiousAccess(['confirmed_absent'], 'confirmed'), cautiousAccess(['confirmed_absent', 'reported'], 'reported'), cautiousAccess(['confirmed'], 'reported'),
  ], ['confirmed', 'unknown', 'confirmed_absent', 'unknown', 'reported']);
});

test('conflicts keep every stated value with its source and are not resolved', async () => {
  const { model, report } = await extractProcessModel(fake, 'P', SOURCES);
  assert.equal(model.conflicts.length, 2);
  const tol = model.conflicts.find(k => k.target.kind === 'rule')!;
  assert.deepEqual(tol.values.map(v => [v.value, v.sources[0].sourceId]), [['2% or INR 5,000, whichever is lower', 'sop'], ['5%', 'call-1']]);
  const vol = model.conflicts.find(k => k.target.kind === 'metric')!;
  assert.deepEqual(vol.values.map(v => v.value), ['8500 invoices/month (FY average)', '9000 to 10000 invoices/month (recent months)']);
  assert.ok(model.conflicts.every(k => k.resolution === null));
  assert.ok(report.dropped.some(d => d.includes('Not really a conflict')));
  const metric = model.meta.metrics[0];
  assert.deepEqual([metric.range, metric.sources.length], [[9000, 10000], 2]);
});

test('gaps become questions: a step without a system', async () => {
  const run: RunTask = async (task, input) => {
    const r = await fake(task, input);
    if (task.id === 'merge_flow') (r.data as any).steps[0].systems = [];
    return r;
  };
  const { model, report } = await extractProcessModel(run, 'P', SOURCES);
  assert.ok(model.openQuestions.some(q => q.target.kind === 'step' && q.target.field === 'systemIds' && /Log invoice/.test(q.question)));
  assert.ok(report.questionsFromGaps >= 1);
});

test('candidate listings carry ids, sources and order but no source text beyond the extracted fields', async () => {
  const set = buildCandidates(SOURCES, [
    { sourceId: 'sop', facts: { ...empty, rules: [{ name: 'Price tolerance', condition: '2%', action: 'post', segmentId: 'sop:3', excerpt: 'Price tolerance' }] }, steps: { steps: [{ name: 'Log invoice', description: 'd', actors: ['AP Clerk'], systems: [], taskType: 'user', segmentId: 'sop:1', excerpt: 'Log the invoice' }], decisions: [] } },
  ], SOP);
  assert.match(flowListing(set), /S1 \[sop #1\] Log invoice — d \| actors: AP Clerk \| systems: — \| type: user/);
  assert.match(factsListing(set), /B1 \[sop #1\] Price tolerance: if 2% then post/);
  assert.doesNotMatch(flowListing(set) + factsListing(set), /6\.2 Log the invoice in the AP tracker/);
});

import { applyReview, MAX_REVIEW_SHARE } from './review.ts';

test('review: merged steps pool their candidates, removed steps are bypassed, and the share of changes is capped', () => {
  const flow: any = {
    roles: [{ key: 'r1', name: 'AP Clerk', kind: 'person_role', members: ['R1'] }], systems: [],
    steps: ['a', 'b', 'c', 'd', 'e', 'f'].map(k => ({ key: k, name: `Step ${k}`, description: '', taskType: 'user', roles: k === 'c' ? [] : ['r1'], systems: [k], members: [`S${k}`] })),
    gateways: [{ key: 'g1', question: 'OK?', members: ['D1'] }],
    events: [{ key: 'e1', kind: 'start', name: 'Start', members: [] }, { key: 'e2', kind: 'end', name: 'End', members: [] }, { key: 'e3', kind: 'end', name: 'Rejected', members: [] }],
    flows: [
      { from: 'e1', to: 'a', label: '' }, { from: 'a', to: 'b', label: '' }, { from: 'b', to: 'g1', label: '' },
      { from: 'g1', to: 'c', label: 'Yes' }, { from: 'g1', to: 'd', label: 'No' }, { from: 'd', to: 'e3', label: '' },
      { from: 'c', to: 'e', label: '' }, { from: 'e', to: 'f', label: '' }, { from: 'f', to: 'e2', label: '' },
    ],
  };
  const { flow: out, applied, skipped } = applyReview(flow, {
    merges: [{ step: 'b', into: 'a', reason: 'part of a' }, { step: 'f', into: 'e', reason: 'part of e' }, { step: 'x', into: 'a', reason: 'unknown' }],
    removals: [{ step: 'd', kind: 'outcome', reason: 'rejection' }, { step: 'c', kind: 'not_an_activity', reason: 'over the cap' }],
  });
  assert.equal(Math.floor(6 * MAX_REVIEW_SHARE), 2, 'six steps allow two changes');
  assert.deepEqual(out.steps.map((s: any) => s.key), ['a', 'c', 'd', 'e'], 'both merges applied; the removals are over the cap');
  const a = out.steps.find((s: any) => s.key === 'a');
  assert.deepEqual([a.members, a.systems], [['Sa', 'Sb'], ['a', 'b']]);
  assert.ok(out.flows.some((f: any) => f.from === 'a' && f.to === 'g1'), 'flows of a merged step move to its target');
  assert.ok(!out.flows.some((f: any) => f.from === f.to));
  assert.equal(applied.length, 2, 'only two of six steps may change');
  assert.ok(skipped.includes('merge x into a') && skipped.some(x => x.startsWith('remove')));
});

test('review: removing an outcome step joins its predecessor to what follows', () => {
  const flow: any = {
    roles: [], systems: [], gateways: [{ key: 'g1', question: 'Duplicate?', members: ['D1'] }],
    steps: ['a', 'b', 'c', 'd', 'e'].map(k => ({ key: k, name: `Step ${k}`, description: '', taskType: 'user', roles: [], systems: [], members: [`S${k}`] })),
    events: [{ key: 'e9', kind: 'end', name: 'Rejected', members: [] }],
    flows: [{ from: 'a', to: 'g1', label: '' }, { from: 'g1', to: 'b', label: 'Yes' }, { from: 'b', to: 'e9', label: '' }, { from: 'g1', to: 'c', label: 'No' }],
  };
  const { flow: out } = applyReview(flow, { merges: [], removals: [{ step: 'b', kind: 'outcome', reason: 'rejection ends the case' }] });
  assert.deepEqual(out.flows.find((f: any) => f.to === 'e9'), { from: 'g1', to: 'e9', label: 'Yes' });
});
