// Looking in a process's sources for answers before its questions are put to people (part D of the
// effort-first plan; rules in domain/assistant/sourceLook.ts). The process page starts a look when it
// opens and whenever the sources or the questions change; a look reads the sources with the existing
// `answerFromNotes` task, within its limit. What was looked up, what was found and what was set aside
// with "Not right" are kept on the server for everyone (package 4 of docs/next-plan.md, table
// process_source_looks): a page reads the server's copy before it decides to look, and writes every step
// through domain/assistant/sharedLook.ts, so no page loses what another found and the wait holds across
// browsers. This browser keeps a copy only for showing it at once, for when the server cannot be reached,
// and for the demo. Answers found are suggestions: nothing is written to the process until a person
// presses Save.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage, type Triage } from '../../domain/questions/triage.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import { planQuestions, type QuestionPlan } from '../../domain/questions/firstList.ts';
import type { Passage } from '../../domain/assistant/ask.ts';
import { answerSuggestions, sourceSegments, type Suggestion } from '../../domain/assistant/suggest.ts';
import { allowanceStopped, allowanceUsedUp, AUTO_LOOK, foundFor, foundKeys, sourcesKey, toLookUp, waitingUntil, type SourceLook } from '../../domain/assistant/sourceLook.ts';
import { answerStep, commitStep, dismissStep, handOverStep, sendStep, Skip, stoppedStep, type LookStep, type SharedLook } from '../../domain/assistant/sharedLook.ts';

const EVENT = 'avala:source-look';
const lookKey = (processId: string) => `avala:source-look:${processId}`;
const dismissedKey = (processId: string) => `avala:dismissed:${processId}`;
const announce = (processId: string) => dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));

export function readLook(processId: string): SourceLook | null {
  try { const raw = localStorage.getItem(lookKey(processId)); return raw ? (JSON.parse(raw) as SourceLook) : null; } catch { return null; }
}
/** This browser's copy of the shared look. */
function writeCopy(processId: string, s: SharedLook): void {
  try {
    if (s.look) localStorage.setItem(lookKey(processId), JSON.stringify(s.look)); else localStorage.removeItem(lookKey(processId));
    localStorage.setItem(dismissedKey(processId), JSON.stringify(s.dismissed.slice(-500)));
  } catch { /* storage unavailable: the copy is kept for this page only */ }
  if (s.look) memory.set(processId, s.look); else memory.delete(processId);
  memoryDismissed.set(processId, s.dismissed);
  announce(processId);
}
/** Kept for this page when the browser's storage is unavailable. */
const memory = new Map<string, SourceLook>();
const memoryDismissed = new Map<string, string[]>();
const current = (processId: string) => readLook(processId) ?? memory.get(processId) ?? null;

/** Suggestions set aside with "Not right" on this process (shared by everyone, as last read from the server). */
export function readDismissed(processId: string): string[] {
  try { const raw = localStorage.getItem(dismissedKey(processId)); if (raw) return JSON.parse(raw) as string[]; } catch { /* fall through */ }
  return memoryDismissed.get(processId) ?? [];
}

/** The server each process's shared look is kept on, as the open process page knows it (editors write). */
const servers = new Map<string, { store: JourneyStore; workspaceId: string; canEdit: boolean }>();

/**
 * Applies one step: to this browser's copy at once, then to the server's latest copy (again on a newer copy
 * when another page wrote first). Returns false when the step gave up on the server's copy.
 */
async function commit(processId: string, step: LookStep): Promise<boolean> {
  const mine = step({ look: current(processId), dismissed: readDismissed(processId) });
  const srv = servers.get(processId);
  if (!srv?.canEdit) { if (mine !== Skip) writeCopy(processId, mine); return mine !== Skip; }
  try {
    const saved = await commitStep({
      get: () => srv.store.getSourceLook(processId),
      save: (next, version) => srv.store.saveSourceLook(processId, srv.workspaceId, next, version),
    }, step);
    if (saved === Skip) return false;
    if (saved) { writeCopy(processId, saved); return true; }
  } catch { /* the server cannot be reached: keep this browser's copy */ }
  if (mine !== Skip) writeCopy(processId, mine);
  return mine !== Skip;
}

