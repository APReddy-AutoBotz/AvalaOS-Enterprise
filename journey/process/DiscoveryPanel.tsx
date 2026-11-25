// Discovery, the fourth tab of Ask Avala on a process (package B, pull request 4b, plan
// `claude/package-b-pr4-plan-24-nov.md`, section 4; approved 24 November 2026). Ask Avala asks one question at a
// time, by rule: the first cards, the shape of the process, conflicts, the questions that could change the
// recommendation, the inputs that would sharpen the assessment, then what sign-off needs. Every rule is in
// domain/discovery/; this screen shows and saves. Nothing joins the process until a person presses Save; a
// person's words are kept as a source before anything is read from them; a value a person confirmed is never
// overwritten. The session (what is not in the record yet) is kept on the server with the version it was read at.
import React from 'react';
import type { ExtractionRow, JourneyStore, ProcessRow, SourceRow, Workspace } from '../store/types.ts';
import { StoreError } from '../store/types.ts';
import type { AccessStatus, ProcessModel } from '../../domain/processModel/types.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage, type TriageItem } from '../../domain/questions/triage.ts';
import { ACCESS, type Op } from '../../domain/questions/answer.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import { interviewAnswer, interviewSegments, readInterview, type Reading } from '../../domain/questions/interview.ts';
import { NO_WAY_IN, NO_WAY_IN_LABEL, waysMissing, waysRecordLine } from '../../domain/questions/ways.ts';
import { offersPurpose } from '../../domain/plan/purpose.ts';
import { ownWordsSource, sourceDate } from '../../domain/plan/start.ts';
import { failedLine } from '../../domain/extract/failure.ts';
import { GROUP_HEADING, originLine, type Card } from '../../domain/discovery/card.ts';
import { discoveryQueue } from '../../domain/discovery/queue.ts';
import { startCards } from '../../domain/discovery/checklist.ts';
import { inputEdit, type InputCard, type InputValue } from '../../domain/discovery/inputs.ts';
import { answersSource, ANSWER_TO } from '../../domain/discovery/answers.ts';
import { CAP_LINE, canReadWords, canUpdateDraft } from '../../domain/discovery/limits.ts';
import { sessionSummary } from '../../domain/discovery/summary.ts';
import {
  BUSY_LINE, commitSessionStep, countedReading, countSaved, dropLater, emptyState, FULL_LINE, keepAnswer, keepLater, keysBeingWritten, laterFor, readingsReviewed, readingsStarted, sourcesRead, takingInto, waitingAgainst,
  readState, reviewedReading, savedCount, skip, startedLine, startedReading, tookIntoSource, usedCall, type LaterWords, type SessionStep, type StoredSession,
} from '../../domain/discovery/session.ts';
import {
  cardItem, chooseEdit, keptLine, laterLine, leaveWith, notApplicable, stageOf, stepsWithWords, updateLabel, updateNote, updateSources, wordsEdit, WORDS,
} from '../../domain/discovery/flow.ts';
import { AnswerBox } from './AnswerFromNotes.tsx';
import { ChangeReview, coarsePatch } from './SourcesStage.tsx';
import { useVoice, voiceProps } from './voice.ts';
import { useDiscoveryOpenHere } from './discoveryOpen.ts';
import { announceProcessChanged } from '../processChanged.ts';
import { applyChanges, proposeChanges } from '../../domain/extract/rebase.ts';
import { Button, cx, ErrorNote, messageOf, Tag } from '../ui.tsx';

const MIN_WORDS = 40;
const MONTH = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const budgetGone = (e: unknown) => e instanceof StoreError && e.code === 'BUDGET_EXCEEDED';

/** The paragraph the demo shows in place of the tab: nothing to press. */
export function DiscoveryDemo() {
  return <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700" data-testid="discovery-demo">{WORDS.demo}</p>;
}

