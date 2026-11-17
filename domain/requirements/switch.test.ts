import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { decideApproach, removeDecidedApproach, setPurpose } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from './derive.ts';
import { reconcile, type StoredRequirement } from './register.ts';
import { requirementsOnSwitch } from './switch.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const AT = '2026-11-17T06:00:00Z';
const d = emptyDecisions();
/** What Documents saves when it opens: the list re-derived for this model. */
const opened = (m: ProcessModel, stored: StoredRequirement[]) => reconcile(deriveRequirements(m, assessProcess(m, { decisions: d })), stored).requirements;
const apply = (stored: StoredRequirement[], rows: StoredRequirement[] | null) => {
  const by = new Map(stored.map(r => [r.code, r]));
  for (const r of rows ?? []) by.set(r.code, r);
  return [...by.values()];
};
const removed = (rs: StoredRequirement[]) => rs.filter(r => r.state === 'source_removed').map(r => r.code);

test('decided, Documents opened, the decision removed: the switch brings every requirement back at once', () => {
  const assessed = gold();
  const start = opened(assessed, []);
  assert.deepEqual(removed(start), []);
  const decided = decideApproach(assessed, { approach: 'rpa', reason: 'One platform', by: 'u1', at: AT }).model;
  // The switch itself re-derives; Documents opened while decided saves the same list.
  const whileDecided = apply(start, requirementsOnSwitch(assessed, decided, d, start));
  assert.ok(removed(whileDecided).length > 0, 'steps RPA cannot do lose their requirement while decided');
  assert.deepEqual(removed(opened(decided, whileDecided)), removed(whileDecided));
  const back = removeDecidedApproach(decided, { by: 'u1', at: AT }).model;
  const after = apply(whileDecided, requirementsOnSwitch(decided, back, d, whileDecided));
  assert.deepEqual(removed(after), [], 'nothing is left "source removed" for Work items, the evidence pack, Ask Avala or the board');
  assert.deepEqual(after.map(r => [r.code, r.state]).sort(), start.map(r => [r.code, r.state]).sort());
});

test('a switch to or from "Document it as it is" leaves the stored requirements exactly as they are, both ways', () => {
  const assessed = gold();
  const stored = opened(assessed, []);
  const asIs = setPurpose(assessed, { value: 'as_is', by: 'u1', at: AT }).model;
  assert.equal(requirementsOnSwitch(assessed, asIs, d, stored), null);
  assert.equal(requirementsOnSwitch(asIs, assessed, d, stored), null);
  const decided = decideApproach(assessed, { approach: 'api', reason: 'APIs only', by: 'u1', at: AT }).model;
  const decidedList = apply(stored, requirementsOnSwitch(assessed, decided, d, stored));
  const decidedAsIs = setPurpose(decided, { value: 'as_is', by: 'u1', at: AT }).model;
  assert.equal(requirementsOnSwitch(decided, decidedAsIs, d, decidedList), null);
  assert.equal(requirementsOnSwitch(decidedAsIs, decided, d, decidedList), null);
});

test('nothing to save when nothing that decides a step changed', () => {
  const m = gold();
  const stored = opened(m, []);
  assert.equal(requirementsOnSwitch(m, setPurpose(m, { value: 'assess', by: 'u1', at: AT }).model, d, stored), null);
  const a = decideApproach(m, { approach: 'rpa', reason: 'x', by: 'u1', at: AT }).model;
  const b = decideApproach(a, { approach: 'rpa', reason: 'a better reason', by: 'u1', at: AT }).model;
  assert.equal(requirementsOnSwitch(a, b, d, stored), null);
  const c = decideApproach(a, { approach: 'api', reason: 'x', by: 'u1', at: AT }).model;
  assert.notEqual(requirementsOnSwitch(a, c, d, opened(a, stored)), null);
});
