// The call panel (package C, C3b; revision 2, section 4.2, with C3's fallback lines and the card to confirm): one
// question to ask next, your notes typed or spoken, and what the notes have answered or raised. The rules choose and
// read (domain/meeting/panel.ts); this screen only shows them and passes on what the analyst does. Nothing is saved
// before the end of the call: the call is kept on this device.
import React from 'react';
import type { BriefItem } from '../../domain/meeting/briefing.ts';
import { itemHeading } from '../../domain/meeting/briefing.ts';
import type { CallState } from '../../domain/meeting/kept.ts';
import { askedList, nextQuestion, panelLine, raisedToShow, type Readings, type Suggestion } from '../../domain/meeting/panel.ts';
import { capFor, SPOKEN_NOTE_SECONDS } from '../../domain/meeting/limits.ts';
import { CALL_WORDS as W, clock } from '../../domain/meeting/words.ts';
import { originLine, GROUP_HEADING } from '../../domain/discovery/card.ts';
import type { Triage } from '../../domain/questions/triage.ts';
import { OWNER_LABEL } from '../../domain/questions/triage.ts';
import { AnswerBox } from './AnswerFromNotes.tsx';
import { Button, CARD, cx } from '../ui.tsx';

export type ReadStatus = { kind: 'reading' } | { kind: 'read'; at: string } | { kind: 'failed' } | { kind: 'minute'; line: string } | null;

export interface PanelActions {
  addNote(text: string, speaker: string | undefined, spoken: boolean): string | null;
  editNote(id: string, text: string): void;
  removeNote(id: string): void;
  asked(s: Suggestion): void;
  skip(key: string): void;
  leave(key: string, name: string): void;
  askNow(key: string): void;
  dismiss(itemKey: string, noteId: string): void;
  readNow(): void;
  end(): void;
  download(): void;
}

function Origin({ s, t, zone }: { s: Suggestion; t: CallState; zone?: string }) {
  if (s.noteId && s.card.origin.kind === 'quote') {
    const n = t.notes.find(x => x.id === s.noteId);
    return <p className="mt-1 text-xs text-slate-600">{W.fromNote(n ? clock(n.at, zone) : '', s.card.origin.quote.excerpt)}</p>;
  }
  const o = s.card.origin;
  if (o.kind === 'quote') return <p className="mt-1 text-xs text-slate-600">{W.fromRecord(o.quote.excerpt, o.sourceTitle)}</p>;
  if (o.kind === 'gap') return <p className="mt-1 text-xs text-slate-600">{W.missing(o.gap)}</p>;
  if (o.kind === 'conflict' && o.values.length >= 2) return <p className="mt-1 text-xs text-slate-600">{W.disagree(o.values[0]!.quote.excerpt, o.values[1]!.quote.excerpt)}</p>;
  return <p className="mt-1 text-xs text-slate-600">{originLine(o)}</p>;
}

/** The plain line under "Ask next" when the next question follows the list, or the panel is checking. */
function lineFor(line: ReturnType<typeof panelLine>, month: string): string | null {
  if (line === 'capped') return W.capReached;
  if (line === 'failed') return W.readFailed;
  if (line === 'allowance') return W.allowanceUsed(month);
  if (line === 'noAi') return W.noAiThisMonth;
  return null;
}

