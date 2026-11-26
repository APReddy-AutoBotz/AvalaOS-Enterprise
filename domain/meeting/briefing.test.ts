// Package C, pull request C1: the briefing before a call, by rules only, on the sample's hand-checked model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { deferQuestion, setPurpose } from '../processModel/patch.ts';
import { triage } from '../questions/triage.ts';
import { hasOrigin } from '../discovery/card.ts';
import { agendaText, arrange, buildBriefing, fits, itemHeading, moveItem, type BriefingInput } from './briefing.ts';
import type { Attendee } from './kept.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const brief = (m: ProcessModel, attendees: Attendee[], extra: Partial<BriefingInput> = {}) =>
  buildBriefing({ model: m, assessment: assessProcess(m), asksPurpose: true, attendees, minutes: 30, sources: 6, ...extra });
const everyone: Attendee[] = [{ kind: 'business', name: 'Priya' }, { kind: 'it', name: 'Ravi' }, { kind: 'finance' }];
const keys = (xs: { card: { key: string } }[]) => xs.map(x => x.card.key);

test('fitting the list to the call: 5 minutes of opening, then 3 minutes a question', () => {
  assert.deepEqual([fits(30), fits(45), fits(60)], [8, 13, 18]);
  for (const minutes of [30, 45, 60] as const) assert.equal(brief(gold, everyone, { minutes }).forCall.length, Math.min(fits(minutes), brief(gold, everyone, { minutes: 60 }).forCall.length + brief(gold, everyone, { minutes: 60 }).ifTime.length));
});

test('the same record, the same people and the same length give the same briefing', () => {
  assert.deepEqual(brief(gold, everyone), brief(gold, everyone));
  assert.deepEqual(brief(structuredClone(gold), structuredClone(everyone)), brief(gold, everyone));
});

test('every line says where it came from and has a target', () => {
  const b = brief(gold, everyone, { minutes: 60 });
  for (const x of [...b.forCall, ...b.ifTime]) {
    assert.ok(hasOrigin(x.card.origin), `${x.card.key} says where it came from`);
    assert.ok(x.card.target.kind === 'meta' ? x.card.target.field : x.card.target.id, `${x.card.key} has a target`);
    assert.ok(itemHeading(x).length > 0);
  }
});

test('only the kinds of person on the call; everyone else\'s questions under "Not for this call"', () => {
  const it = brief(gold, [{ kind: 'it' }]);
  assert.ok(it.forCall.length > 0);
  assert.ok([...it.forCall, ...it.ifTime].every(x => x.owner === 'it'));
  assert.ok(keys(it.forCall).includes('item:system:sys-sap'), 'the SAP interfaces are asked of IT');
  assert.ok(it.elsewhere.some(g => g.owner === 'business') && it.elsewhere.every(g => g.owner !== 'it'));
  const business = brief(gold, [{ kind: 'business', name: 'Priya' }]);
  assert.ok([...business.forCall, ...business.ifTime].every(x => x.owner === 'business' && x.name === 'Priya'));
  assert.ok(business.elsewhere.some(g => g.owner === 'it'));
  assert.deepEqual(brief(gold, everyone).elsewhere, [], 'with everyone on the call, nothing is for someone else');
});

test('the order is the Discovery order: the first cards, the shape, conflicts, then what could change the recommendation', () => {
  const b = brief(gold, everyone, { minutes: 60 });
  const groups = [...b.forCall, ...b.ifTime].map(x => x.card.group);
  const rank = { start: 0, shape: 1, conflict: 2, decides: 3, settles: 3, said: 4, input: 5, signoff: 6 } as const;
  assert.deepEqual(groups, [...groups].sort((a, b2) => rank[a] - rank[b2]));
});

test('a question left with a person who is on the call comes first, and says so', () => {
  const t = triage(gold, assessProcess(gold));
  const item = t.items.find(i => i.key === 'q-gl-coding')!;
  const m = deferQuestion(gold, { questionIds: item.questionIds, owner: 'priya' }).model;
  const b = brief(m, everyone);
  assert.equal(b.forCall[0]!.leftWith, 'priya');
  assert.equal(b.forCall[0]!.card.question, item.question);
  // Left with someone not on the call, it is for someone else.
  const other = deferQuestion(gold, { questionIds: item.questionIds, owner: 'Meera' }).model;
  const b2 = brief(other, everyone);
  assert.ok(!keys([...b2.forCall, ...b2.ifTime]).includes(`item:${item.key}`));
  assert.ok(b2.elsewhere.some(g => g.items.some(i => i.leftWith === 'Meera')));
});

test('the analyst\'s own questions, moves and left out', () => {
  const own = [{ key: 'o1', question: 'Who signs off a new vendor?' }];
  const b = brief(gold, everyone, { own });
  assert.equal(b.forCall[0]!.own, true);
  assert.equal(itemHeading(b.forCall[0]!), 'Your own question');
  assert.ok(hasOrigin(b.forCall[0]!.card.origin));
  const shown = keys([...b.forCall, ...b.ifTime]);
  const order = moveItem(shown, shown[3]!, -1);
  assert.equal(order[2], shown[3]);
  assert.deepEqual(moveItem(shown, shown[0]!, -1), shown, 'the first cannot move up');
  const moved = brief(gold, everyone, { own, arranged: { order, leftOut: [shown[1]!] } });
  assert.deepEqual(keys(moved.leftOut), [shown[1]]);
  assert.ok(!keys([...moved.forCall, ...moved.ifTime]).includes(shown[1]!));
  assert.equal(keys(moved.forCall)[1], shown[3], 'moved up, and the left-out one is gone');
  // Something new in the record goes after the analyst's order.
  const { kept } = arrange([{ card: { key: 'new' } }, { card: { key: 'b' } }, { card: { key: 'a' } }] as never, { order: ['a', 'b'], leftOut: [] });
  assert.deepEqual(keys(kept), ['a', 'b', 'new']);
});

test('where the process stands, and what is open', () => {
  const b = brief(gold, everyone, { waitingInDiscovery: 2 });
  assert.deepEqual(b.standing, ['21 steps, 10 roles and 7 applications, from 6 sources.', 'Assessed: API-led integration.', '2 answers from Discovery are waiting for the draft.']);
  assert.equal(b.openLine, '2 could change the recommendation · 4 about the shape of the process · 2 where the sources disagree · 7 needed for sign-off');
  const empty = brief({ ...structuredClone(gold), steps: [], flows: [], gateways: [], events: [] }, everyone);
  assert.equal(empty.standing[0], 'No steps yet: the call starts with the shape of the process.');
  const asIs = setPurpose(gold, { value: 'as_is', by: null, at: '2026-11-26T10:00:00.000Z' }).model;
  const ai = brief(asIs, everyone, { minutes: 60 });
  assert.equal(ai.standing[1], 'Documented as it is: no assessment.');
  assert.ok(![...ai.forCall, ...ai.ifTime].some(x => x.card.group === 'input' || x.card.group === 'decides'), 'nothing that only serves an assessment');
});

test('"Copy the agenda" holds the numbered questions only', () => {
  const b = brief(gold, everyone);
  const text = agendaText(b);
  const lines = text.split('\n');
  assert.equal(lines[0], `1. ${b.forCall[0]!.card.question}`);
  assert.ok(lines.includes('If there is time:'));
  assert.equal(lines.filter(l => /^\d+\. /.test(l)).length, b.forCall.length + b.ifTime.length);
  assert.ok(!/Why it matters|Missing:|You said|Changes the recommendation|item:|gap:/.test(text));
});