/**
 * Reads the server's copy of a process's shared look into this browser (everyone, viewers too). For an
 * editor, once after the release, this browser's own look of the current sources is handed to the server
 * when the server has none for them, so nothing is looked up again.
 */
export async function syncLook(store: JourneyStore, process: { id: string; workspaceId: string }, canEdit: boolean, sources?: string): Promise<void> {
  // A panel that only reads never takes away the page's right to write.
  servers.set(process.id, { store, workspaceId: process.workspaceId, canEdit: canEdit || Boolean(servers.get(process.id)?.canEdit) });
  const local: SharedLook = { look: current(process.id), dismissed: readDismissed(process.id) };
  try {
    const stored = await store.getSourceLook(process.id);
    if (stored) writeCopy(process.id, { look: stored.look, dismissed: stored.dismissed });
    if (canEdit && sources && local.look?.sources === sources && stored?.look?.sources !== sources) await commit(process.id, handOverStep(local, sources));
  } catch { /* the server cannot be reached: this browser's copy stands */ }
}

/** "Not right" on suggestions, or "Show dismissed suggestions again": for everyone. Others' set-asides stay. */
export function writeDismissed(processId: string, keys: string[]): void {
  const before = readDismissed(processId);
  const add = keys.filter(k => !before.includes(k));
  const remove = before.filter(k => !keys.includes(k));
  void commit(processId, dismissStep(add, remove));
}

/** Whether a look is running, per process, for "Looking in your sources…". */
const running = new Map<string, Promise<SourceLook | null>>();

/** The look and the dismissals of one process, kept up to date when either changes. */
export function useSourceLook(processId: string): { look: SourceLook | null; dismissed: string[]; looking: boolean } {
  const read = React.useCallback(() => ({ look: current(processId), dismissed: readDismissed(processId), looking: running.has(processId) }), [processId]);
  const [state, setState] = React.useState(read);
  React.useEffect(() => {
    setState(read());
    const listen = (e: Event) => { if ((e as CustomEvent<{ processId: string }>).detail?.processId === processId) setState(read()); };
    addEventListener(EVENT, listen);
    return () => removeEventListener(EVENT, listen);
  }, [processId, read]);
  return state;
}

/** The plan of questions for a model, with the answers this browser found in its sources taken out. */
export function questionPlan(processId: string, model: ProcessModel, t: Triage = triage(model, assessProcess(model)), look = current(processId), dismissed = readDismissed(processId)): { plan: QuestionPlan; found: Suggestion[]; triage: Triage } {
  const found = foundFor(look, t, dismissed);
  return { plan: planQuestions(t, model, { found: foundKeys(found) }), found, triage: t };
}

/** The same, kept up to date while the look runs and as answers are dismissed. */
export function useQuestionPlan(processId: string, model: ProcessModel): { plan: QuestionPlan; found: Suggestion[]; triage: Triage; look: SourceLook | null; looking: boolean } {
  const { look, dismissed, looking } = useSourceLook(processId);
  const t = React.useMemo(() => triage(model, assessProcess(model)), [model]);
  const out = React.useMemo(() => questionPlan(processId, model, t, look, dismissed), [processId, model, t, look, dismissed]);
  return { ...out, look, looking };
}

/**
 * Looks up the questions not yet looked up in the current sources, within the limit, one call per
 * batch, saving after each so the panel fills in as it goes. `again` looks every question up afresh
 * (the Suggestions tab's button). Runs one look per process at a time.
 */
