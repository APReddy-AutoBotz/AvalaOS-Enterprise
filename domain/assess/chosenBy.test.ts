// Who made a choice, by name (docs/next-plan.md, section 3d, package 10, item 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFromEntries, decisionsToEntries, emptyDecisions, whoChose, withMapShape, withOverride } from './decisions.ts';
import { resolveConflict } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';

const names = { 'u-asha': 'Asha Rao' };

test('who chose: the profile name by id; else the name stored with it; "Not recorded" only for an email address or nothing', () => {
  assert.equal(whoChose({ by: 'Asha R.', byId: 'u-asha' }, names), 'Asha Rao');
  // The person left the workspace, or the released site saved the entry back without the id: the stored name.
  assert.equal(whoChose({ by: 'Asha R.', byId: 'u-gone' }, names), 'Asha R.');
  assert.equal(whoChose({ by: 'Asha R.' }, names), 'Asha R.');
  // Before 17 November 2026 an email address was stored: never printed.
  assert.equal(whoChose({ by: 'asha@example.com' }, names), 'Not recorded');
  assert.equal(whoChose({ by: '' }, names), 'Not recorded');
  assert.equal(whoChose(null, names), 'Not recorded');
  // An entry from the line at the top of Documents held the id itself.
  assert.equal(whoChose({ by: 'u-asha' }, names), 'Asha Rao');
  assert.equal(whoChose({ by: '0b5f3c1e-1d2a-4f3b-9c8d-7e6f5a4b3c2d' }, names), 'Not recorded');
});

test('a choice of approach and of the map shape keep the id beside the name, read back and written back', () => {
  const step = { stepId: 's1', recommended: undefined, winner: 'rpa' } as never;
  let d = withOverride(emptyDecisions(), step, { approach: 'human', rationale: 'Needs judgment', by: 'Asha Rao', byId: 'u-asha', at: '2026-11-17T10:00:00Z' });
  d = withMapShape(d, { shape: 'simple', suggested: 'swimlanes', by: 'Asha Rao', byId: 'u-asha', at: '2026-11-17T10:00:00Z' });
  const back = decisionsFromEntries(JSON.parse(JSON.stringify(decisionsToEntries(d))));
  assert.equal(back.overrides.s1!.byId, 'u-asha');
  assert.equal(back.overrides.s1!.by, 'Asha Rao');
  assert.equal(back.map!.byId, 'u-asha');
  // An older entry with no id reads as it did.
  const old = decisionsFromEntries([{ kind: 'step', stepId: 's2', approach: 'rpa', rationale: 'x', by: 'a@b.c', at: 'x' }]);
  assert.equal('byId' in old.overrides.s2!, false);
});

test('a resolved conflict keeps the id beside the name, and the record stays valid', () => {
  const m: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
  const c = m.conflicts[0]!;
  const r = resolveConflict(m, { conflictId: c.id, chosen: c.values[0]!.value, by: 'Asha Rao', byId: 'u-asha', reason: 'Asked the owner' });
  const res = r.model.conflicts.find(x => x.id === c.id)!.resolution!;
  assert.deepEqual([res.by, res.byId], ['Asha Rao', 'u-asha']);
  assert.equal(validateModel(r.model).valid, true);
});
