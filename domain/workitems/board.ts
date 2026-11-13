// The Delivery board for confirmed work items: columns, moves, and the trace back to requirements.
// A board item is never changed by the process: when a linked requirement's wording changes after
// the item was confirmed, the item shows "Upstream changed" with the before and after, and a person
// decides what to do.
import type { ProposalType } from './derive.ts';

export type WorkStatus = 'todo' | 'in_progress' | 'in_review' | 'testing' | 'ready_for_release' | 'done' | 'blocked' | 'on_hold';
export const COLUMNS: { id: WorkStatus; label: string }[] = [
  { id: 'todo', label: 'To Do' }, { id: 'in_progress', label: 'In progress' }, { id: 'in_review', label: 'In review' },
  { id: 'testing', label: 'Testing' }, { id: 'ready_for_release', label: 'Ready for release' }, { id: 'done', label: 'Done' },
  { id: 'blocked', label: 'Blocked' }, { id: 'on_hold', label: 'On hold' },
];
export const STATUS_LABEL = Object.fromEntries(COLUMNS.map(c => [c.id, c.label])) as Record<WorkStatus, string>;

export interface WorkItem {
  id: string;
  projectId: string;
  parentId: string | null;
  type: ProposalType | 'bug' | 'subtask';
  title: string;
  description: string;
  acceptance: string[];
  status: WorkStatus;
  priority: 'high' | 'medium' | 'low' | null;
  ownerId: string | null;
  estimateHours: number | null;
  startDate: string | null;
  dueDate: string | null;
  processId: string | null;
  stepIds: string[];
  /** Requirement codes, and their wording when the item was confirmed. */
  requirements: string[];
  snapshot: Record<string, string>;
  updatedAt: string;
}
export interface Project { id: string; name: string; description: string }

export class BoardError extends Error {}
export const BOARD_LIMITS = { title: 300, description: 8000, project: 200 } as const;

/** What a person may change on a board item. Owner, estimate and dates may stay empty. */
export interface WorkItemEdit { title?: string; description?: string; status?: WorkStatus; priority?: WorkItem['priority']; estimateHours?: number | null; startDate?: string | null; dueDate?: string | null }

export function validateEdit(item: WorkItem, e: WorkItemEdit): WorkItemEdit {
  const out: WorkItemEdit = { ...e };
  if (e.title !== undefined) {
    out.title = e.title.trim();
    if (!out.title) throw new BoardError('Give the item a title.');
    if (out.title.length > BOARD_LIMITS.title) throw new BoardError('The title is too long.');
  }
  if (e.description !== undefined && e.description.length > BOARD_LIMITS.description) throw new BoardError('The description is too long.');
  if (e.status !== undefined && !COLUMNS.some(c => c.id === e.status)) throw new BoardError('Unknown status.');
  if (e.estimateHours !== undefined && e.estimateHours !== null && !(e.estimateHours >= 0 && e.estimateHours < 100000)) throw new BoardError('The estimate must be a number of hours.');
  const start = e.startDate !== undefined ? e.startDate : item.startDate, due = e.dueDate !== undefined ? e.dueDate : item.dueDate;
  if (start && due && due < start) throw new BoardError('The due date is before the start date.');
  return out;
}

export function validateProjectName(name: string): string {
  const n = name.trim();
  if (!n) throw new BoardError('Name the project.');
  if (n.length > BOARD_LIMITS.project) throw new BoardError('The project name is too long.');
  return n;
}

export interface UpstreamChange { code: string; before: string | null; after: string | null }
/** Linked requirements whose wording changed, or that were removed, since the item was confirmed. */
export function upstreamChanges(item: WorkItem, current: { code: string; statement: string; state: string }[]): UpstreamChange[] {
  const out: UpstreamChange[] = [];
  for (const code of item.requirements) {
    const before = item.snapshot[code] ?? null;
    const now = current.find(r => r.code === code);
    const after = now && now.state !== 'retired' ? now.statement : null;
    if (before === null) continue; // no wording was recorded at confirm time: nothing to compare
    if (after !== before) out.push({ code, before, after });
  }
  return out;
}

/** "Unassigned · Not estimated · No date", in plain words, for what is still open on an item. */
export function planningLine(i: Pick<WorkItem, 'ownerId' | 'estimateHours' | 'startDate' | 'dueDate'>, ownerName?: string): string {
  return [
    i.ownerId ? ownerName ?? 'Assigned' : 'Unassigned',
    i.estimateHours !== null ? `${i.estimateHours} h` : 'Not estimated',
    i.dueDate ? `Due ${i.dueDate}` : i.startDate ? `Starts ${i.startDate}` : 'No date',
  ].join(' · ');
}
