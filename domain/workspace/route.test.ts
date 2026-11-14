import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyPath, parseJourneyPath, revisionStatus, STAGES } from './route.ts';

const ID = '6f1c2b8e-4a3d-4e5f-9a1b-2c3d4e5f6a7b';

test('journey paths parse and format both ways; other paths belong to the rest of the app', () => {
  for (const s of STAGES) {
    const r = parseJourneyPath(`/process/${ID}/${s.id}`);
    assert.deepEqual(r, { page: 'process', processId: ID, stage: s.id });
    assert.equal(journeyPath(r!), `/process/${ID}/${s.id}`);
  }
  assert.deepEqual(parseJourneyPath(`/process/${ID}`), { page: 'process', processId: ID, stage: 'sources' });
  assert.deepEqual(parseJourneyPath('/processes/'), { page: 'processes' });
  assert.deepEqual(parseJourneyPath('/signin'), { page: 'signin' });
  assert.deepEqual(parseJourneyPath('/reset-password'), { page: 'reset-password' });
  assert.equal(journeyPath({ page: 'reset-password' }), '/reset-password');
  assert.deepEqual(parseJourneyPath('/work/'), { page: 'work' });
  assert.deepEqual(parseJourneyPath('/settings'), { page: 'settings', section: 'people' });
  assert.deepEqual(parseJourneyPath('/settings/ai/'), { page: 'settings', section: 'ai' });
  assert.equal(journeyPath({ page: 'settings', section: 'parts' }), '/settings/parts');
  assert.equal(parseJourneyPath('/settings/billing'), null);
  assert.equal(journeyPath({ page: 'work' }), '/work');
  for (const other of ['/', '/catalog', `/process/${ID}/v2`, '/process/not-a-uuid/sources', `/process/${ID}/sources/extra`, '/processes/x']) {
    assert.equal(parseJourneyPath(other), null, other);
  }
});

test('there is exactly one assessment stage', () => {
  assert.equal(STAGES.filter(s => /assess/i.test(s.id + s.label)).length, 1);
});

test('revision status covers every combination', () => {
  assert.deepEqual(revisionStatus([]), { label: 'Not started', tone: 'neutral' });
  assert.deepEqual(revisionStatus([{ revNo: 1, state: 'working', seq: 4 }]), { label: 'Working draft', tone: 'draft' });
  assert.deepEqual(revisionStatus([{ revNo: 1, state: 'approved', seq: 4 }]), { label: 'Approved revision 1', tone: 'approved' });
  assert.deepEqual(revisionStatus([{ revNo: 3, state: 'approved', seq: 9 }, { revNo: 4, state: 'working', seq: 0 }, { revNo: 2, state: 'superseded', seq: 1 }]), { label: 'Approved revision 3', tone: 'approved' });
  assert.deepEqual(revisionStatus([{ revNo: 3, state: 'approved', seq: 9 }, { revNo: 4, state: 'working', seq: 2 }]), { label: 'Approved revision 3 · unapproved changes', tone: 'changed' });
  for (const s of [revisionStatus([{ revNo: 7, state: 'working', seq: 12 }]), revisionStatus([{ revNo: 2, state: 'approved', seq: 12 }])]) {
    assert.doesNotMatch(s.label, /12|seq|hash|schema|v\d/i, 'edit counts and internal versions stay out of the header');
  }
});

test('board routes: /board, /board/:project and /board/:project/:item', () => {
  const id = '3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6', it = '0a1b2c3d-1111-4222-8333-444455556666';
  assert.deepEqual(parseJourneyPath('/board'), { page: 'board' });
  assert.deepEqual(parseJourneyPath(`/board/${id}`), { page: 'board', projectId: id });
  assert.deepEqual(parseJourneyPath(`/board/${id}/${it}`), { page: 'board', projectId: id, itemId: it });
  assert.equal(parseJourneyPath('/board/not-a-uuid'), null);
  assert.equal(journeyPath({ page: 'board', projectId: id, itemId: it }), `/board/${id}/${it}`);
});
