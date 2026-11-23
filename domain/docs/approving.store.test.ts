// Package 14, pull request 3: the in-browser store keeps versions by the database's rules (approve_version,
// version_states, the change record), so the browser tests and the demo behave as the live site does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../../journey/store/memoryStore.ts';
import { StoreError, type JourneyStore } from '../../journey/store/types.ts';
import { approvalChanges, approvalTarget, keepInputFrom, keptRevision, type KeepRecord } from './approving.ts';
import { buildKeptDocuments, fingerprintsOf, keptInputs, keptLook } from './keep.ts';
import { makeEdit } from './edits.ts';

const demo = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8'));

async function open() {
  const store = createMemoryStore({ demo });
  const ws = (await store.listWorkspaces())[0]!;
  const p = (await store.listProcesses(ws.id))[0]!;
  return { store, ws, p };
}

/** What the approver's page does: the state first, then the inputs, then the approval with the count it saw. */
async function approve(store: JourneyStore, wsId: string, processId: string, reason: string | null, tamper: { version?: number; changes?: number } = {}) {
  const [st] = await store.versionStates(wsId, processId);
  const revisions = await store.listRevisions(processId);
  const target = approvalTarget(revisions)!;
  const rev = target.from === 'draft' ? revisions.find(r => r.id === target.revisionId)! : revisions.find(r => r.state === 'approved')!;
  const docSettings = await store.getDocumentSettings(wsId);
  const record: KeepRecord = {
    model: (await store.getModel(rev.id))!, decisions: await store.getAssessmentDecisions(processId), settings: (await store.getSettings(wsId)).settings,
    stored: await store.listRequirements(processId), sources: await store.listSources(processId), names: {}, edits: await store.listDocumentEdits(processId),
    testEdits: await store.listTestEdits(processId), layouts: docSettings.layouts,
  };
  const number = (st.latest?.number ?? 0) + 1;
  const input = keepInputFrom(record, keptRevision(number, '23 November 2026'));
  const kept = buildKeptDocuments(input);
  const look = keptLook(docSettings.branding);
  const before = st.latest ? await store.getVersionPrints(st.latest.id) : null;
  return store.approveVersion({
    processId, revisionId: target.revisionId, expectedSeq: target.expectedSeq, expectedVersion: tamper.version ?? st.latest?.number ?? 0, expectedChanges: tamper.changes ?? st.changesSeen,
    reason, documents: kept, fingerprints: fingerprintsOf(kept), look, changes: approvalChanges(before, kept, look), inputs: keptInputs(input, { build: 'test' }),
  });
}

const refusal = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert.ok(e instanceof StoreError); return { status: e.status, code: e.code }; } assert.fail('expected a refusal'); };

test('the first approval keeps version 1; a later edit is an unapproved change; version 2 needs a reason', async () => {
  const { store, ws, p } = await open();
  const [s0] = await store.versionStates(ws.id, p.id);
  assert.equal(s0.latest, null);
  assert.equal(s0.approvedHasVersion, false, 'the sample was approved before copies were kept');

  // With nothing changed since the approval, there is still a record to keep: the approved revision.
  const v1 = await approve(store, ws.id, p.id, null);
  assert.equal(v1.number, 1);
  const [s1] = await store.versionStates(ws.id, p.id);
  assert.equal(s1.latest?.number, 1);
  assert.equal(s1.processChanged, false);
  assert.equal(s1.approvedHasVersion, true);

  // A section edit after approval: the tag's "unapproved changes".
  const kept = (await store.getVersion(v1.versionId)).kept;
  const section = kept.documents.pdd!.sections.find(s => s.blocks.some(b => b.kind === 'paragraph'))!;
  await store.saveDocumentEdit(p.id, makeEdit('pdd', section.id, '<p>Our own words for this section.</p>', 'none'));
  const [s2] = await store.versionStates(ws.id, p.id);
  assert.equal(s2.processChanged, true);
  assert.equal(s2.changesSeen, s1.changesSeen + 1);

  assert.deepEqual(await refusal(approve(store, ws.id, p.id, null)), { status: 422, code: 'REASON_REQUIRED' });
  assert.deepEqual(await refusal(approve(store, ws.id, p.id, 'Too short')), { status: 422, code: 'REASON_REQUIRED' }, 'at least three words');
  const v2 = await approve(store, ws.id, p.id, 'Section reworded by the analyst');
  assert.equal(v2.number, 2);
  const list = await store.listVersions(p.id);
  assert.deepEqual(list.map(v => v.number), [2, 1], 'newest first');
  assert.equal(list[0].reason, 'Section reworded by the analyst');
  assert.deepEqual(list[0].changes.sections.map(s => [s.doc, s.id, s.kind]), [['pdd', section.id, 'changed']]);
  assert.equal(list[1].reason, null);

  // Version 1 still reads as before the edit, version 2 with it.
  const again1 = await store.getVersion(v1.versionId), got2 = await store.getVersion(v2.versionId);
  assert.equal(JSON.stringify(again1.kept), JSON.stringify(kept));
  assert.match(JSON.stringify(got2.kept.documents.pdd!.sections.find(s => s.id === section.id)), /Our own words/);
  assert.doesNotMatch(JSON.stringify(again1.kept.documents.pdd!.sections.find(s => s.id === section.id)), /Our own words/);
  const [s3] = await store.versionStates(ws.id, p.id);
  assert.equal(s3.processChanged, false, 'approved again: nothing unapproved');
});

test('an approval is refused when someone approved or saved meanwhile, and then changes nothing', async () => {
  const { store, ws, p } = await open();
  await approve(store, ws.id, p.id, null);
  const [st] = await store.versionStates(ws.id, p.id);
  await store.saveDocumentEdit(p.id, makeEdit('brd', 's-1', '<p>A change.</p>', 'none'));
  assert.deepEqual(await refusal(approve(store, ws.id, p.id, 'A reason in words', { changes: st.changesSeen })), { status: 409, code: 'CHANGED_MEANWHILE' });
  assert.deepEqual(await refusal(approve(store, ws.id, p.id, 'A reason in words', { version: 0 })), { status: 409, code: 'VERSION_CONFLICT' });
  assert.deepEqual((await store.listVersions(p.id)).map(v => v.number), [1], 'no version was made by a refused approval');
});

test('a change for the whole workspace is listed apart and never makes the process "changed"', async () => {
  const { store, ws, p } = await open();
  await approve(store, ws.id, p.id, null);
  const ds = await store.getDocumentSettings(ws.id);
  await store.saveDocumentSettings(ws.id, { ...ds, layouts: { ...ds.layouts, pdd: { sections: {}, custom: [{ id: 'c-1', after: '', title: 'Our own section', text: 'Text.' }] } } });
  const [st] = await store.versionStates(ws.id, p.id);
  assert.deepEqual(st.workspaceChanges, ['layout']);
  assert.equal(st.processChanged, false);
});

test('a version cannot be read in a format this release does not know', async () => {
  const { store, ws, p } = await open();
  const [st] = await store.versionStates(ws.id, p.id);
  const bad = await refusal(store.approveVersion({
    processId: p.id, revisionId: null, expectedSeq: null, expectedVersion: 0, expectedChanges: st.changesSeen, reason: null,
    documents: { format: 9, documents: {}, testPack: null } as never, fingerprints: {}, look: keptLook({ organisation: '', font: 'Calibri', accent: '002C4B', logo: null, template: null }),
    changes: { sections: [], documents: [], look: [] }, inputs: { format: 1, build: 'test', modelHash: '', inputs: {} },
  }));
  assert.equal(bad.status, 422);
});
