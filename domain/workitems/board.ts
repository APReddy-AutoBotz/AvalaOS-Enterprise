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
  /** Order on the board; new items go last. */
  sortOrder?: number;
  /** Labels as in Jira (`parseLabels`). */
  labels?: string[];
  /** The sprint it is planned in (domain/workitems/sprints.ts); none is the backlog. */
  sprintId?: string | null;
}
export interface Project { id: string; name: string; description: string }

export class BoardError extends Error {}
export const BOARD_LIMITS = { title: 300, description: 8000, project: 200 } as const;

/** What a person may change on a board item. Owner, estimate and dates may stay empty. */
export interface WorkItemEdit { title?: string; description?: string; status?: WorkStatus; priority?: WorkItem['priority']; ownerId?: string | null; estimateHours?: number | null; startDate?: string | null; dueDate?: string | null; parentId?: string | null; labels?: string[]; sprintId?: string | null }

// ---- Items a person adds by hand (the board on its own, without a process) ------------------------

export type ItemType = WorkItem['type'];
/** The kinds a person adds by hand, as in Jira. Spikes and decisions come from a process's work items. */
export const MANUAL_TYPES = ['epic', 'story', 'task', 'bug', 'subtask'] as const satisfies readonly ItemType[];
export type ManualType = (typeof MANUAL_TYPES)[number];

/**
 * Where an item may sit, as in Jira: an epic has no parent; a story, task or bug sits under an epic or
 * nowhere; a sub-task sits under a story, task or bug, never on its own. Spikes and decisions follow
 * the task rule.
 */
const PARENT_KINDS: Record<ItemType, readonly ItemType[]> = {
  epic: [], story: ['epic'], task: ['epic', 'story'], bug: ['epic', 'story'], spike: ['epic', 'story'], decision: ['epic', 'story'],
  subtask: ['story', 'task', 'bug', 'spike', 'decision'],
};
export const needsParent = (type: ItemType) => type === 'subtask';

/** The items a given kind may be put under, on this board (never the item itself or anything under it). */
export function allowedParents(type: ItemType, items: WorkItem[], selfId?: string): WorkItem[] {
  const below = selfId ? descendantsOf(selfId, items) : new Set<string>();
  return items.filter(i => PARENT_KINDS[type].includes(i.type) && i.id !== selfId && !below.has(i.id));
}

/** Every item under this one, at any depth. */
export function descendantsOf(id: string, items: WorkItem[]): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => { for (const i of items) if (i.parentId === pid && !out.has(i.id)) { out.add(i.id); walk(i.id); } };
  walk(id);
  return out;
}

function parentProblem(type: ItemType, parentId: string | null | undefined, items: WorkItem[], selfId?: string): string | null {
  if (!parentId) return needsParent(type) ? 'Choose the story, task or bug this sub-task belongs to.' : null;
  const parent = items.find(i => i.id === parentId);
  if (!parent) return 'That parent is not on this board.';
  if (!allowedParents(type, items, selfId).some(i => i.id === parentId)) {
    if (type === 'epic') return 'An epic cannot sit under another item.';
    const article = /^[aeiou]/.test(typeWord(parent.type)) ? 'an' : 'a';
    return `A ${typeWord(type)} cannot sit under ${article} ${typeWord(parent.type)}${selfId && descendantsOf(selfId, items).has(parentId) ? ' that is under it' : ''}.`;
  }
  return null;
}
const typeWord = (t: ItemType) => ({ epic: 'epic', story: 'story', task: 'task', bug: 'bug', subtask: 'sub-task', spike: 'spike', decision: 'decision' })[t];

export interface NewWorkItem {
  type: ManualType;
  title: string;
  description?: string;
  parentId?: string | null;
  ownerId?: string | null;
  priority?: WorkItem['priority'];
  estimateHours?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  labels?: string[];
}

