// What changed in a document since the approved revision: each section is compared by id between
// the document built from the approved model and the one built from the working draft. A section
// whose text, tables or map differ is "changed since approved"; the rest are untouched. The approved
// revision itself is never changed: its document can always be rebuilt from its own model.
import type { Block, DocTree, Section } from './tree.ts';
import { hashText } from './edits.ts';

const cellText = (c: { text: string }) => c.text;
function blockText(b: Block): string[] {
  switch (b.kind) {
    case 'paragraph': case 'callout': return [b.text];
    case 'list': return b.items.map(i => `• ${i}`);
    case 'table': return b.rows.length ? b.rows.map(r => r.map(cellText).join(' | ')) : [b.empty];
    case 'keyValue': return b.rows.map(r => `${r.key}: ${cellText(r.value)}`);
    case 'openItem': return [`Open: ${b.item.text}`];
    case 'rich': return [b.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()];
    case 'figure': return [`[${b.caption}] ${hashText(b.svg)}`];
    default: return [];
  }
}
/** A section as lines of text, for comparing and for showing a diff. */
export const sectionLines = (s: Section): string[] => [s.title, ...s.blocks.flatMap(blockText)];

export interface SectionChange { id: string; number: string; title: string; kind: 'changed' | 'added' | 'removed'; diff: DiffLine[]; figure: boolean }
export interface DiffLine { op: 'same' | 'add' | 'del'; text: string }

/** Line diff (longest common subsequence), small inputs only. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length, m = b.length;
  if (n * m > 250_000) return [...a.map(text => ({ op: 'del' as const, text })), ...b.map(text => ({ op: 'add' as const, text }))];
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'same', text: a[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: 'del', text: a[i++] });
    else out.push({ op: 'add', text: b[j++] });
  }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

/** Sections that differ between two builds of the same document type, in the new document's order. */
export function changedSections(before: DocTree, after: DocTree): SectionChange[] {
  const old = new Map(before.sections.map(s => [s.id, s]));
  const out: SectionChange[] = [];
  for (const s of after.sections) {
    const o = old.get(s.id);
    const figure = s.blocks.some(b => b.kind === 'figure');
    if (!o) { out.push({ id: s.id, number: s.number, title: s.title, kind: 'added', diff: sectionLines(s).map(text => ({ op: 'add', text })), figure }); continue; }
    const a = sectionLines(o), b = sectionLines(s);
    if (a.join('\n') !== b.join('\n')) out.push({ id: s.id, number: s.number, title: s.title, kind: 'changed', diff: diffLines(a, b), figure });
  }
  const now = new Set(after.sections.map(s => s.id));
  for (const s of before.sections) if (!now.has(s.id)) out.push({ id: s.id, number: s.number, title: s.title, kind: 'removed', diff: sectionLines(s).map(text => ({ op: 'del', text })), figure: false });
  return out;
}
