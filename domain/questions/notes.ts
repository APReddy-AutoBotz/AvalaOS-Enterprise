// Answers from free text: notes, a pasted email reply, a follow-up call transcript or a spoken
// answer. The AI only finds which open questions the text answers and quotes the words that do;
// every proposal is shown to a person, and only what they confirm is written.
import type { Segment, TaskDefinition } from '../ai/gateway.ts';
import type { AccessStatus, ProcessModel } from '../processModel/types.ts';
import type { TriageItem } from './triage.ts';

const str = { type: 'string' } as const;

export const answerFromNotes: TaskDefinition = {
  id: 'answerFromNotes',
  schemaName: 'answers_from_notes',
  reasoningEffort: 'medium',
  instructions: [
    'Segments whose id starts with "q:" are open questions about a business process, each with the kind of answer it needs. Segments whose id starts with "n:" are notes from a person (typed, pasted or transcribed from speech).',
    'For each question the notes answer, report the answer with one short verbatim quote from one "n:" segment and that segment id. Never quote a "q:" segment. Report nothing for a question the notes do not answer; do not guess and do not answer from general knowledge.',
    'questionId: the id after "q:". value depends on the kind:',
    '- role: exactly one of the role names listed on the question.',
    '- system: exactly one of the system names listed on the question.',
    '- number: the number only, digits and a decimal point.',
    '- text: the answer in the person\'s words, shortened to one sentence.',
    '- access: one finding per interface the notes settle; give its number in "interface" and value "confirmed" (can be used), "reported" (exists but not confirmed for use) or "confirmed_absent" (not available).',
    '- free: the answer in the person\'s words, shortened to one or two sentences.',
    'interface: the interface number for access questions, otherwise an empty string.',
    'certainty: "stated" when the notes say it outright, "inferred" when it clearly follows.',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['answers'],
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['questionId', 'value', 'interface', 'certainty', 'segmentId', 'excerpt'],
          properties: { questionId: str, value: str, interface: str, certainty: { type: 'string', enum: ['stated', 'inferred'] }, segmentId: str, excerpt: str },
        },
      },
    },
  },
  maxOutputTokens: 8000,
  verifyArrays: ['answers'],
};

export interface NoteFinding { questionId: string; value: string; interface: string; certainty: 'stated' | 'inferred'; segmentId: string; excerpt: string }

/** Questions are sent with a short id; this maps it back to the triage item. */
export function notesSegments(model: ProcessModel, items: TriageItem[], notes: string): { segments: Segment[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const cards: Segment[] = items.map((it, i) => {
    const id = `${i + 1}`;
    ids.set(id, it.key);
    const lines = [`Question ${id} (${it.kind}): ${it.question}`];
    if (it.kind === 'role') lines.push(`Roles: ${model.roles.map(r => r.name).join('; ') || 'none recorded'}`);
    if (it.kind === 'system') lines.push(`Systems: ${model.systems.map(s => s.name).join('; ') || 'none recorded'}`);
    if (it.kind === 'access') lines.push(...(it.interfaces ?? []).map(x => `Interface ${x.index}: ${x.label}`));
    return { id: `q:${id}`, text: lines.join('\n') };
  });
  const paras = notes.split(/\n\s*\n|\n(?=\s*[-*•\d]+[.)]?\s)/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const p of paras) for (let i = 0; i < p.length; i += 4000) chunks.push(p.slice(i, i + 4000));
  return { segments: [...cards, ...chunks.map((text, i) => ({ id: `n:${i + 1}`, text, sourceId: 'answers', locator: `paragraph ${i + 1}` }))], ids };
}

export interface Proposal {
  itemKey: string;
  question: string;
  /** What will be written, in words. */
  display: string;
  quote: string;
  certainty: 'stated' | 'inferred';
  /** The value in the form the guided answer uses. */
  answer: { pick?: string; text?: string; statuses?: Record<number, AccessStatus> };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ACCESS: AccessStatus[] = ['confirmed', 'reported', 'confirmed_absent'];
const ACCESS_WORDS: Record<string, string> = { confirmed: 'can be used', reported: 'exists, not confirmed', confirmed_absent: 'not available' };

/** Turns findings into proposals, dropping any that do not fit the question (an unknown role, a non-number). */
export function proposalsFrom(model: ProcessModel, items: TriageItem[], ids: Map<string, string>, findings: NoteFinding[]): Proposal[] {
  const out = new Map<string, Proposal>();
  for (const f of findings) {
    const key = ids.get(f.questionId.replace(/^q:/, ''));
    const item = items.find(i => i.key === key);
    if (!item || !f.segmentId.startsWith('n:')) continue;
    const base = { itemKey: item.key, question: item.question, quote: f.excerpt, certainty: f.certainty };
    const v = f.value.trim();
    if (item.kind === 'role' || item.kind === 'system') {
      const list = item.kind === 'role' ? model.roles : model.systems;
      const hit = list.find(x => norm(x.name) === norm(v)) ?? list.find(x => norm(x.name).includes(norm(v)) || norm(v).includes(norm(x.name)));
      if (!hit || out.has(item.key)) continue;
      out.set(item.key, { ...base, display: hit.name, answer: { pick: hit.id, text: '' } });
    } else if (item.kind === 'number') {
      const n = Number(v.replace(/[^0-9.]/g, ''));
      if (!v || !Number.isFinite(n) || out.has(item.key)) continue;
      out.set(item.key, { ...base, display: String(n), answer: { text: String(n) } });
    } else if (item.kind === 'access') {
      const idx = Number(f.interface);
      const iface = item.interfaces?.find(x => x.index === idx);
      if (!iface || !ACCESS.includes(v as AccessStatus)) continue;
      const prev = out.get(item.key);
      const statuses = { ...(prev?.answer.statuses ?? Object.fromEntries(item.interfaces!.map(x => [x.index, x.access]))), [idx]: v as AccessStatus };
      const display = item.interfaces!.filter(x => statuses[x.index] !== x.access).map(x => `${x.label.split(' (')[0]}: ${ACCESS_WORDS[statuses[x.index]]}`).join('; ');
      out.set(item.key, { ...base, quote: prev ? `${prev.quote} … ${f.excerpt}` : f.excerpt, display, answer: { statuses, text: '' } });
    } else {
      if (!v || out.has(item.key)) continue;
      out.set(item.key, { ...base, display: v, answer: { text: v } });
    }
  }
  return [...out.values()];
}
