// A start with no documents (docs/effort-first-plan.md, part A): a short form for the few fixed facts
// (whether the work is done today, the applications, what the team has in mind) and "Tell us in your own
// words", typed or spoken. The words are saved as the process's first source, so the steps are read
// from them like any other source; the form's answers go into the brief and the applications, each as
// given by a person. Nothing is filled in that the person did not say.
import React from 'react';
import type { JourneyStore } from '../store/types.ts';
import type { DoneToday, InMind } from '../../domain/processModel/types.ts';
import { DONE_TODAY, IN_MIND } from '../../domain/processModel/validate.ts';
import { DONE_TODAY_LABEL, IN_MIND_LABEL } from '../../domain/plan/delivery.ts';
import { applicationNames, ownWordsEdits, OWN_WORDS_LIMIT } from '../../domain/plan/start.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import { AnswerBox } from './AnswerFromNotes.tsx';
import { useVoice, voiceProps } from './voice.ts';
import { Button, ErrorNote, messageOf } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function StartInOwnWords({ store, processId, workspaceId, onSaved, asksInMind = true }: { store: JourneyStore; processId: string; workspaceId: string; me?: string; onSaved: () => void;
  /** Whether to ask what the team has in mind: not when the process is documented as it is (domain/plan/purpose.ts). */
  asksInMind?: boolean }) {
  const voice = useVoice(store, workspaceId);
  const [doneToday, setDoneToday] = React.useState<DoneToday | ''>('');
  const [apps, setApps] = React.useState('');
  const [inMind, setInMind] = React.useState<InMind[]>([]);
  const [words, setWords] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = words.trim().length >= 40;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // The words first, as a source: everything read from them can point back to them.
      const text = words.trim().slice(0, OWN_WORDS_LIMIT);
      const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const existing = await store.listSources(processId);
      let n = 1; while (existing.some(s => s.key === `own-${n}`)) n++;
      const key = `own-${n}`;
      const segments: IngestSegment[] = paras.map((t, i) => ({ id: `${key}:${i + 1}`, sourceId: key, kind: 'paragraph', text: t, locator: { lineStart: i + 1 } }));
      const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      await store.addSource(processId, { key, title: `Described in own words, ${date}`, fileName: '', format: 'txt', kind: 'Description', segments, inferred: false, warnings: [], byteSize: new Blob([text]).size });
      // Then the form's answers, as given by a person, in one edit on the working draft.
      const ops = ownWordsEdits({ doneToday, inMind: asksInMind ? inMind.filter(x => x !== 'open' || inMind.length === 1) : [], apps: applicationNames(apps) });
      if (ops.length) {
        const draft = await store.startDraft(processId);
        let m = draft.model; const patch = [];
        for (const op of ops) { const r = op(m); m = r.model; patch.push(...r.patch); }
        if (patch.length) await store.savePatch(draft.revisionId, draft.seq, patch, 'user', 'The brief, from the start in your own words');
      }
      onSaved();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Start without documents" data-testid="own-words">
      <h3 className="text-sm font-semibold text-slate-900">No documents? Tell us in your own words</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
        Describe how the work goes, or how it should go, in a few minutes: who does what, in which applications, what can go wrong.
        Your words are kept as the first source, and the steps are read from them like from any document.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">Is the work done today?
          <select value={doneToday} onChange={e => setDoneToday(e.target.value as DoneToday | '')} className={`${input} mt-1`}>
            <option value="">Not saying yet</option>
            {DONE_TODAY.map(v => <option key={v} value={v}>{DONE_TODAY_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Applications it touches
          <input value={apps} onChange={e => setApps(e.target.value)} placeholder="For example: SAP, Outlook, SharePoint" className={`${input} mt-1`} />
        </label>
      </div>
      {asksInMind && <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">What do you have in mind? <span className="font-normal text-slate-500">(an expectation; the assessment decides)</span></legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {IN_MIND.map(v => (
            <label key={v} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-[#002C4B]" checked={inMind.includes(v)} onChange={() => setInMind(xs => (xs.includes(v) ? xs.filter(x => x !== v) : [...xs, v]))} />{IN_MIND_LABEL[v]}
            </label>
          ))}
        </div>
      </fieldset>}
      <div className="mt-4">
        <AnswerBox label="In your own words" value={words} onChange={setWords} rows={7}
          placeholder="For example: Supplier invoices arrive by email. Someone in accounts payable checks them against the purchase order in SAP…"
          {...voiceProps(voice, store, workspaceId)} />
      </div>
      <ErrorNote message={error} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="accent" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save as the first source'}</Button>
        <span className="text-xs text-slate-500">{ready ? 'Then read the process from it below.' : 'A few sentences at least.'}</span>
      </div>
    </section>
  );
}