export function CallPanel({ process, s, list, triage, now, readings, status, zone, voice, actions }: {
  process: string; s: CallState; list: BriefItem[]; triage: Triage; now: string; readings: Readings; status: ReadStatus; zone?: string;
  voice: { transcribe?: (audio: string) => Promise<string>; voiceLine?: string };
  actions: PanelActions;
}) {
  const [note, setNote] = React.useState('');
  const [spoken, setSpoken] = React.useState(false);
  const [speaker, setSpeaker] = React.useState<string>(W.me);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [leaving, setLeaving] = React.useState<string | null>(null);
  const [who, setWho] = React.useState('');
  const [gotIt, setGotIt] = React.useState(false);
  const [micOnce, setMicOnce] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const sug = nextQuestion(s, list, triage, now, readings);
  const line = panelLine(s, list, triage, now, readings);
  const month = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const fallback = lineFor(line, month);
  const cap = capFor(s.minutes);
  const people = [W.me, ...s.attendees.map(a => a.name?.trim() || OWNER_LABEL[a.kind])];
  const started = clock(s.startedAt, zone);
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(s.startedAt)) / 60_000));
  const raised = raisedToShow(s, now);
  const asked = askedList(s, list, triage);
  const found = s.found;
  const timeOf = (id: string) => { const n = s.notes.find(x => x.id === id); return n ? clock(n.at, zone) : ''; };
  const add = () => {
    const r = actions.addNote(note, speaker === W.me ? undefined : speaker, spoken);
    if (r === 'full') setRefusal(W.notesFull);
    else if (r === null) { setNote(''); setSpoken(false); setRefusal(null); }
  };
  const heading = sug ? (sug.toConfirm ? W.toConfirm : sug.own ? W.ownHeading : GROUP_HEADING[sug.card.group] ?? itemHeading({ card: sug.card })) : '';

  return (
    <div className="space-y-5" data-testid="call-panel">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-xl font-semibold text-[#002C4B]">{W.panelHeading(process)}</h1>
        <span className="text-sm text-slate-600">{W.started(started, minutes)}</span>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={actions.download}>{W.download}</Button>
          <Button variant="secondary" onClick={actions.end} data-testid="end-call">{W.endCall}</Button>
        </span>
      </header>
      {!gotIt && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" data-testid="private-line">
          {W.privateLine}<button type="button" onClick={() => setGotIt(true)} className="font-semibold text-[#002C4B] underline">{W.gotIt}</button>
        </p>
      )}

      <section className={cx(CARD, 'border-l-4 border-l-[#FFBC03] p-5')} aria-label="Ask next" data-testid="ask-next">
        {line === 'checking' ? <p className="text-sm text-slate-700" role="status" data-testid="checking">{W.checking}</p>
          : !sug ? <p className="text-sm text-slate-700" data-testid="nothing-left">{W.nothingLeft}</p> : <>
            <p className="text-xs font-semibold text-slate-500">{W.askNext(heading)}</p>
            <p className="mt-1 text-base font-semibold text-slate-900" data-testid="ask-next-question">{sug.card.question}</p>
            {sug.toConfirm ? <>
              <p className="mt-1 text-xs text-slate-700" data-testid="to-confirm">{W.toConfirmLine(sug.toConfirm.display, sug.toConfirm.quote, timeOf(sug.toConfirm.noteId))}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-700">{W.toConfirmAsk}</p>
            </> : <Origin s={sug} t={s} zone={zone} />}
            {sug.card.why?.trim() && <p className="mt-1 text-xs text-slate-600">{W.whyItMatters(sug.card.why)}</p>}
            <p className="mt-1 text-xs text-slate-600">{W.whoCanAnswer(sug.owner, sug.name)}</p>
            {leaving === sug.card.key ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input aria-label={W.whoKnows} placeholder={W.whoKnows} value={who} onChange={e => setWho(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                <Button variant="secondary" disabled={!who.trim()} onClick={() => { actions.leave(sug.card.key, who.trim()); setLeaving(null); setWho(''); }}>{W.leaveWithThem}</Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => actions.asked(sug)} data-testid="asked">{W.asked}</Button>
                <Button variant="secondary" onClick={() => actions.skip(sug.card.key)}>{W.skip}</Button>
                <Button variant="ghost" onClick={() => setLeaving(sug.card.key)}>{W.someoneElse}</Button>
              </div>
            )}
          </>}
        {fallback && <p className="mt-3 text-xs text-slate-600" data-testid="panel-line">{fallback}</p>}
      </section>

      <section aria-label="Your notes" className="space-y-2">
        {voice.transcribe && !micOnce && <p className="text-xs text-slate-600" data-testid="before-recording">{W.beforeRecording} <button type="button" className="font-semibold underline" onClick={() => setMicOnce(true)}>{W.gotIt}</button></p>}
        <AnswerBox label="Your notes" value={note} onChange={setNote} rows={2} placeholder={W.notePlaceholder} maxSeconds={SPOKEN_NOTE_SECONDS}
          onSpoken={() => setSpoken(true)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (note.trim()) add(); } }} {...voice} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>{W.whoSaid}</span>
          {people.map(p => (
            <button key={p} type="button" aria-pressed={speaker === p} onClick={() => setSpeaker(p)}
              className={cx('rounded-full px-2.5 py-1 font-semibold ring-1 ring-inset', speaker === p ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white text-slate-700 ring-slate-300')}>{p}</button>
          ))}
          <span className="ml-auto" role="status" data-testid="read-status">
            {status?.kind === 'reading' ? W.reading : status?.kind === 'read' ? W.readAt(clock(status.at, zone)) : status?.kind === 'failed' ? W.readFailed : status?.kind === 'minute' ? status.line : ''}
            {readings === 'ok' && line !== 'capped' && status?.kind !== 'reading' && <> · <button type="button" onClick={actions.readNow} className="font-semibold text-[#002C4B] underline">{W.readNow}</button></>}
          </span>
        </div>
        {refusal && <p className="text-sm text-amber-800" data-testid="notes-full">{refusal}</p>}
        <ul className="space-y-1.5" data-testid="notes">
          {[...s.notes].reverse().map(n => (
            <li key={n.id} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
              {editing?.id === n.id ? (
                <span className="flex gap-2">
                  <input aria-label="Edit the note" value={editing.text} onChange={e => setEditing({ id: n.id, text: e.target.value })} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
                  <button type="button" className="text-xs font-semibold" onClick={() => { actions.editNote(n.id, editing.text); setEditing(null); }}>Save</button>
                </span>
              ) : <>
                <span className="text-slate-500">{clock(n.at, zone)} · {n.speaker ?? W.me}: </span>{n.text}{n.spoken && <span className="text-slate-400"> {W.spoken}</span>}
                <span className="ml-2 text-xs text-[#002C4B]">
                  <button type="button" className="hover:underline" onClick={() => setEditing({ id: n.id, text: n.text })}>Edit</button> · <button type="button" className="hover:underline" onClick={() => actions.removeNote(n.id)}>Remove</button>
                </span>
              </>}
            </li>
          ))}
        </ul>
      </section>

      <details className={cx(CARD, 'p-4')} data-testid="found">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">{W.foundHeading(found.length)}</summary>
        <ul className="mt-2 space-y-2">
          {found.map(f => (
            <li key={`${f.itemKey}@${f.noteId}`} className="text-sm">
              <p className="font-semibold text-slate-900">{W.mayAnswer(f.question)}</p>
              <p className="text-slate-700">{W.wouldRecord(f.display)} <span className={cx('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', f.certainty === 'stated' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200')}>{f.certainty === 'stated' ? W.stated : W.inferred}</span></p>
              <p className="text-xs italic text-slate-500">{W.quoteAt(f.quote, timeOf(f.noteId))}</p>
              <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => actions.dismiss(f.itemKey, f.noteId)}>{W.notRight}</button>
            </li>
          ))}
        </ul>
      </details>

      <section className={cx(CARD, 'p-4')} data-testid="raised">
        <h2 className="text-sm font-semibold text-slate-900">{W.raisedHeading(raised.length)}</h2>
        <ul className="mt-2 space-y-2">
          {raised.map(r => (
            <li key={r.card.key} className="text-sm">
              <p className="text-slate-900">{r.card.question}</p>
              {r.card.origin.kind === 'quote' && <p className="text-xs text-slate-600">{W.fromNote(timeOf(r.noteId), r.card.origin.quote.excerpt)}</p>}
              {r.holding ? <p className="text-xs text-slate-500">{W.holding}</p>
                : <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => actions.askNow(r.card.key)}>{W.askItNow}</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className={cx(CARD, 'p-4')} data-testid="asked-list">
        <h2 className="text-sm font-semibold text-slate-900">{W.askedHeading(asked.length)}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {asked.map(a => <li key={a.key}>{a.question} <span className="text-xs text-slate-500">· {a.answered ? W.answeredInNotes : W.noAnswerYet}</span></li>)}
        </ul>
      </section>

      <p className="text-xs text-slate-500" data-testid="ai-used">{W.aiUsed(s.use.tokens, cap.tokens)}</p>
    </div>
  );
}
