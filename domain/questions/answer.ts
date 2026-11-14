// What an answer to an open question writes to the process model (moved from the Closing the gaps screen
// so the Ask Avala interview and that screen share one rule). The value goes to the question's target
// through the patch operations, and the question is closed with the answer in words, so the record keeps
// where the value came from. Nothing here runs on its own: the screens apply the edit when a person saves.
import type { AccessStatus, ProcessModel } from '../processModel/types.ts';
import { addQuestion, answerQuestion, closeQuestions, routeException, setAccessStatus, updateFact, type OpResult } from '../processModel/patch.ts';
import type { JsonPatchOp } from '../processModel/jsonPatch.ts';
import type { TriageItem } from './triage.ts';

export type Op = (m: ProcessModel) => OpResult;
/** Runs operations in order as one edit. */
export const all = (...ops: Op[]) => (m: ProcessModel): OpResult => ops.reduce<{ model: ProcessModel; patch: JsonPatchOp[] }>((cur, op) => { const r = op(cur.model); return { model: r.model, patch: [...cur.patch, ...r.patch] }; }, { model: m, patch: [] });


export const ACCESS: [AccessStatus, string][] = [['unknown', 'Unknown'], ['confirmed', 'Can be used'], ['reported', 'Exists, not confirmed for use'], ['confirmed_absent', 'Not available']];

/** Records an answer to an item, creating the stored question first when the item is a gap found by rule. */
export const record = (item: TriageItem, answer: string, status: 'answered' | 'deferred' = 'answered'): Op => m => {
  if (item.questionIds.length) return closeQuestions(m, { questionIds: item.questionIds, answer, status });
  const added = addQuestion(m, { target: item.target, question: item.question });
  const closed = closeQuestions(added.model, { questionIds: [added.questionId], answer, status });
  return { model: closed.model, patch: [...added.patch, ...closed.patch] };
};


/** The edit an answer makes: the value written to its target and the question closed. Null when the answer is not complete. */
export function buildAnswer(item: TriageItem, model: ProcessModel, a: { pick?: string; text?: string; statuses?: Record<number, AccessStatus> }, sourceNote = ''): { op: Op; summary: string } | null {
  const t = item.target;
  const note = (a.text ?? '').trim();
  const withSource = (s: string) => (sourceNote ? `${s} (${sourceNote})` : s);
  switch (item.kind) {
    case 'role':
    case 'system': {
      const options = item.kind === 'role' ? model.roles : model.systems;
      const hit = options.find(o => o.id === a.pick);
      if (!hit) return null;
      const write: Op = t.kind === 'exception' ? m => routeException(m, { exceptionId: t.id!, roleId: hit.id }) : m => updateFact(m, { target: t, value: [hit.id] });
      return { op: all(write, record(item, withSource(note ? `${hit.name}. ${note}` : hit.name))), summary: `Answered: ${item.question}` };
    }
    case 'number': {
      const n = Number(note.replace(/,/g, ''));
      if (!note || !Number.isFinite(n) || n < 0) return null;
      return { op: item.questionIds.length === 1 ? m => answerQuestion(m, { questionId: item.questionIds[0], answer: withSource(note), value: n }) : all(m => updateFact(m, { target: t, value: n }), record(item, withSource(note))), summary: `Answered: ${item.question}` };
    }
    case 'text':
      if (!note) return null;
      return { op: all(m => updateFact(m, { target: t, value: note }), record(item, withSource(note))), summary: `Answered: ${item.question}` };
    case 'access': {
      const statuses = a.statuses ?? {};
      const changed = (item.interfaces ?? []).filter(x => statuses[x.index] && statuses[x.index] !== x.access);
      if (!changed.length && !note) return null;
      const settled = (item.interfaces ?? []).every(x => (statuses[x.index] ?? x.access) !== 'unknown');
      const ops: Op[] = changed.map(x => m => setAccessStatus(m, { systemId: t.id!, index: x.index, access: statuses[x.index] }));
      if (settled || note) ops.push(record(item, withSource(note || `Settled: ${changed.map(x => `${x.label.split(' (')[0]} ${ACCESS.find(y => y[0] === statuses[x.index])![1].toLowerCase()}`).join('; ')}`)));
      return { op: all(...ops), summary: `Interfaces of ${model.systems.find(s => s.id === t.id)?.name ?? 'a system'}` };
    }
    case 'free':
      if (!note) return null;
      return { op: record(item, withSource(note)), summary: `Answered: ${item.question}` };
  }
}

