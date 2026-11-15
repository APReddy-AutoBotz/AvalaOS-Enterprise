import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentRights, openCommentsText, reviewOf, ReviewError, validateSectionComment, type SectionComment } from './review.ts';

const c = (over: Partial<SectionComment>): SectionComment => ({ id: 'c', docType: 'pdd', sectionKey: 's-1', sectionTitle: 'Introduction', authorId: 'u1', body: 'x', createdAt: '2026-11-15T10:00:00Z', editedAt: null, resolvedAt: null, resolvedBy: null, ...over });
const doc = { type: 'pdd' as const, sections: [{ id: 's-1', number: '1', title: 'Introduction', level: 1 as const, blocks: [] }, { id: 's-2', number: '2', title: 'As-Is', level: 1 as const, blocks: [] }] };

test('comments are placed by section, a gone section keeps its comments apart, and other documents are left out', () => {
  const v = reviewOf(doc, [c({ id: 'a', createdAt: '2026-11-15T11:00:00Z' }), c({ id: 'b' }), c({ id: 'r', sectionKey: 's-2', resolvedAt: 'x' }), c({ id: 'o', sectionKey: 's-9' }), c({ id: 'f', docType: 'frd' })]);
  assert.deepEqual(v.bySection.get('s-1')!.map(x => x.id), ['b', 'a'], 'oldest first');
  assert.deepEqual(v.orphaned.map(x => x.id), ['o']);
  assert.equal(v.open, 3);
  assert.equal(v.resolved, 1);
  assert.equal(openCommentsText(v.open), '3 open comments');
  assert.equal(openCommentsText(0), null);
});

test('who may do what: the author edits; the author or an editor resolves; the author or an admin deletes', () => {
  assert.deepEqual(commentRights(c({}), { id: 'u1', canEdit: false, isAdmin: false }), { edit: true, resolve: true, remove: true });
  assert.deepEqual(commentRights(c({}), { id: 'u2', canEdit: true, isAdmin: false }), { edit: false, resolve: true, remove: false });
  assert.deepEqual(commentRights(c({}), { id: 'u3', canEdit: false, isAdmin: false }), { edit: false, resolve: false, remove: false });
  assert.deepEqual(commentRights(c({}), { id: 'u4', canEdit: true, isAdmin: true }), { edit: false, resolve: true, remove: true });
  assert.deepEqual(commentRights(c({ authorId: null }), { id: '', canEdit: false, isAdmin: false }), { edit: false, resolve: false, remove: false });
});

test('a comment needs text and stays under the limit', () => {
  assert.equal(validateSectionComment('  Step 4 misses the call-back.  '), 'Step 4 misses the call-back.');
  assert.throws(() => validateSectionComment('   '), ReviewError);
  assert.throws(() => validateSectionComment('x'.repeat(10001)), ReviewError);
});
