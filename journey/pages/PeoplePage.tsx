// The people of a workspace: who holds which role, invitations, and the audit trail. Admins change
// things here; everyone else sees the roster by name.
import React from 'react';
import type { Invite, JourneyStore, Person, Workspace } from '../store/types.ts';
import { ROLES, describeAudit, roleOf, validateEmail, type AuditEntry, type RoleDef } from '../../domain/people/roles.ts';
import { Button, EmptyState, ErrorNote, Field, Spinner, Tag, ago, cx, messageOf, when } from '../ui.tsx';

const choice = (r: RoleDef) => ({ access: r.access, job: r.job, canApprove: r.canApprove });

function RoleSelect({ value, onChange, disabled, label }: { value: string; onChange: (key: RoleDef['key']) => void; disabled?: boolean; label: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value as RoleDef['key'])}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50 disabled:text-slate-600">
      {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select>
  );
}

export function PeoplePage({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const isAdmin = workspace.role === 'admin';
  const [people, setPeople] = React.useState<{ members: Person[]; invites: Invite[] } | null>(null);
  const [audit, setAudit] = React.useState<AuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [roleKey, setRoleKey] = React.useState<RoleDef['key']>('business_analyst');
  const [showAudit, setShowAudit] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setPeople(await store.listPeople(workspace.id));
      if (isAdmin) setAudit(await store.auditLog(workspace.id));
    } catch (e) { setError(messageOf(e)); }
  }, [store, workspace.id, isAdmin]);
  React.useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (done) setNotice(done); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  if (!people) return error ? <ErrorNote message={error} /> : <Spinner />;
  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    let addr: string;
    try { addr = validateEmail(email); } catch (err) { setError(messageOf(err)); return; }
    const role = ROLES.find(r => r.key === roleKey)!;
    run(async () => {
      const r = await store.invitePerson(workspace.id, addr, choice(role));
      setEmail('');
      if (r.state === 'member') { setNotice(`${addr} is in the workspace as ${role.label}.`); return; }
      const saved = `Invitation saved for ${addr}. They get the ${role.label} role when they sign up with this address.`;
      try {
        await store.sendInviteEmail(workspace.id, addr);
        setNotice(`${saved} We emailed them the invitation.`);
      } catch (err) {
        setNotice(`${saved} The invitation email was not sent (${messageOf(err)}), so let them know yourself.`);
      }
    });
  };

  return (
    <section className="max-w-4xl space-y-4" data-testid="people">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-slate-900">People in {workspace.name}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">A role decides what a person may do. Where a process names its analyst, architect and approver, that decides what they see first. People here see only this workspace: for a client, use a workspace of its own.</p>
        <ul className="mt-4 divide-y divide-slate-100" data-testid="people-list">
          {people.members.map(m => {
            const role = roleOf({ access: m.role, canApprove: m.canApprove, job: m.job });
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{m.name}</p>
                  {m.email && <p className="truncate text-xs text-slate-500">{m.email}</p>}
                </div>
                {isAdmin
                  ? <RoleSelect label={`Role of ${m.name}`} value={role.key} disabled={busy} onChange={k => run(() => store.changePerson(workspace.id, m.userId, choice(ROLES.find(r => r.key === k)!)))} />
                  : <Tag>{role.label}</Tag>}
                {isAdmin && <Button variant="ghost" disabled={busy} aria-label={`Remove ${m.name}`} onClick={() => { if (window.confirm(`Remove ${m.name} from ${workspace.name}? Their board items stay, unassigned.`)) run(() => store.removePerson(workspace.id, m.userId)); }}>Remove</Button>}
              </li>
            );
          })}
        </ul>
        {isAdmin && people.invites.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Waiting to sign up</h3>
            <ul className="mt-2 divide-y divide-slate-100" data-testid="invites">
              {people.invites.map(i => (
                <li key={i.email} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{i.email}</span>
                  <Tag tone="warn">{roleOf({ access: i.role, canApprove: i.canApprove, job: i.job }).label}</Tag>
                  <span className="text-xs text-slate-500">{ago(i.at)}</span>
                  <Button variant="ghost" disabled={busy} aria-label={`Email the invitation to ${i.email} again`} onClick={() => run(() => store.sendInviteEmail(workspace.id, i.email), `Invitation emailed again to ${i.email}.`)}>Send again</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => run(() => store.cancelInvite(workspace.id, i.email))}>Cancel</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {isAdmin ? (
        <form onSubmit={invite} className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-base font-semibold text-slate-900">Add someone</h3>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label="Work email" type="email" required placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <label className="space-y-1.5 text-sm font-medium text-slate-800">
              <span className="block">Role</span>
              <RoleSelect label="Role for the new person" value={roleKey} onChange={setRoleKey} />
            </label>
            <Button type="submit" disabled={busy || !email.trim()}>Add person</Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{ROLES.find(r => r.key === roleKey)!.summary} Sign-up is by invitation: someone without an account joins when they sign up with this address.</p>
          <div className="mt-2" aria-live="polite">{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}<ErrorNote message={error} /></div>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Only an admin can add people or change roles.</p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-slate-900">What each role can do</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {ROLES.map(r => (<div key={r.key}><dt className="text-sm font-semibold text-slate-900">{r.label}</dt><dd className="text-sm leading-5 text-slate-600">{r.summary}</dd></div>))}
        </dl>
      </div>

      {isAdmin && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-base font-semibold text-slate-900">Audit trail</h3>
            <Button variant="ghost" onClick={() => setShowAudit(v => !v)} aria-expanded={showAudit}>{showAudit ? 'Hide' : 'Show'}</Button>
          </div>
          {showAudit && (audit === null ? <Spinner /> : audit.length === 0 ? (
            <EmptyState title="Nothing yet">Changes to people and approvals of process revisions appear here.</EmptyState>
          ) : (
            <ol className={cx('mt-3 divide-y divide-slate-100')} data-testid="audit">
              {audit.map(a => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-800">{describeAudit(a)}</span>
                  <time className="text-xs text-slate-500" dateTime={a.at}>{when(a.at)}</time>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
    </section>
  );
}
