// Package 14, pull request 3: which record an approval keeps, when Approve is offered, and how the working
// draft is compared with the latest version. On the demo's sample, built as the Documents page builds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalChanges, approvalTarget, compareDraft, keepInputFrom, keptRevision, offersApproval, type KeepRecord } from './approving.ts';
import { buildKeptDocuments, fingerprintsOf, keptLook } from './keep.ts';
import { makeEdit } from './edits.ts';
import { loadSample } from './fixtures/keepSample.ts';

const sample = await loadSample();
const record = (over: Partial<KeepRecord> = {}): KeepRecord => ({
  model: sample.model, decisions: sample.decisions, settings: sample.settings, stored: sample.stored, sources: sample.sources,
  names: sample.names, edits: sample.edits, testEdits: sample.testEdits, layouts: sample.docSettings.layouts, ...over,
});
const keep = (r: KeepRecord, n = 1) => buildKeptDocuments(keepInputFrom(r, keptRevision(n, '23 November 2026')));

test('an approval keeps the working draft when it has edits, else the approved record as it reads now', () => {
  const draft = { id: 'w', state: 'working', seq: 3 }, empty = { id: 'w', state: 'working', seq: 0 }, approved = { id: 'a', state: 'approved', seq: 9 };
  assert.deepEqual(approvalTarget([draft, approved]), { from: 'draft', revisionId: 'w', expectedSeq: 3 });
  assert.deepEqual(approvalTarget([empty]), { from: 'draft', revisionId: 'w', expectedSeq: 0 }, 'the first approval of a draft with no edits yet');
  assert.deepEqual(approvalTarget([empty, approved]), { from: 'approved', revisionId: null, expectedSeq: null }, 'an empty draft is never what is kept');
  assert.deepEqual(approvalTarget([approved]), { from: 'approved', revisionId: null, expectedSeq: null });
  assert.equal(approvalTarget([]), null);
});

test('Approve is offered for a draft, or after a change saved since the latest version', () => {
  const fromDraft = { from: 'draft' as const, revisionId: 'w', expectedSeq: 1 }, fromApproved = { from: 'approved' as const, revisionId: null, expectedSeq: null };
  const base = { canApprove: true, latest: 1, processChanged: false, workspaceChanges: [] as string[] };
  assert.equal(offersApproval({ ...base, target: fromDraft }), true);
  assert.equal(offersApproval({ ...base, target: fromDraft, canApprove: false }), false, 'only an approver');
  assert.equal(offersApproval({ ...base, target: fromApproved }), false, 'nothing saved since the version');
  assert.equal(offersApproval({ ...base, target: fromApproved, processChanged: true }), true, 'a section edit or a choice');
  assert.equal(offersApproval({ ...base, target: fromApproved, workspaceChanges: ['layout'] }), true, 'a change for the whole workspace');
  assert.equal(offersApproval({ ...base, target: fromApproved, latest: null, processChanged: true }), false, 'approved before copies were kept: kept as it reads, in pull request 4');
  assert.equal(offersApproval({ ...base, target: null }), false);
});

test('the version number and date in the document control never mark a section changed', () => {
  const v1 = keep(record(), 1), v2 = keep(record(), 7);
  const c = compareDraft(fingerprintsOf(v1), v2);
  assert.equal(c.differing, 0);
  assert.deepEqual(c.sections, []);
  assert.equal(v2.documents.pdd!.control.find(x => x.key === 'Revision')!.value, 'Approved version 7');
});

test('a section edit after approval marks exactly that section, and is listed as what changed', () => {
  const v1 = keep(record());
  const section = v1.documents.pdd!.sections.find(s => s.blocks.some(b => b.kind === 'paragraph'))!;
  const edited = record({ edits: [...sample.edits.filter(e => !(e.docType === 'pdd' && e.sectionKey === section.id)), makeEdit('pdd', section.id, '<p>Our own words for this section.</p>', 'none')] });
  const draft = keep(edited, 2);
  const c = compareDraft(fingerprintsOf(v1), draft);
  assert.equal(c.differing, 1);
  assert.deepEqual([...(c.byDoc.pdd ?? [])], [section.id]);
  assert.deepEqual(c.sections.map(s => [s.doc, s.id, s.kind]), [['pdd', section.id, 'changed']]);
  // The kept version is not touched by the edit: built again from the record as it was, it is byte for byte the same.
  assert.equal(JSON.stringify(keep(record())), JSON.stringify(v1));
  const look = keptLook(sample.docSettings.branding);
  const changes = approvalChanges({ fingerprints: fingerprintsOf(v1), look }, draft, look);
  assert.deepEqual(changes.sections.map(s => s.id), [section.id]);
  assert.deepEqual(changes.look, []);
  assert.deepEqual(approvalChanges(null, draft, look), { sections: [], documents: [], look: [] }, 'version 1 has nothing before it');
});

test('a document now offered counts every one of its sections', () => {
  const v1 = keep(record());
  const prints = fingerprintsOf(v1);
  const { tests, ...withoutTests } = prints;
  const c = compareDraft(withoutTests, v1);
  assert.deepEqual(c.documents, [{ doc: 'tests', kind: 'added' }]);
  assert.equal(c.differing, tests!.length);
  assert.equal(c.byDoc.tests!.size, tests!.length);
});

test('a choice of approach for a step marks the sections it reaches', () => {
  const v1 = keep(record());
  const step = sample.model.steps[0]!;
  const current = sample.decisions.overrides[step.id]?.approach;
  const approach = current === 'human' ? 'rpa' as const : 'human' as const;
  const choice = { ...sample.decisions, overrides: { ...sample.decisions.overrides, [step.id]: { stepId: step.id, approach, rationale: 'Kept with the team for now', by: 'Priya', at: '2026-11-23T00:00:00Z' } } };
  const c = compareDraft(fingerprintsOf(v1), keep(record({ decisions: choice }), 2));
  assert.ok(c.differing > 0);
  assert.ok(c.sections.every(s => s.kind === 'changed'));
});
