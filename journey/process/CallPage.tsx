// The call page (package C, C3b; plan `claude/package-c-c3-plan-28-nov.md`, and revision 2 of the package C plan,
// sections 3 to 5), at /process/{id}/call in a window of its own, without the top bar. It opens on a call not
// finished on this device ("Continue · Discard"), else on the briefing; Start opens the panel; End reads the notes
// once more and opens the review; Save writes one "Call notes" source and one edit of the record. Nothing is written
// to the server before Save, and the call is kept on this device only (callNotes.ts).
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage as triageOf } from '../../domain/questions/triage.ts';
import { offersPurpose } from '../../domain/plan/purpose.ts';
import { meetingResult } from '../../domain/questions/result.ts';
import { readState } from '../../domain/discovery/session.ts';
import { stagesForProcess } from '../../domain/plan/purpose.ts';
import { GAPS_MARK, questionsLanding } from '../../domain/work/home.ts';
import type { StageId } from '../../domain/workspace/route.ts';
import { buildBriefing } from '../../domain/meeting/briefing.ts';
import { addNote, continueCall, editNote, newCall, notesFile, notesFileName, removeNote, unfinishedLine, type CallState } from '../../domain/meeting/kept.ts';
import { askNow, dismissFound, leaveWithName, markAsked, readingDue, skipQuestion, type Readings } from '../../domain/meeting/panel.ts';
import { buildReview, callEdit, callNotesSource, type SaveChoice } from '../../domain/meeting/review.ts';
import { callAsked } from '../../domain/meeting/asked.ts';
import { CALL_WORDS as W, day } from '../../domain/meeting/words.ts';
import type { JourneyStore, Me, RevisionRow, SourceRow, Workspace } from '../store/types.ts';
import { Button, CARD, cx, messageOf, Spinner } from '../ui.tsx';
import { useModelEditor } from './useModelEditor.ts';
import { useVoice, voiceProps } from './voice.ts';
import { CallBriefing, type BriefingChoices } from './CallBriefing.tsx';
import { CallPanel, type ReadStatus } from './CallPanel.tsx';
import { CallReview } from './CallReview.tsx';
import { useProcessChanged } from '../processChanged.ts';
import { forgetCall, keepCall, loadCall, minuteLimitLine, readingsAfter, runEnd, runReading } from './callNotes.ts';

const ZONE = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
const nowIso = () => new Date().toISOString();

interface Loaded {
  name: string; workspace: Workspace; model: ProcessModel; working: { id: string; seq: number } | null;
  sources: SourceRow[]; session: ReturnType<typeof readState> | null; myName: string;
}

async function load(store: JourneyStore, processId: string, me: Me): Promise<Loaded | string> {
  const process = await store.getProcess(processId);
  if (!process) return 'This process could not be found, or you are not a member of its workspace.';
  const [revisions, workspaces, sources, session, members] = await Promise.all([
    store.listRevisions(processId), store.listWorkspaces(), store.listSources(processId),
    store.getDiscoverySession(processId).catch(() => null), store.listMembers(process.workspaceId).catch(() => []),
  ]);
  const workspace = workspaces.find(w => w.id === process.workspaceId);
  if (!workspace) return 'This process could not be found, or you are not a member of its workspace.';
  const current = revisions.find((r: RevisionRow) => r.state === 'working') ?? revisions.find((r: RevisionRow) => r.state === 'approved');
  const model = current ? await store.getModel(current.id) : null;
  if (!model) return 'This process has no record to prepare a call from yet.';
  const working = revisions.find((r: RevisionRow) => r.state === 'working');
  const mine = members.find(m => m.userId === me.id)?.name;
  return {
    name: process.name, workspace, model, working: working ? { id: working.id, seq: working.seq } : null, sources: sources.filter(s => !s.archived),
    session: session ? readState(session.state) : null, myName: mine && mine !== 'Unnamed member' ? mine : '',
  };
}

/**
 * `stageHref` gives the address of one of the process's stages, under the prefix the journey runs under; the call's
 * links open it in the main window when there is one (the window that opened this one), else here.
 */
