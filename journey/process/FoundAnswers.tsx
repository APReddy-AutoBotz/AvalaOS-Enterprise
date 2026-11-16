// Answers Avala OS found in a process's sources before asking anyone (part D of the effort-first plan):
// each question with the passage that answers it and what confirming records. Confirm writes it through
// the same edit the interview makes, keeping the source and its words, and History says it was suggested
// from that source; "Not right" sets it aside in this browser and the question goes back to the people.
// Used by Closing the gaps (Documents) and the Ask Avala panel.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { TriageItem } from '../../domain/questions/triage.ts';
import type { Op } from '../../domain/questions/answer.ts';
import { interviewEdit } from '../../domain/questions/interview.ts';
import type { Suggestion } from '../../domain/assistant/suggest.ts';
import { readDismissed, writeDismissed } from './sourceLook.ts';
import { Button } from '../ui.tsx';

export function FoundAnswers({ processId, model, items, found, canEdit, onApply }: {
  processId: string; model: ProcessModel; items: TriageItem[]; found: Suggestion[]; canEdit: boolean;
  onApply: (op: Op, summary: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  if (!found.length) return null;
  const confirm = async (s: Suggestion) => {
    if (s.target.kind !== 'answer') return;
    const { itemKey, proposal, source } = s.target;
    const item = items.find(i => i.key === itemKey);
    const edit = item && interviewEdit(model, item, proposal, source);
    if (!edit) { setProblem('This answer no longer fits its question. Answer it yourself, or press Not right.'); return; }
    setBusy(s.key); setProblem(null);
    try { await onApply(edit.op, edit.summary); } finally { setBusy(null); }
  };
  return (
    <div data-testid="found-answers">
      {problem && <p className="mb-2 text-sm text-red-700" role="alert">{problem}</p>}
      <ul className="space-y-3">
        {found.map(s => s.target.kind === 'answer' && (
          <li key={s.key} className="rounded-xl border border-slate-200 bg-white p-4" data-testid="found-answer">
            <p className="text-sm font-semibold leading-6 text-slate-900">{s.target.proposal.question}</p>
            {s.quote && <blockquote className="mt-2 border-l-2 border-[#E69F00] pl-3 text-sm leading-6 text-slate-700">“{s.quote.text}” <span className="text-slate-500">({s.quote.source})</span></blockquote>}
            <p className="mt-2 text-sm text-slate-700">Confirming records: <span className="font-medium text-slate-900">{s.target.proposal.display}</span></p>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="accent" disabled={busy !== null} onClick={() => confirm(s)}>{busy === s.key ? 'Saving…' : 'Confirm'}</Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => writeDismissed(processId, [...readDismissed(processId), s.key])}>Not right</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
