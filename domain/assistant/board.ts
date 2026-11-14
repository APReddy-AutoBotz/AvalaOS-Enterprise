// Ask Avala about the Delivery board (docs/product-plan.md, "Ask Avala: the plan", stage 1, board scope).
// The facts are built here, by rule, from what the board page already reads: its items (type, status,
// owner, priority, due date, sprint, labels, parent, process), its sprints and the workspace's people by
// name. Counts and totals are worked out here and given as facts ("8 items are in progress"), because a
// model miscounts a long list. When there are more items than fit, the summaries stay and the items are
// chosen by what needs attention and how well they match the question.
import type { TaskDefinition } from '../ai/gateway.ts';
import type { WorkItem } from '../workitems/board.ts';
import { STATUS_LABEL } from '../workitems/board.ts';
import type { Sprint } from '../workitems/sprints.ts';
import { askProcess, type Fact } from './ask.ts';
import { PLATFORM_FACTS, PLATFORM_LABEL } from './platform.ts';

export const BOARD_LIMITS = { items: 200 } as const;

export interface BoardContext {
  project: { id: string; name: string };
  items: WorkItem[];
  sprints: Sprint[];
  /** The workspace's people by name (never an email address). */
  members: { userId: string; name: string }[];
  /** The workspace's processes by name, for items that came from one. */
  processes: { id: string; name: string }[];
  /** Today, as YYYY-MM-DD, for what is overdue. */
  today: string;
}

const OPEN = (i: WorkItem) => i.status !== 'done';
const KIND: Record<string, string> = { subtask: 'sub-task' };
const KINDS: Record<string, string> = { story: 'stories', subtask: 'sub-tasks' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quoted = (items: WorkItem[], max = 12) => items.slice(0, max).map(i => `"${i.title}"`).join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');
const STOP = new Set('the and for are was what which who how why when where does did this that with from into have has can item items board'.split(' '));
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !STOP.has(w)));

