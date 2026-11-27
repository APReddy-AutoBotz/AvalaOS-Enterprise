// A description read alone gave 0 steps (live run of 27 November 2026, claude/first-description-zero-steps-and-
// public-repo-27-nov.md): the flow merge named every member by the place the listing prints ("own-1 #1") in
// place of its id ("S1"). The text below is made up; the answers have the shape of the stored ones: members as
// places, everything else (roles, systems, flows, the review) as keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, flowListing, positionOf, type SourcePassOutput } from './candidates.ts';
import { memberReader } from './members.ts';
import { assembleModel, type MergeFactsOutput, type MergeFlowOutput } from './assemble.ts';
import { applyReview, reviewListing } from './review.ts';
import { extractProcessModel, type RunTask } from './pipeline.ts';
import { plainFailureOf, TaskError } from './failure.ts';
import { validateModel } from '../processModel/validate.ts';
import type { IngestSegment } from '../ingest/segment.ts';

// One passage, as a spoken description is kept.
const WORDS = 'Documents come in by email. The reviewer checks each one against the protocol. If there is a deviation, the reviewer escalates it to the study lead and blocks the approval. The study lead sends a corrected version, which the reviewer checks again. Otherwise the reviewer approves the document in the document system.';
const SEG: IngestSegment = { id: 'own-1:1', sourceId: 'own-1', kind: 'paragraph', text: WORDS, locator: { lineStart: 1 } };
const SOURCE = { sourceId: 'own-1', title: 'Described in own words, 27 November 2026', kind: 'Description', segments: [SEG] };

const q = (excerpt: string) => ({ segmentId: 'own-1:1', excerpt });
const STEPS = [
  ['Receive documents', 'Documents come in by email.'],
  ['Check against the protocol', 'The reviewer checks each one against the protocol.'],
  ['Escalate the deviation', 'the reviewer escalates it to the study lead'],
  ['Block the approval', 'blocks the approval'],
  ['Check the corrected version', 'which the reviewer checks again'],
  ['Approve the document', 'the reviewer approves the document in the document system'],
] as const;
const PASS: SourcePassOutput = {
  sourceId: 'own-1',
  facts: {
    roles: [{ name: 'Reviewer', kind: 'person_role', ...q('The reviewer checks each one') }, { name: 'Study lead', kind: 'person_role', ...q('the study lead') }],
    systems: [{ name: 'Email', kind: 'email', ...q('by email') }, { name: 'Document system', kind: 'other', ...q('the document system') }],
    interfaces: [], rules: [], exceptions: [], metrics: [], unknowns: [],
  },
  steps: {
    steps: STEPS.map(([name, excerpt]) => ({ name, description: '', actors: ['Reviewer'], systems: [], taskType: 'user', ...q(excerpt) })),
    decisions: [{ question: 'Is there a deviation?', outcomes: [{ label: 'Yes', then: 'escalate' }, { label: 'No', then: 'approve' }], ...q('If there is a deviation') }],
  },
};
const SET = buildCandidates([{ sourceId: 'own-1', title: SOURCE.title, kind: SOURCE.kind }], [PASS], [SEG]);
const NO_FACTS: MergeFactsOutput = { rules: [], exceptions: [], interfaces: [], metrics: [], conflicts: [], questions: [] };

/** The flow merge's answer, with each member written by `name` (the place, as live, or the id). */
function flowAnswer(name: (kind: string, n: number) => string): MergeFlowOutput {
  const step = (n: number) => name('step', n);
  return {
    roles: [{ key: 'r1', name: 'Reviewer', kind: 'person_role', members: [name('role', 1)] }, { key: 'r2', name: 'Study lead', kind: 'person_role', members: [name('role', 2)] }],
    systems: [{ key: 'y1', name: 'Email', kind: 'email', members: [name('system', 1)] }, { key: 'y2', name: 'Document system', kind: 'other', members: [name('system', 2)] }],
    steps: STEPS.map(([n], i) => ({ key: `s${i + 1}`, name: n, description: '', taskType: 'user', roles: [i === 2 ? 'r1' : 'r1'], systems: i === 0 ? ['y1'] : i === 5 ? ['y2'] : [], members: [step(i + 1)] })),
    gateways: [{ key: 'g1', question: 'Is there a deviation?', members: [name('decision', 1)] }],
    // "own-1 #1" is both the first step and the first decision: an event naming it names neither.
    events: [{ key: 'e1', kind: 'start', name: 'Documents received', members: [step(1)] }, { key: 'e2', kind: 'end', name: 'Document approved', members: [step(6)] }],
    flows: [
      { from: 'e1', to: 's1', label: '' }, { from: 's1', to: 's2', label: '' }, { from: 's2', to: 'g1', label: '' },
      { from: 'g1', to: 's3', label: 'Yes' }, { from: 's3', to: 's4', label: '' }, { from: 's4', to: 's5', label: '' }, { from: 's5', to: 's2', label: '' },
      { from: 'g1', to: 's6', label: 'No' }, { from: 's6', to: 'e2', label: '' },
    ],
  };
}
const PREFIX: Record<string, string> = { role: 'R', system: 'Y', step: 'S', decision: 'D' };
const BY_PLACE = flowAnswer((_k, n) => `own-1 #${n}`);
const BY_ID = flowAnswer((k, n) => `${PREFIX[k]}${n}`);

