// Sprints on the board, as in Jira's Scrum boards: planned, then active (one at a time per project),
// then completed. Completing one moves its unfinished work to a planned sprint or to the backlog;
// done work stays with it. The database enforces the same (migration board_collaboration, close_sprint).
import { BoardError, type WorkItem } from './board.ts';

export type SprintState = 'planned' | 'active' | 'closed';
export interface Sprint {
  id: string; projectId: string; name: string; goal: string;
  startsOn: string | null; endsOn: string | null; state: SprintState;
  startedAt: string | null; closedAt: string | null;
}
export interface SprintInput { name: string; goal?: string; startsOn?: string | null; endsOn?: string | null }
export const SPRINT_LIMITS = { name: 120, goal: 2000 } as const;
export const SPRINT_STATE_LABEL: Record<SprintState, string> = { planned: 'Planned', active: 'Active', closed: 'Completed' };

export function validateSprint(s: SprintInput): Required<SprintInput> {
  const name = (s.name ?? '').trim();
  if (!name) throw new BoardError('Give the sprint a name.');
  if (name.length > SPRINT_LIMITS.name) throw new BoardError('The sprint name is too long.');
  const goal = (s.goal ?? '').trim();
  if (goal.length > SPRINT_LIMITS.goal) throw new BoardError('The sprint goal is too long.');
  const startsOn = s.startsOn || null, endsOn = s.endsOn || null;
  if (startsOn && endsOn && endsOn < startsOn) throw new BoardError('The sprint ends before it starts.');
  return { name, goal, startsOn, endsOn };
}

/** "Sprint 4" after Sprint 3, as Jira names them; a person can rename it. */
export function nextSprintName(sprints: Pick<Sprint, 'name'>[]): string {
  const n = Math.max(0, ...sprints.map(s => Number(/^Sprint (\d+)$/i.exec(s.name.trim())?.[1] ?? 0)));
  return `Sprint ${Math.max(n, sprints.length) + 1}`;
}

/** Order: the active sprint, then planned ones (as created), then completed ones (latest first). */
export function sprintOrder(sprints: Sprint[]): Sprint[] {
  const rank = { active: 0, planned: 1, closed: 2 } as const;
  return sprints.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.state] - rank[b.s.state]
    || (a.s.state === 'closed' ? (b.s.closedAt ?? '').localeCompare(a.s.closedAt ?? '') : a.i - b.i)).map(x => x.s);
}

/** Why a sprint cannot start now, or null when it can. */
export function startProblem(sprint: Sprint, sprints: Sprint[]): string | null {
  if (sprint.state !== 'planned') return sprint.state === 'active' ? 'This sprint is already running.' : 'A completed sprint cannot start again.';
  const running = sprints.find(s => s.state === 'active' && s.projectId === sprint.projectId);
  return running ? `Complete ${running.name} first: one sprint runs at a time on a board.` : null;
}

/** The work in a sprint, and what completing it would do. */
export function sprintSummary(sprint: Sprint, items: WorkItem[]): { done: number; open: number; total: number } {
  const work = items.filter(i => i.sprintId === sprint.id);
  const done = work.filter(i => i.status === 'done').length;
  return { done, open: work.length - done, total: work.length };
}

/** Where a completed sprint's unfinished work may go: a planned sprint of the same board, or the backlog. */
export function moveTargets(sprint: Sprint, sprints: Sprint[]): Sprint[] {
  return sprintOrder(sprints).filter(s => s.state === 'planned' && s.projectId === sprint.projectId && s.id !== sprint.id);
}

export function closeEffect(sprint: Sprint, items: WorkItem[], target: Sprint | null): string {
  const { done, open } = sprintSummary(sprint, items);
  const doneText = done ? `${done} done ${done === 1 ? 'item stays' : 'items stay'} with ${sprint.name}.` : '';
  if (!open) return `Complete ${sprint.name}? ${doneText || 'It has no work in it.'}`.trim();
  const where = target ? `move to ${target.name}` : 'go back to the backlog';
  return `Complete ${sprint.name}? ${open} unfinished ${open === 1 ? 'item will' : 'items will'} ${where}. ${doneText}`.trim();
}

/** Which sprints an item may be put in: planned or active ones of its board. Epics are not put in sprints. */
export function sprintChoices(item: Pick<WorkItem, 'type'>, sprints: Sprint[]): Sprint[] {
  return item.type === 'epic' ? [] : sprintOrder(sprints).filter(s => s.state !== 'closed');
}

/** What the board shows: everything, the backlog (no sprint), or one sprint. Starts on the active sprint. */
export type SprintView = 'all' | 'backlog' | string;
export const defaultView = (sprints: Sprint[]): SprintView => sprints.find(s => s.state === 'active')?.id ?? 'all';
export function inView(item: Pick<WorkItem, 'sprintId' | 'type'>, view: SprintView): boolean {
  if (view === 'all') return true;
  if (view === 'backlog') return !item.sprintId;
  return item.sprintId === view;
}

/** Days left in a running sprint, from its end date; null when it has none. Negative when overdue. */
export function daysLeft(sprint: Pick<Sprint, 'endsOn' | 'state'>, today: string): number | null {
  if (sprint.state !== 'active' || !sprint.endsOn) return null;
  return Math.round((Date.parse(`${sprint.endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
export function daysLeftText(n: number | null): string | null {
  if (n === null) return null;
  if (n > 1) return `${n} days left`;
  if (n === 1) return '1 day left';
  if (n === 0) return 'Ends today';
  return `Ended ${-n} ${n === -1 ? 'day' : 'days'} ago`;
}
