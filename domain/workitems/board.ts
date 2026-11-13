// The Delivery board for confirmed work items: columns, moves, and the trace back to requirements.
// A board item is never changed by the process: when a linked requirement's wording changes after
// the item was confirmed, the item shows "Upstream changed" with the before and after, and a person
// decides what to do.
import type { ProposalType } from './derive.ts';

export type WorkStatus = 'todo' | 'in_progress' | 'in_review' | 'testing' | 'ready_for_release' | 'done' | 'blocked' | 'on_hold';
export const COLUMNS: { id: WorkStatus; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'in_progress', label: 'In progress' }, { id: 'in_review', label: 'In review' },
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
export interface WorkItemEdit { title?: string; description?: string; status?: WorkStatus; priority?: WorkItem['priority']; ownerId?: string | null; estimateHours?: number | null; startDate?: string | null; dueDate?: string | null }

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

/** A board lane: an epic and the work under it. Epics head lanes, as in Jira and Azure DevOps; they are not cards. */
export interface Lane { epic: WorkItem | null; items: WorkItem[]; done: number }
/** One lane per epic, in the order the epics come, then one lane for work that has no epic. */
export function lanesOf(items: WorkItem[]): Lane[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const epicOf = (i: WorkItem): WorkItem | null => {
    let cur: WorkItem | undefined = i.parentId ? byId.get(i.parentId) : undefined;
    for (let n = 0; cur && n < 10; n++) { if (cur.type === 'epic') return cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return null;
  };
  const lanes = new Map<string, Lane>(items.filter(i => i.type === 'epic').map(e => [e.id, { epic: e, items: [], done: 0 }]));
  const loose: Lane = { epic: null, items: [], done: 0 };
  for (const i of items) {
    if (i.type === 'epic') continue;
    const lane = lanes.get(epicOf(i)?.id ?? '') ?? loose;
    lane.items.push(i);
    if (i.status === 'done') lane.done++;
  }
  return [...lanes.values(), ...(loose.items.length ? [loose] : [])];
}

/** A story's description opens with its "As the…, I want…" line. The line is shown on its own, once. */
export function splitStory(description: string): { story: string | null; rest: string } {
  const [first, ...more] = description.split('\n');
  if (!/^As (the|a|an) .+, I want /.test(first)) return { story: null, rest: description };
  return { story: first, rest: more.join('\n').replace(/^\n+/, '') };
}
export const joinStory = (story: string | null, rest: string) => (story ? (rest.trim() ? `${story}\n\n${rest}` : story) : rest);

/** What is set on an item, for a card: nothing is shown for what the team has not set yet. */
export function planningFacts(i: Pick<WorkItem, 'estimateHours' | 'startDate' | 'dueDate'>): { estimate: string | null; date: string | null } {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { estimate: i.estimateHours !== null ? `${i.estimateHours} h` : null, date: i.dueDate ? `Due ${day(i.dueDate)}` : i.startDate ? `Starts ${day(i.startDate)}` : null };
}

/** The words of a criterion that carry its shape, so the screen can set them apart. */
export function criterionParts(text: string): { word: string; text: string }[] | null {
  const m = /^Given (.+?), when (.+?), then (.+)$/s.exec(text);
  return m ? [{ word: 'Given', text: m[1] }, { word: 'when', text: m[2] }, { word: 'then', text: m[3] }] : null;
}

/** Two letters for a person's mark on a card: "Priya Nair" -> "PN", "analyst" -> "AN". */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}
