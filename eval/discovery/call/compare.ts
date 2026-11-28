// The call replay's independent check (owner, 28 November 2026; plan `claude/measure-1-single-check-plan-27-nov.md`):
// on the made-up calls only (set M), where the text can be read and every question has a hand-written answer, every
// question the call could answer is read against all of the call's notes twice. Once alone, as a single check before
// a suggestion would read it; once all together, as the end reading reads them today. Each read is scored against the
// hand-written answers (`answers.json`, `expected`), so it does not rest on the judge. Numbers only: the report never
// holds a note, a question, a quote or a value.
import type { TriageItem } from '../../../domain/questions/triage.ts';
import { answerFromNotes, notesSegments, proposalsFrom, type NoteFinding } from '../../../domain/questions/notes.ts';
import { addNote, newCall, type CallState } from '../../../domain/meeting/kept.ts';
import { prepareEnd } from '../../../domain/meeting/panel.ts';
import { ReplayStop, type Ask } from '../replay.ts';
import { asNote, callList, type CallAnswers, type CallCase } from './replay.ts';

/** One way of reading, scored: answers right and wrong by how they were given, missed, and rightly left unanswered. */
export interface ReadTally {
  right: { stated: number; inferred: number };
  wrong: { stated: number; inferred: number };
  /** A hand-written answer exists and the read gave none. */
  missed: number;
  /** The hand-written answer is "not answered by the notes" and the read gave none. */
  rightlyEmpty: number;
  tokens: number;
  calls: number;
  failures: number;
}

export interface CompareResult {
  id: string;
  /** Questions with a hand-written answer that the call could read. */
  questions: number;
  /** Hand-written answers for a question the call had no way to read (left out of both tallies). */
  notRead: number;
  alone: ReadTally;
  together: ReadTally;
}

const stops = (e: unknown) => e instanceof ReplayStop;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tally = (): ReadTally => ({ right: { stated: 0, inferred: 0 }, wrong: { stated: 0, inferred: 0 }, missed: 0, rightlyEmpty: 0, tokens: 0, calls: 0, failures: 0 });

/** One answer (or none) against the hand-written one: null means the notes do not answer it, '*' any answer, else the words a right answer holds. */
export function scoreAnswer(t: ReadTally, expected: string[] | null | '*', got: { display: string; certainty: 'stated' | 'inferred' } | undefined): void {
  if (!got) { if (expected === null) t.rightlyEmpty++; else t.missed++; return; }
  const right = expected === '*' || (expected !== null && expected.some(w => norm(got.display).includes(norm(w))));
  t[right ? 'right' : 'wrong'][got.certainty]++;
}

/** The call with every passage of the case taken as a note, as the replay takes them. */
function allNotes(c: CallCase): CallState {
  let s = newCall({ processId: c.id, at: new Date(Date.UTC(2026, 0, 1, 9)).toISOString(), attendees: c.attendees, minutes: 60 });
  for (const p of c.passages) {
    const next = addNote(s, { id: `p${p.n}`, at: new Date(Date.UTC(2026, 0, 1, 9) + ((p.seconds ?? p.n * 24) * 1000)).toISOString(), ...asNote(p) });
    if (typeof next !== 'string') s = next;
  }
  return s;
}

/** Reads one set of questions against all the notes: the first answer to each question, by the key its answer is kept under. */
async function read(c: CallCase, items: TriageItem[], text: string, ask: Ask, t: ReadTally): Promise<Map<string, { display: string; certainty: 'stated' | 'inferred' }> | null> {
  const { segments, ids } = notesSegments(c.model, items, text);
  t.calls++;
  try {
    const r = await ask(answerFromNotes.id, segments);
    t.tokens += r.tokens;
    const got = new Map<string, { display: string; certainty: 'stated' | 'inferred' }>();
    for (const p of proposalsFrom(c.model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers) ?? [])) {
      const had = got.get(p.itemKey);
      if (!had || (had.certainty === 'inferred' && p.certainty === 'stated')) got.set(p.itemKey, { display: p.display, certainty: p.certainty });
    }
    return got;
  } catch (e) { if (stops(e)) throw e; t.failures++; return null; }
}

