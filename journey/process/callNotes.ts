// The call's storage and its AI calls (package C, C3b; plan `claude/package-c-c3-plan-28-nov.md`). A running call
// is kept on this device only, under `avala:call:{process}` (domain/meeting/kept.ts): nothing goes to the server
// before Save. A reading is the two existing tasks, `answerFromNotes` and `discoveryQuestions`, through journey-ai
// (store.runAiTask); the end reading is `answerFromNotes` on every open question. What each call costs is counted
// against the call's cap from the usage the server reports.
import { answerFromNotes } from '../../domain/questions/notes.ts';
import { discoveryQuestions } from '../../domain/discovery/notice.ts';
import { CALL_KEY_PREFIX, callKey, mergeCalls, notesFile, notesFileName, readCall, type CallState } from '../../domain/meeting/kept.ts';
import { applyEnd, applyReading, prepareEnd, prepareReading, type CallResult, type PrepContext } from '../../domain/meeting/panel.ts';
import type { Readings } from '../../domain/meeting/panel.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { StoreError, type JourneyStore } from '../store/types.ts';

/** The call kept on this device for a process, or null (none, or one that cannot be read). */
export function loadCall(processId: string): CallState | null {
  try { const raw = localStorage.getItem(callKey(processId)); return raw ? readCall(JSON.parse(raw), processId) : null; }
  catch { return null; }
}

/** Keeps the call on this device; another tab's newer copy is merged in, never overwritten. False when the browser cannot keep it. */
export function keepCall(s: CallState): boolean {
  try {
    const raw = localStorage.getItem(callKey(s.processId));
    const theirs = raw ? readCall(JSON.parse(raw), s.processId) : null;
    const next = theirs && theirs.changedAt > s.changedAt ? mergeCalls(s, theirs) : s;
    localStorage.setItem(callKey(s.processId), JSON.stringify(next));
    return true;
  } catch { return false; }
}

/** Removes the call from this device: after Save, on Discard, and at sign-out. */
export function forgetCall(processId: string): void {
  try { localStorage.removeItem(callKey(processId)); } catch { /* nothing to remove */ }
}

/** Whether any call not finished is kept on this device: the question before signing out. */
export function anyCallKept(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CALL_KEY_PREFIX)) return true;
    }
  } catch { /* none can be read */ }
  return false;
}

/** Downloads the notes of every call kept on this device: before signing out. */
export function downloadKeptCalls(): void {
  const calls: CallState[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CALL_KEY_PREFIX)) continue;
      const s = readCall(JSON.parse(localStorage.getItem(k) ?? 'null'), k.slice(CALL_KEY_PREFIX.length));
      if (s) calls.push(s);
    }
  } catch { /* nothing to download */ }
  for (const s of calls) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([notesFile(s)], { type: 'text/plain;charset=utf-8' }));
    a.download = notesFileName('Call', s);
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/** What a failed call says about readings for the rest of the call: the month's allowance used up stops them. */
export function readingsAfter(e: unknown): Readings | null {
  return e instanceof StoreError && e.code === 'BUDGET_EXCEEDED' ? 'allowance' : null;
}

/** The server's own sentence for the minute limit, when that is why a call was refused. */
export const minuteLimitLine = (e: unknown): string | null => (e instanceof StoreError && e.code === 'RATE_LIMITED' ? e.message : null);

async function run(store: JourneyStore, workspaceId: string, task: string, segments: unknown[], onError: (e: unknown) => void): Promise<CallResult> {
  try {
    const r = await store.runAiTask(workspaceId, task, segments as never);
    return { data: r.data, usage: r.usage ?? null };
  } catch (e) { onError(e); return 'failed'; }
}

/** One reading: the two calls sent together, applied to the call as it stands when they come back. */
export async function runReading(store: JourneyStore, workspaceId: string, s: CallState, ctx: PrepContext & { at: () => string }, onError: (e: unknown) => void): Promise<(latest: CallState) => CallState> {
  const prep = prepareReading(s, ctx);
  const [answers, notice] = await Promise.all([
    prep.answers ? run(store, workspaceId, answerFromNotes.id, prep.answers.segments, onError) : Promise.resolve(null),
    prep.notice ? run(store, workspaceId, discoveryQuestions.id, prep.notice.segments, onError) : Promise.resolve(null),
  ]);
  return latest => applyReading(latest, prep, { answers, notice }, { model: ctx.model, at: ctx.at(), asked: ctx.asked, list: ctx.list });
}

/** The end reading: every open question against all the notes, at most two calls, within the cap's last share. */
export async function runEnd(store: JourneyStore, workspaceId: string, s: CallState, ctx: { model: ProcessModel; list: PrepContext['list']; triage: PrepContext['triage']; at: string }, onError: (e: unknown) => void): Promise<{ call: CallState; total: number; read: number }> {
  const prep = prepareEnd(s, ctx);
  const results: CallResult[] = [];
  for (const b of prep.batches) results.push(await run(store, workspaceId, answerFromNotes.id, b.segments, onError));
  return { call: applyEnd(s, prep, results, { model: ctx.model, at: ctx.at }), total: prep.total, read: prep.read };
}
