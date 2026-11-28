// The review at the end of a call, after the review chat's preview walk of 28 November 2026: a figure shown and
// recorded with its unit or period; every choice the review lists has something to pick or a field to fill; what
// Save recorded is said; an input's answer is recorded without a quote, and the review says so; a question with no
// Discovery card is answered on its stored question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { errorsOf, validateModel } from '../processModel/validate.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { buildBriefing } from './briefing.ts';
import { addNote, newCall, type CallState, type Found } from './kept.ts';
import { answerKey } from './panel.ts';
import { buildReview, callEdit, callNotesSource } from './review.ts';
import { figureFromNote, figureNeeds, figureText, unitFrom } from './figures.ts';
import { CALL_WORDS } from './words.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = (min: number) => new Date(Date.UTC(2026, 10, 28, 9, min)).toISOString();

function setUp(m: ProcessModel) {
  const a = assessProcess(m);
  const t = triage(m, a);
  const b = buildBriefing({ model: m, assessment: a, asksPurpose: true, attendees: [{ kind: 'business' }, { kind: 'it' }, { kind: 'finance' }], minutes: 60, sources: 1, triage: t });
  return { t, list: [...b.forCall, ...b.ifTime] };
}

/** A call with one note per answer, each found as the reading would find it. */
function callWith(m: ProcessModel, found: { key: string; note: string; display: string; quote?: string; text?: string; pick?: string }[]) {
  const { t, list } = setUp(m);
  let s: CallState = newCall({ processId: 'p-1', at: at(0), attendees: [{ kind: 'business' }], minutes: 60 });
  const out: Found[] = [];
  found.forEach((f, i) => {
    s = addNote(s, { id: `n${i + 1}`, at: at(i + 1), text: f.note }) as CallState;
    const card = list.find(x => answerKey(x.card, t) === f.key)?.card;
    out.push({ itemKey: f.key, question: card?.question ?? f.key, display: f.display, quote: f.quote ?? f.note, certainty: 'stated', answer: f.pick ? { pick: f.pick } : { text: f.text ?? f.display }, noteId: `n${i + 1}`, readAt: at(i + 1) });
  });
  s = { ...s, found: out, endedAt: at(30) };
  return { s, t, list };
}

const save = (m: ProcessModel, x: ReturnType<typeof callWith>, choice: Parameters<typeof callEdit>[2]) => {
  const review = buildReview(x.s, { model: m, list: x.list, triage: x.t, timeZone: 'UTC' });
  const source = callNotesSource(x.s, { takenKeys: [], endedAt: at(30), timeZone: 'UTC' })!;
  const edit = callEdit(x.s, review, choice, { model: m, list: x.list, triage: x.t, timeZone: 'UTC', source, date: '28 November 2026' });
  const after = edit.op(m).model;
  assert.deepEqual(errorsOf(validateModel(after)), []);
  return { review, edit, after };
};

test('a figure\'s unit and period are read from the note\'s words by rule, and shown with the number', () => {
  assert.equal(unitFrom('It takes about 40 minutes a case.'), 'minutes');
  assert.equal(unitFrom('Two hours, roughly.'), 'hours');
  assert.equal(unitFrom('40 mins'), 'minutes');
  assert.equal(unitFrom('About 40.'), null);
  assert.equal(unitFrom('An hour and 20 minutes.'), null, 'both: asked, not guessed');
  assert.equal(figureFromNote('input:time', '40', 'About 40 minutes each.'), '40 minutes');
  assert.equal(figureFromNote('input:time', '1', 'One hour.'), '1 hour');
  assert.equal(figureFromNote('input:time', '40', 'About 40.'), '40, minutes or hours not said');
  assert.equal(figureFromNote('input:volume', '500', 'About 500 a month.'), '500 cases a month');
  assert.equal(figureFromNote('input:volume', '500', 'About 500.'), '500 cases, the period not said');
  assert.equal(figureText('item:q-1', 'AP Clerk'), 'AP Clerk', 'anything else as given');
  assert.deepEqual([figureNeeds('input:time', '40 minutes'), figureNeeds('input:time', '40'), figureNeeds('input:volume', '500'), figureNeeds('item:x', '')], [null, 'unit', 'period', null]);
});

test('a time is recorded with its unit: "This will record: 40 minutes"; one with no unit is asked first', () => {
  const minutes = callWith(gold, [{ key: 'input:time', note: 'A case takes about 40 minutes by hand.', display: '40' }]);
  const r1 = save(gold, minutes, { ticked: new Set(['answer:input:time']) });
  const a = r1.review.answers.find(x => x.key === 'input:time')!;
  assert.equal(a.record, '40 minutes');
  assert.equal(a.input, true);
  assert.equal(a.ticked, true);
  assert.equal(CALL_WORDS.willRecord(a.record), 'This will record: 40 minutes');
  const time = (m: ProcessModel) => m.meta.metrics.find(x => x.kind === 'handling_time' && x.appliesTo === 'process');
  assert.deepEqual([time(r1.after)?.value, time(r1.after)?.unit], [40, 'minutes']);

  const hours = callWith(gold, [{ key: 'input:time', note: 'Each one is about 2 hours of work.', display: '2' }]);
  assert.deepEqual([time(save(gold, hours, { ticked: new Set(['answer:input:time']) }).after)?.value, time(save(gold, hours, { ticked: new Set(['answer:input:time']) }).after)?.unit], [2, 'hours']);

  // No unit in the note: not ticked, nothing written until the unit is said in the review.
  const bare = callWith(gold, [{ key: 'input:time', note: 'About 40 per invoice.', display: '40' }]);
  const r3 = save(gold, bare, { ticked: new Set(['answer:input:time']) });
  const b = r3.review.answers[0]!;
  assert.deepEqual([b.needsUnit, b.ticked, b.record], [true, false, '40, minutes or hours not said']);
  assert.equal(r3.edit.counts.answers, 0);
  assert.equal(time(r3.after)?.value ?? null, time(gold)?.value ?? null, 'the figure is not written without its unit');
  const r4 = save(gold, bare, { ticked: new Set(['answer:input:time']), units: { 'input:time': 'hours' } });
  assert.deepEqual([time(r4.after)?.value, time(r4.after)?.unit], [40, 'hours']);
});

