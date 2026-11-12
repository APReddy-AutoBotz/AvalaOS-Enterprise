// A company's own document structure, applied to a built document: sections renamed, hidden or
// reordered, and the company's own sections added. Content still comes only from the builders, so a
// layout can change where things are and what they are called, never what the facts say. The closing
// list of open items cannot be hidden, and an item raised in a hidden section is still listed there.
import { NOT_PROVIDED, type Block, type DocTree, type DocType, type Section } from './tree.ts';
import type { DocLayout } from './branding.ts';

export interface OutlineEntry { number: string; title: string; level: 1 | 2; locked: boolean }
export class LayoutError extends Error {}

export const EMPTY_LAYOUT: DocLayout = { sections: {}, custom: [] };
export const LAYOUT_LIMITS = { title: 120, customText: 4000, custom: 30 } as const;
/** The closing list of open items: always shown. */
export const isLocked = (title: string) => /^open (gaps|questions)/i.test(title);

export const outlineOf = (doc: DocTree): OutlineEntry[] =>
  doc.sections.map(s => ({ number: s.number, title: s.title, level: s.level, locked: isLocked(s.title) }));

/** Checks a layout against the document's own outline before saving. Throws LayoutError naming the problem. */
export function validateLayout(layout: DocLayout, outline: OutlineEntry[]): DocLayout {
  const numbers = new Set(outline.map(o => o.number));
  const sections: DocLayout['sections'] = {};
  for (const [n, v] of Object.entries(layout.sections ?? {})) {
    const o = outline.find(x => x.number === n);
    if (!o) continue; // a section that no longer exists is dropped, not an error
    const title = v.title?.trim();
    if (title !== undefined && title.length > LAYOUT_LIMITS.title) throw new LayoutError(`Keep the title of section ${n} under ${LAYOUT_LIMITS.title} characters.`);
    if (v.hidden && o.locked) throw new LayoutError(`Section ${n} lists the open items and cannot be hidden.`);
    const entry: { title?: string; hidden?: boolean } = {};
    if (title && title !== o.title) entry.title = title;
    if (v.hidden) entry.hidden = true;
    if (Object.keys(entry).length) sections[n] = entry;
  }
  const tops = outline.filter(o => o.level === 1).map(o => o.number);
  let order: string[] | undefined;
  if (layout.order?.length) {
    const known = layout.order.filter(n => tops.includes(n));
    order = [...new Set([...known, ...tops.filter(n => !known.includes(n))])];
    if (order.join() === tops.join()) order = undefined;
  }
  if ((layout.custom ?? []).length > LAYOUT_LIMITS.custom) throw new LayoutError(`Add at most ${LAYOUT_LIMITS.custom} sections of your own.`);
  const custom = (layout.custom ?? []).map(c => {
    const title = c.title.trim();
    if (!title) throw new LayoutError('Give every section of your own a title.');
    if (title.length > LAYOUT_LIMITS.title) throw new LayoutError(`Keep the title "${title.slice(0, 30)}…" under ${LAYOUT_LIMITS.title} characters.`);
    if (c.text.length > LAYOUT_LIMITS.customText) throw new LayoutError(`Keep the text of "${title}" under ${LAYOUT_LIMITS.customText} characters.`);
    if (c.after !== 'start' && !numbers.has(c.after)) throw new LayoutError(`"${title}" is placed after a section that does not exist.`);
    return { id: c.id, after: c.after, title, text: c.text.trim() };
  });
  return { sections, ...(order ? { order } : {}), custom };
}

const customSection = (c: DocLayout['custom'][number], level: 1 | 2): Section => ({
  id: `c-${c.id}`, number: '', title: c.title, level,
  blocks: c.text ? c.text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(text => ({ kind: 'paragraph', text }) as Block) : [{ kind: 'callout', tone: 'info', text: NOT_PROVIDED }],
});

/** The document with the layout applied and the sections numbered again in their new order. */
export function applyLayout(doc: DocTree, layout: DocLayout | undefined): DocTree {
  if (!layout || (!Object.keys(layout.sections ?? {}).length && !layout.order?.length && !(layout.custom ?? []).length)) return doc;
  // Group each top-level section with its subsections.
  const groups: Section[][] = [];
  for (const s of doc.sections) {
    if (s.level === 1 || !groups.length) groups.push([s]); else groups.at(-1)!.push(s);
  }
  const head = (g: Section[]) => g[0].number;
  const order = layout.order?.length ? layout.order : groups.map(head);
  const sorted = [...groups].sort((a, b) => {
    const ia = order.indexOf(head(a)), ib = order.indexOf(head(b));
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
  });
  const custom = layout.custom ?? [];
  const hidden = (s: Section) => !isLocked(s.title) && !!layout.sections?.[s.number]?.hidden;

  const out: Section[] = [];
  for (const c of custom.filter(c => c.after === 'start')) out.push(customSection(c, 1));
  for (const g of sorted) {
    if (hidden(g[0])) { for (const c of custom.filter(c => g.some(s => s.number === c.after))) out.push(customSection(c, 1)); continue; }
    for (const s of g) {
      if (!hidden(s)) out.push({ ...s, title: layout.sections?.[s.number]?.title || s.title });
      if (s.level === 2) for (const c of custom.filter(c => c.after === s.number)) out.push(customSection(c, 2));
    }
    for (const c of custom.filter(c => c.after === g[0].number)) out.push(customSection(c, 1));
  }
  // Number again: 1, 1.1, 1.2, 2, …
  const renumber = new Map<string, string>();
  let top = 0, sub = 0;
  const numbered = out.map(s => {
    let n: string;
    if (s.level === 1 || top === 0) { top += 1; sub = 0; n = String(top); } else { sub += 1; n = `${top}.${sub}`; }
    if (s.number) renumber.set(s.number, n);
    return { ...s, number: n, level: (s.level === 2 && top > 0 ? 2 : 1) as 1 | 2 };
  });
  const map = (n: string | undefined) => (n ? renumber.get(n) ?? '' : n);
  const openItems = doc.openItems.map(o => ({ ...o, section: map(o.section) || undefined }));
  const sections = numbered.map(s => ({
    ...s,
    blocks: s.blocks.map(b => {
      if (b.kind === 'openItem') return { ...b, item: { ...b.item, section: map(b.item.section) || undefined } };
      if (b.kind === 'table' && b.columns.at(-1) === 'Raised in') return { ...b, rows: b.rows.map(r => [...r.slice(0, -1), { ...r.at(-1)!, text: map(r.at(-1)!.text) ?? '' }]) };
      return b;
    }),
  }));
  return { ...doc, sections, openItems };
}

