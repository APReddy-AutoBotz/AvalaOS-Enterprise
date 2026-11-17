// When a process last changed, for "Changed … ago" on its card (review of 17 November 2026: a card said
// "Changed 4 days ago" minutes after an edit). The process row's own time moves when its name, people or
// state change; an edit to its record moves only the working draft's time. The later of the two is when
// the process last changed. Approved revisions never change, so only the draft (or the latest revision
// when there is no draft) counts.
export interface RevisionTimes { state: 'working' | 'approved' | 'superseded'; createdAt: string; updatedAt?: string | null }

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : new Date(b).getTime() > new Date(a).getTime() ? b : a);

export function lastChanged(processUpdatedAt: string | null, revisions: readonly RevisionTimes[]): string | null {
  let at = processUpdatedAt;
  for (const r of revisions) at = later(at, later(r.createdAt ?? null, r.updatedAt ?? null));
  return at;
}
