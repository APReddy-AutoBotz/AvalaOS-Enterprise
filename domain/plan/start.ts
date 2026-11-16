// A start with no documents (docs/effort-first-plan.md, part A): the short form's answers as edits on
// the working draft. Only what the person gave is written, each as given by a person; the words they
// type or speak are kept as a source (journey/process/StartInOwnWords.tsx), never as facts.
import type { DoneToday, InMind, ProcessModel } from '../processModel/types.ts';
import { addSystem, setBriefFact, type OpResult } from '../processModel/patch.ts';

/** The most a description may hold, in characters. */
export const OWN_WORDS_LIMIT = 20000;

/** Application names as typed: split on commas, semicolons or new lines, tidied, each once. */
export function applicationNames(text: string): string[] {
  const out: string[] = [];
  for (const n of text.split(/[,;\n]/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) if (!out.some(o => o.toLowerCase() === n.toLowerCase())) out.push(n);
  return out.slice(0, 30);
}

/** The edits the form makes, in order, on the draft. */
export function ownWordsEdits(form: { doneToday: DoneToday | ''; inMind: InMind[]; apps: string[] }): ((m: ProcessModel) => OpResult)[] {
  const ops: ((m: ProcessModel) => OpResult)[] = [];
  if (form.doneToday) ops.push(m => setBriefFact(m, { fact: 'doneToday', value: form.doneToday as DoneToday }));
  if (form.inMind.length) ops.push(m => setBriefFact(m, { fact: 'inMind', value: form.inMind }));
  for (const name of form.apps) ops.push(m => (m.systems.some(s => s.name.toLowerCase() === name.toLowerCase()) ? { model: m, patch: [] } : addSystem(m, { name, kind: 'other' })));
  return ops;
}

