// The change record in words (package 14, pull request 5, owner-approved 24 November 2026): one line per row
// of `draft_changes`, for History. The record keeps no values, only what changed, which items by their names
// in the product, who and when; this says that and nothing more. Pure.
import { docShort, type DocType } from './tree.ts';

export type ChangeKind = 'section_edit' | 'choice' | 'rate' | 'costs' | 'map_shape' | 'requirement' | 'test_edit' | 'source' | 'assessment_settings' | 'layout' | 'look';

/** The words for each kind (owner-approved). */
export const KIND_WORDS: Record<ChangeKind, string> = {
  section_edit: 'Section edit',
  choice: 'Choice of approach',
  rate: 'Hourly cost',
  costs: 'Build and running costs',
  map_shape: 'Shape of the maps',
  requirement: 'Requirement wording',
  test_edit: 'Test case',
  source: 'Source',
  assessment_settings: 'Assessment settings',
  layout: 'Document sections',
  look: 'How documents look',
};

/** History's heading and the line under it: the record starts the day its migration was applied (#224). */
export const CHANGE_RECORD_HEADING = 'Changes to documents and choices';
export const CHANGE_RECORD_SINCE = 'Recorded since 22 November 2026.';
/** Items named on a line before "and N more". */
export const ITEMS_SHOWN = 5;

export interface ChangeRow {
  processId: string | null;
  kind: ChangeKind;
  change: 'added' | 'changed' | 'removed';
  origin: 'person' | 'follows';
  items: (string | null)[];
  itemCount: number;
  actor: string | null;
  createdAt: string;
}

export interface ChangeContext {
  /** People's names by user id; a name with "@" in it is never shown. */
  names: Record<string, string>;
  /** A step's place and name in the current record ("step 4, Post invoice in SAP"); absent when it is gone. */
  stepLabel?: (stepId: string) => string | null;
}

const DOC_TYPES = new Set<string>(['pdd', 'brd', 'frd', 'sdd', 'agent', 'tests', 'evidence']);

/** "pdd:s-2-4" → "PDD, section 2.4"; a company section keeps its key. */
export function sectionLabel(item: string): string {
  const [doc, key] = item.includes(':') ? [item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)] : ['', item];
  const name = DOC_TYPES.has(doc) ? docShort(doc as DocType) : doc.toUpperCase();
  const m = /^s-([0-9A-Za-z-]+)$/.exec(key);
  const section = m ? m[1].replace(/-/g, '.') : key;
  return name ? `${name}, section ${section}` : `section ${section}`;
}

function itemLabel(kind: ChangeKind, item: string, ctx: ChangeContext): string {
  if (kind === 'section_edit') return sectionLabel(item);
  if (kind === 'choice') return ctx.stepLabel?.(item) ?? `a step no longer in the record (${item})`;
  return item;
}

/** The items of a row in words, the first `ITEMS_SHOWN`, then "and N more"; empty when the kind has none. */
export function itemsText(row: Pick<ChangeRow, 'kind' | 'items' | 'itemCount'>, ctx: ChangeContext): string {
  const named = row.items.filter((i): i is string => typeof i === 'string' && i.length > 0);
  if (!named.length) return '';
  const shown = named.slice(0, ITEMS_SHOWN).map(i => itemLabel(row.kind, i, ctx));
  const more = Math.max(row.itemCount, named.length) - shown.length;
  // Sections and steps carry a comma of their own, so they are joined with a semicolon; codes and keys with a comma.
  const joined = shown.join(row.kind === 'section_edit' || row.kind === 'choice' ? '; ' : ', ');
  return more > 0 ? `${joined} and ${more} more` : joined;
}

/** A person by name, never an email address; "Not recorded" when the record holds none. */
export function whoText(actor: string | null, names: Record<string, string>): string {
  const n = actor ? names[actor]?.trim() : '';
  return n && !n.includes('@') ? n : 'Not recorded';
}

/** One line: "Section edit changed: PDD, section 2.1", "(whole workspace)", or "Requirements followed another change: …". */
export function changeLine(row: ChangeRow, ctx: ChangeContext): string {
  const items = itemsText(row, ctx);
  const what = row.origin === 'follows'
    ? `${row.kind === 'requirement' ? 'Requirements' : KIND_WORDS[row.kind]} followed another change`
    : `${KIND_WORDS[row.kind]} ${row.change}`;
  return `${what}${items ? `: ${items}` : ''}${row.processId === null ? ' (whole workspace)' : ''}`;
}

/** The line with who and when, as History shows it. */
export function changeEntry(row: ChangeRow, ctx: ChangeContext, when: (iso: string) => string): { text: string; who: string; when: string } {
  return { text: changeLine(row, ctx), who: whoText(row.actor, ctx.names), when: row.createdAt ? when(row.createdAt) : 'Not recorded' };
}

/** What a revision row says when it was kept as a version (History's revisions). */
export const keptAsRevisionLine = (number: number, later: boolean) => (later ? `Kept as approved version ${number}, after approval` : `Kept as approved version ${number}`);