export function lookInSources(store: JourneyStore, process: { id: string; workspaceId: string }, model: ProcessModel, again = false): Promise<SourceLook | null> {
  const busy = running.get(process.id);
  if (busy) return busy;
  const run = (async () => {
    const sources = (await store.listSources(process.id)).filter(s => !s.archived);
    const key = sourcesKey(sources);
    // The server's copy first: what another page or person already looked up, found or is waiting for.
    await syncLook(store, process, true, key);
    const t = triage(model, assessProcess(model));
    let look = current(process.id);
    // On its own, Avala OS does not look while the month's allowance is used up, nor send what an
    // earlier page sent and has not had answered within the wait (packages 2 and 4 of docs/next-plan.md).
    if (!again && allowanceStopped(look, Date.now())) return look;
    const batches = toLookUp(t, look, key, AUTO_LOOK, Date.now(), again);
    if (!batches.length || !sources.length) return look;
    announce(process.id);
    const passages: Passage[] = (await Promise.all(sources.map(async s => (await store.getSourceSegments(s.id).catch(() => []))
      .map(seg => ({ sourceKey: s.key, sourceTitle: s.title, locator: seg.locator, text: seg.text }))))).flat();
    for (const items of batches) {
      const { segments, ids, passageOf } = sourceSegments(model, items, passages);
      if (passageOf.size === 0) { await commit(process.id, answerStep(key, { items, found: [], passages: 0, tokens: 0 })); continue; }
      // Noted on the server before the call. When the server's copy shows another page has just sent
      // questions, this page stops here and leaves the look to it.
      if (!(await commit(process.id, sendStep(key, items, Date.now(), again)))) break;
      let r: Awaited<ReturnType<JourneyStore['runAiTask']>>;
      try { r = await store.runAiTask(process.workspaceId, answerFromNotes.id, segments as never); } catch (e) {
        if (allowanceUsedUp(e)) await commit(process.id, stoppedStep(key, Date.now()));
        throw e;
      }
      const found = answerSuggestions(model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers ?? []), passageOf);
      await commit(process.id, answerStep(key, { items, found, passages: passageOf.size, tokens: (r.usage?.input ?? 0) + (r.usage?.output ?? 0) }));
    }
    look = current(process.id);
    return look;
  })();
  running.set(process.id, run);
  const done = () => { running.delete(process.id); announce(process.id); };
  run.then(done, done);
  return run;
}

/** On a process page or panel: reads the server's shared look for this process, for everyone, viewers too. */
export function useSharedLook(store: JourneyStore, process: { id: string; workspaceId: string } | null, canEdit: boolean): void {
  const pid = process?.id ?? '';
  const wid = process?.workspaceId ?? '';
  React.useEffect(() => { if (pid) void syncLook(store, { id: pid, workspaceId: wid }, canEdit); }, [store, pid, wid, canEdit]);
}

/** The shared look of a process straight from the server, for pages that count across processes (My work, Processes, Portfolio). */
export async function sharedLookOf(store: JourneyStore, processId: string): Promise<SharedLook> {
  try {
    const stored = await store.getSourceLook(processId);
    if (stored) return { look: stored.look, dismissed: stored.dismissed };
  } catch { /* the server cannot be reached */ }
  return { look: current(processId), dismissed: readDismissed(processId) };
}

/** Processes where a look failed in this page (no server, the allowance used up): not tried again until the page reloads. */
const failed = new Set<string>();

/**
 * On the process page: looks in the sources on its own when there are questions not yet looked up, for
 * a person who can edit the process (suggestions are changes) and only where the server reads with AI.
 * While an earlier page's call is within its wait, the page waits too, and looks once the wait is over.
 */
export function useAutoLook(store: JourneyStore, process: { id: string; workspaceId: string } | null, model: ProcessModel | null, canEdit: boolean): void {
  const pid = process?.id ?? '';
  const wid = process?.workspaceId ?? '';
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!pid || !model || !model.steps.length || !canEdit || !store.aiAvailable || failed.has(pid)) return;
    let wake = 0, live = true;
    const t = window.setTimeout(() => {
      lookInSources(store, { id: pid, workspaceId: wid }, model).then(() => {
        // Held by an earlier page's call: try again when its wait ends.
        const look = current(pid);
        const until = look ? waitingUntil(look, look.sources, Date.now()) : null;
        if (live && until !== null && !running.has(pid)) wake = window.setTimeout(() => setTick(n => n + 1), Math.max(1000, until - Date.now() + 500));
      }, () => { failed.add(pid); });
    }, 600);
    return () => { live = false; window.clearTimeout(t); window.clearTimeout(wake); };
  }, [store, pid, wid, model, canEdit, tick]);
}
