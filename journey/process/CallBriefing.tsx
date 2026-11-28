// The call's briefing (package C, C3b; revision 2 of the plan, section 4.1): who will be on the call, how long it
// is, where the process stands, what is open, the questions in order, your own questions, and what is for someone
// else. Rules only (domain/meeting/briefing.ts): nothing is sent to the AI and nothing is saved.
import React from 'react';
import { agendaText, itemHeading, moveItem, type BriefItem, type Briefing } from '../../domain/meeting/briefing.ts';
import { CALL_LENGTHS, type Attendee, type CallLength, type OwnQuestion } from '../../domain/meeting/kept.ts';
import { CALL_WORDS as W } from '../../domain/meeting/words.ts';
import { OWNER_LABEL, type QOwner } from '../../domain/questions/triage.ts';
import { originLine } from '../../domain/discovery/card.ts';
import { Button, CARD, cx } from '../ui.tsx';

export interface BriefingChoices {
  attendees: Attendee[];
  minutes: CallLength;
  arranged: { order: string[]; leftOut: string[] };
  own: OwnQuestion[];
}

const KINDS: QOwner[] = ['business', 'it', 'finance'];

function Item({ item, n, onUp, onDown, onOut, onIn }: { item: BriefItem; n?: number; onUp?: () => void; onDown?: () => void; onOut?: () => void; onIn?: () => void }) {
  const why = item.card.why?.trim();
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4" data-testid="briefing-item">
      <p className="text-xs font-semibold text-slate-500">{n !== undefined ? `${n} · ` : ''}{itemHeading(item)}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{item.card.question}</p>
      {!item.own && <p className="mt-1 text-xs text-slate-600">{originLine(item.card.origin)}</p>}
      {why && <p className="mt-1 text-xs text-slate-600">{W.whyItMatters(why)}</p>}
      <p className="mt-1 text-xs text-slate-600">{W.whoCanAnswer(item.owner, item.name)}</p>
      {item.leftWith && <p className="mt-1 text-xs font-semibold text-[#B58500]">{W.leftWithAttendee(item.leftWith)}</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-[#002C4B] print:hidden">
        {onUp && <button type="button" onClick={onUp} className="hover:underline">Move up</button>}
        {onDown && <button type="button" onClick={onDown} className="hover:underline">Move down</button>}
        {onOut && <button type="button" onClick={onOut} className="hover:underline">Leave out</button>}
        {onIn && <button type="button" onClick={onIn} className="hover:underline">Bring back</button>}
      </div>
    </li>
  );
}

export function CallBriefing({ process, briefing, choices, onChoices, canRun, readsNotes, onStart, onOpenFiles }: {
  process: string; briefing: Briefing; choices: BriefingChoices; onChoices: (c: BriefingChoices) => void;
  /** An editor: the panel can be started. */
  canRun: boolean;
  /** Whether the workspace's AI can read the notes this month. */
  readsNotes: boolean;
  onStart: () => void; onOpenFiles: () => void;
}) {
  const [own, setOwn] = React.useState('');
  const [copied, setCopied] = React.useState<string | null>(null);
  const shown = [...briefing.forCall, ...briefing.ifTime].map(i => i.card.key);
  const set = (c: Partial<BriefingChoices>) => onChoices({ ...choices, ...c });
  const ticked = (k: QOwner) => choices.attendees.find(a => a.kind === k);
  const tick = (k: QOwner, on: boolean) => set({ attendees: on ? [...choices.attendees.filter(a => a.kind !== k), { kind: k }] : choices.attendees.filter(a => a.kind !== k) });
  const name = (k: QOwner, v: string) => set({ attendees: choices.attendees.map(a => (a.kind === k ? { kind: k, ...(v.trim() ? { name: v } : {}) } : a)) });
  const move = (key: string, by: -1 | 1) => set({ arranged: { ...choices.arranged, order: moveItem(shown, key, by) } });
  const out = (key: string) => set({ arranged: { ...choices.arranged, leftOut: [...choices.arranged.leftOut, key] } });
  const back = (key: string) => set({ arranged: { ...choices.arranged, leftOut: choices.arranged.leftOut.filter(k => k !== key) } });
  const addOwn = () => { const q = own.trim(); if (!q) return; set({ own: [...choices.own, { key: `own-${Date.now()}`, question: q }] }); setOwn(''); };
  const copy = async () => {
    const k = briefing.forCall.length + briefing.ifTime.length;
    try { await navigator.clipboard.writeText(agendaText(briefing)); setCopied(W.copied(k)); } catch { setCopied(null); }
  };
  const list = (items: BriefItem[], from: number) => (
    <ol className="space-y-2">
      {items.map((it, i) => <Item key={it.card.key} item={it} n={from + i} onUp={() => move(it.card.key, -1)} onDown={() => move(it.card.key, 1)} onOut={() => out(it.card.key)} />)}
    </ol>
  );

  return (
    <div className="space-y-6" data-testid="call-briefing">
      <header>
        <h1 className="font-display text-2xl font-semibold text-[#002C4B]">{W.briefingHeading(process)}</h1>
        <p className="mt-1 text-sm text-slate-600">{W.briefingLine}</p>
      </header>

      <section className={cx(CARD, 'space-y-4 p-5 print:hidden')}>
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">{W.who}</legend>
          <div className="mt-2 space-y-2">
            {KINDS.map(k => (
              <div key={k} className="flex flex-wrap items-center gap-3">
                <label className="flex w-56 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(ticked(k))} onChange={e => tick(k, e.target.checked)} />{OWNER_LABEL[k]}</label>
                {ticked(k) && <input aria-label={`${OWNER_LABEL[k]}: ${W.nameOptional}`} placeholder={W.nameOptional} value={ticked(k)!.name ?? ''} onChange={e => name(k, e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{W.namesStay}</p>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">{W.howLong}</legend>
          <div className="mt-2 flex gap-2">
            {CALL_LENGTHS.map(m => (
              <button key={m} type="button" aria-pressed={choices.minutes === m} onClick={() => set({ minutes: m })}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', choices.minutes === m ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white text-slate-700 ring-slate-300')}>{m} minutes</button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="space-y-1 text-sm text-slate-700" data-testid="briefing-standing">
        {briefing.standing.map(l => <p key={l}>{l}</p>)}
        {briefing.openLine && <p className="font-semibold text-slate-900" data-testid="briefing-open">{briefing.openLine}</p>}
      </section>

      {choices.attendees.length > 0 && <>
        <section>
          <h2 className="font-display text-lg font-semibold text-slate-900">{W.forThisCall(briefing.forCall.length)}</h2>
          <div className="mt-2">{list(briefing.forCall, 1)}</div>
        </section>
        {briefing.ifTime.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-semibold text-slate-900">{W.ifTime(briefing.ifTime.length)}</h2>
            <div className="mt-2">{list(briefing.ifTime, briefing.forCall.length + 1)}</div>
          </section>
        )}
        {briefing.leftOut.length > 0 && (
          <section className="print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Left out ({briefing.leftOut.length})</h2>
            <ol className="mt-2 space-y-2">{briefing.leftOut.map(it => <Item key={it.card.key} item={it} onIn={() => back(it.card.key)} />)}</ol>
          </section>
        )}
        <section className="print:hidden">
          <label className="text-sm font-semibold text-slate-900" htmlFor="own-question">{W.addOwn}</label>
          <div className="mt-2 flex gap-2">
            <input id="own-question" value={own} onChange={e => setOwn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOwn(); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <Button variant="secondary" onClick={addOwn} disabled={!own.trim()}>Add</Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">{W.ownLine}</p>
        </section>
      </>}

      {briefing.elsewhere.length > 0 && (
        <section className="print:hidden" data-testid="briefing-elsewhere">
          <h2 className="font-display text-lg font-semibold text-slate-900">{W.elsewhere}</h2>
          {briefing.elsewhere.map(g => (
            <details key={g.owner} className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">{g.label} ({g.items.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{g.items.map((x, i) => <li key={i}>{x.question}</li>)}</ul>
            </details>
          ))}
          <button type="button" onClick={onOpenFiles} className="mt-2 text-sm font-semibold text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4">{W.openFiles}</button>
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5 print:hidden">
        {canRun ? <Button variant="accent" onClick={onStart} disabled={choices.attendees.length === 0} data-testid="start-panel">{W.start}</Button>
          : <p className="text-sm text-slate-600" data-testid="viewer-line">{W.viewerLine}</p>}
        <Button variant="secondary" onClick={copy} disabled={choices.attendees.length === 0}>{W.copyAgenda}</Button>
        <Button variant="ghost" onClick={() => window.print()}>{W.print}</Button>
        <span className="text-sm text-slate-600" role="status">{copied ?? ''}</span>
      </footer>
      {canRun && !readsNotes && <p className="text-sm text-slate-600" data-testid="no-ai-line">{W.noAiThisMonth}</p>}
    </div>
  );
}
