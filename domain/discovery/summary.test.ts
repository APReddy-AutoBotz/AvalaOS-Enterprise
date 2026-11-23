// Package B, pull request 1: where a session stands, and its closing summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { assessProcess } from '../assess/process.ts';
import { deferQuestion, keepWanted, setPurpose } from '../processModel/patch.ts';
import { deciding, sessionDone, sessionSummary } from './summary.ts';
import { shapeCards } from './checklist.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';

test('a session ends when the shape is settled and nothing that decides is open, answered or left with someone', () => {
  const a = assessProcess(gold);
  assert.ok(deciding(gold, a) > 0);
  assert.equal(sessionDone(gold, a), false);
  // Every decisive question left with someone, and the shape settled: done.
  const decisive = ['q-gr-api', 'q-invoice-api', 'q-attach-api', 'q-servicenow'];
  let m = deferQuestion(gold, { questionIds: decisive, owner: 'IT' }).model;
  assert.equal(deciding(m, assessProcess(m)), 1, 'the scanner, a question found by rule, is still open');
  assert.equal(sessionDone(emptyModel('x'), assessProcess(emptyModel('x'))), false, 'nothing known about its shape');
  // Documented as it is: nothing decides; it ends when the shape is settled.
  const asIs = setPurpose(gold, { value: 'as_is', by: 'u1', at }).model;
  assert.equal(deciding(asIs, assessProcess(asIs)), 0);
  assert.equal(sessionDone(asIs, assessProcess(asIs)), shapeCards(asIs).length === 0);
  m = keepWanted(m, { statement: 'Invoices should be read automatically.' }).model;
  const s = sessionSummary(m, assessProcess(m), 4);
  assert.equal(s.line, `Recorded: 4 answers. What you want to change: 1. Conflicts to resolve: ${gold.conflicts.filter(c => !c.resolution).length}. Still open: ${s.open}.`);
  assert.match(s.closing, /^You stopped with \d+ questions? still to ask\. Carry on whenever you like\.$/);
  assert.equal(sessionSummary(m, assessProcess(m), 1).line.startsWith('Recorded: 1 answer.'), true);
});