export function DiscoveryPanel({ store, workspace, process, model, sources, onOpenStage }: {
  store: JourneyStore; workspace: Workspace; process: ProcessRow; model: ProcessModel | null; sources: SourceRow[];
  /** Leaves the panel for a stage of the process (the Sources stage, Closing the gaps). */
  onOpenStage: (stage: 'sources' | 'process' | 'gaps') => void;
}) {
  useDiscoveryOpenHere(process.id);
  const voice = useVoice(store, workspace.id);
  const [session, setSession] = React.useState<StoredSession | null | undefined>(undefined);
  const [run, setRun] = React.useState<ExtractionRow | null | undefined>(undefined);
  const [names, setNames] = React.useState<Record<string, string>>({});
  // Who chooses, kept with every choice as the other screens keep it (review, 24 November 2026).
  const [me, setMe] = React.useState<string | null>(null);
  const who = { me, name: me && names[me] && names[me] !== 'Unnamed member' ? names[me]! : '' };
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [allowanceGone, setAllowanceGone] = React.useState(false);

  const load = React.useCallback(async () => {
    const [s, r] = await Promise.all([store.getDiscoverySession(process.id), store.latestExtraction(process.id)]);
    setSession(s);
    setRun(r);
  }, [store, process.id]);
  React.useEffect(() => { load().catch(e => setError(messageOf(e))); }, [load]);
  React.useEffect(() => {
    store.listMembers(workspace.id).then(ms => setNames(Object.fromEntries(ms.map(m => [m.userId, m.name])))).catch(() => {});
    store.currentUser().then(u => setMe(u?.id ?? null)).catch(() => {});
  }, [store, workspace.id]);

  // Follow a running reading; once it is done, count it against the session's cap (once).
  const running = Boolean(run && run.status !== 'done' && run.status !== 'failed');
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { store.latestExtraction(process.id).then(setRun).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [running, store, process.id]);

  const state = session ? readState(session.state) : emptyState();

  /** The open session, started when the person first does something that needs it. */
  const ensure = async (): Promise<StoredSession> => {
    if (session && session.status === 'open') return session;
    const made = await store.startDiscoverySession(process.id, workspace.id, emptyState());
    const s = made ?? await store.getDiscoverySession(process.id);
    if (!s) throw new Error('The session could not be started. Try again.');
    setSession(s);
    return s;
  };
  /** A step on the session, applied to the server's latest copy with the version it was read at. */
  const commit = async (step: SessionStep): Promise<boolean> => {
    await ensure();
    const r = await commitSessionStep({ get: () => store.getDiscoverySession(process.id), save: (id, next, v) => store.saveDiscoverySession(id, next, v) }, step);
    if (r.kind === 'saved') { setSession(r.session); return true; }
    if (r.kind === 'full') setError(FULL_LINE);
    else if (r.kind === 'busy') setError(BUSY_LINE);
    else { setSession(null); setError('This session was finished. Start a new one to carry on.'); }
    return false;
  };
  React.useEffect(() => {
    if (run?.status === 'done' && session && readingsStarted(readState(session.state)).includes(run.id) && !(readState(session.state).runs as string[] | undefined)?.includes(run.id)) {
      commit(countedReading(run.id, run.tokens ?? 0)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status, session?.id]);

  /** One edit on the working draft, read again if another page wrote first. */
  const saveOp = async (op: Op, summary: string): Promise<boolean> => {
    setError(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await store.startDraft(process.id);
        const r = op(d.model);
        if (r.patch.length) await store.savePatch(d.revisionId, d.seq, r.patch, 'user', summary);
        await commit(countSaved).catch(() => {});
        announceProcessChanged(process.id);
        return true;
      } catch (e) {
        if (!(e instanceof StoreError && e.status === 409) || attempt === 1) { setError(messageOf(e)); return false; }
      }
    }
    return false;
  };

  /** A call of the panel's own (reading an answer, voice), counted against the session's cap. */
  const callAi = async (segments: unknown) => {
    const r = await store.runAiTask(process.workspaceId, answerFromNotes.id, segments as never);
    await commit(usedCall(r.usage)).catch(() => {});
    return r;
  };
  const speak = voiceProps(voice, store, workspace.id);
  const boxVoice = speak.transcribe ? { transcribe: async (audio: string) => { const t = await speak.transcribe!(audio); await commit(usedCall(null)).catch(() => {}); return t; } } : speak;

  /** Reads sources as the Sources stage does, and remembers that this session started it. */
  const read = async (ids: string[]) => {
    const { runId } = await store.startExtraction(workspace.id, process.id, ids);
    // The session keeps which sources it read: the browser may not read a run's own list (review, 25 November 2026).
    await commit(startedReading(runId, ids));
    setRun({ id: runId, status: 'queued', error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: null });
  };

  // A load that failed says so, with a way to try again (review, 25 November 2026), never "Opening…" for ever.
  if (session === undefined || run === undefined) {
    if (!error) return <p className="text-sm text-slate-500">Opening Discovery…</p>;
    return (
      <div className="space-y-2" data-testid="discovery-load-failed">
        <ErrorNote message={`Discovery could not be opened: ${error}`} />
        <Button variant="secondary" onClick={() => { setError(null); load().catch(e => setError(messageOf(e))); }}>Try again</Button>
      </div>
    );
  }

  const hasSteps = Boolean(model?.steps.length);
  const stage = stageOf({ hasSteps, sources: sources.filter(s => !s.archived).length, run: run ?? null });
  const m = model ?? emptyModel(process.name);
  const asksPurpose = offersPurpose(workspace.modules);
  const capped = !canReadWords(state.use);
  const active = sources.filter(s => !s.archived);

  const header = session && session.status === 'open' && (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="discovery-session">
      <span>{startedLine(session.startedBy ? names[session.startedBy] : null, sourceDate(new Date(session.startedAt)))}</span>
      <FinishButton store={store} process={process} session={session} waiting={state.waiting.length} busy={busy}
        onDone={() => { setSession(null); setNotice('The session is finished. Start a new one whenever you like.'); }}
        keepAsSource={async () => (await keepWaiting()) !== 'failed'} onError={setError} />
    </div>
  );

  /**
   * The waiting answers become one "Discovery answers" source (review, 25 November 2026). They stay in the session,
   * marked with the source's key, until the source is saved, and only then leave it: closing the tab between the
   * two writes loses nothing, and answers whose source an earlier attempt saved are taken out, never written again.
   * Gives the ids of the answers sources to read.
   */
  async function keepWaiting(): Promise<{ ids: string[] } | 'none' | 'failed'> {
    const s = readState((await store.getDiscoverySession(process.id))?.state);
    const latest = await store.listSources(process.id);
    const { done, pending, doneKeys } = waitingAgainst(s, latest.map(x => x.key));
    const ids = latest.filter(x => doneKeys.includes(x.key)).map(x => x.id);
    if (done.length && !(await commit(tookIntoSource(done)))) return 'failed';
    const src = answersSource(pending, latest.map(x => x.key), sourceDate());
    if (!src) return ids.length ? { ids } : 'none';
    // Refused (full or busy): the line is shown and nothing is written.
    if (!(await commit(takingInto(pending, src.key)))) return 'failed';
    const row = await store.addSource(process.id, { key: src.key, title: src.title, fileName: '', format: 'txt', kind: src.kind, segments: src.segments, inferred: false, warnings: [], byteSize: new TextEncoder().encode(src.segments.map(x => x.text).join('\n')).length });
    announceProcessChanged(process.id);
    // Refused here, the source is saved and the answers still marked: the next update takes them out without writing them again.
    if (!(await commit(tookIntoSource(pending)))) return 'failed';
    return { ids: [...ids, row.id] };
  }

  const update = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const kept = await keepWaiting();
      if (typeof kept === 'string') return;
      const latest = await store.listSources(process.id);
      const newest = kept.ids[kept.ids.length - 1]!;
      const base = updateSources(sourcesRead(state, run?.id), latest.filter(s => !s.archived), newest);
      await read([...base.slice(0, -1), ...kept.ids.filter(id => !base.includes(id)), newest]);
    } catch (e) { if (budgetGone(e)) setAllowanceGone(true); else setError(messageOf(e)); } finally { setBusy(false); }
  };

  const reviewing = run?.status === 'done' && run.model && hasSteps && readingsStarted(state).includes(run.id) && !readingsReviewed(state).includes(run.id) ? run : null;
  const waiting = state.waiting.length;
  const files = active.filter(s => !/^own-|^ans-/.test(s.key)).length;

  return (
    <section aria-label="Discovery" data-testid="discovery">
      {header}
      {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="discovery-notice">{notice}</p>}
      <ErrorNote message={error} />
      {allowanceGone && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="discovery-allowance">{WORDS.allowance(MONTH())}</p>}
      {capped && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="discovery-cap">{CAP_LINE}</p>}

      {stage === 'describe' && (
        <Describe store={store} process={process} m={m} asksPurpose={asksPurpose} boxVoice={boxVoice} capped={!canUpdateDraft(state.use)} busy={busy}
          onSave={async (words, picks) => {
            setBusy(true); setError(null);
            try {
              // The first cards' choices join the process with this Save, never on a click (review, 24 November 2026).
              for (const [card, pick] of picks) {
                const e = chooseEdit(card, m, pick, { ...who, at: new Date().toISOString() });
                if (e && !(await saveOp(e.op, e.summary))) return;
              }
              const row = await store.addSource(process.id, ownWordsSource(words, sources.map(s => s.key), sourceDate()));
              announceProcessChanged(process.id);
              await read([row.id]);
            } catch (e) { if (budgetGone(e)) setAllowanceGone(true); else setError(messageOf(e)); } finally { setBusy(false); }
          }}
          onSources={() => onOpenStage('sources')} />
      )}

      {stage === 'reading' && <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-950" data-testid="discovery-reading">{hasSteps ? WORDS.updating : WORDS.reading}</p>}

      {stage === 'first' && (
        <FirstReading store={store} process={process} run={run ?? null} lastRead={sourcesRead(state, run?.id)} boxVoice={boxVoice} busy={busy} active={active}
          onRead={async ids => { setBusy(true); setError(null); try { await read(ids); } catch (e) { if (budgetGone(e)) setAllowanceGone(true); else setError(messageOf(e)); } finally { setBusy(false); } }}
          onAdd={async words => {
            setBusy(true); setError(null);
            try {
              const row = await store.addSource(process.id, ownWordsSource(words, sources.map(s => s.key), sourceDate()));
              const latest = await store.listSources(process.id);
              await read(updateSources(sourcesRead(state, run?.id), latest.filter(s => !s.archived), row.id));
            } catch (e) { if (budgetGone(e)) setAllowanceGone(true); else setError(messageOf(e)); } finally { setBusy(false); }
          }}
          onStarted={() => { announceProcessChanged(process.id); if (run) void commit(reviewedReading(run.id)); }} />
      )}

      {stage === 'cards' && (
        <>
          {waiting > 0 && !reviewing && (
            <div className="mb-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" data-testid="discovery-waiting">
              <p className="text-sm text-amber-950">{waiting} {waiting === 1 ? 'answer is' : 'answers are'} not in the draft yet.</p>
              {updateNote(active.length + 1, files) && <p className="text-xs text-amber-900">{updateNote(active.length + 1, files)}</p>}
              <Button variant="accent" onClick={update} disabled={busy || running || !canUpdateDraft(state.use)}>{updateLabel(waiting)}</Button>
            </div>
          )}
          {run?.status === 'failed' && readingsStarted(state).includes(run.id) && <div className="mb-4"><ErrorNote message={failedLine(run.error)} /><Button variant="secondary" onClick={() => { const ids = sourcesRead(state, run.id); void read(ids.length ? ids : active.map(x => x.id)); }}>Try again</Button></div>}
          {reviewing && (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="discovery-review">
              <p className="mb-2 text-sm font-semibold text-slate-900">What your answers change in the draft</p>
              <ChangeReview store={store} processId={process.id} extracted={reviewing.model!} finishedAt={reviewing.updatedAt} matchLine="Your answers match the draft as it stands."
                onApplied={() => { void commit(reviewedReading(reviewing.id)); announceProcessChanged(process.id); }} />
              <button type="button" className="mt-2 text-xs font-medium text-slate-500 underline" onClick={() => void commit(reviewedReading(reviewing.id))}>Close this review</button>
            </div>
          )}
          <Cards store={store} process={process} model={m} asksPurpose={asksPurpose} skipped={state.skipped} waitingKeys={state.waiting.map(w => w.key)} keys={[...sources.map(s => s.key), ...keysBeingWritten(state)]}
            capped={capped || allowanceGone} boxVoice={boxVoice} saved={savedCount(state)} later={state.later} who={who} callAi={callAi} saveOp={saveOp} commit={commit}
            onAllowance={() => setAllowanceGone(true)} onNotice={setNotice} onError={setError} onOpenStage={onOpenStage}
            addWords={async (key, question, words) => {
              await store.addSource(process.id, { key, title: `Discovery answers, ${sourceDate()}`, fileName: '', format: 'txt', kind: 'Discovery answers', inferred: false, warnings: [], byteSize: words.length,
                segments: [{ id: `${key}:1`, sourceId: key, kind: 'paragraph', text: words.trim(), locator: { heading: `${ANSWER_TO}${question}`, lineStart: 1 } }] });
            }} />
        </>
      )}
    </section>
  );
}