test('a member is read by id, by id and its own place, or by a place only one candidate of the allowed kinds holds', () => {
  const r = memberReader(SET);
  const id = (m: string, kinds: Parameters<typeof r.read>[1]) => r.read(m, kinds)?.id ?? null;
  assert.equal(positionOf(SET.items.find(c => c.id === 'S1')!), 'own-1 #1', 'the place the listing prints');
  assert.ok(flowListing(SET).includes('S1 [own-1 #1] Receive documents'));
  assert.equal(id('S1', ['step']), 'S1');
  assert.equal(id('S1 [own-1 #1]', ['step']), 'S1');
  assert.equal(id('own-1 #1', ['step']), 'S1');
  assert.equal(id('[own-1 #1]', ['role']), 'R1');
  assert.equal(id('  own-1   #2 ', ['system']), 'Y2');
  assert.equal(id('own-1 #1', ['decision']), 'D1');
  assert.deepEqual(r.counts, { byLabel: 5, unresolved: 0 });
  // Not read: a place two candidates of the allowed kinds hold, an id and a place that disagree, an id of
  // another kind, a place nothing holds, and a name.
  assert.equal(id('own-1 #1', ['step', 'decision']), null);
  assert.equal(id('S1 [own-1 #2]', ['step']), null);
  assert.equal(id('R1', ['step']), null);
  assert.equal(id('own-1 #9', ['step']), null);
  assert.equal(id('Receive documents', ['step']), null);
  assert.deepEqual(r.counts, { byLabel: 5, unresolved: 5 });
  // Each candidate once in a group, in the members' order.
  assert.deepEqual(r.readAll(['own-1 #2', 'S2', 'own-1 #1'], ['step']).map(c => c.id), ['S2', 'S1']);
});

test('a numbered section is a place too, and two steps quoted from one section are not told apart by it', () => {
  const segs: IngestSegment[] = [
    { id: 'sop:1', sourceId: 'sop', kind: 'paragraph', text: '6.2 Log the request. Check the form.', locator: { section: '6.2' } },
    { id: 'sop:2', sourceId: 'sop', kind: 'paragraph', text: '6.5 Send the reply.', locator: { section: '6.5' } },
  ];
  const step = (name: string, segmentId: string, excerpt: string) => ({ name, description: '', actors: [], systems: [], taskType: 'user', segmentId, excerpt });
  const set = buildCandidates([{ sourceId: 'sop', title: 'SOP', kind: 'docx' }], [{
    sourceId: 'sop', facts: { roles: [], systems: [], interfaces: [], rules: [], exceptions: [], metrics: [], unknowns: [] },
    steps: { steps: [step('Log the request', 'sop:1', 'Log the request.'), step('Check the form', 'sop:1', 'Check the form.'), step('Send the reply', 'sop:2', 'Send the reply.')], decisions: [] },
  }], segs);
  const r = memberReader(set);
  assert.equal(r.read('sop §6.5', ['step'])?.id, 'S3');
  assert.equal(r.read('[sop §6.2]', ['step']), null, 'two steps are quoted from 6.2');
  assert.equal(r.read('S2 [sop §6.2]', ['step'])?.id, 'S2', 'with its id it is one');

  // The review reads members the same way: its listing names where each step came from, and it keeps the
  // only step of a numbered section from being merged away.
  const flow: MergeFlowOutput = {
    roles: [], systems: [], gateways: [], events: [],
    steps: [
      { key: 's1', name: 'Log and check', description: '', taskType: 'user', roles: [], systems: [], members: ['S1 [sop §6.2]', 'S2 [sop §6.2]'] },
      { key: 's2', name: 'Send the reply', description: '', taskType: 'user', roles: [], systems: [], members: ['sop §6.5'] },
      // Three more, so one review may change up to two steps (MAX_REVIEW_SHARE).
      ...['s3', 's4', 's5'].map(key => ({ key, name: key, description: '', taskType: 'user' as const, roles: [], systems: [], members: [] })),
    ],
    flows: [{ from: 's1', to: 's2', label: '' }],
  };
  assert.match(reviewListing(flow, set), /s1 Log and check — {2}\| roles: — \| from: "Log the request" \(sop\), "Check the form" \(sop\)/);
  assert.match(reviewListing(flow, set), /s2 Send the reply .*from: "Send the reply" \(sop\)/);
  const reviewed = applyReview(flow, { merges: [{ step: 's2', into: 's1', reason: 'same' }], removals: [] }, set);
  assert.deepEqual(reviewed.skipped, ['merge s2 into s1: it is the only step for procedure section 6.5']);
});

