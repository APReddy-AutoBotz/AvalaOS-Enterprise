import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedAnswerNote, approvedNote } from './approval.ts';

test('the Documents page never says an approved document is unchanged (F07)', () => {
  for (const line of [approvedNote(3), approvedAnswerNote(3)]) {
    assert.doesNotMatch(line, /unchanged|never change|final/i);
    assert.match(line, /revision 3/i);
  }
  assert.equal(approvedNote(2), 'Approved revision 2 of the process is kept exactly as approved. Its documents are rebuilt each time they are opened, so later section edits, choices and settings appear in them too. Approve this draft to make these changes the approved version.');
});