type BoxVoice = { transcribe?: (audio: string) => Promise<string>; voiceLine?: string };
type Who = { me: string | null; name: string };

function Choices({ card, value, onChange }: { card: Card; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="sr-only">{card.question}</legend>
      {(card.choices ?? []).map(([v, label]) => (
        <label key={v} className="flex items-center gap-2 text-sm text-slate-800">
          <input type="radio" name={card.key} className="h-4 w-4 accent-[#002C4B]" checked={value === v} onChange={() => onChange(v)} />{label}
        </label>
      ))}
    </fieldset>
  );
}

function Describe({ m, asksPurpose, boxVoice, capped, busy, onSave, onSources }: {
  store: JourneyStore; process: ProcessRow; m: ProcessModel; asksPurpose: boolean; boxVoice: BoxVoice; capped: boolean; busy: boolean;
  onSave: (words: string, picks: [Card, string][]) => void; onSources: () => void;
}) {
  const [words, setWords] = React.useState('');
  const first = startCards(m, { asksPurpose });
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  return (
    <div className="space-y-4" data-testid="discovery-describe">
      <div>
        <h3 className="font-display text-lg font-semibold text-slate-900">Tell Ask Avala about the process</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{WORDS.intro}</p>
      </div>
      {first.map(card => (
        <div key={card.key} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">{card.question}</p>
          <div className="mt-2"><Choices card={card} value={picks[card.key] ?? ''} onChange={v => setPicks(p => ({ ...p, [card.key]: v }))} /></div>
          {card.key === 'start:purpose' && picks[card.key] === 'decided' && <p className="mt-2 text-sm text-slate-600" data-testid="discovery-decided">{WORDS.decided}</p>}
        </div>
      ))}
      <AnswerBox label="In your own words" value={words} onChange={setWords} rows={7} placeholder="For example: Supplier invoices arrive by email. Someone in accounts payable checks them against the purchase order…" {...boxVoice} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="accent" disabled={busy || capped || words.trim().length < MIN_WORDS} onClick={() => onSave(words, first.filter(c => picks[c.key]).map(c => [c, picks[c.key]!] as [Card, string]))}>{busy ? 'Saving…' : 'Save and read it'}</Button>
        <span className="text-xs text-slate-500">{words.trim().length < MIN_WORDS ? 'A few sentences at least. Your choices above are saved with it.' : `${WORDS.kept} Your choices above are saved with it.`}</span>
      </div>
      <button type="button" onClick={onSources} className="text-sm font-medium text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4">Have documents too? Add them on the Sources stage.</button>
    </div>
  );
}