test('every choice the review lists has answers to pick or the input\'s own field; the change expected is recorded', () => {
  const { t, list } = setUp(gold);
  const keys = list.map(x => answerKey(x.card, t));
  assert.ok(keys.includes('input:change'), 'the sample asks whether the process will change');
  // Every card on the list, found in a note: nothing that reaches "pick the answer" is left with nothing to pick.
  const all = callWith(gold, keys.map(key => ({ key, note: `About that: yes, ${key}.`, display: 'yes' })));
  const review = buildReview(all.s, { model: gold, list: all.list, triage: all.t, timeZone: 'UTC' });
  assert.ok(review.choose.length > 0);
  for (const c of review.choose) assert.ok(c.choices.length > 0 || c.field, `${c.key}: something to pick`);
  const change = review.choose.find(c => c.key === 'input:change')!;
  assert.deepEqual([change.field?.kind, change.choices], ['change', []]);

  const one = callWith(gold, [{ key: 'input:change', note: 'No big changes expected, maybe a small tweak to approvals.', display: 'minor' }]);
  const nothing = save(gold, one, { ticked: new Set() });
  assert.equal(nothing.edit.counts.answers, 0, 'nothing is picked for the analyst');
  const r = save(gold, one, { ticked: new Set(), inputs: { 'input:change': { level: 'minor' } } });
  assert.equal(r.edit.counts.answers, 1);
  assert.equal(r.after.meta.profile?.processChange?.value, 'minor');
});

test('Save says what it recorded, so an answer to an input never reads as nothing saved', () => {
  assert.equal(CALL_WORDS.saved({ answers: 1, kept: 0, left: 0 }, '0 of 14 open questions closed'), 'Saved: 1 answer recorded. 0 of 14 open questions closed.');
  assert.equal(CALL_WORDS.saved({ answers: 2, kept: 1, left: 1 }, '1 of 14 open questions closed'), 'Saved: 2 answers recorded, 1 question kept open, 1 left with someone. 1 of 14 open questions closed.');
  assert.equal(CALL_WORDS.saved({ answers: 0, kept: 0, left: 0 }, '0 of 14 open questions closed'), 'Saved: your notes are kept as a source. 0 of 14 open questions closed.');
});

test('an input\'s answer is recorded without a quote, and the review says so; an open question\'s answer quotes its note', () => {
  const x = callWith(gold, [
    { key: 'input:time', note: 'A case takes about 40 minutes by hand.', display: '40' },
    { key: 'gap:step_without_role:step:s-match:roleIds', note: 'The AP Clerk does the three-way match.', display: 'AP Clerk', quote: 'The AP Clerk does the three-way match', pick: 'r-clerk' },
  ]);
  const ticked = new Set(['answer:input:time', 'answer:gap:step_without_role:step:s-match:roleIds']);
  const r = save(gold, x, { ticked });
  assert.deepEqual(r.review.answers.map(a => [a.key, a.input]), [['input:time', true], ['gap:step_without_role:step:s-match:roleIds', false]]);
  const metric = r.after.meta.metrics.find(m => m.kind === 'handling_time' && m.appliesTo === 'process')!;
  assert.deepEqual(metric.sources, [], 'the Inputs view\'s operation keeps no quote');
  assert.ok(CALL_WORDS.notesKept('Call notes, 28 November 2026').includes('recorded without a quote'));
  assert.ok(!CALL_WORDS.notesKept('x').includes('every answer can quote'));
  assert.deepEqual(r.after.steps.find(st => st.id === 's-match')!.roleIds, ['r-clerk']);
  assert.ok(r.after.openQuestions.some(q => q.status === 'answered' && q.answer?.includes('from ans-1: "The AP Clerk does the three-way match"')), 'the open question\'s answer cites the note');
});

test('a question Discovery gives no card is read and answered on its stored question', () => {
  const m: ProcessModel = { ...gold, openQuestions: [...gold.openQuestions, { id: 'q-u1', target: { kind: 'meta' }, question: 'How are month-end cut-off invoices handled?', whyItMatters: '', owner: null, status: 'open' }] };
  const { t, list } = setUp(m);
  const card = list.find(x => x.card.key === 'item:q-u1')!.card;
  const key = answerKey(card, t);
  const x = callWith(m, [{ key, note: 'Cut-off invoices are held until the new month opens.', display: 'Held until the new month opens' }]);
  const r = save(m, x, { ticked: new Set([`answer:${key}`]) });
  assert.equal(r.review.answers.length, 1);
  assert.equal(r.review.answers[0]!.input, false);
  const q = r.after.openQuestions.find(o => o.id === 'q-u1')!;
  assert.equal(q.status, 'answered');
  assert.ok(q.answer?.includes('Held until the new month opens'));
});
