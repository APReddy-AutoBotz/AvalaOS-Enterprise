// Working together on a board item, as in Jira: comments and the item's history (written by the
// database, migration board_collaboration). Labels are in board.ts.
import { BoardError, STATUS_LABEL, type WorkItem, type WorkStatus } from './board.ts';

// ---- Comments -------------------------------------------------------------------------------------

export interface ItemComment { id: string; workItemId: string; authorId: string | null; body: string; createdAt: string; editedAt: string | null }
export const COMMENT_LIMIT = 10000;

export function validateComment(body: string): string {
  const b = body.trim();
  if (!b) throw new BoardError('Write something first.');
  if (b.length > COMMENT_LIMIT) throw new BoardError('The comment is too long.');
  return b;
}

/** Every member comments (viewers too). Only the author edits; the author or an admin deletes. */
export function commentRights(c: Pick<ItemComment, 'authorId'>, me: string, isAdmin: boolean): { edit: boolean; remove: boolean } {
  const mine = c.authorId === me;
  return { edit: mine, remove: mine || isAdmin };
}

// ---- History --------------------------------------------------------------------------------------

export type EventField = 'title' | 'type' | 'status' | 'priority' | 'owner' | 'parent' | 'sprint' | 'estimate' | 'start_date' | 'due_date' | 'labels' | 'description' | 'acceptance_criteria';
export interface ItemEvent { id: string; workItemId: string; actorId: string | null; kind: 'created' | 'changed'; field: EventField | null; oldValue: string | null; newValue: string | null; createdAt: string }

/** Names to show: people, other items and sprints by id. Anything not found is said plainly, never shown as an id. */
export interface HistoryNames { person: (id: string) => string | undefined; item: (id: string) => Pick<WorkItem, 'title'> | undefined; sprint: (id: string) => string | undefined }

const FIELD_WORD: Record<EventField, string> = {
  title: 'the title', type: 'the kind', status: 'the status', priority: 'the priority', owner: 'the owner', parent: 'the parent',
  sprint: 'the sprint', estimate: 'the estimate', start_date: 'the start date', due_date: 'the due date', labels: 'the labels',
  description: 'the description', acceptance_criteria: 'the acceptance criteria',
};
const TYPE_WORD: Record<string, string> = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Sub-task', spike: 'Spike', decision: 'Decision' };
const PRIORITY_WORD: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

function valueWord(field: EventField, v: string | null, names: HistoryNames): string | null {
  if (v === null || v === '') return null;
  switch (field) {
    case 'status': return STATUS_LABEL[v as WorkStatus] ?? v;
    case 'type': return TYPE_WORD[v] ?? v;
    case 'priority': return PRIORITY_WORD[v] ?? v;
    case 'owner': return names.person(v) ?? 'a former member';
    case 'parent': { const i = names.item(v); return i ? i.title : 'a deleted item'; }
    case 'sprint': return names.sprint(v) ?? 'a deleted sprint';
    case 'estimate': return `${Number(v)} h`;
    case 'labels': return v.split(' ').join(', ');
    default: return v;
  }
}

/** One line of history in plain words: "Ana changed the status from To do to In progress". */
export function describeEvent(e: ItemEvent, names: HistoryNames): { who: string; text: string } {
  const who = e.actorId ? (names.person(e.actorId) ?? 'A former member') : 'Avala OS';
  if (e.kind === 'created' || !e.field) return { who, text: 'created this item' };
  const f = e.field;
  if (f === 'description' || f === 'acceptance_criteria') return { who, text: `changed ${FIELD_WORD[f]}` };
  const from = valueWord(f, e.oldValue, names), to = valueWord(f, e.newValue, names);
  if (!from && to) return { who, text: `set ${FIELD_WORD[f]} to ${to}` };
  if (from && !to) return { who, text: f === 'owner' ? `unassigned ${from}` : `cleared ${FIELD_WORD[f]} (was ${from})` };
  return { who, text: `changed ${FIELD_WORD[f]} from ${from} to ${to}` };
}

/** Newest first; changes made in one save (same person, same moment) stay together in their saved order. */
export function historyOrder(events: ItemEvent[]): ItemEvent[] {
  return [...events].sort((a, b) => (a.createdAt === b.createdAt ? Number(a.id) - Number(b.id) : a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * The rows the database's history trigger writes when an item changes (app_private.log_work_item_change),
 * for the in-browser store. Keep the two in step: same fields, long text without its values.
 */
export function changedFields(before: WorkItem, after: WorkItem): { field: EventField; oldValue: string | null; newValue: string | null }[] {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const rows: [EventField, string | null, string | null, boolean][] = [
    ['title', before.title, after.title, true],
    ['type', before.type, after.type, true],
    ['status', before.status, after.status, true],
    ['priority', s(before.priority), s(after.priority), true],
    ['owner', s(before.ownerId), s(after.ownerId), true],
    ['parent', s(before.parentId), s(after.parentId), true],
    ['sprint', s(before.sprintId), s(after.sprintId), true],
    ['estimate', s(before.estimateHours), s(after.estimateHours), true],
    ['start_date', s(before.startDate), s(after.startDate), true],
    ['due_date', s(before.dueDate), s(after.dueDate), true],
    ['labels', (before.labels ?? []).join(' '), (after.labels ?? []).join(' '), true],
    ['description', before.description, after.description, false],
    ['acceptance_criteria', JSON.stringify(before.acceptance), JSON.stringify(after.acceptance), false],
  ];
  return rows.filter(([, o, n]) => o !== n).map(([field, o, n, keep]) => ({ field, oldValue: keep ? o : null, newValue: keep ? n : null }));
}