function FirstReading({ store, process, run, lastRead, boxVoice, busy, active, onRead, onAdd, onStarted }: {
  store: JourneyStore; process: ProcessRow; run: ExtractionRow | null; lastRead: string[]; boxVoice: BoxVoice; busy: boolean; active: SourceRow[];
  onRead: (ids: string[]) => void; onAdd: (words: string) => void; onStarted: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [words, setWords] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  if (!run || !run.model) {
    return (
      <div className="space-y-2" data-testid="discovery-first">
        {run?.status === 'failed' && <ErrorNote message={failedLine(run.error)} />}
        <p className="text-sm text-slate-700">{active.length} {active.length === 1 ? 'source is' : 'sources are'} ready to read.</p>
        <Button variant="accent" disabled={busy} onClick={() => onRead(lastRead.length ? lastRead : active.map(s => s.id))}>{run ? 'Try again' : 'Read it'}</Button>
      </div>
    );
  }
  const extracted = run.model!;
  const rows = stepsWithWords(extracted);
  const start = async () => {
    setSaving(true); setError(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await store.startDraft(process.id);
        const set = proposeChanges(d.model, extracted);
        const next = applyChanges(d.model, extracted, new Set(set.changes.filter(c => c.defaultSelected).map(c => c.id)));
        const patch = coarsePatch(d.model, next);
        if (patch.length) await store.savePatch(d.revisionId, d.seq, patch, 'extraction', 'Model extracted from sources');
        setSaving(false);
        onStarted();
        return;
      } catch (e) {
        if (!(e instanceof StoreError && e.status === 409) || attempt === 1) { setError(messageOf(e)); setSaving(false); return; }
      }
    }
  };
  return (
    <div className="space-y-3" data-testid="discovery-first">
      <h3 className="font-display text-lg font-semibold text-slate-900">What I understand so far</h3>
      <p className="text-sm leading-6 text-slate-600">From what you said: {extracted.steps.length} {extracted.steps.length === 1 ? 'step' : 'steps'}, {extracted.roles.length} {extracted.roles.length === 1 ? 'role' : 'roles'} and {extracted.systems.length} {extracted.systems.length === 1 ? 'application' : 'applications'}. Each step shows the words it came from.</p>
      <ol className="space-y-2" data-testid="discovery-steps">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">{i + 1}. {r.name}</p>
            {(r.role || r.app) && <p className="text-xs text-slate-600">{[r.role, r.app].filter(Boolean).join(' · ')}</p>}
            {r.words && <p className="mt-1 text-sm leading-6 text-slate-700">From your words: “{r.words}”</p>}
          </li>
        ))}
      </ol>
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="accent" onClick={start} disabled={saving || !extracted.steps.length}>Start the process from this</Button>
        <Button variant="secondary" onClick={() => setAdding(a => !a)}>Add to what I said</Button>
      </div>
      <p className="text-xs text-slate-500">It becomes a working draft you can edit. Nothing is approved yet.</p>
      {adding && (
        <div className="space-y-2">
          <AnswerBox label="What to add" value={words} onChange={setWords} rows={4} placeholder="What else happens, who does it, in which application…" {...boxVoice} />
          <Button disabled={busy || words.trim().length < 2} onClick={() => onAdd(words)}>Save and read it again</Button>
        </div>
      )}
    </div>
  );
}

