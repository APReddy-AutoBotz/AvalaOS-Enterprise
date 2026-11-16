import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addQuestion, deferQuestion } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { sameQuestion, triage } from './triage.ts';
import { askingOrder, blocksDocument, FIRST_LIST, holdReason, nowHeading, planQuestions, planSummary, questionsTabCount, weightOf } from './firstList.ts';
import { openItemCount } from '../processModel/selectors.ts';
import { buildPacks } from './packs.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const src = [{ sourceId: 'call-1', locator: {}, excerpt: 'q' }];

/**
 * The shape the owner's first real documents gave (15 November 2026), on the sample's facts: many
 * questions in free words from the merge, several of them restating what a structured question asks
 * (an application's access, a figure, who handles a case), two wordings of the same question, every
 * application's interfaces asked one by one, and a "who does this step" for steps with no role.
 */
function realShape(): ProcessModel {
  let m = gold();
  const sap = m.systems.find(s => /SAP/.test(s.name))!;
  m.systems = m.systems.map(s => s.id !== sap.id ? s : { ...s, access: [...s.access, ...['MIRO', 'FB60', 'ME23N', 'Customizing tables'].map(name => ({ method: 'ui' as const, name, operations: ['read'], access: 'unknown' as const, status: 'stated' as const, sources: src }))] });
  for (const name of ['MIRO', 'FB60', 'ME23N', 'Customizing tables']) m = addQuestion(m, { target: { kind: 'system', id: sap.id, field: 'access' }, question: `Is ${name} available for use from SAP, and when?` }).model;
  const free = [
    'What are the permitted access methods for SAP configuration information?',          // covered by the SAP question
    'What are the confirmed access statuses for the SAP APIs and the backup interfaces?', // covered by the SAP question
    'What are the concrete handling-time values for the small and large invoices?',     // covered by a figure question
    'Who handles invoices flagged for clarification when no routed owner is specified?',  // covered by an exception question
    'Is the S/4 attachment API active in this landscape?',
    'Is the S/4 attachment API active in this landscape yet?',                           // a second wording: merged
    'Which OCR tool will read the scanned invoices?',
    'Is the OCR tool able to read handwritten invoices?',                                // near the one above: waits
    'What is the monthly volume of PO invoices?',
    'What is the monthly volume of non-PO invoices?',                                   // not the same question
    'Is the SAP system test client refreshed before each release?',
    'Which integration platform is used for the vendor master?',
    'Is the GRN system able to expose receipts?',
    'Can the IT team enable a technical user in SAP?',
    'Is the price tolerance in SAP the same as in the AP policy?',
    'Who should validate the proposed answers?',
    'Should the chatbot answers include source links?',
    'What is the final plan for the first pilot?',
  ];
  for (const q of free) m = addQuestion(m, { target: { kind: 'meta' }, question: q }).model;
  m.steps = m.steps.map((s, i) => (i % 3 === 0 ? { ...s, roleIds: [] } : s));
  return m;
}

test('the same question in two wordings is merged; a question with "non" or another number is not', () => {
  assert.equal(sameQuestion('Is the S/4 attachment API active in this landscape?', 'Is the S/4 attachment API active in this landscape yet?'), true);
  assert.equal(sameQuestion('What is the monthly volume of PO invoices?', 'What is the monthly volume of non-PO invoices?'), false);
  assert.equal(sameQuestion('Is approval needed above 50,000?', 'Is approval needed above 75,000?'), false);
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const api = t.items.find(i => /attachment API/.test(i.question))!;
  assert.equal(api.questionIds.length, 2);
  assert.deepEqual(api.also, ['Is the S/4 attachment API active in this landscape yet?']);
  assert.equal(t.items.filter(i => /monthly volume of/.test(i.question)).length, 2);
});

test('the first list holds at most the cap, only questions that change the recommendation or block a document, most decisive first', () => {
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const p = planQuestions(t, m);
  assert.ok(t.items.length > 20, `${t.items.length} questions listed by triage`);
  assert.ok(p.now.length <= FIRST_LIST.cap && p.now.length > 0, `${p.now.length} in the first list`);
  for (const i of p.now) assert.ok(i.group === 'decides' || blocksDocument(i), i.question);
  const w = p.now.map(weightOf);
  assert.deepEqual(w, [...w].sort((a, b) => b - a), 'ranked by weight');
  assert.ok(p.now[0].target.kind === 'system', 'an application used by steps to decide comes first');
  // Every open question is still somewhere: nothing is dropped.
  assert.equal(p.now.length + p.wait.length + p.found.length + p.deferred.length, t.items.length);
  assert.equal(new Set([...p.now, ...p.wait].map(i => i.key)).size, p.now.length + p.wait.length);
  // Steps with no role and other detail wait for sign-off, with a reason.
  const role = p.wait.find(i => i.kind === 'role' && i.target.kind === 'step')!;
  assert.equal(p.held[role.key].kind, 'later');
  assert.match(holdReason(p.held[role.key]), /before sign-off/);
  for (const i of p.wait) assert.ok(holdReason(p.held[i.key]), `a reason for "${i.question}"`);
});

