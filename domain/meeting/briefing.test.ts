// Package C, pull request C1: the briefing before a call, by rules only, on the sample's hand-checked model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { deferQuestion, setPurpose } from '../processModel/patch.ts';
import { triage } from '../questions/triage.ts';
import { hasOrigin } from '../discovery/card.ts';
import { agendaText, arrange, buildBriefing, fits, itemHeading, moveItem, type Briefing, type BriefingInput } from './briefing.ts';
import { askedParts, coveringItem } from '../discovery/queue.ts';
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
    // A target, or (a plain question Discovery gives no card, as the sample's "How long does a non-PO invoice take
    // to handle?" on a figure with no id) the stored question it stands for, by key.
    assert.ok((x.card.target.kind === 'meta' ? x.card.target.field : x.card.target.id) || x.card.itemKey, `${x.card.key} has a target`);
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

test('"What do you want from this process?" is never on the list: it is the organisation\'s own choice', () => {
  for (const m of [gold, { ...structuredClone(gold), steps: [], flows: [], gateways: [], events: [] }]) {
    const b = brief(m, everyone, { minutes: 60 });
    assert.ok(![...b.forCall, ...b.ifTime, ...b.leftOut].some(x => x.card.key === 'start:purpose'));
    assert.ok(!agendaText(b).includes('What do you want from this process?'));
  }
});

test('with an assessment: what could change the recommendation first, then the conflicts, then the shape', () => {
  const b = brief(gold, everyone, { minutes: 60 });
  const groups = [...b.forCall, ...b.ifTime].map(x => x.card.group);
  assert.ok(assessProcess(gold).assessed > 0);
  assert.deepEqual(groups.slice(0, 2), ['decides', 'decides'], 'the SAP and ServiceNow interfaces open the list');
  const rank = { decides: 0, settles: 0, conflict: 1, start: 2, shape: 2, said: 3, input: 4, signoff: 5 } as const;
  assert.deepEqual(groups, [...groups].sort((a, b2) => rank[a] - rank[b2]));
  assert.ok(groups.indexOf('conflict') < groups.indexOf('shape'));
  // On a 30-minute call with the process owner and IT, both now fit, where Discovery's order put them 9th and 10th.
  const thirty = brief(gold, [{ kind: 'business' }, { kind: 'it' }]);
  assert.deepEqual(thirty.forCall.slice(0, 2).map(x => x.card.key), ['item:system:sys-sap', 'item:system:sys-servicenow']);
});

