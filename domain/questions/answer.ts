// What an answer to an open question writes to the process model (moved from the Closing the gaps screen
// so the Ask Avala interview and that screen share one rule). The value goes to the question's target
// through the patch operations, and the question is closed with the answer in words, so the record keeps
// where the value came from. Nothing here runs on its own: the screens apply the edit when a person saves.
import type { AccessStatus, ProcessModel, RaisedBy, RoleKind } from '../processModel/types.ts';
import { addQuestion, addRole, addSystem, answerQuestion, closeQuestions, routeException, setAccessStatus, setStepTrait, setSystemUiStable, updateFact, type OpResult, type TraitName } from '../processModel/patch.ts';
import type { JsonPatchOp } from '../processModel/jsonPatch.ts';
import type { TriageItem } from './triage.ts';
import { waysEdit, waysNote } from './ways.ts';

export type Op = (m: ProcessModel) => OpResult;
/** Runs operations in order as one edit. */
export const all = (...ops: Op[]) => (m: ProcessModel): OpResult => ops.reduce<{ model: ProcessModel; patch: JsonPatchOp[] }>((cur, op) => { const r = op(cur.model); return { model: r.model, patch: [...cur.patch, ...r.patch] }; }, { model: m, patch: [] });


export const ACCESS: [AccessStatus, string][] = [['unknown', 'Unknown'], ['confirmed', 'Can be used'], ['reported', 'Exists, not confirmed for use'], ['confirmed_absent', 'Not available']];

const YES_NO: [string, string][] = [['true', 'Yes'], ['false', 'No']];
/** The answers to a fact of a step, or to whether an application's screens are stable (package 9). */
export function choicesFor(trait: string): [string, string][] {
  if (trait === 'input') return [['structured', 'Structured data'], ['semi_structured', 'Semi-structured'], ['unstructured', 'Documents'], ['paper', 'Paper']];
  if (trait === 'write') return [['none', 'Nothing'], ['record', 'A record'], ['financial', 'Money'], ['irreversible', 'Cannot be undone']];
  return YES_NO;
}
const choiceValue = (trait: string, v: string): unknown => (trait === 'input' || trait === 'write' ? v : v === 'true');

/**
 * Records an answer to an item, creating the stored question first when the item is a gap found by rule.
 * A question a discovery session raised from what was said keeps those words (`raisedBy`, package B).
 */
export const record = (item: TriageItem, answer: string, status: 'answered' | 'deferred' = 'answered', raisedBy?: RaisedBy): Op => m => {
  if (item.questionIds.length) return closeQuestions(m, { questionIds: item.questionIds, answer, status });
  const added = addQuestion(m, { target: item.target, question: item.question, ...(raisedBy ? { raisedBy } : {}) });
  const closed = closeQuestions(added.model, { questionIds: [added.questionId], answer, status });
  return { model: closed.model, patch: [...added.patch, ...closed.patch] };
};


/**
 * "Someone else" (owner's walk, 28 November 2026): the answer to "Who does …?" or "Which application …?" is often a
 * role or an application not in the process yet. The pick `SOMEONE_ELSE` with a typed name adds it and records the
 * answer in one edit; a name already in the process (ignoring case and punctuation) is that one, and nothing is added.
 */
