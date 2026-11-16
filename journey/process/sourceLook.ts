// Looking in a process's sources for answers before its questions are put to people (part D of the
// effort-first plan; rules in domain/assistant/sourceLook.ts). The process page starts a look when it
// opens and whenever the sources or the questions change; a look reads the sources with the existing
// `answerFromNotes` task, within its limit, and remembers what it found in this browser only (a light
// convenience: nothing is recorded, and another browser looks again). Answers found are suggestions:
// the Ask Avala panel offers each to confirm; nothing is written until a person presses Save.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage, type Triage } from '../../domain/questions/triage.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import { planQuestions, type QuestionPlan } from '../../domain/questions/firstList.ts';
import type { Passage } from '../../domain/assistant/ask.ts';
import { answerSuggestions, sourceSegments, type Suggestion } from '../../domain/assistant/suggest.ts';
import { addLook, foundFor, foundKeys, sourcesKey, toLookUp, type SourceLook } from '../../domain/assistant/sourceLook.ts';

const EVENT = 'avala:source-look';
const lookKey = (processId: string) => `avala:source-look:${processId}`;
const dismissedKey = (processId: string) => `avala:dismissed:${processId}`;

export function readLook(processId: string): SourceLook | null {
  try { const raw = localStorage.getItem(lookKey(processId)); return raw ? (JSON.parse(raw) as SourceLook) : null; } catch { return null; }
}
function writeLook(processId: string, look: SourceLook): void {
  try { localStorage.setItem(lookKey(processId), JSON.stringify(look)); } catch { /* storage unavailable: the look is kept for this page only */ }
  memory.set(processId, look);
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
}
/** Kept for this page when the browser's storage is unavailable. */
const memory = new Map<string, SourceLook>();
const current = (processId: string) => readLook(processId) ?? memory.get(processId) ?? null;

/** Suggestions this person dismissed on this process, in this browser (shared with the Suggestions tab). */
export function readDismissed(processId: string): string[] {
  try { return JSON.parse(localStorage.getItem(dismissedKey(processId)) ?? '[]') as string[]; } catch { return []; }
}
export function writeDismissed(processId: string, keys: string[]): void {
  try { localStorage.setItem(dismissedKey(processId), JSON.stringify(keys.slice(-200))); } catch { /* storage unavailable */ }
  dispatchEvent(new CustomEvent(EVENT, { detail: { processId } }));
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
    const t = triage(model, assessProcess(model));
    let look = again ? null : current(process.id);
    const batches = toLookUp(t, look, key);
    if (!batches.length || !sources.length) return look;
    dispatchEvent(new CustomEvent(EVENT, { detail: { processId: process.id } }));
    const passages: Passage[] = (await Promise.all(sources.map(async s => (await store.getSourceSegments(s.id).catch(() => []))
      .map(seg => ({ sourceKey: s.key, sourceTitle: s.title, locator: seg.locator, text: seg.text }))))).flat();
    for (const items of batches) {
      const { segments, ids, passageOf } = sourceSegments(model, items, passages);
      if (passageOf.size === 0) { look = addLook(look, key, { items, found: [], passages: 0, tokens: 0 }); writeLook(process.id, look); continue; }
      const r = await store.runAiTask(process.workspaceId, answerFromNotes.id, segments as never);
      const found = answerSuggestions(model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers ?? []), passageOf);
      look = addLook(look, key, { items, found, passages: passageOf.size, tokens: (r.usage?.input ?? 0) + (r.usage?.output ?? 0) });
      writeLook(process.id, look);
    }
    return look;
  })();
  running.set(process.id, run);
  const done = () => { running.delete(process.id); dispatchEvent(new CustomEvent(EVENT, { detail: { processId: process.id } })); };
  run.then(done, done);
  return run;
}

/** Processes where a look failed in this page (no server, the allowance used up): not tried again until the page reloads. */
const failed = new Set<string>();

/**
 * On the process page: looks in the sources on its own when there are questions not yet looked up, for
 * a person who can edit the process (suggestions are changes) and only where the server reads with AI.
 */
export function useAutoLook(store: JourneyStore, process: { id: string; workspaceId: string } | null, model: ProcessModel | null, canEdit: boolean): void {
  const pid = process?.id ?? '';
  const wid = process?.workspaceId ?? '';
  React.useEffect(() => {
    if (!pid || !model || !model.steps.length || !canEdit || !store.aiAvailable || failed.has(pid)) return;
    const t = window.setTimeout(() => {
      lookInSources(store, { id: pid, workspaceId: wid }, model).catch(() => { failed.add(pid); });
    }, 600);
    return () => window.clearTimeout(t);
  }, [store, pid, wid, model, canEdit]);
}