export function CallPage({ store, processId, me, stageHref }: { store: JourneyStore; processId: string; me: Me; stageHref: (stage: StageId) => string }) {
  const [loaded, setLoaded] = React.useState<Loaded | string | null>(null);
  const reload = React.useCallback(() => { load(store, processId, me).then(setLoaded).catch(e => setLoaded(messageOf(e))); }, [store, processId, me]);
  React.useEffect(reload, [reload]);
  useProcessChanged(processId, reload);
  if (loaded === null) return <Spinner />;
  if (typeof loaded === 'string') return <main className="mx-auto max-w-3xl px-6 py-10"><p className="text-sm text-slate-700">{loaded}</p></main>;
  return <Call store={store} processId={processId} me={me} data={loaded} onReload={reload} stageHref={stageHref} />;
}

function Call({ store, processId, me, data, onReload, stageHref }: { store: JourneyStore; processId: string; me: Me; data: Loaded; onReload: () => void; stageHref: (stage: StageId) => string }) {
  const editor = useModelEditor(store, processId, { model: data.model, working: data.working }, onReload);
  const model = editor.model;
  const canEdit = data.workspace.role !== 'viewer';
  const voice = useVoice(store, data.workspace.id);
  const assessment = React.useMemo(() => assessProcess(model), [model]);
  const triage = React.useMemo(() => triageOf(model, assessment), [model, assessment]);
  const asksPurpose = offersPurpose(data.workspace.modules);
  const [call, setCallState] = React.useState<CallState | null>(() => loadCall(processId));
  const [view, setView] = React.useState<'unfinished' | 'briefing' | 'panel' | 'review' | 'saved'>(() => (loadCall(processId) ? 'unfinished' : 'briefing'));
  const [choices, setChoices] = React.useState<BriefingChoices>({ attendees: [], minutes: 30, arranged: { order: [], leftOut: [] }, own: [] });
  const [readings, setReadings] = React.useState<Readings>(store.aiAvailable ? 'ok' : 'noAi');
  const [status, setStatus] = React.useState<ReadStatus>(null);
  const [now, setNow] = React.useState(nowIso);
  const [ending, setEnding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [limited, setLimited] = React.useState<number | null>(null);
  const [savedKey, setSavedKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReturnType<typeof meetingResult> | null>(null);
  const [recorded, setRecorded] = React.useState({ answers: 0, kept: 0, left: 0 });
  const latest = React.useRef<CallState | null>(call);
  const reading = React.useRef(false);

  const setCall = React.useCallback((f: (s: CallState) => CallState) => {
    const cur = latest.current;
    if (!cur) return;
    const next = f(cur);
    latest.current = next;
    setCallState(next);
    keepCall(next);
  }, []);

  // The briefing, from the call's own choices once one is running, else from the briefing's.
  const using = call ? { attendees: call.attendees, minutes: call.minutes, arranged: call.arranged, own: call.own } : choices;
  const waiting = data.session?.waiting.length ?? 0;
  const briefing = React.useMemo(() => buildBriefing({ model, assessment, asksPurpose, attendees: using.attendees, minutes: using.minutes, arranged: using.arranged, own: using.own, sources: data.sources.length, waitingInDiscovery: waiting, triage }),
    [model, assessment, asksPurpose, using.attendees, using.minutes, using.arranged, using.own, data.sources.length, waiting, triage]);
  const list = React.useMemo(() => [...briefing.forCall, ...briefing.ifTime], [briefing]);
  const asked = React.useMemo(() => callAsked(model, data.session), [model, data.session]);
  const ctx = { model, list, triage, asked, timeZone: ZONE };
  // The main window, when it opened this one: the call's links open there, so the call stays where it is.
  const openThere = (href: string) => {
    const main = window.opener && !window.opener.closed ? window.opener as Window : null;
    if (main) { main.location.href = href; main.focus(); } else window.location.href = href;
  };
  const landing = questionsLanding(stagesForProcess(data.workspace.modules, model));
  const onOpenFiles = () => openThere(`${stageHref(landing.stage)}${landing.gaps ? `?${GAPS_MARK.name}=${GAPS_MARK.value}` : ''}`);
  const onReadIntoDraft = () => openThere(stageHref('sources'));

  // The minute readings: due when a note is added and a minute has passed, at once while the panel is checking.
  const read = React.useCallback(async (manual: boolean) => {
    const s = latest.current;
    if (!s || reading.current || readings !== 'ok') return;
    const at = nowIso();
    if (!readingDue(s, at, manual, { list, triage })) return;
    reading.current = true;
    setStatus({ kind: 'reading' });
    let failed: unknown = null;
    try {
      // The Discovery session is read again before each reading, so a question asked there in another tab counts.
      const session = await store.getDiscoverySession(processId).catch(() => null);
      const askedNow = session ? callAsked(model, readState(session.state)) : ctx.asked;
      const apply = await runReading(store, data.workspace.id, s, { ...ctx, asked: askedNow, now: at, at: nowIso }, e => { failed = failed ?? e; });
      setCall(apply);
      const stop = failed ? readingsAfter(failed) : null;
      if (stop) setReadings(stop);
      const minute = failed ? minuteLimitLine(failed) : null;
      setStatus(minute ? { kind: 'minute', line: minute } : failed ? { kind: 'failed' } : { kind: 'read', at: nowIso() });
    } finally { reading.current = false; }
  }, [store, data.workspace.id, readings, list, triage, ctx.asked, model, setCall]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (view !== 'panel') return;
    const t = window.setInterval(() => { setNow(nowIso()); void read(false); }, 5_000);
    return () => window.clearInterval(t);
  }, [view, read]);

  // Closing the window with notes not saved: the browser's own question.
  React.useEffect(() => {
    if (view !== 'panel' && view !== 'review') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [view]);

  const download = () => {
    const s = latest.current;
    if (!s) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([notesFile(s, ZONE)], { type: 'text/plain;charset=utf-8' }));
    a.download = notesFileName(data.name, s, ZONE);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const discard = () => {
    if (!window.confirm(W.discardAsk)) return;
    forgetCall(processId); latest.current = null; setCallState(null); setView('briefing');
  };
  const start = () => {
    const s = newCall({ processId, at: nowIso(), attendees: choices.attendees, minutes: choices.minutes, arranged: choices.arranged, own: choices.own });
    latest.current = s; setCallState(s); keepCall(s); setView('panel');
  };
  const end = async () => {
    const s = latest.current;
    if (!s) return;
    setBusy(true); setError(null);
    try {
      if (readings === 'ok') {
        let failed: unknown = null;
        const r = await runEnd(store, data.workspace.id, s, { model, list, triage, at: nowIso() }, e => { failed = failed ?? e; });
        latest.current = r.call; setCallState(r.call); keepCall(r.call);
        setLimited(r.total > r.read ? r.read : null);
        const stop = failed ? readingsAfter(failed) : null;
        if (stop) setReadings(stop);
      } else {
        const ended = { ...s, endedAt: nowIso(), changedAt: nowIso() };
        latest.current = ended; setCallState(ended); keepCall(ended);
      }
      setEnding(false); setView('review');
    } finally { setBusy(false); }
  };
  const save = async (choice: SaveChoice) => {
    const s = latest.current;
    if (!s) return;
    setBusy(true); setError(null);
    const before = model;
    const rctx = { model, list, triage, timeZone: ZONE };
    const review = buildReview(s, rctx);
    try {
      const source = callNotesSource(s, { takenKeys: data.sources.map(x => x.key), by: data.myName || me.email, endedAt: s.endedAt ?? nowIso(), timeZone: ZONE });
      if (!source) { setError('There are no notes to keep.'); return; }
      let key = savedKey;
      if (!key) {
        await store.addSource(processId, { key: source.key, title: source.title, fileName: '', format: 'txt', kind: source.kind, segments: source.segments, inferred: false, warnings: [], byteSize: source.byteSize });
        key = source.key; setSavedKey(key);
      }
      const edit = callEdit(s, review, choice, { ...rctx, source: { ...source, key }, date: day(s.startedAt, ZONE), by: { id: me.id, name: data.myName }, at: nowIso() });
      // The record as saved: the editor's own state is not yet updated inside this handler.
      let after: ProcessModel | null = null;
      const ok = await editor.apply(m => { const r = edit.op(m); after = r.model; return r; }, edit.summary);
      if (!ok || !after) { setError(W.notSaved('The record could not be saved', key)); return; }
      forgetCall(processId); latest.current = null; setCallState(null);
      setResult(meetingResult(before, after));
      setRecorded(edit.counts);
      setView('saved');
    } catch (e) { setError(savedKey ? W.notSaved(messageOf(e), savedKey) : W.notSavedNothing(messageOf(e))); }
    finally { setBusy(false); }
  };

  // Opened here because the browser blocked a new window (CALL_WORDS.blockedWindow).
  const here = typeof location !== 'undefined' && new URLSearchParams(location.search).get('opened') === 'here';
  const shell = (child: React.ReactNode) => <main className="mx-auto max-w-3xl px-6 py-8">{here && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="opened-here">{W.blockedWindow}</p>}{child}</main>;

  if (view === 'unfinished' && call) return shell(
    <section className={cx(CARD, 'p-6')} data-testid="call-unfinished">
      <p className="text-sm text-slate-800">{unfinishedLine(call, nowIso(), ZONE)}</p>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => { setCall(s => continueCall(s, nowIso())); setView('panel'); }}>{W.continue}</Button>
        <Button variant="secondary" onClick={discard}>{W.discard}</Button>
        <Button variant="ghost" onClick={download}>{W.download}</Button>
      </div>
    </section>);

  if (view === 'briefing') return shell(
    <CallBriefing process={data.name} briefing={briefing} choices={choices} onChoices={setChoices} canRun={canEdit} readsNotes={readings === 'ok'} onStart={start} onOpenFiles={onOpenFiles} />);

  if (view === 'panel' && call) return shell(<>
    <CallPanel process={data.name} s={call} list={list} triage={triage} now={now} readings={readings} status={status} zone={ZONE}
      voice={voiceProps(voice, store, data.workspace.id)}
      actions={{
        addNote: (text, speaker, spoken) => {
          const s = latest.current!;
          const r = addNote(s, { id: `n-${Date.now()}`, at: nowIso(), text, ...(speaker ? { speaker } : {}), ...(spoken ? { spoken: true } : {}) });
          if (typeof r === 'string') return r;
          setCall(() => r); return null;
        },
        editNote: (id, text) => setCall(s => { const r = editNote(s, id, text, nowIso()); return typeof r === 'string' ? s : r; }),
        removeNote: id => setCall(s => removeNote(s, id, nowIso())),
        asked: sug => setCall(s => markAsked(s, sug, nowIso())),
        skip: key => setCall(s => skipQuestion(s, key, nowIso())),
        leave: (key, name) => setCall(s => leaveWithName(s, key, name, nowIso())),
        askNow: key => setCall(s => askNow(s, key, nowIso())),
        dismiss: (itemKey, noteId) => setCall(s => dismissFound(s, { itemKey, noteId }, nowIso())),
        readNow: () => void read(true),
        end: () => setEnding(true),
        download,
      }} />
    {ending && (
      <div role="dialog" aria-modal="true" aria-label={W.endCall} className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
        <div className={cx(CARD, 'max-w-md p-6')}>
          <p className="text-sm text-slate-800">{W.endAsk}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={end} disabled={busy} data-testid="end-and-review">{W.endAndReview}</Button>
            <Button variant="secondary" onClick={() => setEnding(false)} disabled={busy}>{W.backToCall}</Button>
          </div>
        </div>
      </div>
    )}
  </>);

  if (view === 'review' && call) {
    const review = buildReview(call, { model, list, triage, timeZone: ZONE });
    const title = callNotesSource(call, { takenKeys: data.sources.map(x => x.key), by: data.myName || me.email, endedAt: call.endedAt ?? nowIso(), timeZone: ZONE })?.title ?? '';
    const shown = error && editor.error ? `${error} ${editor.error}` : error;
    return shell(<CallReview review={review} model={model} notesTitle={title} limited={limited} busy={busy} error={shown} onSave={save} onDiscard={discard} onDownload={download} />);
  }

  return shell(
    <section className={cx(CARD, 'space-y-3 p-6')} data-testid="call-saved">
      <p className="text-base font-semibold text-slate-900">{W.saved(recorded, result?.text ?? '')}</p>
      {result && result.left.length > 0 && <>
        <p className="text-sm text-slate-700">{W.stillOpen}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{result.left.map(g => <li key={g.owner}>{g.label}: {g.items.length}</li>)}</ul>
      </>}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="secondary" onClick={onOpenFiles}>{W.sendFiles}</Button>
        <Button variant="secondary" onClick={onReadIntoDraft}>{W.readIntoDraft}</Button>
        <Button variant="ghost" onClick={() => window.close()}>{W.closeWindow}</Button>
      </div>
    </section>);
}