test('a question in free words that a structured question asks is held back, not closed', () => {
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const p = planQuestions(t, m, { cap: 50 });
  const sapKey = t.items.find(i => i.target.kind === 'system' && /SAP/.test(m.systems.find(s => s.id === i.target.id)!.name))!.key;
  for (const re of [/permitted access methods/, /confirmed access statuses/]) {
    const i = p.wait.find(x => re.test(x.question))!;
    assert.deepEqual([p.held[i.key].kind, (p.held[i.key] as { by: string }).by], ['covered', sapKey], i.question);
  }
  const fig = p.wait.find(x => /handling-time values/.test(x.question))!;
  assert.equal(p.held[fig.key].kind, 'covered', 'a handling-time figure is asked for');
  // The monthly volumes are recorded in the sample, so nothing asks for them: those two are not covered.
  for (const v of p.wait.filter(x => /monthly volume of/.test(x.question))) assert.equal(p.held[v.key].kind, 'later');
  const route = t.items.find(x => /routed owner/.test(x.question))!;
  if (t.items.some(x => x.target.kind === 'exception')) assert.ok(!p.now.includes(route));
  assert.ok(!p.now.some(i => /permitted access methods|confirmed access statuses/.test(i.question)));
});

test('a question close in wording to one already in the first list waits for it', () => {
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const p = planQuestions(t, m, { cap: 50 });
  const near = p.wait.find(x => /OCR tool able to read handwritten/.test(x.question))!;
  assert.equal(p.held[near.key].kind, 'near');
  assert.ok(p.now.some(x => /^Which OCR tool will read the scanned invoices\?$/.test(x.question)));
});

test('a question a source answers moves to "found", and the next one moves up', () => {
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const before = planQuestions(t, m);
  const top = before.now[0];
  const after = planQuestions(t, m, { found: new Set([top.key]) });
  assert.deepEqual(after.found.map(i => i.key), [top.key]);
  assert.ok(!after.now.includes(top));
  if (before.wait.some(i => before.held[i.key].kind === 'full')) assert.equal(after.now.length, before.now.length);
  assert.match(planSummary(after), /^1 found in your sources to confirm · /);
});

test('the cap can be changed; a missing objective or owner always comes first', () => {
  const m = realShape();
  m.meta = { ...m.meta, objective: { value: null, status: 'unknown', sources: [] } as never };
  const t = triage(m, assessProcess(m));
  const three = planQuestions(t, m, { cap: 3 });
  assert.equal(three.now.length, 3);
  if (t.items.some(i => i.target.kind === 'meta' && i.target.field === 'objective')) assert.equal(three.now[0].target.field, 'objective');
  assert.equal(planQuestions(t, m, { cap: 0 }).now.length, 0);
  assert.match(nowHeading(planQuestions(t, m, { cap: 0 })), /Nothing/);
});

test('deferred questions stay with their person; the interview asks the first list, then what can wait', () => {
  let m = realShape();
  const t0 = triage(m, assessProcess(m));
  const tol = t0.items.find(i => /price tolerance/.test(i.question))!;
  m = deferQuestion(m, { questionIds: tol.questionIds, owner: 'Finance Controller' }).model;
  const t = triage(m, assessProcess(m));
  const p = planQuestions(t, m);
  assert.ok(p.deferred.some(i => /price tolerance/.test(i.question)));
  assert.ok(![...p.now, ...p.wait].some(i => /price tolerance/.test(i.question)));
  assert.deepEqual(askingOrder(p, false), p.now);
  assert.deepEqual(askingOrder(p, true), [...p.now, ...p.wait]);
  assert.match(planSummary(p), /^\d+ can wait until sign-off · 1 with someone else\. \d+ repeats? merged/);
  assert.match(nowHeading(p), /^\d things? only your people can tell us$/);
});

test('packs put the first list first, marked "Answer first"', () => {
  const m = realShape();
  const t = triage(m, assessProcess(m));
  const p = planQuestions(t, m);
  const packs = buildPacks(t, m, p);
  const all = packs.flatMap(x => x.items);
  assert.equal(all.filter(x => x.first).length, p.now.length);
  for (const pack of packs) {
    const firsts = pack.items.map(x => x.first);
    assert.deepEqual(firsts, [...firsts].sort((a, b) => Number(b) - Number(a)), `${pack.label}: first-list questions lead`);
  }
});

test('the Process stage\'s questions tab shows the first list\'s count, and says why when it lists more raw items', () => {
  const m = realShape();
  const plan = planQuestions(triage(m, assessProcess(m)), m);
  const raw = openItemCount(m);
  const { count, note } = questionsTabCount(plan, raw);
  // The same number Ask Avala's questions tab shows.
  assert.equal(count, plan.now.length + plan.found.length);
  assert.ok(raw > count, `${raw} raw items, ${count} in the first list`);
  assert.match(note!, new RegExp(`^${count} questions need people now: the same list as Ask Avala's questions\\. Below is every open item as recorded, ${raw} in all;`));
  // When the two agree there is nothing to explain.
  assert.equal(questionsTabCount(plan, count).note, null);
  assert.match(questionsTabCount({ ...plan, now: plan.now.slice(0, 1), found: [] }, raw).note!, /^1 question needs people now/);
});