function Cards({ model, asksPurpose, skipped, waitingKeys, keys, capped, boxVoice, saved, later, who, callAi, saveOp, commit, addWords, onAllowance, onNotice, onError, onOpenStage }: {
  store: JourneyStore; process: ProcessRow; model: ProcessModel; asksPurpose: boolean; skipped: string[]; waitingKeys: string[]; keys: string[];
  capped: boolean; boxVoice: BoxVoice; saved: number; later: LaterWords[]; who: Who;
  callAi: (segments: unknown) => Promise<{ data: unknown }>; saveOp: (op: Op, summary: string) => Promise<boolean>; commit: (step: SessionStep) => Promise<boolean>;
  addWords: (key: string, question: string, words: string) => Promise<void>;
  onAllowance: () => void; onNotice: (n: string | null) => void; onError: (e: string | null) => void; onOpenStage: (stage: 'sources' | 'process' | 'gaps') => void;
}) {
  const assessment = React.useMemo(() => assessProcess(model), [model]);
  const t = React.useMemo(() => triage(model, assessment), [model, assessment]);
  const queue = React.useMemo(() => discoveryQueue({ model, assessment, asksPurpose, skipped, triage: t }).filter(c => !waitingKeys.includes(c.key)), [model, assessment, asksPurpose, skipped, t, waitingKeys]);
  const summary = sessionSummary(model, assessment, saved, later.length);
  const [showSummary, setShowSummary] = React.useState(false);
  const card = queue[0];
  return (
    <>
      {card && !showSummary ? (
        <React.Fragment key={card.key}><CardView card={card} item={cardItem(card, t)} model={model} n={1} of={queue.length} keys={keys} capped={capped} boxVoice={boxVoice} later={laterFor({ ...emptyState(), later }, card.key)} who={who}
          callAi={callAi} saveOp={saveOp} commit={commit} addWords={addWords} onAllowance={onAllowance} onNotice={onNotice} onError={onError} onOpenStage={onOpenStage} waiting={waitingKeys.length} /></React.Fragment>
      ) : (
        <Summary summary={summary} onOpenStage={onOpenStage} />
      )}
      {card && <button type="button" className="mt-4 text-sm font-medium text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4" onClick={() => setShowSummary(s => !s)}>{showSummary ? 'Back to the questions' : 'Where discovery stands'}</button>}
    </>
  );
}