/** Every fact Ask Avala may answer from about one board, with where each one leads. */
export function boardFacts(question: string, ctx: BoardContext): Fact[] {
  const { project, items, sprints, today } = ctx;
  const name = (id: string | null) => (id ? ctx.members.find(m => m.userId === id)?.name ?? null : null);
  const sprintOf = new Map(sprints.map(s => [s.id, s]));
  const byId = new Map(items.map(i => [i.id, i]));
  const board = { kind: 'board' as const, projectId: project.id };
  const out: Fact[] = [];
  const summary = (id: string, text: string) => out.push({ id: `b:${id}`, text, label: `Board: ${project.name}`, target: board });

  // ---- counts, by rule
  const open = items.filter(OPEN);
  const statusCounts = Object.entries(STATUS_LABEL).map(([s, label]) => [label, items.filter(i => i.status === s).length] as const).filter(([, n]) => n > 0);
  const types = [...new Set(items.map(i => i.type))].map(t => plural(items.filter(i => i.type === t).length, KIND[t] ?? t, KINDS[t]));
  summary('summary', items.length
    ? `The board "${project.name}" has ${plural(items.length, 'item')}: ${statusCounts.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ')}. By kind: ${types.join(', ')}. Open (not done): ${open.length}.`
    : `The board "${project.name}" has no items yet.`);
  const blocked = open.filter(i => i.status === 'blocked'), held = open.filter(i => i.status === 'on_hold');
  const overdue = open.filter(i => i.dueDate && i.dueDate < today);
  const unowned = open.filter(i => !i.ownerId && i.type !== 'epic');
  summary('blocked', blocked.length ? `${plural(blocked.length, 'item is', 'items are')} blocked: ${quoted(blocked)}.` : 'No item on the board is blocked.');
  summary('on-hold', held.length ? `${plural(held.length, 'item is', 'items are')} on hold: ${quoted(held)}.` : 'No item on the board is on hold.');
  summary('overdue', overdue.length ? `${overdue.length === 1 ? '1 open item is past its due date' : `${overdue.length} open items are past their due date`}: ${quoted(overdue)}.` : `No open item is past its due date${open.some(i => i.dueDate) ? '' : '; no open item has a due date'}.`);
  summary('no-owner', unowned.length ? `${plural(unowned.length, 'open item has', 'open items have')} no owner (epics not counted): ${quoted(unowned)}.` : 'Every open item has an owner (epics not counted).');
  for (const m of ctx.members) {
    const mine = items.filter(i => i.ownerId === m.userId);
    if (!mine.length) continue;
    const by = Object.entries(STATUS_LABEL).map(([s, l]) => [l, mine.filter(i => i.status === s).length] as const).filter(([, n]) => n > 0);
    summary(`owner:${m.userId}`, `${m.name} owns ${plural(mine.length, 'item')}: ${by.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ')}.`);
  }
  // Sprints: the active one first, then those planned; completed ones only counted.
  const active = sprints.find(s => s.state === 'active');
  if (!sprints.length) summary('sprints', 'The board has no sprints.');
  for (const s of [...(active ? [active] : []), ...sprints.filter(x => x.state === 'planned')]) {
    const inIt = items.filter(i => i.sprintId === s.id);
    summary(`sprint:${s.id}`, `${s.state === 'active' ? 'Active' : 'Planned'} sprint "${s.name}"${s.goal ? `, goal: ${s.goal.trim().replace(/[.\s]+$/, '')}` : ''}${s.startsOn ? `, from ${s.startsOn}` : ''}${s.endsOn ? ` to ${s.endsOn}` : ''}: ${plural(inIt.length, 'item')}, ${inIt.filter(i => i.status === 'done').length} done.`);
  }
  const closed = sprints.filter(s => s.state === 'closed').length;
  if (closed) summary('sprints-closed', `${plural(closed, 'sprint has', 'sprints have')} been completed.`);
  if (sprints.length) summary('backlog', `${plural(items.filter(i => !i.sprintId && i.type !== 'epic' && OPEN(i)).length, 'open item is', 'open items are')} in the backlog, in no sprint.`);

  // ---- the items: what needs attention first, then what the question names, then the rest
  const q = words(question);
  const weight = (i: WorkItem) => (i.status === 'blocked' || i.status === 'on_hold' ? 4 : 0) + (overdue.includes(i) ? 4 : 0) + (OPEN(i) ? 1 : 0)
    + 2 * [...words(i.title)].filter(w => q.has(w)).length;
  const chosen = items.map((i, n) => ({ i, n, w: weight(i) })).sort((a, b) => b.w - a.w || a.n - b.n).slice(0, BOARD_LIMITS.items).sort((a, b) => a.n - b.n).map(x => x.i);
  for (const i of chosen) {
    const parent = i.parentId ? byId.get(i.parentId) : null;
    const proc = i.processId ? ctx.processes.find(p => p.id === i.processId)?.name : null;
    const sprint = i.sprintId ? sprintOf.get(i.sprintId)?.name : null;
    const parts = [
      `status ${STATUS_LABEL[i.status]}`,
      name(i.ownerId) ? `owner ${name(i.ownerId)}` : 'no owner',
      i.priority ? `priority ${i.priority}` : '',
      i.dueDate ? `due ${i.dueDate}` : '',
      i.startDate ? `starts ${i.startDate}` : '',
      i.estimateHours !== null && i.estimateHours !== undefined ? `estimate ${i.estimateHours} hours` : '',
      sprint ? `in sprint "${sprint}"` : '',
      i.labels?.length ? `labels ${i.labels.join(', ')}` : '',
      i.requirements.length ? `linked to ${i.requirements.slice(0, 5).join(', ')}${i.requirements.length > 5 ? ` and ${i.requirements.length - 5} more requirements` : ''}` : '',
      parent ? `under "${parent.title}"` : '',
      proc ? `from the process "${proc}"` : '',
    ].filter(Boolean);
    out.push({ id: `w:${i.id}`, text: `Board item (${i.type.replace('subtask', 'sub-task')}) "${i.title}": ${parts.join(', ')}.`, label: `Board: ${i.title}`, target: { kind: 'item', itemId: i.id, projectId: i.projectId } });
  }
  if (chosen.length < items.length) summary('more', `${plural(items.length - chosen.length, 'more item is', 'more items are')} on the board and not listed here.`);
  for (const p of PLATFORM_FACTS) out.push({ id: p.id, text: p.text, label: PLATFORM_LABEL, target: { kind: 'platform', stage: p.stage } });
  return out;
}

/** The same rules and shape of answer as on a process, about a board. */
export const askBoard: TaskDefinition = {
  ...askProcess,
  id: 'askBoard',
  schemaName: 'board_answer',
  // The process task's rules, line by line: the line on what the segments are is the board's own, the line
  // on the assessment does not apply, and every other line holds as it is.
  instructions: askProcess.instructions.split('\n').flatMap(line => {
    if (line.startsWith('Every other segment is one fact.')) return [
      'Every other segment is one fact. Segments whose id starts with "h:" say how Avala OS works for every process and board; when a sentence relies on one, say it as how Avala OS works, never as what this board holds. All other segments are facts from this Delivery board: counts worked out from it (by status, owner and sprint; what is blocked, on hold, overdue or without an owner), its sprints, and its items with their kind, status, owner, priority, dates, sprint, labels, parent and process. The counts are exact: use them rather than counting items yourself.',
    ];
    if (line.startsWith('The assessment was computed')) return [];
    return [line.replace(/this process's record/g, "this board's record").replace(/this process/g, 'this board')];
  }).join('\n'),
};
