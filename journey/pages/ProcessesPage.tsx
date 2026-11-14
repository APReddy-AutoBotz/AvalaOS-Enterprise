// The processes of the workspace the person is in. Three ways to look at them: cards (each process with
// its assessment in short), a list (one row each, for when there are many), and the portfolio that
// compares them. Cards open by default up to CARDS_UP_TO processes, the list beyond that; a person's own
// choice between the two is remembered in the browser.
import React from 'react';
import type { JourneyStore, Member, ProcessRow, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { ago, Button, CARD, cx, EmptyState, ErrorNote, Field, messageOf, PageHead, Spinner, Tag, when } from '../ui.tsx';
import { namedOn, openOn } from '../../domain/work/home.ts';
import { cardTotals } from '../../domain/assess/portfolio.ts';
import { DEFAULT_SETTINGS, type AssessmentSettings } from '../../domain/assess/settings.ts';
import { initials } from '../../domain/workitems/board.ts';
import { loadProcessFacts, STATUS_TONE, type LoadedFacts } from '../processFacts.ts';
import { DUTY, Figures, hrs, OpenChip, People, StatusPill, StepSplit } from '../processCard.tsx';
import { Portfolio } from './Portfolio.tsx';
import { has, offMessage } from '../../domain/workspace/modules.ts';
import { remember } from '../workspaceChoice.ts';

// One row of the list: the process, who is named on it, what is open, where it stands, when it changed.
const ROW = 'md:grid md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,13rem)_minmax(0,14rem)_6.5rem] md:items-center md:gap-4';
/** Cards are the opening view up to this many processes; beyond it, the list. */
const CARDS_UP_TO = 6;
type View = 'cards' | 'list' | 'portfolio';
const VIEW_KEY = 'avala.journey.processes.view';
const savedView = (): View | null => { try { const v = localStorage.getItem(VIEW_KEY); return v === 'cards' || v === 'list' ? v : null; } catch { return null; } };
const saveView = (v: View) => { try { if (v !== 'portfolio') localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };

export function ProcessesPage({ store, nav, workspace }: { store: JourneyStore; nav: Nav; workspace: Workspace }) {
  const eyebrow = `${workspace.organizationName} · ${workspace.name}`;
  if (!has(workspace.modules, 'assess')) {
    return (
      <div>
        <PageHead eyebrow={eyebrow} title="Processes" />
        <div className="mt-8"><EmptyState title="Not switched on">{offMessage('processes', workspace.organizationName)}</EmptyState></div>
      </div>
    );
  }
  return <ProcessList store={store} nav={nav} workspace={workspace} eyebrow={eyebrow} />;
}

function ProcessList({ store, nav, workspace, eyebrow }: { store: JourneyStore; nav: Nav; workspace: Workspace; eyebrow: string }) {
  const [processes, setProcesses] = React.useState<ProcessRow[] | null>(null);
  const [name, setName] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<View | null>(savedView);
  const canEdit = workspace.role !== 'viewer';

  const [facts, setFacts] = React.useState<Record<string, LoadedFacts>>({});
  const [members, setMembers] = React.useState<Member[]>([]);
  const [settings, setSettings] = React.useState<AssessmentSettings>(DEFAULT_SETTINGS);
  React.useEffect(() => {
    let live = true;
    (async () => {
      // The lines the figures are measured against; the defaults apply when they cannot be read.
      const lines = await store.getSettings(workspace.id).then(r => r.settings).catch(() => DEFAULT_SETTINGS);
      const list = await store.listProcesses(workspace.id);
      if (!live) return;
      setSettings(lines);
      setProcesses(list);
      // Where each process stands, who is named, what is open and what its assessment says, read after the page shows.
      list.forEach(p => loadProcessFacts(store, p, lines).then(f => { if (live) setFacts(cur => ({ ...cur, [p.id]: f })); }).catch(() => {}));
    })().catch(e => { if (live) setError(messageOf(e)); });
    store.listMembers(workspace.id).then(m => { if (live) setMembers(m); }).catch(() => {});
    return () => { live = false; };
  }, [store, workspace.id]);
  const nameOf = (id: string) => members.find(m => m.userId === id)?.name ?? 'Someone no longer in this workspace';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await store.createProcess(workspace.id, name);
      nav.go({ page: 'process', processId: p.id, stage: 'sources' });
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const addForm = (
    <form onSubmit={create} className="flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1"><Field label="Process name" placeholder="e.g. Vendor invoice processing" required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <Button type="submit" disabled={busy || !name.trim()}>Add process</Button>
    </form>
  );

  const count = processes?.length ?? 0;
  const view: View = picked ?? (count > CARDS_UP_TO ? 'list' : 'cards');
  const choose = (v: View) => { setPicked(v); saveView(v); };
  const open = (id: string) => nav.go({ page: 'process', processId: id, stage: 'sources' });
  // The line under the title: counted from the processes below it, once every one of them has been read.
  const read = processes !== null && processes.every(p => facts[p.id]);
  const totals = read ? cardTotals(processes!.map(p => facts[p.id]!.card)) : null;
  const summary = !processes || count === 0 ? undefined : (
    <span data-testid="processes-summary">
      {count === 1 ? '1 process' : `${count} processes`}{totals ? (totals.assessed === count ? ' assessed.' : `, ${totals.assessed} assessed.`) : '.'}
      {totals && totals.hours > 0 && <> Automation could take up to <strong className="font-bold text-[#002C4B]">{hrs(totals.hours)} hands-on hours a year</strong>, about {(totals.hours / settings.hoursPerFte).toFixed(1)} full-time people.</>}
    </span>
  );

  return (
    <div>
      <PageHead eyebrow={eyebrow} title="Processes" summary={summary}>
        {processes !== null && count > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Views" className="inline-flex rounded-xl bg-slate-200/70 p-1">
              {([['cards', 'Cards'], ['list', 'List'], ['portfolio', 'Portfolio']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => choose(id)}
                  className={cx('rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]', view === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
              ))}
            </div>
            {canEdit && view !== 'portfolio' && !adding && (
              <Button variant="accent" className="min-h-11 px-5 text-[15px]" onClick={() => setAdding(true)}>
                <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                Add process
              </Button>
            )}
          </div>
        )}
      </PageHead>

      <section className="mt-8 space-y-5">
        <ErrorNote message={error} />
        {processes === null ? (error ? null : <Spinner />) : count === 0 ? (
          <EmptyState title="No processes yet" action={canEdit ? addForm : undefined}>
            {canEdit ? 'Add the process you want to assess. You will add its transcripts, procedures and flowcharts next.' : 'Nobody has added a process to this workspace yet.'}
          </EmptyState>
        ) : view === 'portfolio' ? <Portfolio store={store} nav={nav} processes={processes} workspaceId={workspace.id} /> : (
          <>
            {canEdit && adding && <div className={cx(CARD, 'p-5')}>{addForm}</div>}
            {view === 'cards' ? (
              <ul className="grid gap-6 lg:grid-cols-2" data-testid="process-cards">
                {processes.map(p => <li key={p.id} className="min-w-0"><ProcessCardView p={p} f={facts[p.id]} nameOf={nameOf} open={open} /></li>)}
                {/* With an odd number of cards the last place is free: it invites the next process. */}
                {canEdit && !adding && count % 2 === 1 && (
                  <li className="min-w-0">
                    <button type="button" onClick={() => setAdding(true)} data-testid="add-process-card"
                      className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-[#002C4B] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">
                      <span aria-hidden className="grid h-13 w-13 place-items-center rounded-full border border-slate-200 bg-white"><svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="#002C4B" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg></span>
                      <span className="font-display text-lg font-semibold text-slate-900">Add a process</span>
                      <span className="max-w-xs text-sm leading-6 text-slate-600">Bring its transcripts, procedures and flowcharts. Avala OS reads them and shows where every fact came from.</span>
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <div className={cx(CARD, 'overflow-hidden')} data-testid="process-list">
                <div className={cx('hidden border-b border-slate-200 px-6 py-3 text-xs font-semibold text-slate-500', ROW)} aria-hidden>
                  <span>Process</span><span>People</span><span>Open</span><span>Where it stands</span><span className="text-right">Last changed</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {processes.map(p => {
                    const f = facts[p.id];
                    const people = f ? namedOn(f) : [];
                    const openNow = f ? openOn(f) : [];
                    return (
                      <li key={p.id} data-testid="process-row">
                        <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); open(p.id); }} className={cx('group flex flex-col gap-2 px-6 py-4 hover:bg-slate-50', ROW)}>
                          <span className="min-w-0">
                            <span className="block truncate text-[15px] font-semibold text-slate-900 group-hover:text-[#002C4B]">{p.name}</span>
                            {p.description && <span className="mt-0.5 block truncate text-sm text-slate-500">{p.description}</span>}
                          </span>
                          <span className="flex items-center gap-1">
                            {f && (people.length === 0 ? <Tag tone="warn">Nobody named</Tag> : people.map(x => (
                              <span key={x.userId} title={`${nameOf(x.userId)}: ${x.duties.map(d => DUTY[d]).join(', ')}`}>
                                <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">{initials(nameOf(x.userId))}</span>
                                <span className="sr-only">{x.duties.map(d => DUTY[d]).join(', ')}: {nameOf(x.userId)}.</span>
                              </span>
                            )))}
                          </span>
                          <span className="min-w-0 text-sm text-slate-700">{f && (openNow.length ? openNow.join(' · ') : <span className="text-slate-500">Nothing open</span>)}</span>
                          <span>{f && <Tag tone={STATUS_TONE[f.statusTone]} className="px-2 py-1 text-xs">{f.statusLabel}</Tag>}</span>
                          <span className="text-xs text-slate-500 md:text-right" title={when(p.updatedAt)}>{ago(p.updatedAt)}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * One process as a card: its name and where it stands, its assessment in three figures, how its steps
 * would be done, who is named on it and what is open. The whole card opens the process. A process with
 * nothing to assess yet says so instead of showing empty figures.
 */
function ProcessCardView({ p, f, nameOf, open }: { p: ProcessRow; f: LoadedFacts | undefined; nameOf: (id: string) => string; open: (id: string) => void }) {
  const openNow = f ? openOn(f) : [];
  return (
    <article data-testid="process-card" className={cx(CARD, 'relative flex h-full flex-col p-6 transition hover:border-slate-300 hover:shadow-elev2')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="font-display text-xl font-semibold leading-tight text-slate-900">
            <a href={`/process/${p.id}/sources`} onClick={e => { e.preventDefault(); open(p.id); }} className="rounded after:absolute after:inset-0 after:rounded-2xl hover:text-[#002C4B] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[#002C4B]">{p.name}</a>
          </h2>
          <p className="mt-1.5 text-[13px] text-slate-500" title={when(p.updatedAt)}>Changed {ago(p.updatedAt)}</p>
        </div>
        {f && <StatusPill facts={f} />}
      </div>
      {p.description && <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{p.description}</p>}

      {!f ? (
        <div aria-hidden className="mt-5 h-36 animate-pulse rounded-xl bg-slate-100" />
      ) : f.card ? (
        <>
          <Figures card={f.card} className="mt-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.8fr)]" />
          <div className="mt-5"><StepSplit card={f.card} /></div>
        </>
      ) : (
        <p className="mt-5 rounded-xl bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
          {f.status === 'none' ? 'Nothing to assess yet. Add its transcripts, procedures and flowcharts, and the assessment appears here.' : 'Nothing to assess yet. The assessment appears here once the process has steps.'}
        </p>
      )}

      {f && (
        <div className="mt-auto pt-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-slate-100 pt-4">
            <span className="min-w-0 flex-1 basis-56"><People facts={f} nameOf={nameOf} /></span>
            {openNow.length > 0 && <span className="flex flex-wrap gap-2">{openNow.map(t => <OpenChip key={t}>{t}</OpenChip>)}</span>}
          </div>
        </div>
      )}
    </article>
  );
}

export function FirstRun({ store, onCreated }: { store: JourneyStore; onCreated: () => void }) {
  const [org, setOrg] = React.useState('');
  const [ws, setWs] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mayCreate, setMayCreate] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let live = true;
    store.canCreateOrganization().then(v => { if (live) setMayCreate(v); }).catch(() => { if (live) setMayCreate(false); });
    return () => { live = false; };
  }, [store]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspaceId } = await store.createOrganization(org.trim(), ws.trim() || 'General');
      remember(workspaceId);
      onCreated();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };
  if (mayCreate === null) return <Spinner />;
  if (!mayCreate) {
    return (
      <div className="mx-auto mt-6 max-w-md">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">You are not in a workspace yet</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Avala OS is by invitation. Ask an admin of your organization's workspace to add you from People, then sign in again.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-6 max-w-md">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Set up your organization</h1>
      <p className="mt-1 text-sm text-slate-600">You are not a member of any workspace yet. Create one, or ask a colleague to add you to theirs.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <Field label="Organization" required value={org} onChange={e => setOrg(e.target.value)} />
        <Field label="First workspace" placeholder="General" hint="A team or department, for example Finance Operations." value={ws} onChange={e => setWs(e.target.value)} />
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" disabled={busy || !org.trim()}>Create organization</Button>
      </form>
    </div>
  );
}