function Summary({ summary, onOpenStage }: { summary: ReturnType<typeof sessionSummary>; onOpenStage: (stage: 'sources' | 'process' | 'gaps') => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="discovery-summary">
      <h3 className="font-display text-lg font-semibold text-slate-900">Where discovery stands</h3>
      <p className="mt-1 text-sm leading-6 text-slate-700">{summary.line}</p>
      <p className="mt-2 text-sm leading-6 text-slate-700">{summary.closing}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onOpenStage('gaps')}>Send questions to the people who know</Button>
      </div>
    </div>
  );
}

function CardView({ card, item, model, n, of, keys, capped, boxVoice, later, who, callAi, saveOp, commit, addWords, onAllowance, onNotice, onError, onOpenStage, waiting }: {
  card: Card; item: TriageItem | undefined; model: ProcessModel; n: number; of: number; keys: string[]; capped: boolean; boxVoice: BoxVoice; waiting: number;
  /** Words kept on this card to read later: shown again in the box. */
  later: LaterWords | undefined; who: Who;
  callAi: (segments: unknown) => Promise<{ data: unknown }>; saveOp: (op: Op, summary: string) => Promise<boolean>; commit: (step: SessionStep) => Promise<boolean>;
  addWords: (key: string, question: string, words: string) => Promise<void>;
  onAllowance: () => void; onNotice: (n: string | null) => void; onError: (e: string | null) => void; onOpenStage: (stage: 'sources' | 'process' | 'gaps') => void;
}) {
  const [text, setText] = React.useState(later?.words ?? '');
  const [pick, setPick] = React.useState('');
  const [statuses, setStatuses] = React.useState<Record<number, AccessStatus>>(() => Object.fromEntries((item?.interfaces ?? []).map(x => [x.index, x.access])));
  const [reading, setReading] = React.useState<{ r: Reading; said: string; attempt: 1 | 2; first: string } | null>(null);
  const [followUp, setFollowUp] = React.useState<{ question: string; first: string } | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [asked, setAsked] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [field, setField] = React.useState<InputValue>({});
  const ways = item && (item.kind === 'ways' || item.kind === 'access');
  const way = card.answer === 'words' && !item ? 'waits' : card.answer;

  const done = (line: string | null) => { onNotice(line); };
  const run = async (f: () => Promise<void>) => { setBusy(true); onError(null); try { await f(); } catch (e) { if (e instanceof StoreError && e.code === 'BUDGET_EXCEEDED') onAllowance(); else onError(messageOf(e)); } finally { setBusy(false); } };

  const readWords = () => run(async () => {
    const said = followUp ? interviewAnswer(followUp.first, text) : interviewAnswer(text);
    const { segments, ids } = interviewSegments(model, item!, said);
    const r = await callAi(segments);
    const findings = ((r.data as { answers?: NoteFinding[] } | null)?.answers ?? []);
    const attempt: 1 | 2 = followUp ? 2 : 1;
    const out = readInterview(model, item!, ids, findings, attempt, said);
    if (out.kind === 'followUp') { setFollowUp({ question: out.question, first: said }); setText(''); setReading(null); return; }
    setReading({ r: out, said, attempt, first: followUp?.first ?? '' });
  });
  const saveWords = (r: Extract<Reading, { kind: 'record' | 'confirm' }>) => run(async () => {
    const e = wordsEdit(model, item!, r.proposal, keys);
    if (!e) { onError('This answer cannot be recorded for this question.'); return; }
    if (e.keepWords) await addWords(e.keepWords.key, e.keepWords.question, e.keepWords.words);
    if (await saveOp(e.op, e.summary)) { if (later) await commit(dropLater(card.key)); done(e.line ?? `Recorded: ${r.proposal.display}`); }
  });
  const wordsPreview = reading && (reading.r.kind === 'record' || reading.r.kind === 'confirm') ? wordsEdit(model, item!, reading.r.proposal, keys) : null;

  const choose = () => run(async () => {
    if (card.key === 'start:purpose' && pick === 'decided') { if (await commit(skip(card.key))) onNotice(WORDS.decided); return; }
    const e = chooseEdit(card, model, pick, { ...who, at: new Date().toISOString(), item, statuses });
    if (!e) { await commit(skip(card.key)); return; }
    if (await saveOp(e.op, e.summary)) done(null);
  });
  const keep = () => run(async () => {
    if (await commit(keepAnswer({ key: card.key, words: text.trim(), question: card.question, at: new Date().toISOString() }))) done(keptLine(waiting + 1));
  });
  const fieldSave = () => run(async () => {
    const op = inputEdit(card as InputCard, field);
    if (!op) { onError('Fill in the answer first.'); return; }
    if (await saveOp(op, `Discovery: ${card.question}`)) done(null);
  });
  const chosenReady = ways ? Boolean(waysRecordLine(model, item!, { pick, statuses })) : Boolean(pick);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4" data-testid="discovery-card">
      <p className="text-xs font-medium text-slate-500">Question {n} of {of} · {GROUP_HEADING[card.group]}</p>
      <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700" data-testid="discovery-origin">{originLine(card.origin)}</p>
      <h3 className="mt-2 font-display text-lg font-semibold leading-7 text-slate-900" data-testid="discovery-question">{card.question}</h3>
      {card.why && <p className="mt-1 text-sm leading-6 text-slate-600">Why it matters: {card.why}</p>}
      {card.updates.length > 0 && <p className="mt-1 text-sm leading-6 text-slate-600">Your answer will update: {card.updates.join(', ')}.</p>}

      <div className="mt-4 space-y-3">
        {way === 'choose' && !ways && <Choices card={card} value={pick} onChange={setPick} />}
        {way === 'choose' && ways && (
          <div className="space-y-2">
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Ways in">
              {item!.interfaces!.map(x => (
                <li key={x.index} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-slate-800">{x.label}</span>
                  <select aria-label={`Status of ${x.label}`} value={statuses[x.index]} onChange={e => { setStatuses({ ...statuses, [x.index]: e.target.value as AccessStatus }); setPick(''); }}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                    {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            {item!.kind === 'ways' && (
              <button type="button" aria-pressed={pick === NO_WAY_IN} onClick={() => setPick(pick === NO_WAY_IN ? '' : NO_WAY_IN)}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', pick === NO_WAY_IN ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white text-slate-800 ring-slate-300')}>{NO_WAY_IN_LABEL}</button>
            )}
            {waysMissing({ pick, statuses }) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status" data-testid="ways-missing">{waysMissing({ pick, statuses })}</p>}
            {waysRecordLine(model, item!, { pick, statuses }) && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950" role="status" data-testid="ways-record">{waysRecordLine(model, item!, { pick, statuses })}</p>}
          </div>
        )}
        {way === 'field' && <FieldInput card={card as InputCard} model={model} value={field} onChange={setField} />}
        {way === 'waits' && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-950" data-testid="discovery-waits">{WORDS.shapeWaits}</p>}
        {(way === 'words' || way === 'waits') && (
          <>
            {followUp && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950" data-testid="discovery-follow-up">{followUp.question}</p>}
            {later && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2" data-testid="discovery-later">
                <p className="text-sm text-slate-700">{laterLine(later.at)}</p>
                <Button variant="ghost" disabled={busy} onClick={() => run(async () => { if (await commit(dropLater(card.key))) setText(''); })}>Clear my kept words</Button>
              </div>
            )}
            <AnswerBox label="Or answer in your own words" value={text} onChange={v => { setText(v); setReading(null); }} rows={3} maxLength={2000} placeholder="Type, or press the microphone and speak" {...boxVoice} />
          </>
        )}
        {reading?.r.kind === 'unanswered' && <p className="text-sm text-slate-700">{reading.r.message}</p>}
        {reading && (reading.r.kind === 'record' || reading.r.kind === 'confirm') && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2" data-testid="discovery-record">
            <p className="text-sm font-semibold text-sky-950">This will record</p>
            <p className="mt-1 text-sm text-sky-950">{reading.r.proposal.display} <Tag tone={reading.r.kind === 'record' ? 'neutral' : 'warn'}>{reading.r.kind === 'record' ? 'You said it' : 'Inferred: check it'}</Tag></p>
            <p className="mt-1 text-xs text-sky-900">“{reading.r.proposal.quote}”</p>
            {wordsPreview?.line && <p className="mt-2 text-sm text-amber-950" data-testid="discovery-confirmed">{wordsPreview.line}</p>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {way === 'choose' && <Button onClick={choose} disabled={busy || !chosenReady}>Save</Button>}
        {way === 'field' && <Button onClick={fieldSave} disabled={busy}>Save</Button>}
        {way === 'waits' && <Button onClick={keep} disabled={busy || text.trim().length < 2}>Save</Button>}
        {way === 'words' && !reading && <Button onClick={readWords} disabled={busy || capped || text.trim().length < 2}>Read my answer</Button>}
        {way === 'words' && capped && text.trim().length > 1 && <Button variant="secondary" onClick={() => run(async () => { if (await commit(keepLater({ key: card.key, question: card.question, words: text.trim(), at: new Date().toISOString() }))) done('Your words are kept with this session, to read later.'); })}>Keep my words to read later</Button>}
        {reading && (reading.r.kind === 'record' || reading.r.kind === 'confirm') && <>
          <Button onClick={() => saveWords(reading.r as Extract<Reading, { kind: 'record' | 'confirm' }>)} disabled={busy}>Save</Button>
          <Button variant="secondary" onClick={() => setReading(null)}>Change my answer</Button>
        </>}
        <Button variant="ghost" onClick={() => setAsking(a => !a)}>Not known, ask someone</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => { const e = notApplicable(card, item); if (await saveOp(e.op, e.summary)) { if (later) await commit(dropLater(card.key)); done(null); } })}>Not applicable</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await commit(skip(card.key)); })}>Skip</Button>
      </div>
      {asking && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">Who would know?
            <input value={asked} onChange={e => setAsked(e.target.value)} maxLength={120} className="mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          </label>
          <Button disabled={busy || !asked.trim()} onClick={() => run(async () => { const e = leaveWith(card, item, asked); if (e && await saveOp(e.op, e.summary)) { if (later) await commit(dropLater(card.key)); done(e.line ?? null); } })}>Leave it with them</Button>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{WORDS.nothing}</p>
    </article>
  );
}

/** The field an input card asks with: the Inputs view's own answers. */
function FieldInput({ card, model, value, onChange }: { card: InputCard; model: ProcessModel; value: InputValue; onChange: (v: InputValue) => void }) {
  const f = card.field;
  const input = 'rounded-lg border border-slate-300 px-2 py-1 text-sm';
  const stepName = (id: string) => model.steps.find(s => s.id === id)?.name ?? id;
  if (f.kind === 'figure') return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Number" inputMode="decimal" className={input} value={value.number ?? ''} onChange={e => onChange({ ...value, number: e.target.value === '' ? undefined : Number(e.target.value) })} />
      {f.period && <select aria-label="Period" className={input} value={value.period ?? ''} onChange={e => onChange({ ...value, period: (e.target.value || undefined) as InputValue['period'] })}>
        <option value="">a…</option>{(['day', 'week', 'month', 'quarter', 'year'] as const).map(p => <option key={p} value={p}>a {p}</option>)}
      </select>}
      {f.units && <select aria-label="Unit" className={input} value={value.unit ?? ''} onChange={e => onChange({ ...value, unit: (e.target.value || undefined) as InputValue['unit'] })}>
        <option value="">unit</option>{f.units.map(u => <option key={u} value={u}>{u}</option>)}
      </select>}
    </div>
  );
  if (f.kind === 'change') return (
    <fieldset className="space-y-1">{(['none', 'minor', 'major'] as const).map(l => (
      <label key={l} className="flex items-center gap-2 text-sm"><input type="radio" name={card.key} checked={value.level === l} onChange={() => onChange({ ...value, level: l })} />{l === 'none' ? 'No change' : l === 'minor' ? 'Minor changes' : 'Major changes'}</label>
    ))}</fieldset>
  );
  if (f.kind === 'api') return (
    <ul className="space-y-1">{f.stepIds.map(id => (
      <li key={id} className="flex items-center gap-2 text-sm">
        <span className="flex-1">{stepName(id)}</span>
        <select aria-label={`API for ${stepName(id)}`} className={input} value={value.covers?.includes(id) ? 'yes' : value.notCovers?.includes(id) ? 'no' : ''}
          onChange={e => onChange({ ...value, covers: [...(value.covers ?? []).filter(x => x !== id), ...(e.target.value === 'yes' ? [id] : [])], notCovers: [...(value.notCovers ?? []).filter(x => x !== id), ...(e.target.value === 'no' ? [id] : [])] })}>
          <option value="">Not known</option><option value="yes">Covers it</option><option value="no">Does not cover it</option>
        </select>
      </li>
    ))}</ul>
  );
  if (f.kind === 'fact') return (
    <div className="space-y-2">
      <fieldset className="space-y-1">{f.choices.map(([v, l]) => (
        <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name={card.key} checked={value.pick === v} onChange={() => onChange({ ...value, pick: v })} />{l}</label>
      ))}</fieldset>
      {f.sameForAll && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value.sameForAll)} onChange={e => onChange({ ...value, sameForAll: e.target.checked })} />The same for every step</label>}
    </div>
  );
  return (
    <ul className="space-y-1">{f.stepIds.map(id => (
      <li key={id} className="flex items-center gap-2 text-sm">
        <span className="flex-1">{stepName(id)}</span>
        <input aria-label={`${f.trait === 'effortMinutes' ? 'Minutes' : 'Share'} for ${stepName(id)}`} inputMode="decimal" className={`${input} w-24`} value={value.perStep?.[id] ?? ''}
          onChange={e => onChange({ ...value, perStep: { ...(value.perStep ?? {}), [id]: Number(e.target.value) } })} />
        <span className="text-xs text-slate-500">{f.trait === 'effortMinutes' ? 'minutes' : '%'}</span>
      </li>
    ))}</ul>
  );
}

