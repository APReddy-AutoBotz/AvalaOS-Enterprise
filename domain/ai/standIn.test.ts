// The browser tests' stand-in for AI tasks (package 16): answers by task name, never source passages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { answerFromNotes, notesSegments } from '../questions/notes.ts';
import { sourceSegments } from '../assistant/suggest.ts';
import { standInReading, standInRefusal, standInReply, standInTranscript } from './standIn.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const items = triage(gold, assessProcess(gold)).items.slice(0, 3);
const replies = { [answerFromNotes.id]: [{ answers: [] }, { answers: [{ questionId: '1' }] }] };

test('a person\'s notes are answered by the task\'s reply, in order, the last one repeating', () => {
  const { segments } = notesSegments(gold, items, 'SAP can be used.\n\nServiceNow too.');
  assert.equal(standInRefusal(replies, answerFromNotes.id, segments), null);
  const used: Record<string, number> = {};
  assert.deepEqual(standInReply(replies, used, answerFromNotes.id), { answers: [] });
  assert.deepEqual(standInReply(replies, used, answerFromNotes.id), { answers: [{ questionId: '1' }] });
  assert.deepEqual(standInReply(replies, used, answerFromNotes.id), { answers: [{ questionId: '1' }] });
  assert.equal(used[answerFromNotes.id], 3);
  // A copy each time: a screen changing a reply does not change the next one.
  const a = standInReply(replies, {}, answerFromNotes.id) as { answers: unknown[] };
  a.answers.push('x');
  assert.deepEqual(replies[answerFromNotes.id]![0], { answers: [] });
});

test('the automatic look in the sources asks the same task with passages of a source: refused', () => {
  const passages = [{ sourceKey: 'call-1', sourceTitle: 'Call 1', locator: { lineStart: 4 }, text: 'We raise incidents in ServiceNow through its REST API and post invoices in SAP.' }];
  const { segments } = sourceSegments(gold, items, passages as never);
  assert.ok(segments.some(s => s.sourceId === 'call-1'));
  assert.match(standInRefusal(replies, answerFromNotes.id, segments)!, /only what a person said, not passages of call-1/);
});

test('a task the test gave no reply for is refused', () => {
  assert.match(standInRefusal(replies, 'askProcess', [{ id: 'question', text: 'Why RPA?' }])!, /no reply for askProcess/);
  assert.match(standInRefusal({ askProcess: [] }, 'askProcess', [{ id: 'question', text: 'Why RPA?' }])!, /no reply for askProcess/);
  // Only a test's own key counts, never one an object inherits.
  assert.match(standInRefusal(replies, 'toString', [])!, /no reply for toString/);
});

// Package B, pull request 4a (24 November 2026): a recording in a browser test is heard as the words the test gave.
test('a recording is heard as the words the test gave, in order, and only when it gave some', () => {
  const used: Record<string, number> = {};
  assert.deepEqual(standInTranscript({ transcribe: ['Through its screens.', 'With a service account.'] }, used), { text: 'Through its screens.' });
  assert.deepEqual(standInTranscript({ transcribe: ['Through its screens.', 'With a service account.'] }, used), { text: 'With a service account.' });
  assert.deepEqual(standInTranscript({ answerFromNotes: [{ answers: [] }] }, {}), { refused: 'The stand-in has no words for a recording.' });
  assert.deepEqual(standInTranscript({ transcribe: [{ not: 'words' }] }, {}), { refused: 'The stand-in has no words for a recording.' });
});

// Package B, pull request 4b (24 November 2026): a reading in a browser test gives the model the test gave.
test('a reading gives the model the test gave, and only when it gave one', () => {
  const used: Record<string, number> = {};
  assert.deepEqual(standInReading({ extraction: [{ steps: [] }] }, used), { model: { steps: [] } });
  assert.deepEqual(standInReading({ answerFromNotes: [{ answers: [] }] }, {}), { refused: 'The stand-in has no reading.' });
  // The AI tasks' rule is unchanged: a call carrying a source's passages is still not answered.
  assert.match(standInRefusal({ answerFromNotes: [{ answers: [] }] }, 'answerFromNotes', [{ id: 's1', sourceId: 'sop', text: 'x' } as never])!, /not passages of sop/);
});

test('noticing (5b) reads a person\'s own words kept as sources; every other task and source is still refused', () => {
  const replies = { discoveryQuestions: [{ questions: [], wanted: [] }], answerFromNotes: [{ answers: [] }] };
  const own = [{ id: 'n:1', text: 'We check invoices.', sourceId: 'own-1' }, { id: 'n:2', text: 'Filed.', sourceId: 'ans-2' }];
  assert.equal(standInRefusal(replies, 'discoveryQuestions', own), null);
  assert.match(standInRefusal(replies, 'answerFromNotes', own)!, /not passages of own-1, ans-2/);
  assert.match(standInRefusal(replies, 'discoveryQuestions', [{ id: 's:1', text: 'SOP text', sourceId: 'sop-1' }])!, /not passages of sop-1/);
});