// ---- Suggesting a layout from a company's Word template ------------------------------------------

const SYNONYMS: [RegExp, string][] = [
  [/\b(as[- ]?is|current[- ]state|existing)\b/g, 'asis'],
  [/\b(to[- ]?be|future[- ]state|target|proposed)\b/g, 'tobe'],
  [/\b(applications?|systems?|tools?)\b/g, 'system'],
  [/\b(exceptions?|errors?)\b/g, 'exception'],
  [/\b(goals?|objectives?|aims?)\b/g, 'objective'],
  [/\b(contacts?|stakeholders?|raci|roles?)\b/g, 'contact'],
  [/\b(prerequisites?|pre-requisites?|requirements?)\b/g, 'requirement'],
  [/\b(gaps?|questions?|issues?|deferred)\b/g, 'open'],
  [/\b(maps?|diagrams?|flows?|flowcharts?)\b/g, 'map'],
  [/\b(steps?|activities|procedures?)\b/g, 'step'],
  [/\b(introduction|overview|summary|purpose)\b/g, 'overview'],
  [/\b(references?|sources?|appendix)\b/g, 'source'],
];
const STOP = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'to', 'in', 'this', 'document', 'process', 'detailed', 'details', 'description']);
function words(t: string): Set<string> {
  let s = t.toLowerCase().replace(/^\s*[\d.]+\s*/, '');
  for (const [re, w] of SYNONYMS) s = s.replace(re, ` ${w} `);
  return new Set(s.split(/[^a-z]+/).filter(w => w.length > 1 && !STOP.has(w)));
}
const similarity = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let both = 0; for (const w of a) if (b.has(w)) both += 1;
  return both / Math.max(a.size, b.size);
};

export interface HeadingMatch { heading: string; level: number; number: string | null; score: number }
export interface LayoutSuggestion { matches: HeadingMatch[]; layout: DocLayout; unmatchedSections: string[] }

/**
 * Matches the template's headings to the document's sections by meaning-bearing words. A match renames
 * the section to the company's heading and follows its order; a heading with no match becomes a section
 * of the company's own, left empty for the company's text. Sections with no heading stay as they are,
 * so nothing the model knows is dropped. A person reviews the suggestion before it is saved.
 */
export function suggestLayout(outline: OutlineEntry[], headings: { level: number; text: string }[], threshold = 0.5): LayoutSuggestion {
  const taken = new Set<string>();
  const matches: HeadingMatch[] = headings.filter(h => h.text.trim()).map(h => {
    const hw = words(h.text);
    let best: OutlineEntry | null = null, score = 0;
    for (const o of outline) {
      if (taken.has(o.number)) continue;
      const sc = similarity(hw, words(o.title)) + (Math.min(h.level, 2) === o.level ? 0.05 : 0);
      if (sc > score) { best = o; score = sc; }
    }
    if (best && score >= threshold) { taken.add(best.number); return { heading: h.text.trim(), level: h.level, number: best.number, score: Math.round(score * 100) / 100 }; }
    return { heading: h.text.trim(), level: h.level, number: null, score: 0 };
  });
  const sections: DocLayout['sections'] = {};
  for (const m of matches) if (m.number) {
    const o = outline.find(x => x.number === m.number)!;
    const t = m.heading.replace(/^\s*[\d.]+\s*/, '').trim();
    if (t && t !== o.title) sections[m.number] = { title: t.slice(0, LAYOUT_LIMITS.title) };
  }
  // Order of top-level sections: as the template orders the headings that matched them.
  const topOf = (n: string) => n.split('.')[0];
  const order = [...new Set(matches.filter(m => m.number).map(m => topOf(m.number!)))];
  const custom: DocLayout['custom'] = [];
  let after = 'start';
  matches.forEach((m, i) => {
    if (m.number) { after = m.number; return; }
    custom.push({ id: `t${i + 1}`, after, title: m.heading.replace(/^\s*[\d.]+\s*/, '').slice(0, LAYOUT_LIMITS.title) || m.heading, text: '' });
  });
  return {
    matches,
    layout: { sections, ...(order.length ? { order } : {}), custom },
    unmatchedSections: outline.filter(o => !taken.has(o.number)).map(o => o.number),
  };
}

export const layoutFor = (layouts: Partial<Record<DocType, DocLayout>>, type: DocType): DocLayout => layouts[type] ?? EMPTY_LAYOUT;