function FinishButton({ store, process, session, waiting, busy, onDone, keepAsSource, onError }: {
  store: JourneyStore; process: ProcessRow; session: StoredSession; waiting: number; busy: boolean;
  onDone: () => void; keepAsSource: () => Promise<boolean>; onError: (e: string | null) => void;
}) {
  const [asking, setAsking] = React.useState(false);
  const finish = async (keep: boolean) => {
    onError(null);
    try {
      // A session is finished only once its waiting answers are safely in a source.
      if (keep && !(await keepAsSource())) return;
      for (let i = 0; i < 3; i++) {
        const s = await store.getDiscoverySession(process.id);
        if (!s) { onDone(); return; }
        const r = await store.finishDiscoverySession(s.id, s.version);
        if (r !== 'stale') { onDone(); return; }
      }
      onError(BUSY_LINE);
    } catch (e) { onError(messageOf(e)); }
  };
  if (asking) return (
    <span className="flex flex-wrap items-center gap-2" data-testid="discovery-finish-ask">
      <span>{waiting} {waiting === 1 ? 'answer is' : 'answers are'} not in the draft yet.</span>
      <Button variant="secondary" disabled={busy} onClick={() => void finish(true)}>Keep them as a source and finish</Button>
      <Button variant="ghost" onClick={() => setAsking(false)}>Update the draft first</Button>
    </span>
  );
  return <Button variant="ghost" disabled={busy || session.id === ''} onClick={() => (waiting > 0 ? setAsking(true) : void finish(false))}>Finish</Button>;
}
