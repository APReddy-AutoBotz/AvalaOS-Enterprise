// Save at the end of a call (review chat, 28 November 2026): who saved is a name, never an email address; when the
// edit fails after the notes were kept in the same press, the result says the notes are kept, and a retry reuses that
// source and adds no second one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { buildBriefing } from './briefing.ts';
import { addNote, newCall, type CallState } from './kept.ts';
import { buildReview, callNotesSource, type NotesSource } from './review.ts';
import { saveCall, savedBy, type SaveWrites } from './save.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = (min: number) => new Date(Date.UTC(2026, 10, 28, 9, min)).toISOString();
const a = assessProcess(gold);
const t = triage(gold, a);
const b = buildBriefing({ model: gold, assessment: a, asksPurpose: true, attendees: [{ kind: 'business' }], minutes: 30, sources: 1, triage: t });
const ctx = { model: gold, list: [...b.forCall, ...b.ifTime], triage: t, timeZone: 'UTC' };
const call = (): CallState => ({ ...(addNote(newCall({ processId: 'p-1', at: at(0), attendees: [{ kind: 'business' }], minutes: 30 }), { id: 'n1', at: at(1), text: 'Invoices arrive by email.' }) as CallState), endedAt: at(20) });
const input = (s: CallState, by: string | null, keptKey: string | null = null) => ({
  s, review: buildReview(s, ctx), choice: { ticked: new Set<string>() }, ctx, takenKeys: ['ans-1'], keptKey,
  by: { id: 'u-1', name: by }, endedAt: at(20), at: at(21), date: '28 November 2026',
});

/** The store's two writes, recorded; the edit fails as asked. */
function writes(edit: 'ok' | 'throws' | 'refused') {
  const kept: NotesSource[] = [];
  const w: SaveWrites = {
    addSource: async src => { kept.push(src); },
    apply: async (op, _summary) => {
      if (edit === 'throws') throw new Error('The server could not be reached');
      if (edit === 'refused') return { error: 'The draft moved on' };
      return { model: op(gold).model };
    },
  };
  return { kept, w };
}

test('who saved is a name, never an email address: the notes\' title then names no one', () => {
  assert.equal(savedBy('Asha'), 'Asha');
  assert.equal(savedBy('  '), undefined);
  assert.equal(savedBy(null), undefined);
  assert.equal(savedBy('asha@example.com'), undefined);
  const s = call();
  assert.equal(callNotesSource(s, { takenKeys: [], by: 'asha@example.com', endedAt: at(20), timeZone: 'UTC' })!.title, 'Call notes, 28 November 2026, 09:00 to 09:20');
});

test('Save keeps the notes with the person\'s name, or with no name; never an email address', async () => {
  for (const [by, title] of [['Asha', 'Call notes by Asha, 28 November 2026, 09:00 to 09:20'], ['asha@example.com', 'Call notes, 28 November 2026, 09:00 to 09:20'], [null, 'Call notes, 28 November 2026, 09:00 to 09:20']] as const) {
    const { kept, w } = writes('ok');
    const r = await saveCall(input(call(), by), w);
    assert.equal(r.ok, true);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.title, title);
    assert.ok(!kept[0]!.title.includes('@'));
  }
});

test('the edit fails after the notes were kept in the same press: it says the notes are kept, and a retry adds no second source', async () => {
  const thrown = writes('throws');
  const r = await saveCall(input(call(), 'Asha'), thrown.w);
  assert.equal(r.ok, false);
  assert.equal(thrown.kept.length, 1, 'the notes were kept');
  assert.equal(r.key, 'ans-2');
  assert.ok(r.ok === false && r.error.includes('Your notes are kept as source ans-2'), 'not "nothing changed"');
  assert.ok(r.ok === false && !r.error.includes('Nothing changed'));

  const refused = writes('refused');
  const r2 = await saveCall(input(call(), 'Asha'), refused.w);
  assert.ok(r2.ok === false && r2.error.includes('The draft moved on') && r2.error.includes('ans-2'));

  // The retry with the kept key: no second source, and the edit saved.
  const again = writes('ok');
  const r3 = await saveCall(input(call(), 'Asha', 'ans-2'), again.w);
  assert.equal(r3.ok, true);
  assert.equal(again.kept.length, 0);
  assert.equal(r3.key, 'ans-2');

  // When keeping the notes itself fails, nothing was saved, and it says so.
  const failing: SaveWrites = { addSource: async () => { throw new Error('No connection'); }, apply: async () => ({ error: null }) };
  const r4 = await saveCall(input(call(), 'Asha'), failing);
  assert.ok(r4.ok === false && r4.key === null && r4.error.includes('Nothing changed'));
});
