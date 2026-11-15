// Work items: proposals derived from the requirements and the design, reviewed before anything goes
// to the board. A person edits, selects or rejects each one (with a reason); deriving again never
// undoes that. Owner, estimate and dates stay empty until the delivery team sets them.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { Decisions } from '../../domain/assess/decisions.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '../../domain/docs/branding.ts';
import type { ProposalType } from '../../domain/workitems/derive.ts';
import { planWork } from '../../domain/workitems/plan.ts';
import { editProposal, keepMine, mergeProblem, mergeProposals, ProposalError, reconcileProposals, rejectProposal, restoreProposal, setSelected, splitProposal, takeUpdate, type Proposal, type ProposalRow, type SplitInput } from '../../domain/workitems/register.ts';
import { Button, cx, ErrorNote, messageOf, ReqCode, Spinner, Tag, TypeGlyph, WORK_TYPE } from '../ui.tsx';
import { splitStory } from '../../domain/workitems/board.ts';
import { BoardError, validateProjectName, type Project } from '../../domain/workitems/board.ts';

type Row = ProposalRow;
const plain = ({ sourceRemoved: _s, derivedHash: _h, needsReview: _n, derived: _d, ...p }: ProposalRow): Proposal => p;
const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function WorkItemsStage({ store, processId, workspaceId, model, canEdit, onOpenBoard }: { store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; canEdit: boolean; onOpenBoard: (projectId: string) => void }) {
  const [stored, setStored] = React.useState<Proposal[] | null>(null);
  const [reqs, setReqs] = React.useState<StoredRequirement[] | null>(null);
  const [docSettings, setDocSettings] = React.useState<DocumentSettings>(DEFAULT_DOCUMENT_SETTINGS);
  const [decisions, setDecisions] = React.useState<Decisions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'selected' | 'rejected'>('all');
  const load = React.useCallback(() => {
    // Reloads the stored proposals; a confirm marks them on the board.
    // People's choices of approach decide which steps become automation work (the same as the documents).
    Promise.all([store.listProposals(processId), store.listRequirements(processId), store.getDocumentSettings(workspaceId), store.getAssessmentDecisions(processId)])
      .then(([p, r, d, x]) => { setStored(p); setReqs(r); setDocSettings(d); setDecisions(x); }).catch(e => setError(messageOf(e)));
  }, [store, processId, workspaceId]);
  React.useEffect(load, [load]);

  const derived = React.useMemo(() => {
    if (!reqs || !decisions) return null;
    return planWork(model, decisions, reqs, docSettings.layouts);
  }, [model, reqs, docSettings, decisions]);
  const rec = React.useMemo(() => (derived && stored ? reconcileProposals(derived.d.proposals, stored) : null), [derived, stored]);
  React.useEffect(() => {
    if (!rec || !derived || !canEdit) return;
    const work: Promise<unknown>[] = [];
    if (derived.register.changed.length) work.push(store.saveRequirements(processId, derived.register.changed));
    if (rec.changed.length) work.push(store.saveProposals(processId, rec.changed));
    if (work.length) Promise.all(work).then(() => { setStored(rec.proposals.map(plain)); if (derived.register.changed.length) setReqs(derived.register.requirements); }).catch(e => setError(messageOf(e)));
  }, [rec, derived, canEdit, store, processId]);

  const save = async (p: Proposal) => {
    setError(null);
    try {
      await store.saveProposals(processId, [p]);
      setStored(cur => (cur ?? []).map(x => (x.key === p.key ? p : x)));
    } catch (e) { setError(e instanceof ProposalError ? e.message : messageOf(e)); }
  };
  /** Saves several proposals at once (a merge or a split): changed ones are replaced, new ones added. */
  const saveMany = async (ps: Proposal[]) => {
    setError(null);
    try {
      await store.saveProposals(processId, ps);
      setStored(cur => {
        const list = cur ?? [];
        const byKey = new Map(ps.map(x => [x.key, x]));
        return [...list.map(x => byKey.get(x.key) ?? x), ...ps.filter(x => !list.some(l => l.key === x.key))];
      });
    } catch (e) { setError(e instanceof ProposalError ? e.message : messageOf(e)); }
  };
  if (!rec || !derived) return error ? <ErrorNote message={error} /> : <Spinner label="Working out the work items" />;
  const rows = rec.proposals;
  const shown = (r: Row) => filter === 'all' ? true : filter === 'selected' ? r.state === 'selected' : r.state === 'rejected';
  const kids = (key: string) => rows.filter(r => r.parentKey === key);
  const tops = rows.filter(r => !r.parentKey || !rows.some(x => x.key === r.parentKey));
  const epics = tops.filter(r => r.type === 'epic');
  const loose = tops.filter(r => r.type !== 'epic');
  const selected = rows.filter(r => r.state === 'selected');
  const count = (t: ProposalType) => rows.filter(r => r.type === t && r.state !== 'rejected').length;
  const mergeNote = mergeProblem(selected.map(plain));
  const merge = () => {
    try { saveMany(mergeProposals(selected.map(plain), rows.map(plain), crypto.randomUUID())); setFilter('all'); }
    catch (e) { setError(e instanceof ProposalError ? e.message : messageOf(e)); }
  };
  const split = (r: Row, input: SplitInput) => saveMany(splitProposal(r, input, crypto.randomUUID()));
  const selectAll = (list: Row[], on: boolean) => {
    const next = list.filter(r => r.state !== 'confirmed' && r.state !== 'rejected').map(r => setSelected(plain(r), on));
    store.saveProposals(processId, next).then(() => setStored(cur => (cur ?? []).map(x => next.find(n => n.key === x.key) ?? x))).catch(e => setError(messageOf(e)));
  };

  // One panel per epic: the epic is the heading row, the work under it the rows below, indented by level.
  const rowsOf = (r: Row, depth: number): React.ReactNode => {
    if (!shown(r) && !kids(r.key).some(shown)) return null;
    return (
      <React.Fragment key={r.key}>
        <li className={cx(depth > 0 && 'border-t border-slate-100')} style={depth > 1 ? { paddingLeft: `${(depth - 1) * 1.75}rem` } : undefined}>
          <ProposalCard r={r} canEdit={canEdit} head={depth === 0 && r.type === 'epic'} open={open === r.key} onOpen={() => setOpen(open === r.key ? null : r.key)} onSave={save} onSplit={split} />
        </li>
        {kids(r.key).map(k => rowsOf(k, depth + 1))}
      </React.Fragment>
    );
  };
  const panel = (r: Row) => {
    const body = rowsOf(r, 0);
    return body ? <ul key={r.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">{body}</ul> : null;
  };

  return (
    <div className="space-y-5 pb-24" data-testid="work-items">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="max-w-2xl">
            <h3 className="font-display text-lg font-semibold text-slate-900">Proposed work items</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">Worked out from the requirements, the automation units and the open questions. Review each one, then select what goes to the board. Nothing is assigned, estimated or dated for you.</p>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="proposal-counts">
            {(['epic', 'story', 'task', 'spike', 'decision'] as ProposalType[]).filter(t => count(t) > 0).map(t => <div key={t} className="flex items-center gap-1.5"><TypeGlyph type={t} /><dd className="font-semibold tabular-nums text-slate-900">{count(t)}</dd><dt className="text-slate-600">{count(t) === 1 ? WORK_TYPE[t].label : WORK_TYPE[t].plural}</dt></div>)}
          </dl>
        </div>
        {derived.cov.notPlanned.length > 0 && (
          <details className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="not-planned">
            <summary className="cursor-pointer font-semibold">{derived.cov.notPlanned.length} {derived.cov.notPlanned.length === 1 ? 'requirement is' : 'requirements are'} not planned yet</summary>
            <ul className="mt-2 space-y-1.5">{derived.cov.notPlanned.map(n => <li key={n.code}><ReqCode>{n.code}</ReqCode> {n.title}: {n.reason}</li>)}</ul>
          </details>
        )}
      </div>
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Show" className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-sm">
          {([['all', 'All'], ['selected', `Selected (${selected.length})`], ['rejected', `Rejected (${rows.filter(r => r.state === 'rejected').length})`]] as const).map(([id, label]) =>
            <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={cx('rounded-md px-3 py-1 font-semibold', filter === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600')}>{label}</button>)}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {selected.length >= 2 && <Button variant="secondary" onClick={merge} disabled={mergeNote !== null} title={mergeNote ?? undefined}>Merge {selected.length} selected into one</Button>}
            {selected.length >= 2 && mergeNote && <span className="text-xs text-slate-500" data-testid="merge-note">{mergeNote}</span>}
            <Button variant="ghost" onClick={() => selectAll(rows, true)}>Select all</Button><Button variant="ghost" onClick={() => selectAll(rows, false)}>Clear selection</Button>
          </div>
        )}
      </div>
      {epics.length > 0 && <section aria-label="Epics" className="space-y-3">{epics.map(panel)}</section>}
      {loose.length > 0 && <section aria-label="Set-up and decisions"><h4 className="mb-2 text-[13px] font-semibold text-slate-700">Not under an epic</h4><div className="space-y-2">{loose.map(panel)}</div></section>}
      {!rows.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">No work items yet: they come once the assessment recommends automating a step.</p>}
      {canEdit && <ConfirmPanel store={store} processId={processId} workspaceId={workspaceId} selected={selected} onDone={load} onOpenBoard={onOpenBoard} />}
    </div>
  );
}

/** Puts the selected items on a Delivery board project, once. */
function ConfirmPanel({ store, processId, workspaceId, selected, onDone, onOpenBoard }: { store: JourneyStore; processId: string; workspaceId: string; selected: Proposal[]; onDone: () => void; onOpenBoard: (projectId: string) => void }) {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [projectId, setProjectId] = React.useState<string>('');
  const [newName, setNewName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ created: number; projectId: string } | null>(null);
  React.useEffect(() => { store.listProjects(workspaceId).then(p => { setProjects(p); if (p[0]) setProjectId(p[0].id); }).catch(e => setError(messageOf(e))); }, [store, workspaceId]);
  const confirm = async (chosen: string) => {
    setBusy(true); setError(null); setDone(null);
    try {
      let target = chosen;
      if (target === '__new') {
        const p = await store.createProject(workspaceId, validateProjectName(newName));
        setProjects(cur => [...(cur ?? []), p]); setProjectId(p.id); setNewName(''); target = p.id;
      }
      const r = await store.confirmProposals(processId, target, selected.map(s => s.key));
      setDone({ created: r.created, projectId: target });
      onDone();
    } catch (e) { setError(e instanceof BoardError ? e.message : messageOf(e)); } finally { setBusy(false); }
  };
  if (!projects) return null;
  const choice = projects.length ? projectId : '__new';
  return (
    <div className="sticky bottom-4 z-10 rounded-xl border border-slate-300 bg-white px-4 py-3 shadow-[0_10px_30px_-8px_rgba(15,23,42,0.25)]" data-testid="confirm-panel">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-slate-900">{selected.length} selected</span>
        <label className="flex items-center gap-2 text-sm text-slate-600">to
          <select aria-label="Board project" value={choice} onChange={e => setProjectId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__new">New project…</option>
          </select>
        </label>
        {choice === '__new' && <input aria-label="New project name" placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />}
        <Button onClick={() => confirm(choice)} disabled={busy || !selected.length}>{busy ? 'Confirming…' : `Confirm ${selected.length} to the board`}</Button>
        {done && <span role="status" className="text-sm text-emerald-800">{done.created} {done.created === 1 ? 'item' : 'items'} added to the board. <button type="button" className="font-semibold underline" onClick={() => onOpenBoard(done.projectId)}>Open the board</button></span>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function ProposalCard({ r, canEdit, head, open, onOpen, onSave, onSplit }: { r: Row; canEdit: boolean; head: boolean; open: boolean; onOpen: () => void; onSave: (p: Proposal) => Promise<void>; onSplit: (r: Row, input: SplitInput) => Promise<void> }) {
  const [title, setTitle] = React.useState(r.title);
  const [description, setDescription] = React.useState(r.description);
  const [criteria, setCriteria] = React.useState(r.acceptance);
  const [reason, setReason] = React.useState('');
  const [rejecting, setRejecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setTitle(r.title); setDescription(r.description); setCriteria(r.acceptance); }, [r.title, r.description, r.acceptance]);
  const locked = r.state === 'confirmed';
  const story = r.type === 'story' ? splitStory(r.description).story : null;
  const run = async (f: () => Proposal) => { setError(null); try { await onSave(f()); setRejecting(false); } catch (e) { setError(e instanceof ProposalError ? e.message : messageOf(e)); } };
  return (
    <div className={cx('relative px-4 py-3', head && 'bg-slate-50/70', r.state === 'selected' && 'bg-[#F1F6FB]', r.state === 'rejected' && 'opacity-60')} data-testid="proposal" data-type={r.type}>
      {r.state === 'selected' && <span className="absolute inset-y-0 left-0 w-0.5 bg-[#002C4B]" aria-hidden />}
      <div className="flex items-start gap-3">
        {canEdit && !locked && r.state !== 'rejected' ? <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#002C4B]" aria-label={`Select ${r.title}`} checked={r.state === 'selected'} onChange={e => run(() => setSelected(plain(r), e.target.checked))} /> : <span className="w-4 shrink-0" aria-hidden />}
        <span className="mt-0.5" title={WORK_TYPE[r.type].label}><TypeGlyph type={r.type} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={onOpen} className={cx('text-left text-sm text-slate-900 hover:underline', head ? 'font-semibold' : 'font-medium')} aria-expanded={open}>{r.title}</button>
            {r.edited && <Tag tone="info">Edited</Tag>}
            {r.needsReview && <Tag tone="warn" data-testid="proposal-review">Needs review</Tag>}
            {r.sourceRemoved && <Tag tone="warn">Source removed</Tag>}
            {locked && <Tag tone="ok">On the board</Tag>}
            {r.state === 'rejected' && <Tag data-testid="rejected-reason" className="whitespace-normal">Rejected: {r.rejectedReason}</Tag>}
          </div>
          {story && <p className="mt-1 max-w-4xl text-[13px] leading-5 text-slate-600" data-testid="story-line">{story}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
            <span>{WORK_TYPE[r.type].label}</span>
            {r.requirements.slice(0, 6).map(c => <React.Fragment key={c}><ReqCode>{c}</ReqCode></React.Fragment>)}
            {r.requirements.length > 6 && <span>+{r.requirements.length - 6}</span>}
            <span>{r.acceptance.length} acceptance criteria</span>
          </p>
        </div>
        {canEdit && !locked && (r.state === 'rejected'
          ? <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => run(() => restoreProposal(plain(r)))}>Restore</button>
          : <button type="button" className="text-xs text-slate-500 hover:text-slate-900 hover:underline" onClick={() => { setRejecting(!rejecting); }}>Reject</button>)}
      </div>
      {r.needsReview && r.derived && !locked && (
        <div className="ml-[3.75rem] mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
          <p><span className="font-semibold">The process changed since you edited this item.</span> Worked out again, it would read:</p>
          <p className="mt-1 font-semibold text-slate-900">{r.derived.title}</p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-slate-700">{r.derived.description}</p>
          {canEdit && <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => run(() => keepMine(r))}>Keep mine</Button><Button variant="secondary" onClick={() => run(() => takeUpdate(r))}>Take update</Button></div>}
        </div>
      )}
      {rejecting && (
        <div className="ml-[3.75rem] mt-3 flex flex-wrap items-center gap-2">
          <input aria-label={`Why reject ${r.title}`} placeholder="Why is it not needed?" value={reason} onChange={e => setReason(e.target.value)} className={cx(input, 'max-w-md flex-1')} />
          <Button variant="secondary" onClick={() => run(() => rejectProposal(plain(r), reason))}>Reject</Button>
        </div>
      )}
      {open && (
        <div className="ml-[3.75rem] mt-3 max-w-4xl space-y-3 border-t border-slate-200 pt-3" data-testid="proposal-detail">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Title<input aria-label={`Title of ${r.title}`} value={title} disabled={!canEdit || locked} onChange={e => setTitle(e.target.value)} className={input} /></label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">Description<textarea aria-label={`Description of ${r.title}`} value={description} disabled={!canEdit || locked} rows={Math.min(10, description.split('\n').length + 1)} onChange={e => setDescription(e.target.value)} className={cx(input, 'font-normal')} /></label>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold text-slate-700">Acceptance criteria</span>
            {criteria.map((c, i) => (
              <div key={i} className="flex gap-2">
                <textarea aria-label={`Criterion ${i + 1} of ${r.title}`} value={c} rows={2} disabled={!canEdit || locked} onChange={e => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
                {canEdit && !locked && <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            {canEdit && !locked && <button type="button" className="w-fit text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => setCriteria([...criteria, ''])}>+ Add a criterion</button>}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {canEdit && !locked && <Button onClick={() => run(() => editProposal(r, { title, description, acceptance: criteria }))}>Save item</Button>}
          {canEdit && !locked && r.state !== 'rejected' && r.type !== 'epic' && <SplitForm r={r} onSplit={onSplit} />}
        </div>
      )}
      {!open && error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Splits one item into two: a title and the criteria for the new one. */
function SplitForm({ r, onSplit }: { r: Row; onSplit: (r: Row, input: SplitInput) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [move, setMove] = React.useState<number[]>([]);
  const [extra, setExtra] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  if (!open) return <div className="border-t border-slate-100 pt-3"><button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => setOpen(true)}>Split into two items</button></div>;
  const go = async () => {
    setError(null);
    try { splitProposal(r, { title, move, extra: extra.split('\n') }, 'check'); } catch (e) { setError(e instanceof ProposalError ? e.message : messageOf(e)); return; }
    await onSplit(r, { title, move, extra: extra.split('\n') });
    setOpen(false); setTitle(''); setMove([]); setExtra('');
  };
  return (
    <fieldset className="grid gap-2 border-t border-slate-100 pt-3" data-testid="split-form">
      <legend className="text-xs font-semibold text-slate-700">Split into two items</legend>
      <p className="text-xs leading-5 text-slate-500">The new item starts with this description and these requirement links. Choose the criteria that move to it, and write any others it needs.</p>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">Title of the new item<input aria-label="Title of the new item" value={title} onChange={e => setTitle(e.target.value)} className={input} /></label>
      <div className="grid gap-1">
        {r.acceptance.map((c, i) => (
          <label key={i} className="flex items-start gap-2 text-[13px] leading-5 text-slate-700">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#002C4B]" checked={move.includes(i)} onChange={e => setMove(e.target.checked ? [...move, i] : move.filter(m => m !== i))} />
            <span>Move: {c}</span>
          </label>
        ))}
      </div>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">Other criteria for the new item, one per line<textarea aria-label="Other criteria for the new item" rows={2} value={extra} onChange={e => setExtra(e.target.value)} className={cx(input, 'font-normal')} /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><Button onClick={go}>Split item</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </fieldset>
  );
}
