// Question packs: the open questions for one kind of owner (process owner, IT, finance), sent as a
// Word or Markdown file and answered offline. A returned pack is read back row by row; its answers
// then go through the same "answer from notes" review as typed or spoken answers, so nothing is
// written to the model without a person confirming it.
import type { ProcessModel } from '../processModel/types.ts';
import { DocBuilder, type DocTree } from '../docs/tree.ts';
import { GROUP_LABEL, OWNER_LABEL, type QOwner, type Triage, type TriageItem } from './triage.ts';

export const PACK_PREFIX: Record<QOwner, string> = { business: 'B', it: 'T', finance: 'F' };
const OWNERS: QOwner[] = ['business', 'it', 'finance'];
const GROUP_ORDER = { decides: 0, signoff: 1, detail: 2 } as const;

export interface PackItem { ref: string; item: TriageItem; how: string }
export interface QuestionPack { owner: QOwner; label: string; items: PackItem[] }

/** What a good answer looks like, in the owner's terms. */
export function howToAnswer(item: TriageItem, m: ProcessModel): string {
  switch (item.kind) {
    case 'role': return m.roles.length ? `Name the role, for example one of: ${m.roles.map(r => r.name).join(', ')}.` : 'Name the role.';
    case 'system': return m.systems.length ? `Name the application, for example one of: ${m.systems.map(s => s.name).join(', ')}.` : 'Name the application.';
    case 'number': return 'A number, with its unit (per month, minutes, and so on).';
    case 'access': return `For each, say whether it can be used, exists but is not confirmed, or is not available: ${(item.interfaces ?? []).map(x => x.label).join('; ')}.`;
    case 'text': return 'In your own words.';
    case 'free': return 'In your own words; say who confirmed it if it was not you.';
  }
}

/** One pack per owner that has questions, most decisive first. Deferred questions are included: a pack is how they get answered. */
export function buildPacks(t: Triage, m: ProcessModel): QuestionPack[] {
  return OWNERS.map(owner => {
    const items = t.items.filter(i => i.owner === owner).sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);
    return { owner, label: OWNER_LABEL[owner], items: items.map((item, n) => ({ ref: `${PACK_PREFIX[owner]}${n + 1}`, item, how: howToAnswer(item, m) })) };
  }).filter(p => p.items.length);
}

/** The pack as a document tree, so it downloads as Word or Markdown with the workspace's branding. */
export function packDocument(pack: QuestionPack, processName: string, date: string): DocTree {
  const b = new DocBuilder();
  b.section('1', 'How to answer', 1);
  b.paragraph(`These questions about ${processName} are for the ${pack.label.charAt(0).toLowerCase()}${pack.label.slice(1)}. Write each answer in the last column of the table and send the file back. Leave a row empty if you do not know; say who would.`);
  b.paragraph('Your answers are read back into the process model and checked by the analyst before anything changes.');
  b.section('2', 'Questions', 1);
  b.table('Questions', ['Ref', 'Question', 'Why it matters', 'How to answer', 'Your answer'],
    pack.items.map(p => [p.ref, p.item.question, GROUP_LABEL[p.item.group], p.how, '']), 'No questions.');
  return {
    type: 'questions', title: 'Questions to answer', subtitle: `${processName}: ${pack.label}`,
    control: [['Process', processName], ['For', pack.label], ['Questions', String(pack.items.length)], ['Date', date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: [],
  };
}

const REF = /^\s*([BTF]\d{1,3})\s*$/;

/**
 * Reads a returned pack. Each table row read from the file (cells joined by " | ") whose first cell is
 * a reference in this pack and whose last cell holds an answer becomes "B3. Question / Answer: …".
 * When no row is answered (a reply written as an email, say), the whole text is returned to be read as notes.
 */
export function replyNotes(pack: QuestionPack, lines: string[]): { notes: string; answered: string[] } {
  const byRef = new Map(pack.items.map(p => [p.ref, p]));
  const out: string[] = [];
  const answered: string[] = [];
  for (const line of lines) {
    // A Word table row read by the parser ("a | b | ") or a Markdown table row ("| a | b |  |").
    const md = line.trim().startsWith('|');
    const cells = md ? line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()) : line.split(' | ');
    const ref = cells[0]?.match(REF)?.[1];
    const p = ref ? byRef.get(ref) : undefined;
    if (!p || cells.length < 2) continue;
    const answer = cells.at(-1)!.trim();
    if (!answer || answer === p.how || answer === p.item.question || cells.length < 5) continue;
    out.push(`${ref}. ${p.item.question}\nAnswer: ${answer}`);
    answered.push(ref!);
  }
  return out.length ? { notes: out.join('\n\n'), answered } : { notes: lines.join('\n').trim(), answered };
}

/** The items a returned pack is answered against: the pack's own questions still open. */
export const packItems = (pack: QuestionPack, refs?: string[]) =>
  pack.items.filter(p => !refs?.length || refs.includes(p.ref)).map(p => p.item);
