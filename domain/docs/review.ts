// Review comments on document sections (part F, with G's review comments; table document_comments).
// A comment belongs to a document type and a section key, and keeps the section's title as written,
// so a comment whose section has since gone (renamed by a layout, or dropped) can still be read.
import type { DocTree, DocType } from './tree.ts';

export interface SectionComment {
  id: string;
  docType: DocType;
  sectionKey: string;
  sectionTitle: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export const COMMENT_MAX = 10000;

export class ReviewError extends Error {}

export function validateSectionComment(body: string): string {
  const b = body.trim();
  if (!b) throw new ReviewError('Write something first.');
  if (b.length > COMMENT_MAX) throw new ReviewError('The comment is too long.');
  return b;
}

export interface ReviewView {
  /** Comments per section key of this document, oldest first. */
  bySection: Map<string, SectionComment[]>;
  /** Comments on this document whose section is no longer in it. */
  orphaned: SectionComment[];
  open: number;
  resolved: number;
}

/** The comments on one document, placed by section; resolved ones are counted apart. */
export function reviewOf(doc: Pick<DocTree, 'type' | 'sections'>, comments: SectionComment[]): ReviewView {
  const mine = comments.filter(c => c.docType === doc.type).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const keys = new Set(doc.sections.map(s => s.id));
  const bySection = new Map<string, SectionComment[]>();
  const orphaned: SectionComment[] = [];
  for (const c of mine) {
    if (keys.has(c.sectionKey)) bySection.set(c.sectionKey, [...(bySection.get(c.sectionKey) ?? []), c]);
    else orphaned.push(c);
  }
  return { bySection, orphaned, open: mine.filter(c => !c.resolvedAt).length, resolved: mine.filter(c => c.resolvedAt).length };
}

/** Who may do what with a comment: the database enforces the same rules. */
export function commentRights(c: Pick<SectionComment, 'authorId'>, me: { id: string; canEdit: boolean; isAdmin: boolean }) {
  const own = Boolean(me.id) && c.authorId === me.id;
  return { edit: own, resolve: own || me.canEdit, remove: own || me.isAdmin };
}

/** "3 open comments" for the document's contents, or null when there are none. */
export const openCommentsText = (n: number) => (n ? `${n} open ${n === 1 ? 'comment' : 'comments'}` : null);
