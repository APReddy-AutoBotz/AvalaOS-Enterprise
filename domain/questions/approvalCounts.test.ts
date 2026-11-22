// Package 14, part L: the two numbers on the approval confirmation, for "assess", "decided" and "as it is".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { decideApproach, deferQuestion, setPurpose } from '../processModel/patch.ts';
import { GROUP_LABEL, groupLabel, triage } from './triage.ts';
import { approvalCounts, approvalCountsLine, SETTLES_DECIDED } from './approvalCounts.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));

test('assessing: the open questions that could change the recommendation, repeats merged, and those left with someone', () => {
  const a = assessProcess(gold);
  const decides = triage(gold, a).items.filter(i => i.group === 'decides');
  const c = approvalCounts(gold, a)!;
  assert.equal(c.group, GROUP_LABEL.decides);
  assert.equal(c.open, decides.filter(i => groupLabel(i) === GROUP_LABEL.decides).length);
  assert.ok(c.open > 0);
  assert.equal(c.leftWithSomeone, 0);
  // One of them left with a named person.
  const q = decides.find(i => i.questionIds.length)!;
  const m = deferQuestion(gold, { questionIds: q.questionIds, owner: 'Finance Controller' }).model;
  const after = approvalCounts(m, assessProcess(m))!;
  assert.equal(after.open, c.open);
  assert.equal(after.leftWithSomeone, 1);
  assert.equal(approvalCountsLine(after), `${c.open} open questions could change the recommendation; 1 of them is left with someone.`);
});

test('decided: the questions that settle the decided approach', () => {
  const m = decideApproach(gold, { approach: 'rpa', reason: 'RPA is the bank\'s chosen platform.', by: 'u1', at: '2026-11-21T10:00:00.000Z' }).model;
  const a = assessProcess(m);
  const c = approvalCounts(m, a)!;
  assert.equal(c.group, SETTLES_DECIDED);
  assert.equal(c.open, triage(m, a).items.filter(i => groupLabel(i) === SETTLES_DECIDED).length);
  assert.match(approvalCountsLine(c)!, c.open === 0 ? /^No open question settles the decided approach\.$/ : /settle|settles the decided approach; /);
});

test('documented as it is: nothing to count, and no line', () => {
  const m = setPurpose(gold, { value: 'as_is', by: 'u1', at: '2026-11-21T10:00:00.000Z' }).model;
  assert.equal(approvalCounts(m, assessProcess(m)), null);
  assert.equal(approvalCountsLine(null), null);
});

test('the line for one question and for none', () => {
  assert.equal(approvalCountsLine({ group: GROUP_LABEL.decides, open: 1, leftWithSomeone: 1 }), '1 open question could change the recommendation; it is left with someone.');
  assert.equal(approvalCountsLine({ group: GROUP_LABEL.decides, open: 1, leftWithSomeone: 0 }), '1 open question could change the recommendation; it is not left with anyone.');
  assert.equal(approvalCountsLine({ group: SETTLES_DECIDED, open: 2, leftWithSomeone: 0 }), '2 open questions settle the decided approach; 0 of them are left with someone.');
  assert.equal(approvalCountsLine({ group: GROUP_LABEL.decides, open: 0, leftWithSomeone: 0 }), 'No open question could change the recommendation.');
});
