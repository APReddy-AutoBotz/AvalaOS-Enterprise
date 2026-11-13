// What a person sees first: what needs them, derived from the state of the processes they are named on,
// and the board items assigned to them. Nothing here is a ticket: an entry disappears when the work is done.
import type { MemberFacts } from '../people/roles.ts';
import type { StageId } from '../workspace/route.ts';
import type { WorkItem } from '../workitems/board.ts';

export interface ProcessFacts {
  id: string;
  name: string;
  analystId: string | null;
  architectId: string | null;
  approverId: string | null;
  status: 'none' | 'draft' | 'approved' | 'changed';
  openQuestions: number;
  /** Proposed work items not yet confirmed to the board or rejected. */
  proposalsWaiting: number;
}

export interface Person extends MemberFacts { userId: string }

export type Duty = 'analyst' | 'architect' | 'approver';
export interface Need { processId: string; processName: string; duty: Duty; text: string; stage: StageId; /** Nobody is named for this duty; shown to everyone who holds the role. */ unassigned: boolean }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether the duty falls to this person, and whether only because nobody is named. */
export function dutyOf(me: Person, p: Pick<ProcessFacts, 'analystId' | 'architectId' | 'approverId'>, duty: Duty): 'named' | 'unassigned' | null {
  const named = duty === 'analyst' ? p.analystId : duty === 'architect' ? p.architectId : p.approverId;
  if (named) return named === me.userId ? 'named' : null;
  if (duty === 'approver') return me.canApprove ? 'unassigned' : null;
  if (me.access === 'viewer') return null;
  if (me.access === 'admin') return 'unassigned';
  return me.job === (duty === 'analyst' ? 'business_analyst' : 'solution_architect') ? 'unassigned' : null;
}

/** What is waiting on this person, most pressing first within each process. */
export function needsFor(me: Person, processes: ProcessFacts[]): Need[] {
  const out: Need[] = [];
  for (const p of processes) {
    const add = (duty: Duty, text: string, stage: StageId) => {
      const d = dutyOf(me, p, duty);
      if (d) out.push({ processId: p.id, processName: p.name, duty, text, stage, unassigned: d === 'unassigned' });
    };
    if (p.status === 'none') add('analyst', 'Add sources and start the process model', 'sources');
    if (p.openQuestions > 0) add('analyst', `${plural(p.openQuestions, 'open question', 'open questions')} to answer`, 'documents');
    if (p.proposalsWaiting > 0) add('architect', `${plural(p.proposalsWaiting, 'work item', 'work items')} waiting to be confirmed to the board`, 'work-items');
    if (p.status === 'draft' || p.status === 'changed') add('approver', p.status === 'changed' ? 'Changes since the approved revision are waiting for approval' : 'A revision is waiting for approval', 'process');
  }
  return out;
}

/** The processes this person is named on; those with nobody named are listed for editors and admins. */
export function processesFor(me: Person, processes: ProcessFacts[]): { mine: ProcessFacts[]; unassigned: ProcessFacts[] } {
  const mine = processes.filter(p => [p.analystId, p.architectId, p.approverId].includes(me.userId));
  const unassigned = me.access === 'viewer' ? [] : processes.filter(p => !p.analystId && !p.architectId && !p.approverId);
  return { mine, unassigned };
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** Board items assigned to this person that are still open: overdue and soonest due first, then by priority. */
export function itemsFor(userId: string, items: WorkItem[], today: string): { item: WorkItem; overdue: boolean }[] {
  return items
    .filter(i => i.ownerId === userId && i.status !== 'done' && i.type !== 'epic')
    .map(item => ({ item, overdue: item.dueDate !== null && item.dueDate < today }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue)
      || (a.item.dueDate ?? '9999').localeCompare(b.item.dueDate ?? '9999')
      || (RANK[a.item.priority ?? 'low'] - RANK[b.item.priority ?? 'low'])
      || a.item.title.localeCompare(b.item.title));
}
