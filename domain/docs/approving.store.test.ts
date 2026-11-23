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
import { ApprovalReadError, approvePrepared, prepareApproval } from '../../journey/process/keepVersion.ts';

const demo = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8'));

/**
 * The sample as a process approved before copies were kept: its approved revision with no kept version. The demo
 * itself keeps version 1 since pull request 4's refresh, so its versions and kept looks are left out here.
 */
async function open() {
  const store = createMemoryStore({ demo: { ...demo, versions: [], keptLooks: [] } });
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
  const before = st.latest ? { fingerprints: (await store.getVersionPrints(st.latest.id)).fingerprints, look: await store.getVersionLook(st.latest.id) } : null;
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

/** The store with one read failing, counting every call to approveVersion. */
function failing(store: JourneyStore, method: 'getAssessmentDecisions' | 'listMembers') {
  const calls = { approve: 0 };
  const wrapped = new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === method) return () => Promise.reject(new StoreError(503, 'The server did not answer.'));
      if (key === 'approveVersion') return (...a: unknown[]) => { calls.approve++; return (value as Function).apply(target, a); };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { store: wrapped, calls };
}

for (const [method, what] of [['getAssessmentDecisions', "people's choices for this process"], ['listMembers', "the people's names"]] as const) {
  test(`a failed read of ${what} refuses the approval, and approve_version is never called`, async () => {
    const { store, ws, p } = await open();
    const { store: broken, calls } = failing(store, method);
    await assert.rejects(prepareApproval(broken, p.id, ws.id), (e: unknown) => e instanceof ApprovalReadError && e.message === `${what} could not be read`);
    assert.equal(calls.approve, 0);
    assert.deepEqual(await store.listVersions(p.id), [], 'nothing was kept');
    // With every read answered, the same page approves.
    const ok = await prepareApproval(store, p.id, ws.id);
    assert.ok(ok);
    assert.equal((await approvePrepared(store, p.id, ok!, null)).number, 1);
  });
}

test('the approval reads the look of the version before only to say what changed', async () => {
  const { store, ws, p } = await open();
  await approve(store, ws.id, p.id, null);
  const [st] = await store.versionStates(ws.id, p.id);
  const prints = await store.getVersionPrints(st.latest!.id);
  assert.deepEqual(Object.keys(prints).sort(), ['fingerprints', 'inputs', 'lookFingerprint'], 'no logo or Word template on opening Documents');
  assert.equal(typeof (await store.getVersionLook(st.latest!.id)).font, 'string');
});

test('the lists read where every process stands in one call for the workspace, and keep the revision\'s words when it fails', async () => {
  const { loadProcessFacts, versionRows } = await import('../../journey/processFacts.ts');
  const { store, ws, p } = await open();
  await approve(store, ws.id, p.id, null);
  let calls = 0;
  const counted = new Proxy(store, { get(t, k) { const v = Reflect.get(t, k, t); if (k === 'versionStates') return (...a: unknown[]) => { calls++; return (v as Function).apply(t, a); }; return typeof v === 'function' ? v.bind(t) : v; } });
  const processes = await store.listProcesses(ws.id);
  const rows = await versionRows(counted, ws.id);
  const facts = await Promise.all(processes.map(x => loadProcessFacts(counted, x, undefined, rows.get(x.id))));
  assert.equal(calls, 1, 'one call for the whole workspace');
  assert.equal(facts.find(f => f.id === p.id)!.statusLabel, 'Approved version 1');
  // The read failed: the revision's own words, as before package 14.
  const fallback = await loadProcessFacts(counted, processes.find(x => x.id === p.id)!, undefined, undefined);
  assert.equal(fallback.statusLabel, 'Approved revision 1');
  assert.equal(calls, 1);
});

// ---- Pull request 4: "Keep it as it reads now" (part J) --------------------------------------------------