test('a description alone, answered with places: assembly keeps its steps, roles, applications and decision, and counts what it read by place', () => {
  const before = assembleModel('Document review', SET, BY_PLACE, NO_FACTS);
  assert.deepEqual(before.model.steps.map(s => s.name), STEPS.map(([n]) => n));
  assert.deepEqual(before.model.roles.map(r => r.name), ['Reviewer', 'Study lead']);
  assert.deepEqual(before.model.systems.map(s => s.name), ['Email', 'Document system']);
  assert.deepEqual(before.model.gateways.map(g => g.question), ['Is there a deviation?']);
  assert.deepEqual(before.model.events.map(e => e.name), ['Documents received', 'Document approved']);
  assert.deepEqual(before.report.dropped, []);
  // Twelve members by place (2 roles, 2 applications, 6 steps, the decision, the end); the start's "own-1 #1"
  // is a step and a decision, so it is not read, and the start cites the step it leads to.
  assert.deepEqual(before.report.members, { byLabel: 12, unresolved: 1 });
  assert.equal(before.model.events[0]!.sources[0]!.excerpt, 'Documents come in by email.');
  assert.deepEqual(validateModel(before.model).issues.filter(i => i.severity === 'error'), []);

  // The same answer with ids gives the same process.
  const ids = assembleModel('Document review', SET, BY_ID, NO_FACTS);
  assert.deepEqual(ids.report.members, { byLabel: 0, unresolved: 0 });
  assert.deepEqual(ids.model.steps, before.model.steps);
  assert.deepEqual(ids.model.roles, before.model.roles);
  assert.deepEqual(ids.model.systems, before.model.systems);
  assert.deepEqual(ids.model.gateways, before.model.gateways);
  assert.deepEqual(ids.model.flows, before.model.flows);
});

/** The reading with a fake AI: `flows` are the flow merge's answers in turn. */
function reading(flows: MergeFlowOutput[]): { run: RunTask; calls: string[] } {
  const calls: string[] = [];
  const usage = { input: 10, output: 5 };
  const run: RunTask = async (task) => {
    calls.push(task.id);
    if (task.id === 'source_facts') return { usage, data: PASS.facts };
    if (task.id === 'source_steps') return { usage, data: PASS.steps };
    if (task.id.startsWith('merge_facts_')) return { usage, data: Object.fromEntries(Object.keys((task.schema as { properties: object }).properties).map(k => [k, []])) };
    if (task.id === 'merge_flow') return { usage, data: flows[calls.filter(c => c === 'merge_flow').length - 1] };
    if (task.id === 'review_flow') return { usage, data: { merges: [{ step: 's2', into: 's1', reason: 'same' }], removals: [] } };
    throw new Error(`unexpected task ${task.id}`);
  };
  return { run, calls };
}
const NOTHING = flowAnswer(() => 'not a candidate');

test('a reading whose sources gave steps never ends with none: the flow merge is asked once more', async () => {
  const { run, calls } = reading([NOTHING, BY_PLACE]);
  const { model, report } = await extractProcessModel(run, 'Document review', [SOURCE]);
  assert.equal(calls.filter(c => c === 'merge_flow').length, 2);
  assert.equal(report.flowMergedAgain, true);
  assert.equal(model.steps.length, 6, 'the second answer, without the review (its keys name the first answer\'s steps)');
  assert.deepEqual(report.review, { applied: [], skipped: [] });

  // When the first answer gives steps, nothing is asked again.
  const once = reading([BY_PLACE]);
  const first = await extractProcessModel(once.run, 'Document review', [SOURCE]);
  assert.equal(once.calls.filter(c => c === 'merge_flow').length, 1);
  assert.equal(first.report.flowMergedAgain, false);
  assert.equal(first.model.steps.length, 5, 'the review merged one step');
});

test('twice no step: the reading stops with a sentence a person can act on', async () => {
  const { run, calls } = reading([NOTHING, NOTHING]);
  const error = await extractProcessModel(run, 'Document review', [SOURCE]).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof TaskError);
  assert.equal(error.code, 'NO_STEPS');
  assert.deepEqual(error.usage, { input: 0, output: 0 }, 'the second answer\'s tokens are counted with it, not again');
  assert.equal(calls.filter(c => c === 'merge_flow').length, 2);
  assert.equal(plainFailureOf({ key: 'assemble' }, error.message, '049fdc71-e2e3-4e9b-98dd-e36dad678534'),
    'Putting the process together: the sources gave steps, but they could not be put together into a process, twice. Nothing in the process was changed. Read the sources again; if it happens again, add another source or let us know. Reference: 049fdc71.');
});
