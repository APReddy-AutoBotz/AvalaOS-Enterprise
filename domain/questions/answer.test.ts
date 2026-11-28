// "Someone else" on a role or application question (owner's walk, 28 November 2026; plan
// `claude/someone-else-plan-28-nov.md`): a name not in the process is added and the answer recorded in one edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { validateModel } from '../processModel/validate.ts';
import { triage, type TriageItem } from './triage.ts';
import { buildAnswer, namedChoice, namedRecordLine, SOMEONE_ELSE } from './answer.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const items = triage(gold, assessProcess(gold)).items;
const who = items.find(i => i.key === 'gap:step_without_role:step:s-match:roleIds')!;
const which = items.find(i => i.key === 'gap:step_without_system:step:s-check:systemIds')!;

test('Someone else: a new role is added, set on the step and the question closed, in one edit', () => {
  const a = { pick: SOMEONE_ELSE, named: { name: '  Accounts payable   lead ', kind: 'person_role' as const } };
  assert.equal(namedRecordLine(who, gold, a), 'This will record: Accounts payable lead does “Three-way match”. Accounts payable lead is added to the roles, as a role.');
  const built = buildAnswer(who, gold, a)!;
  const r = built.op(gold);
  const role = r.model.roles.find(x => x.name === 'Accounts payable lead')!;
  assert.deepEqual([role.kind, role.status, role.sources], ['person_role', 'user-confirmed', []]);
  assert.deepEqual(r.model.steps.find(s => s.id === 's-match')!.roleIds, [role.id]);
  const q = r.model.openQuestions.at(-1)!;
  assert.deepEqual([q.question, q.status, q.answer], ['Who does "Three-way match"?', 'answered', 'Accounts payable lead']);
  assert.ok(validateModel(r.model).valid);
  assert.match(built.summary, /role Accounts payable lead added/);
  // The kind chosen beside the name.
  assert.equal(buildAnswer(who, gold, { pick: SOMEONE_ELSE, named: { name: 'Shared services', kind: 'team' } })!.op(gold).model.roles.at(-1)!.kind, 'team');
  assert.match(namedRecordLine(who, gold, { pick: SOMEONE_ELSE, named: { name: 'Auditor', kind: 'external' } })!, /as an outside party\.$/);
});

test('Another application: added as "Other" with no way in recorded, set on the step; its way in is then asked about', () => {
  const a = { pick: SOMEONE_ELSE, named: { name: 'Coupa' } };
  assert.equal(namedRecordLine(which, gold, a), 'This will record: “Check mandatory fields” is done in Coupa. Coupa is added to the applications. How the automation reaches it is not recorded yet, so that is asked about.');
  const m = buildAnswer(which, gold, a)!.op(gold).model;
  const sys = m.systems.find(x => x.name === 'Coupa')!;
  assert.deepEqual([sys.kind, sys.access, sys.status], ['other', [], 'user-confirmed']);
  assert.deepEqual(m.steps.find(s => s.id === 's-check')!.systemIds, [sys.id]);
  assert.ok(validateModel(m).valid);
  assert.ok(triage(m, assessProcess(m)).items.some(i => i.target.kind === 'system' && i.target.id === sys.id), 'its way in is a question now');
});

test('a typed name already in the process is that one: nothing is added', () => {
  for (const name of ['ap clerk', 'AP-Clerk', ' AP  Clerk.']) {
    const a = { pick: SOMEONE_ELSE, named: { name } };
    assert.deepEqual(namedChoice(who, gold, a), { id: gold.roles.find(r => r.name === 'AP Clerk')!.id, name: 'AP Clerk', isNew: false });
    assert.equal(namedRecordLine(who, gold, a), 'This will record: AP Clerk does “Three-way match”.');
    const m = buildAnswer(who, gold, a)!.op(gold).model;
    assert.equal(m.roles.length, gold.roles.length);
  }
});

test('no name, or no pick, records nothing; a listed pick is as before', () => {
  for (const name of ['', '   ', '--']) assert.equal(buildAnswer(who, gold, { pick: SOMEONE_ELSE, named: { name } }), null);
  assert.equal(buildAnswer(who, gold, { pick: SOMEONE_ELSE }), null);
  assert.equal(buildAnswer(who, gold, {}), null);
  assert.equal(namedRecordLine(who, gold, {}), null);
  const clerk = gold.roles.find(r => r.name === 'AP Clerk')!;
  const m = buildAnswer(who, gold, { pick: clerk.id, text: 'Usually' })!.op(gold).model;
  assert.deepEqual(m.steps.find(s => s.id === 's-match')!.roleIds, [clerk.id]);
  assert.equal(m.openQuestions.at(-1)!.answer, 'AP Clerk. Usually');
});

test('a new role as the handler of an exception', () => {
  const exc = gold.exceptions[0]!;
  const item: TriageItem = { ...who, key: 'test:exception', kind: 'role', target: { kind: 'exception', id: exc.id }, question: `Who handles "${exc.name}"?`, questionIds: [] };
  const a = { pick: SOMEONE_ELSE, named: { name: 'Supplier desk', kind: 'team' as const } };
  assert.equal(namedRecordLine(item, gold, a), `This will record: Supplier desk handles “${exc.name}”. Supplier desk is added to the roles, as a team.`);
  const m = buildAnswer(item, gold, a)!.op(gold).model;
  assert.equal(m.exceptions.find(e => e.id === exc.id)!.routedToRoleId, m.roles.find(r => r.name === 'Supplier desk')!.id);
});

test('Discovery\'s card saves "Someone else" through chooseEdit, with the person\'s words kept in the answer', async () => {
  const { chooseEdit } = await import('../discovery/flow.ts');
  const { makeCard } = await import('../discovery/card.ts');
  const card = makeCard({ key: who.key, group: 'signoff', origin: { kind: 'gap', gap: 'No role recorded.' }, question: who.question, why: '', target: who.target, updates: ['The step'], answer: 'words', itemKey: who.key })!;
  const e = chooseEdit(card, gold, SOMEONE_ELSE, { me: null, name: 'Asha', at: '2026-11-28T08:00:00.000Z', item: who, named: { name: 'Matching desk', kind: 'team' }, words: 'The matching desk in Pune does that.' })!;
  const m = e.op(gold).model;
  const role = m.roles.find(r => r.name === 'Matching desk')!;
  assert.equal(role.kind, 'team');
  assert.deepEqual(m.steps.find(s => s.id === 's-match')!.roleIds, [role.id]);
  assert.equal(m.openQuestions.at(-1)!.answer, 'Matching desk (in their words: "The matching desk in Pune does that.")');
});