/** Checks an item a person adds and gives it its place: the end of To do. */
export function validateNewItem(n: NewWorkItem, items: WorkItem[]): Required<NewWorkItem> & { status: WorkStatus; sortOrder: number } {
  if (!MANUAL_TYPES.includes(n.type)) throw new BoardError('Choose what kind of item this is.');
  const title = (n.title ?? '').trim();
  if (!title) throw new BoardError('Give the item a title.');
  if (title.length > BOARD_LIMITS.title) throw new BoardError('The title is too long.');
  const description = n.description ?? '';
  if (description.length > BOARD_LIMITS.description) throw new BoardError('The description is too long.');
  const problem = parentProblem(n.type, n.parentId, items);
  if (problem) throw new BoardError(problem);
  if (n.priority !== undefined && n.priority !== null && !['high', 'medium', 'low'].includes(n.priority)) throw new BoardError('Unknown priority.');
  const estimate = n.estimateHours ?? null;
  if (estimate !== null && !(estimate >= 0 && estimate < 100000)) throw new BoardError('The estimate must be a number of hours.');
  const start = n.startDate || null, due = n.dueDate || null;
  if (start && due && due < start) throw new BoardError('The due date is before the start date.');
  const last = Math.max(0, ...items.map(i => i.sortOrder ?? 0));
  return {
    type: n.type, title, description, parentId: n.parentId || null, ownerId: n.ownerId || null, priority: n.priority ?? null,
    estimateHours: estimate, startDate: start, dueDate: due, labels: parseLabels(n.labels ?? []), status: 'todo', sortOrder: last + 1,
  };
}

/** What deleting an item does to the rest, in words for the confirmation. */
export function deleteEffect(item: WorkItem, items: WorkItem[]): string {
  const under = items.filter(i => i.parentId === item.id);
  const what = `Delete this ${typeWord(item.type)}? This cannot be undone.`;
  if (!under.length) return what;
  return `${what} The ${under.length === 1 ? 'item' : `${under.length} items`} directly under it ${under.length === 1 ? 'stays' : 'stay'} on the board without a parent.`;
}

export function validateEdit(item: WorkItem, e: WorkItemEdit, items: WorkItem[] = []): WorkItemEdit {
  const out: WorkItemEdit = { ...e };
  if (e.parentId !== undefined) {
    out.parentId = e.parentId || null;
    const problem = parentProblem(item.type, out.parentId, items, item.id);
    if (problem) throw new BoardError(problem);
  }
  if (e.title !== undefined) {
    out.title = e.title.trim();
    if (!out.title) throw new BoardError('Give the item a title.');
    if (out.title.length > BOARD_LIMITS.title) throw new BoardError('The title is too long.');
  }
  if (e.labels !== undefined) out.labels = parseLabels(e.labels);
  if (e.sprintId !== undefined) {
    out.sprintId = e.sprintId || null;
    if (out.sprintId && item.type === 'epic') throw new BoardError('An epic is not put in a sprint; its work is.');
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

// ---- Labels ---------------------------------------------------------------------------------------

export const LABEL_LIMITS = { count: 20, length: 40 } as const;

/**
 * Labels as in Jira: words without spaces or commas. A person types them separated by spaces or commas;
 * repeats are dropped (ignoring case, the first spelling is kept), order is kept.
 */
export function parseLabels(input: string | string[]): string[] {
  const parts = (Array.isArray(input) ? input : [input]).flatMap(s => s.split(/[\s,]+/)).filter(Boolean);
  const seen = new Set<string>(), out: string[] = [];
  for (const p of parts) {
    if (p.length > LABEL_LIMITS.length) throw new BoardError(`A label can be at most ${LABEL_LIMITS.length} characters: "${p.slice(0, 20)}…"`);
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  if (out.length > LABEL_LIMITS.count) throw new BoardError(`An item can have at most ${LABEL_LIMITS.count} labels.`);
  return out;
}

/** Every label on the board, most used first, for suggestions and the filter. */
export function boardLabels(items: Pick<WorkItem, 'labels'>[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) for (const l of i.labels ?? []) count.set(l, (count.get(l) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}