/** Every question with a hand-written answer, read alone and read together against all the call's notes. */
export async function compareCall(c: CallCase, a: CallAnswers, ask: Ask): Promise<CompareResult> {
  const { list, triage } = callList(c);
  const s = allNotes(c);
  const end = prepareEnd(s, { model: c.model, list, triage });
  const text = s.notes.map(n => n.text.replace(/\s+/g, ' ').trim()).join('\n\n');
  const items = end.batches.flatMap(b => b.items).filter(it => it.key in a.expected);
  const out: CompareResult = { id: c.id, questions: items.length, notRead: Object.keys(a.expected).filter(k => !items.some(it => it.key === k)).length, alone: tally(), together: tally() };
  // Together: the end reading's own calls, as it would make them.
  const together = new Map<string, { display: string; certainty: 'stated' | 'inferred' }>();
  let togetherFailed = false;
  for (const b of end.batches) {
    out.together.calls++;
    try {
      const r = await ask(answerFromNotes.id, b.segments);
      out.together.tokens += r.tokens;
      for (const p of proposalsFrom(c.model, b.items, b.ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers) ?? [])) {
        const had = together.get(p.itemKey);
        if (!had || (had.certainty === 'inferred' && p.certainty === 'stated')) together.set(p.itemKey, { display: p.display, certainty: p.certainty });
      }
    } catch (e) { if (stops(e)) throw e; out.together.failures++; togetherFailed = true; }
  }
  if (!togetherFailed) for (const it of items) scoreAnswer(out.together, a.expected[it.key]!, together.get(it.key));
  // Alone: one call a question, with every note.
  for (const it of items) {
    const got = await read(c, [it], text, ask, out.alone);
    if (got) scoreAnswer(out.alone, a.expected[it.key]!, got.get(it.key));
  }
  return out;
}

/** The report: numbers only. */
export function renderCompare(results: CompareResult[]): string {
  const sum = (f: (r: CompareResult) => number) => results.reduce((t, r) => t + f(r), 0);
  const line = (name: string, k: 'alone' | 'together') => {
    const right = sum(r => r[k].right.stated + r[k].right.inferred) + sum(r => r[k].rightlyEmpty);
    const scored = right + sum(r => r[k].wrong.stated + r[k].wrong.inferred + r[k].missed);
    return `${name}: right ${right} of ${scored} (answers right: ${sum(r => r[k].right.stated)} stated, ${sum(r => r[k].right.inferred)} inferred; rightly left unanswered ${sum(r => r[k].rightlyEmpty)}). Wrong: ${sum(r => r[k].wrong.stated)} stated, ${sum(r => r[k].wrong.inferred)} inferred. Missed: ${sum(r => r[k].missed)}. ${sum(r => r[k].tokens)} tokens in ${sum(r => r[k].calls)} calls; ${sum(r => r[k].failures)} failed.`;
  };
  return [
    `Independent check: ${results.length} made-up calls, ${sum(r => r.questions)} questions with a hand-written answer, each read against all of the call's notes; ${sum(r => r.notRead)} hand-written answers had no question to read.`,
    line('Each question read alone', 'alone'),
    line('All read together (as the end reading)', 'together'),
    ...results.map(r => `${r.id}: ${r.questions} questions; alone right ${r.alone.right.stated + r.alone.right.inferred + r.alone.rightlyEmpty}, wrong ${r.alone.wrong.stated + r.alone.wrong.inferred}, missed ${r.alone.missed}; together right ${r.together.right.stated + r.together.right.inferred + r.together.rightlyEmpty}, wrong ${r.together.wrong.stated + r.together.wrong.inferred}, missed ${r.together.missed}.`),
  ].join('\n');
}