export const SOMEONE_ELSE = 'someone-else';
export interface Named { name: string; kind?: RoleKind }
export type AnswerInput = { pick?: string; text?: string; statuses?: Record<number, AccessStatus>; named?: Named };
export const NAMED_KINDS: [RoleKind, string][] = [['person_role', 'A role'], ['team', 'A team'], ['external', 'An outside party']];
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const typedName = (n?: Named) => (n?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

/** What a role or application answer chooses: one already in the process, or a new one by its typed name. */
export function namedChoice(item: TriageItem, model: ProcessModel, a: AnswerInput): { id?: string; name: string; isNew: boolean; kind?: RoleKind } | null {
  if (item.kind !== 'role' && item.kind !== 'system') return null;
  const options: { id: string; name: string }[] = item.kind === 'role' ? model.roles : model.systems;
  if (a.pick && a.pick !== SOMEONE_ELSE) { const hit = options.find(o => o.id === a.pick); return hit ? { id: hit.id, name: hit.name, isNew: false } : null; }
  if (a.pick !== SOMEONE_ELSE) return null;
  const name = typedName(a.named);
  if (!name || !nameKey(name)) return null;
  const same = options.find(o => nameKey(o.name) === nameKey(name));
  if (same) return { id: same.id, name: same.name, isNew: false };
  return { name, isNew: true, ...(item.kind === 'role' ? { kind: a.named?.kind ?? 'person_role' } : {}) };
}

/** Before Save, in words: what a role or application answer will record (and add). Null when nothing would be. */
export function namedRecordLine(item: TriageItem, model: ProcessModel, a: AnswerInput): string | null {
  const c = namedChoice(item, model, a);
  if (!c) return null;
  const t = item.target;
  const step = t.kind === 'step' ? model.steps.find(x => x.id === t.id)?.name : undefined;
  const exc = t.kind === 'exception' ? model.exceptions.find(x => x.id === t.id)?.name : undefined;
  const what = item.kind === 'role'
    ? (step ? `${c.name} does “${step}”` : exc ? `${c.name} handles “${exc}”` : c.name)
    : (step ? `“${step}” is done in ${c.name}` : c.name);
  const added = !c.isNew ? ''
    : item.kind === 'role' ? ` ${c.name} is added to the roles, as ${(NAMED_KINDS.find(k => k[0] === c.kind)?.[1] ?? 'A role').toLowerCase()}.`
    : ` ${c.name} is added to the applications. How the automation reaches it is not recorded yet, so that is asked about.`;
  return `This will record: ${what}.${added}`;
}

/** The edit an answer makes: the value written to its target and the question closed. Null when the answer is not complete. */
export function buildAnswer(item: TriageItem, model: ProcessModel, a: AnswerInput, sourceNote = ''): { op: Op; summary: string } | null {
  const t = item.target;
  const note = (a.text ?? '').trim();
  const withSource = (s: string) => (sourceNote ? `${s} (${sourceNote})` : s);
  switch (item.kind) {
    case 'role':
    case 'system': {
      const c = namedChoice(item, model, a);
      if (!c) return null;
      const write = (id: string): Op => t.kind === 'exception' ? m => routeException(m, { exceptionId: t.id!, roleId: id }) : m => updateFact(m, { target: t, value: [id] });
      const closing = record(item, withSource(note ? `${c.name}. ${note}` : c.name));
      if (!c.isNew) return { op: all(write(c.id!), closing), summary: `Answered: ${item.question}` };
      // A role or application not in the process yet: added, written and recorded in one edit.
      const op: Op = m => {
        const added = item.kind === 'role' ? addRole(m, { name: c.name, kind: c.kind! }) : addSystem(m, { name: c.name, kind: 'other' });
        const id = 'roleId' in added ? added.roleId : added.systemId;
        const rest = all(write(id), closing)(added.model);
        return { model: rest.model, patch: [...added.patch, ...rest.patch] };
      };
      return { op, summary: `Answered: ${item.question} (${item.kind === 'role' ? 'role' : 'application'} ${c.name} added)` };
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
    case 'choice': {
      const hit = (item.choices ?? []).find(c => c[0] === a.pick);
      if (!hit) return null;
      const field = t.field ?? '';
      const write: Op = t.kind === 'system' ? m => setSystemUiStable(m, { systemId: t.id!, value: hit[0] === 'true' })
        : m => setStepTrait(m, { stepId: t.id!, trait: field.replace(/^traits\./, '') as TraitName, value: choiceValue(field.replace(/^traits\./, ''), hit[0]) });
      return { op: all(write, record(item, withSource(note ? `${hit[1]}. ${note}` : hit[1]))), summary: `Answered: ${item.question}` };
    }
    case 'ways': {
      // A way in chosen per row, or "No way in"; words alone are never an answer here (domain/questions/ways.ts).
      const ops = waysEdit(t.id!, a);
      const said = waysNote(a);
      if (!ops || !said) return null;
      return { op: all(...ops, record(item, withSource(note ? `${said} ${note}` : said))), summary: `Ways in to ${model.systems.find(s => s.id === t.id)?.name ?? 'an application'}` };
    }
    case 'free':
      if (!note) return null;
      return { op: record(item, withSource(note)), summary: `Answered: ${item.question}` };
  }
}