test('"Keep it as it reads now" keeps an earlier approval as version 1, with who approved it and when, and who kept it and when', async () => {
  const { store, ws, p } = await open();
  const [s0] = await store.versionStates(ws.id, p.id);
  const approvedRev = (await store.listRevisions(p.id)).find(r => r.state === 'approved')!;
  assert.equal(s0.approvedHasVersion, false);
  const prepared = (await prepareApproval(store, p.id, ws.id, 'keep'))!;
  assert.equal(prepared.mode, 'keep');
  assert.equal(prepared.number, 1);
  assert.equal(prepared.approved?.revNo, approvedRev.revNo);
  assert.equal(prepared.approved?.approvedAt, approvedRev.approvedAt);
  assert.equal(prepared.kept.documents.pdd!.control.find(c => c.key === 'Revision')?.value, 'Approved version 1, kept after approval', 'the documents say they were kept after approval');

  assert.deepEqual(await refusal(approvePrepared(store, p.id, prepared, 'A reason in words')), { status: 422, code: 'REASON_NOT_TAKEN' });
  const v1 = await approvePrepared(store, p.id, prepared, null);
  assert.equal(v1.number, 1);
  const [row] = await store.listVersions(p.id);
  assert.equal(row.revisionId, approvedRev.id);
  assert.equal(row.approvedAt, approvedRev.approvedAt, 'the approval keeps its own date: nothing is dated earlier than the day it was kept');
  assert.equal(row.approvedBy, approvedRev.approvedBy ?? null, 'and its own approver');
  assert.ok(row.keptAt, 'who kept it and when are recorded apart');
  assert.ok(row.keptAt! >= row.approvedAt);
  const [s1] = await store.versionStates(ws.id, p.id);
  assert.equal(s1.approvedHasVersion, true);
  assert.equal(s1.latest?.keptAt, row.keptAt);

  // Kept once only, and no longer offered.
  assert.equal(await prepareApproval(store, p.id, ws.id, 'keep'), null);
  assert.deepEqual(await refusal(approvePrepared(store, p.id, prepared, null)), { status: 409, code: 'ALREADY_KEPT' });
});

test('"Keep it as it reads now" builds from the approved record, never from the working draft', async () => {
  const { store, ws, p } = await open();
  const draft = await store.startDraft(p.id);
  await store.savePatch(draft.revisionId, draft.seq, [{ op: 'replace', path: '/meta/name', value: 'Renamed in the working draft' }], 'user', 'Renamed');
  const prepared = (await prepareApproval(store, p.id, ws.id, 'keep'))!;
  assert.doesNotMatch(JSON.stringify(prepared.kept), /Renamed in the working draft/);
  const approve = (await prepareApproval(store, p.id, ws.id))!;
  assert.match(JSON.stringify(approve.kept), /Renamed in the working draft/, 'Approve keeps the draft, as before');
});

test('"Keep it as it reads now" after a newer approval without a copy needs a reason, and is refused when anything moved meanwhile', async () => {
  const { store, ws, p } = await open();
  await approve(store, ws.id, p.id, null);
  // A page opened before copies were kept approves a new draft with the old button: no copy of it is kept.
  const draft = await store.startDraft(p.id);
  const { seq } = await store.savePatch(draft.revisionId, draft.seq, [{ op: 'replace', path: '/meta/name', value: 'Approved the old way' }], 'user', 'Renamed');
  await store.approve(draft.revisionId, seq);
  const [st] = await store.versionStates(ws.id, p.id);
  assert.equal(st.latest?.number, 1);
  assert.equal(st.approvedHasVersion, false);

  const prepared = (await prepareApproval(store, p.id, ws.id, 'keep'))!;
  assert.equal(prepared.number, 2);
  assert.match(JSON.stringify(prepared.kept), /Approved the old way/);
  assert.deepEqual(await refusal(approvePrepared(store, p.id, prepared, null)), { status: 422, code: 'REASON_REQUIRED' });

  await store.saveDocumentEdit(p.id, makeEdit('brd', 's-1', '<p>Saved meanwhile.</p>', 'none'));
  assert.deepEqual(await refusal(approvePrepared(store, p.id, prepared, 'Kept as it reads now')), { status: 409, code: 'CHANGED_MEANWHILE' });
  const again = (await prepareApproval(store, p.id, ws.id, 'keep'))!;
  const send = { processId: p.id, expectedChanges: again.state.changesSeen, reason: 'Kept as it reads now', documents: again.kept, fingerprints: again.fingerprints, look: again.look, changes: again.changes, inputs: again.inputs };
  assert.deepEqual(await refusal(store.keepVersionAsReadsNow({ ...send, expectedVersion: 0 })), { status: 409, code: 'VERSION_CONFLICT' });
  assert.deepEqual((await store.listVersions(p.id)).map(v => v.number), [1], 'the refused keeps made nothing');
  assert.equal((await approvePrepared(store, p.id, again, 'Kept as it reads now')).number, 2);
  const [v2] = await store.listVersions(p.id);
  assert.equal(v2.reason, 'Kept as it reads now');
  assert.ok(v2.keptAt);
});