test('without an assessment the order stays Discovery\'s: the first cards, the shape, conflicts, then the rest', () => {
  const empty = { ...structuredClone(gold), steps: [], flows: [], gateways: [], events: [] };
  assert.equal(assessProcess(empty).assessed, 0);
  const b = brief(empty, everyone, { minutes: 60 });
  const groups = [...b.forCall, ...b.ifTime].map(x => x.card.group);
  const rank = { start: 0, shape: 1, conflict: 2, decides: 3, settles: 3, said: 4, input: 5, signoff: 6 } as const;
  assert.ok(groups.length > 0);
  assert.deepEqual(groups, [...groups].sort((a, b2) => rank[a] - rank[b2]));
  // Documented as it is: no assessment, so Discovery's order too.
  const asIs = setPurpose(gold, { value: 'as_is', by: null, at: '2026-11-26T10:00:00.000Z' }).model;
  const g2 = [...brief(asIs, everyone, { minutes: 60 }).forCall, ...brief(asIs, everyone, { minutes: 60 }).ifTime].map(x => x.card.group);
  assert.deepEqual(g2, [...g2].sort((a, b2) => rank[a] - rank[b2]));
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
  assert.equal(b.openLine, '2 could change the recommendation · 4 about the shape of the process · 2 where the sources disagree · 6 needed for sign-off');
  // "Needed for sign-off" in the header counts what the list labels so (review chat, 28 November 2026).
  const all = brief(gold, everyone, { minutes: 60 });
  const labelled = [...all.forCall, ...all.ifTime, ...all.leftOut].filter(x => itemHeading(x) === 'Needed for sign-off').length;
  assert.equal(all.openLine?.match(/(\d+) needed for sign-off/)?.[1], String(labelled));
  const untargetedLine = brief(untargeted(gold), everyone, { minutes: 60 });
  assert.equal(untargetedLine.openLine?.match(/(\d+) needed for sign-off/)?.[1], String([...untargetedLine.forCall, ...untargetedLine.ifTime].filter(x => itemHeading(x) === 'Needed for sign-off').length));
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

// Preview walk, 28 November 2026: a reading's questions about the process as a whole (target meta, no field) had no
// Discovery card, so with their owner on the call they were neither on the list nor under "Not for this call".
const untargeted = (m: ProcessModel): ProcessModel => ({
  ...m,
  openQuestions: [
    ...m.openQuestions,
    ...['Who signs off a supplier that is new to the business?', 'How are month-end cut-off invoices handled?', 'What happens to an invoice that arrives with no purchase order number?']
      .map((question, n) => ({ id: `q-u${n + 1}`, target: { kind: 'meta' as const }, question, whyItMatters: '', owner: null, status: 'open' as const })),
  ],
});

/** Every open item still asked appears once: on the list (for this call, if there is time, left out) or under "Not for this call". */
function coverage(m: ProcessModel, b: Briefing) {
  const t = triage(m, assessProcess(m));
  const parts = askedParts(m, t);
  const asked = new Set([...parts.items.map(x => x.key), ...parts.shape.map(c => coveringItem(c, t)?.key).filter((k): k is string => Boolean(k)), ...t.items.filter(x => x.deferred).map(x => x.key)]);
  const shown = [...[...b.forCall, ...b.ifTime, ...b.leftOut].map(x => coveringItem(x.card, t)?.key).filter((k): k is string => Boolean(k)), ...b.elsewhere.flatMap(g => g.items.map(x => x.key))];
  return { asked, shown };
}

test('every open question of a kind on the call is on the list; one with no card is a plain question, in the briefing\'s order', () => {
  const m = untargeted(gold);
  for (const people of [everyone, [{ kind: 'business' }], [{ kind: 'it' }], [{ kind: 'finance' }]] as Attendee[][]) {
    const b = brief(m, people, { minutes: 60, arranged: { order: [], leftOut: ['item:q-u2'] } });
    const { asked, shown } = coverage(m, b);
    assert.deepEqual([...shown].sort(), [...asked].sort(), `${people.map(p => p.kind).join('+')}: each open item once`);
    assert.equal(new Set(shown).size, shown.length, 'none twice');
  }
  const b = brief(m, [{ kind: 'business' }], { minutes: 60 });
  const plain = [...b.forCall, ...b.ifTime].filter(x => x.card.key.startsWith('item:q-u'));
  assert.equal(plain.length, 3);
  for (const x of plain) {
    assert.equal(x.card.answer, 'words');
    assert.deepEqual(x.card.target, { kind: 'meta' }, 'the stored question\'s own target');
    assert.ok(hasOrigin(x.card.origin));
  }
  // Not under "Not for this call" when their owner is on it.
  assert.ok(!b.elsewhere.some(g => g.items.some(i => i.key.startsWith('q-u'))));
  // In the briefing's order: what could change the recommendation first, the plain questions after it.
  const all = [...b.forCall, ...b.ifTime];
  const firstPlain = all.findIndex(x => x.card.key.startsWith('item:q-u'));
  assert.ok(all.slice(firstPlain).every(x => x.card.group !== 'decides' && x.card.group !== 'settles'));
  // Without their owner on the call they are under "Not for this call".
  const it = brief(m, [{ kind: 'it' }]);
  const askOwner = it.elsewhere.find(g => g.owner === 'business')!;
  assert.equal(askOwner.items.filter(i => i.key.startsWith('q-u')).length, 3);
});

test('the plain questions come from Discovery\'s queue: the briefing is what it was when it added them itself', async () => {
  const { addQuestion } = await import('../processModel/patch.ts');
  const { discoveryQueue, plainCard, triageCard } = await import('../discovery/queue.ts');
  const { ASSESSED_ORDER, hasAssessment, ownerOf } = await import('./briefing.ts');
  // The briefing's composition before the rule moved (package C, C3b): Discovery's cards, then the plain questions,
  // in Discovery's order of the groups, or the assessed order on a process that has an assessment.
  const DISCOVERY_ORDER = { start: 0, shape: 1, conflict: 2, decides: 3, settles: 3, said: 4, input: 5, signoff: 6 } as const;
  const before = (m: ProcessModel, attendees: Attendee[]) => {
    const a = assessProcess(m), t = triage(m, a);
    const plain = askedParts(m, t).items.filter(x => !triageCard(x, m)).map(x => plainCard(x, m)!).filter(Boolean);
    const cards = discoveryQueue({ model: m, assessment: a, asksPurpose: true, triage: t }).filter(c => !plain.some(p => p.key === c.key));
    const rank: Record<string, number> = hasAssessment(m, a) ? ASSESSED_ORDER : DISCOVERY_ORDER;
    const kinds = new Set(attendees.map(x => x.kind));
    return [...cards, ...plain].filter(c => c.key !== 'start:purpose').map((c, n) => ({ c, n })).sort((x, y) => rank[x.c.group]! - rank[y.c.group]! || x.n - y.n)
      .map(x => x.c).filter(c => kinds.has(ownerOf(c, t))).map(c => c.key);
  };
  let meta = gold;
  for (const q of ['Which system holds the vendor master today?', 'How are duplicate invoices noticed today?', 'What happens at month end?'])
    meta = addQuestion(meta, { target: { kind: 'meta' }, question: q, whyItMatters: 'w' }).model;
  const purposes = [setPurpose(meta, { value: 'assess', by: null, at: '2026-11-26T10:00:00.000Z' }).model, setPurpose(meta, { value: 'as_is', by: null, at: '2026-11-26T10:00:00.000Z' }).model];
  let plainSeen = 0;
  for (const m of [gold, meta, ...purposes]) for (const people of [everyone, [{ kind: 'business' } as Attendee], [{ kind: 'it' } as Attendee]]) {
    const b = brief(m, people, { minutes: 60 });
    assert.deepEqual(keys([...b.forCall, ...b.ifTime]), before(m, people));
    const t = triage(m, assessProcess(m));
    plainSeen += [...b.forCall, ...b.ifTime].filter(x => { const i = x.card.itemKey ? t.items.find(y => y.key === x.card.itemKey) : undefined; return i && !triageCard(i, m); }).length;
  }
  assert.ok(plainSeen > 0, 'the fixtures hold plain questions');
});
