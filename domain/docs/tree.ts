// The document tree: what every document (BRD, PDD, FRD, SDD) is rendered into before it reaches a
// screen, Markdown, Word or PDF. Builders fill it from the Process Model and the assessment only.
// A missing fact never becomes filler: it is a "Not provided" cell or an open item, and every open
// item is listed again at the end of the document.
import type { ElementTarget, FactStatus } from '../processModel/types.ts';

export type DocType = 'brd' | 'pdd' | 'frd' | 'sdd';

export interface Cell { text: string; status?: FactStatus; missing?: boolean }
export type CellInput = string | Cell;

export interface OpenItem { text: string; owner: string | null; target?: ElementTarget; section?: string }

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; caption: string; columns: string[]; rows: Cell[][]; empty: string }
  | { kind: 'keyValue'; caption: string; rows: { key: string; value: Cell }[] }
  | { kind: 'callout'; tone: 'info' | 'warning'; text: string }
  | { kind: 'openItem'; item: OpenItem };

export interface Section { id: string; number: string; title: string; level: 1 | 2; blocks: Block[] }

export interface DocTree {
  type: DocType;
  title: string;
  subtitle: string;
  control: { key: string; value: string }[];
  sections: Section[];
  openItems: OpenItem[];
}

export const NOT_PROVIDED = 'Not provided';
export const cell = (c: CellInput): Cell => (typeof c === 'string' ? { text: c } : c);
export const missing = (text = NOT_PROVIDED): Cell => ({ text, missing: true });

/** Builds sections in order, collecting every open item for the closing list. */
export class DocBuilder {
  readonly sections: Section[] = [];
  readonly openItems: OpenItem[] = [];
  private current: Section | null = null;

  section(number: string, title: string, level: 1 | 2 = 2): this {
    this.current = { id: `s-${number.replace(/[^0-9A-Za-z]+/g, '-')}`, number, title, level, blocks: [] };
    this.sections.push(this.current);
    return this;
  }
  private add(b: Block) { if (!this.current) throw new Error('Start a section first.'); this.current.blocks.push(b); return this; }
  paragraph(text: string) { return text.trim() ? this.add({ kind: 'paragraph', text }) : this; }
  list(items: string[]) { return items.length ? this.add({ kind: 'list', items }) : this; }
  callout(text: string, tone: 'info' | 'warning' = 'info') { return this.add({ kind: 'callout', tone, text }); }
  table(caption: string, columns: string[], rows: CellInput[][], empty: string) {
    return this.add({ kind: 'table', caption, columns, rows: rows.map(r => r.map(cell)), empty });
  }
  keyValue(caption: string, rows: [string, CellInput][]) {
    return this.add({ kind: 'keyValue', caption, rows: rows.map(([key, value]) => ({ key, value: cell(value) })) });
  }
  /** An open item in place; it is also listed at the end of the document. */
  open(text: string, target?: ElementTarget, owner: string | null = null) {
    const item: OpenItem = { text, owner, target, section: this.current?.number };
    if (!this.openItems.some(x => x.text === text)) this.openItems.push(item);
    return this.add({ kind: 'openItem', item });
  }
  /** Records an open item for the closing list without showing it in place (for example from a "Not provided" cell). */
  note(text: string, target?: ElementTarget) {
    if (!this.openItems.some(x => x.text === text)) this.openItems.push({ text, owner: null, target, section: this.current?.number });
    return this;
  }
}
