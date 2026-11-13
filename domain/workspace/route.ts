// Routes of the process journey and the revision status shown in the process header.
// Pure: the UI renders these, tests check them.

export const STAGES = [
  { id: 'sources', label: 'Sources' },
  { id: 'process', label: 'Process' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'documents', label: 'Documents' },
  { id: 'flows', label: 'Flows' },
  { id: 'work-items', label: 'Work items' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];

export type JourneyRoute =
  | { page: 'signin' }
  | { page: 'work' }
  | { page: 'processes' }
  | { page: 'process'; processId: string; stage: StageId }
  | { page: 'board'; projectId?: string; itemId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStage = (s: string): s is StageId => STAGES.some(x => x.id === s);

/** The journey route for a path, or null when the path belongs to the rest of the application. */
export function parseJourneyPath(pathname: string): JourneyRoute | null {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] === 'signin' && parts.length === 1) return { page: 'signin' };
  if (parts[0] === 'work' && parts.length === 1) return { page: 'work' };
  if (parts[0] === 'processes' && parts.length === 1) return { page: 'processes' };
  if (parts[0] === 'board' && parts.length <= 3 && (!parts[1] || UUID.test(parts[1])) && (!parts[2] || UUID.test(parts[2]))) {
    return { page: 'board', ...(parts[1] ? { projectId: parts[1].toLowerCase() } : {}), ...(parts[2] ? { itemId: parts[2].toLowerCase() } : {}) };
  }
  if (parts[0] === 'process' && parts.length >= 2 && parts.length <= 3 && UUID.test(parts[1])) {
    const stage = parts[2] ?? 'sources';
    return isStage(stage) ? { page: 'process', processId: parts[1].toLowerCase(), stage } : null;
  }
  return null;
}

export function journeyPath(route: JourneyRoute): string {
  switch (route.page) {
    case 'signin': return '/signin';
    case 'work': return '/work';
    case 'processes': return '/processes';
    case 'process': return `/process/${route.processId}/${route.stage}`;
    case 'board': return `/board${route.projectId ? `/${route.projectId}` : ''}${route.projectId && route.itemId ? `/${route.itemId}` : ''}`;
  }
}

export interface RevisionSummary {
  revNo: number;
  state: 'working' | 'approved' | 'superseded';
  /** Number of edits saved on this revision. */
  seq: number;
}

/**
 * The status shown in the process header. Revision numbers are the user's own versions and appear
 * here; edit sequences, hashes and schema versions appear only in History.
 */
export function revisionStatus(revisions: RevisionSummary[]): { label: string; tone: 'neutral' | 'draft' | 'approved' | 'changed' } {
  const working = revisions.find(r => r.state === 'working');
  const approved = revisions.find(r => r.state === 'approved');
  if (approved && working && working.seq > 0) return { label: `Approved revision ${approved.revNo} · unapproved changes`, tone: 'changed' };
  if (approved) return { label: `Approved revision ${approved.revNo}`, tone: 'approved' };
  if (working) return { label: 'Working draft', tone: 'draft' };
  return { label: 'Not started', tone: 'neutral' };
}
