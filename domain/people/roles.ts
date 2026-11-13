// The six roles people hold in a workspace, and how each maps onto what the database enforces.
// The database knows three access levels (admin, editor, viewer) and a can-approve flag; a job
// title says what an editor does. Everything a role may do is derived here, once.

export type AccessLevel = 'admin' | 'editor' | 'viewer';
export type Job = 'business_analyst' | 'solution_architect' | 'developer' | 'approver';
export type RoleKey = 'admin' | Job | 'viewer';

export interface RoleDef {
  key: RoleKey;
  label: string;
  summary: string;
  access: AccessLevel;
  canApprove: boolean;
  job: Job | null;
}

export const ROLES: readonly RoleDef[] = [
  { key: 'admin', label: 'Admin', summary: 'Manages people and settings, and can do everything else.', access: 'admin', canApprove: true, job: null },
  { key: 'business_analyst', label: 'Business analyst', summary: 'Adds sources, assesses processes and writes the documents.', access: 'editor', canApprove: false, job: 'business_analyst' },
  { key: 'solution_architect', label: 'Solution architect', summary: 'Reviews approaches and designs, and confirms work to the board.', access: 'editor', canApprove: false, job: 'solution_architect' },
  { key: 'developer', label: 'Developer', summary: 'Works the items assigned on the delivery board.', access: 'editor', canApprove: false, job: 'developer' },
  { key: 'approver', label: 'Approver', summary: 'Reviews and approves process revisions. Cannot change them.', access: 'viewer', canApprove: true, job: 'approver' },
  { key: 'viewer', label: 'Viewer', summary: 'Reads everything. Changes nothing.', access: 'viewer', canApprove: false, job: null },
];

export interface MemberFacts { access: AccessLevel; canApprove: boolean; job: Job | null }

export function roleOf(m: MemberFacts): RoleDef {
  if (m.access === 'admin') return ROLES[0]!;
  const exact = ROLES.find(r => r.access === m.access && r.job === m.job && r.canApprove === m.canApprove);
  if (exact) return exact;
  // An editor with no job, or an approval flag set by hand, keeps its access and is named by it.
  if (m.access === 'viewer') return m.canApprove ? ROLES.find(r => r.key === 'approver')! : ROLES.find(r => r.key === 'viewer')!;
  return (m.job ? ROLES.find(r => r.job === m.job) : undefined) ?? ROLES.find(r => r.key === 'business_analyst')!;
}

export type Action = 'manage_people' | 'change_settings' | 'edit_process' | 'confirm_work' | 'work_items' | 'approve' | 'read';

export function can(m: MemberFacts, action: Action): boolean {
  switch (action) {
    case 'read': return true;
    case 'manage_people': case 'change_settings': return m.access === 'admin';
    case 'edit_process': case 'confirm_work': case 'work_items': return m.access !== 'viewer';
    case 'approve': return m.canApprove;
  }
}

export class PeopleError extends Error {}

export function validateEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new PeopleError('Enter a work email address, like name@company.com.');
  return email;
}

/** Whether a change would leave the workspace without an admin. */
export function leavesNoAdmin(members: { userId: string; access: AccessLevel }[], userId: string, nextAccess: AccessLevel | null): boolean {
  const others = members.filter(m => m.userId !== userId && m.access === 'admin').length;
  return others === 0 && nextAccess !== 'admin';
}

export type AuditKind = 'invited' | 'joined' | 'role_changed' | 'removed' | 'approved';
export interface AuditEntry { id: string; at: string; kind: AuditKind; actor: string; subject: string; detail: string }

export function describeAudit(e: Pick<AuditEntry, 'kind' | 'actor' | 'subject' | 'detail'>): string {
  switch (e.kind) {
    case 'invited': return `${e.actor} invited ${e.subject} as ${e.detail}`;
    case 'joined': return `${e.subject} joined as ${e.detail}`;
    case 'role_changed': return `${e.actor} changed ${e.subject} to ${e.detail}`;
    case 'removed': return `${e.actor} removed ${e.subject}`;
    case 'approved': return `${e.actor} approved ${e.subject}${e.detail ? ` (${e.detail})` : ''}`;
  }
}
