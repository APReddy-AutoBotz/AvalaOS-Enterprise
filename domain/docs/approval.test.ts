import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedAnswerNote, approvedNote } from './approval.ts';

test('the Documents page never says an approved document is unchanged (F07)', () => {
  for (const line of [approvedNote(3), approvedAnswerNote(3)]) {
    assert.doesNotMatch(line, /unchanged|never change|final/i);
    assert.match(line, /Revision 3/);
  }
  assert.match(approvedNote(2), /section edits, choices and settings show in them/);
});
