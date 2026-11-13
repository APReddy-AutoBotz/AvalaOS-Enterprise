// A person's edits to a section's narrative (plan WP3.4). The narrative of a section is its
// paragraphs, lists and notes; tables and open items always come from the model, so a fact is
// corrected in the model, never in the document. An edit is kept on every rebuild; when the generated
// narrative changes after the edit, the section needs review until the person keeps theirs or takes
// the update.
import type { Block, DocTree, DocType, Section } from './tree.ts';

export interface SectionEdit { docType: DocType; sectionKey: string; html: string; baseHash: string; updatedBy?: string; updatedAt?: string }
export type SectionState = 'generated' | 'edited' | 'needs_review';
export interface SectionStatus { state: SectionState; openItems: number; generatedHtml: string; hash: string }

const isNarrative = (b: Block) => b.kind === 'paragraph' || b.kind === 'list' || b.kind === 'callout';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The generated narrative of a section as editor HTML. */
export function narrativeHtml(s: Section): string {
  return s.blocks.filter(isNarrative).map(b => {
    if (b.kind === 'list') return `<ul>${b.items.map(i => `<li><p>${esc(i)}</p></li>`).join('')}</ul>`;
    return `<p>${esc((b as { text: string }).text)}</p>`;
  }).join('');
}

/** A short, stable hash (FNV-1a, 32 bit, hex) of the generated narrative. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---- Sanitising: only the tags the editor makes, no attributes. -----------------------------------
const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br', 'h3', 'h4']);
export const MAX_EDIT_CHARS = 100_000;
export class EditError extends Error {}

export function sanitizeHtml(html: string): string {
  if (html.length > MAX_EDIT_CHARS) throw new EditError('The section text is too long.');
  return html
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g, (m, tag: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return '';
      return m.startsWith('</') ? `</${t}>` : t === 'br' ? '<br>' : `<${t}>`;
    })
    .trim();
}

// ---- Reading the edited HTML back into runs, for Word and Markdown. ---------------------------------
export interface Run { text: string; bold?: boolean; italic?: boolean }
export interface RichPara { kind: 'p' | 'li' | 'heading'; ordered?: boolean; runs: Run[] }

const unesc = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Paragraphs, list items and headings with bold and italic runs. */
export function richParas(html: string): RichPara[] {
  const out: RichPara[] = [];
  const list: ('ul' | 'ol')[] = [];
  let cur: RichPara | null = null;
  let bold = 0, italic = 0;
  const flush = () => { if (cur && cur.runs.some(r => r.text.trim())) out.push(cur); cur = null; };
  const start = (kind: RichPara['kind']) => { flush(); cur = { kind, ...(kind === 'li' ? { ordered: list.at(-1) === 'ol' } : {}), runs: [] }; };
  for (const tok of sanitizeHtml(html).split(/(<[^>]+>)/).filter(Boolean)) {
    const m = /^<(\/?)([a-z0-9]+)>$/.exec(tok);
    if (!m) {
      const text = unesc(tok);
      if (!text) continue;
      if (!cur) start(list.length ? 'li' : 'p');
      cur!.runs.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
      continue;
    }
    const [, close, t] = m;
    if (t === 'ul' || t === 'ol') { if (close) { list.pop(); flush(); } else { flush(); list.push(t); } }
    else if (t === 'li') { if (close) flush(); else start('li'); }
    else if (t === 'p') {
      // A paragraph inside a list item belongs to the item.
      const inItem = (cur as RichPara | null)?.kind === 'li';
      if (!close && !inItem) start('p');
      else if (close && !inItem) flush();
    }
    else if (t === 'h3' || t === 'h4') { if (close) flush(); else start('heading'); }
    else if (t === 'strong' || t === 'b') bold += close ? -1 : 1;
    else if (t === 'em' || t === 'i') italic += close ? -1 : 1;
    else if (t === 'br' && cur) (cur as RichPara).runs.push({ text: '\n' });
  }
  flush();
  return out;
}

export function richMarkdown(html: string): string {
  // Spaces stay outside the markers ("a **b**", not "a** b**"), or Markdown does not read them as emphasis.
  const runMd = (r: Run) => {
    const t = r.text.replace(/\n/g, '  \n');
    const mark = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : '';
    if (!mark || !t.trim()) return t;
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!;
    return `${lead}${mark}${core}${mark}${trail}`;
  };
  let n = 0;
  return richParas(html).map(p => {
    const text = p.runs.map(runMd).join('');
    if (p.kind === 'li') return p.ordered ? `${++n}. ${text}` : `- ${text}`;
    n = 0;
    return p.kind === 'heading' ? `#### ${text}` : `${text}\n`;
  }).join('\n').trim();
}

/**
 * The document with each edit in place of its section's narrative, and every section's status.
 * Sections are matched by their builder id, so an edit follows its section through a renamed or
 * reordered layout.
 */
export function applyEdits(doc: DocTree, edits: SectionEdit[]): { doc: DocTree; status: Record<string, SectionStatus> } {
  const status: Record<string, SectionStatus> = {};
  const mine = new Map(edits.filter(e => e.docType === doc.type).map(e => [e.sectionKey, e]));
  const sections = doc.sections.map(s => {
    const generatedHtml = narrativeHtml(s);
    const hash = hashText(generatedHtml);
    const openItems = s.blocks.filter(b => b.kind === 'openItem').length;
    const e = mine.get(s.id);
    if (!e) { status[s.id] = { state: 'generated', openItems, generatedHtml, hash }; return s; }
    status[s.id] = { state: e.baseHash === hash ? 'edited' : 'needs_review', openItems, generatedHtml, hash };
    const first = s.blocks.findIndex(isNarrative);
    const rest = s.blocks.filter(b => !isNarrative(b));
    const at = first < 0 ? 0 : s.blocks.slice(0, first).filter(b => !isNarrative(b)).length;
    const rich: Block = { kind: 'rich', html: sanitizeHtml(e.html) };
    return { ...s, blocks: [...rest.slice(0, at), rich, ...rest.slice(at)] };
  });
  return { doc: { ...doc, sections }, status };
}

/** An edit to save: sanitised, against the generated narrative it replaces. */
export function newEdit(docType: DocType, section: Section, html: string): SectionEdit {
  return makeEdit(docType, section.id, html, hashText(narrativeHtml(section)));
}
/** The same, from a section's status (its hash is of the generated narrative shown beside the edit). */
export function makeEdit(docType: DocType, sectionKey: string, html: string, baseHash: string): SectionEdit {
  const clean = sanitizeHtml(html);
  if (!richParas(clean).length) throw new EditError('Write something, or use the generated text.');
  return { docType, sectionKey, html: clean, baseHash };
}
