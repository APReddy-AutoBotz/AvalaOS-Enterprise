// Ask Avala's suggestions on a process (docs/product-plan.md, stage 3): cards that say what, why and what
// applying it would do, with "Review and apply", which opens the screen where that change is made, and
// "Dismiss". Nothing is applied here. The rule-based ones (work no proposal plans, application facts to
// bring in) show at once; answers the sources state are looked for only when the person asks, because
// that reads the sources with AI. Rules: domain/assistant/suggest.ts.
import React from 'react';
import type { JourneyStore, ProcessRow, Workspace } from '../store/types.ts';
import { StoreError } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage } from '../../domain/questions/triage.ts';
import { interviewQueue } from '../../domain/questions/interview.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import { planWork } from '../../domain/workitems/plan.ts';
import { DEFAULT_DOCUMENT_SETTINGS } from '../../domain/docs/branding.ts';
import type { Passage } from '../../domain/assistant/ask.ts';
import {
  answerSuggestions, applicationSuggestions, draftSuggestions, sourceSegments, suggestionsFor, workItemSuggestions, type Suggestion,
} from '../../domain/assistant/suggest.ts';
import { Button, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import type { StageId } from '../../domain/workspace/route.ts';

const KIND_LABEL: Record<Suggestion['kind'], string> = { answer: 'An answer from the sources', 'work-item': 'Work to plan', application: 'From the applications list', draft: 'A section to draft' };

/** Dismissals are this person's, in this browser: a light convenience, never shared. */
const dismissedKey = (processId: string) => `avala:dismissed:${processId}`;
const readDismissed = (processId: string): string[] => {
  try { return JSON.parse(localStorage.getItem(dismissedKey(processId)) ?? '[]') as string[]; } catch { return []; }
};
const writeDismissed = (processId: string, keys: string[]) => {
  try { localStorage.setItem(dismissedKey(processId), JSON.stringify(keys.slice(-200))); } catch { /* storage unavailable */ }
};

export function SuggestionsPanel({ store, process, workspace, model, stages, onReview }: {
  store: JourneyStore; process: ProcessRow; workspace: Workspace; model: ProcessModel;
  /** The stages this workspace uses: a suggestion leads only to one of them. */
  stages: StageId[];
  /** "Review and apply": the panel opens the interview, or the stage where the change is made. */
  onReview: (s: Suggestion) => void;
}) {
  const member = { access: workspace.role, canApprove: workspace.canApprove, job: workspace.job ?? null };
  const [ruled, setRuled] = React.useState<Suggestion[] | null>(null);
  const [answers, setAnswers] = React.useState<Suggestion[] | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<string[]>(() => readDismissed(process.id));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    Promise.all([
      store.getAssessmentDecisions(process.id).catch(() => null), store.listRequirements(process.id).catch(() => []),
      store.getDocumentSettings(process.workspaceId).catch(() => DEFAULT_DOCUMENT_SETTINGS), store.listApplications(process.workspaceId).catch(() => []),
      store.listDocumentEdits(process.id).catch(() => []),
    ]).then(([decisions, reqs, docs, apps, edits]) => {
      if (!live) return;
      const work = decisions ? workItemSuggestions(planWork(model, decisions, reqs, docs.layouts).cov.notPlanned) : [];
      setRuled([...work, ...applicationSuggestions(model, apps), ...draftSuggestions(docs.layouts, edits)]);
    }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, process.id, process.workspaceId, model]);

  const look = async () => {
    setLooking(true); setError(null);
    try {
      const items = interviewQueue(triage(model, assessProcess(model)));
      const sources = (await store.listSources(process.id)).filter(s => !s.archived);
      const passages: Passage[] = (await Promise.all(sources.map(async s => (await store.getSourceSegments(s.id).catch(() => []))
        .map(seg => ({ sourceKey: s.key, sourceTitle: s.title, locator: seg.locator, text: seg.text }))))).flat();
      const { segments, ids, passageOf } = sourceSegments(model, items, passages);
      if (!items.length || passageOf.size === 0) { setAnswers([]); return; }
      const r = await store.runAiTask(process.workspaceId, answerFromNotes.id, segments as never);
      setAnswers(answerSuggestions(model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers ?? []), passageOf));
    } catch (x) {
      setError(x instanceof StoreError && x.status === 501 ? 'Reading the sources needs the server. Sign in to Avala OS to look for answers there.' : messageOf(x));
    } finally { setLooking(false); }
  };

  const dismiss = (key: string) => { const next = [...dismissed, key]; setDismissed(next); writeDismissed(process.id, next); };
  if (member.access === 'viewer') return <p className="text-sm leading-6 text-slate-600" data-testid="suggestions-viewer">Suggestions are changes to this process, so they are offered to people who can edit it.</p>;
  if (!ruled) return error ? <ErrorNote message={error} /> : <Spinner />;
  const usable = (s: Suggestion) => s.target.kind === 'answer' || (s.target.kind === 'section' ? stages.includes('documents') : stages.includes(s.target.stage));
  const shown = suggestionsFor([...(answers ?? []), ...ruled].filter(usable), member, dismissed);

  return (
    <section aria-label="Suggestions" data-testid="suggestions">
      <p className="text-sm leading-6 text-slate-600">Changes Ask Avala suggests from this process's record. Each opens the screen where that change is made, so you review it there; nothing is changed from here.</p>
      <ErrorNote message={error} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={look} disabled={looking}>{looking ? 'Reading the sources…' : answers ? 'Look in the sources again' : 'Look in the sources for answers'}</Button>
        <span className="text-xs text-slate-500">Reads the sources with AI to find open questions they already answer.</span>
      </div>
      {answers && answers.length === 0 && !looking && <p className="mt-3 text-sm text-slate-600" data-testid="suggestions-no-answers">The sources do not state an answer to any open question.</p>}
      {shown.length === 0 && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="suggestions-none">Nothing to suggest{dismissed.length ? ' (some were dismissed)' : ''}.</p>}
      <ul className="mt-4 space-y-3">
        {shown.map(s => (
          <li key={s.key} className="rounded-xl border border-slate-200 bg-white p-4" data-testid="suggestion">
            <p className="text-xs font-medium text-slate-500">{KIND_LABEL[s.kind]}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{s.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{s.why}</p>
            {s.quote && <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-sm leading-6 text-slate-700">“{s.quote.text}” <span className="text-slate-500">({s.quote.source})</span></blockquote>}
            <p className="mt-2 text-sm text-slate-700">It would: {s.willDo}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => onReview(s)}>Review and apply</Button>
              <Button variant="ghost" onClick={() => dismiss(s.key)}>Dismiss</Button>
            </div>
          </li>
        ))}
      </ul>
      {dismissed.length > 0 && <Button variant="ghost" className="mt-3" onClick={() => { setDismissed([]); writeDismissed(process.id, []); }}>Show dismissed suggestions again</Button>}
    </section>
  );
}
