// The review at the end of the call (package C, C3b; revision 2, section 4.3): tick what to keep, then Save writes
// the notes as one "Call notes" source and one edit of the record (domain/meeting/review.ts). An answer stated in the
// notes is ticked; one only inferred is not; a choice is kept only with the answer the analyst picks.
import React from 'react';
import type { Review, SaveChoice } from '../../domain/meeting/review.ts';
import { CALL_WORDS as W } from '../../domain/meeting/words.ts';
import { Button, CARD, cx } from '../ui.tsx';

const PERIODS: [string, string][] = [['day', 'a day'], ['week', 'a week'], ['month', 'a month'], ['quarter', 'a quarter'], ['year', 'a year']];

export function CallReview({ review, notesTitle, limited, busy, error, onSave, onDiscard, onDownload }: {
  review: Review; notesTitle: string;
  /** The end reading read against fewer questions than were open: how many it read. */
  limited: number | null;
  busy: boolean; error: string | null;
  onSave: (choice: SaveChoice) => void; onDiscard: () => void; onDownload: () => void;
}) {
  const initial = () => new Set([...review.answers, ...review.keepOpen, ...review.own, ...review.leftWith].filter(x => x.ticked).map(x => x.id));
  const [ticked, setTicked] = React.useState<Set<string>>(initial);
  const [periods, setPeriods] = React.useState<Record<string, string>>({});
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  const tick = (id: string, on: boolean) => { const n = new Set(ticked); on ? n.add(id) : n.delete(id); setTicked(n); };
  const box = (id: string, disabled = false) => <input type="checkbox" className="mt-1" checked={ticked.has(id)} disabled={disabled} onChange={e => tick(id, e.target.checked)} />;
  const save = () => onSave({ ticked, periods: periods as SaveChoice['periods'], picks });

  return (
    <div className="space-y-5" data-testid="call-review">
      <header>
        <h1 className="font-display text-2xl font-semibold text-[#002C4B]">{W.reviewHeading}</h1>
        <p className="mt-1 text-sm text-slate-600">{W.reviewLine}</p>
        {limited !== null && <p className="mt-1 text-sm text-slate-600">{W.endReadingLimited(limited)}</p>}
      </header>

      {review.answers.length > 0 && (
        <section className={cx(CARD, 'p-5')} data-testid="review-answers">
          <h2 className="text-sm font-semibold text-slate-900">{W.answersHeading(review.answers.length)}</h2>
          <ul className="mt-2 space-y-3">
            {review.answers.map(a => (
              <li key={a.id}>
                <label className="flex gap-3">
                  {box(a.id, a.needsPeriod && !periods[a.key])}
                  <span className="text-sm">
                    <span className="block font-semibold text-slate-900">{a.question}</span>
                    <span className="block text-slate-800">{W.willRecord(a.display)} <span className={cx('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', a.certainty === 'stated' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200')}>{a.certainty === 'stated' ? W.stated : W.inferred}</span></span>
                    <span className="block text-xs italic text-slate-500">{W.quoteAt(a.quote, a.time)}</span>
                    {a.line && <span className="block text-xs text-amber-900">{a.line}</span>}
                  </span>
                </label>
                {a.needsPeriod && (
                  <label className="ml-7 mt-1 flex items-center gap-2 text-xs text-slate-700">{W.needsPeriod}
                    <select aria-label="Period" value={periods[a.key] ?? ''} onChange={e => setPeriods({ ...periods, [a.key]: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1">
                      <option value="">Choose</option>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.choose.length > 0 && (
        <section className={cx(CARD, 'p-5')} data-testid="review-choose">
          <h2 className="text-sm font-semibold text-slate-900">{W.chooseHeading(review.choose.length)}</h2>
          <p className="mt-1 text-xs text-slate-600">{W.chooseLine}</p>
          <ul className="mt-2 space-y-3">
            {review.choose.map(c => (
              <li key={c.id} className="text-sm">
                <p className="font-semibold text-slate-900">{c.question}</p>
                <p className="text-xs italic text-slate-500">{W.quoteAt(c.quote, c.time)}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {c.choices.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={picks[c.key] === v} onClick={() => setPicks({ ...picks, [c.key]: picks[c.key] === v ? '' : v })}
                      className={cx('rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', picks[c.key] === v ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.keepOpen.length > 0 && (
        <section className={cx(CARD, 'p-5')} data-testid="review-keep">
          <h2 className="text-sm font-semibold text-slate-900">{W.keepOpenHeading(review.keepOpen.length)}</h2>
          <ul className="mt-2 space-y-2">
            {review.keepOpen.map(k => (
              <li key={k.id}><label className="flex gap-3 text-sm">{box(k.id)}<span><span className="block text-slate-900">{k.question}</span>
                {k.quote && <span className="block text-xs italic text-slate-500">{W.quoteAt(k.quote, k.time ?? '')}</span>}
                {k.asked && <span className="block text-xs text-slate-600">{W.askedNotAnswered}</span>}</span></label></li>
            ))}
          </ul>
        </section>
      )}

      {review.leftWith.length > 0 && (
        <section className={cx(CARD, 'p-5')} data-testid="review-left">
          <h2 className="text-sm font-semibold text-slate-900">{W.leftWithHeading(review.leftWith.length)}</h2>
          <ul className="mt-2 space-y-2">{review.leftWith.map(l => <li key={l.id}><label className="flex gap-3 text-sm">{box(l.id)}<span>{W.leftWithLine(l.question, l.name)}</span></label></li>)}</ul>
        </section>
      )}

      {review.own.length > 0 && (
        <section className={cx(CARD, 'p-5')} data-testid="review-own">
          <h2 className="text-sm font-semibold text-slate-900">{W.ownHeadingReview(review.own.length)}</h2>
          <ul className="mt-2 space-y-2">{review.own.map(o => <li key={o.id}><label className="flex gap-3 text-sm">{box(o.id)}<span>{o.question}</span></label></li>)}</ul>
        </section>
      )}

      {review.shape && (
        <section className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700" data-testid="review-shape">
          <h2 className="font-semibold text-slate-900">{W.shapeHeading}</h2>
          <p className="mt-1">{W.shapeLine}</p>
        </section>
      )}

      <p className="text-sm text-slate-600" data-testid="notes-kept">{W.notesKept(notesTitle)}</p>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <footer className="flex flex-wrap gap-2">
        <Button variant="accent" onClick={save} disabled={busy} data-testid="save-call">{W.save}</Button>
        <Button variant="secondary" onClick={onDownload} disabled={busy}>{W.download}</Button>
        <Button variant="ghost" onClick={onDiscard} disabled={busy}>{W.discardCall}</Button>
      </footer>
    </div>
  );
}
