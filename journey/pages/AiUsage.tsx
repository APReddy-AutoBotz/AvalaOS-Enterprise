// Settings → AI use: this month's AI use in the workspace and, on Avala OS's AI, how much of the monthly
// allowance is left and when it starts again. Read-only, for every member. Rules in domain/ai/usage.ts.
import React from 'react';
import type { AiUsage, JourneyStore, Member, Workspace } from '../store/types.ts';
import { summarizeUsage, tokenWords, type UsageSummary } from '../../domain/ai/usage.ts';
import { ErrorNote, messageOf, Spinner } from '../ui.tsx';

const dateWords = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Date(iso).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const requests = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

export function AiUsagePanel({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const [data, setData] = React.useState<{ usage: AiUsage; members: Member[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    Promise.all([store.getAiUsage(workspace.id), store.listMembers(workspace.id).catch(() => [] as Member[])])
      .then(([usage, members]) => { if (live) setData({ usage, members }); })
      .catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, workspace.id]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card" data-testid="ai-usage">
      <h2 className="font-display text-lg font-semibold text-slate-900">AI use this month</h2>
      {error ? <ErrorNote message={error} /> : !data ? <Spinner /> : <UsageBody summary={summarizeUsage(data.usage.rows, new Date(), data.usage.allowance)} usage={data.usage} members={data.members} workspace={workspace} />}
    </div>
  );
}

function UsageBody({ summary: s, usage, members, workspace }: { summary: UsageSummary; usage: AiUsage; members: Member[]; workspace: Workspace }) {
  const names = new Map(members.map(m => [m.userId, m.name]));
  const total = s.platform.tokens + s.own.tokens;
  const resets = dateWords(s.resetsOn);
  const onOwnKey = usage.allowance?.source === 'workspace';

  return (
    <div className="mt-2 space-y-5 text-sm leading-6 text-slate-700">
      {s.allowance ? <AllowanceMeter a={s.allowance} resets={resets} isAdmin={workspace.role === 'admin'} /> : (
        <p data-testid="ai-usage-allowance">
          {onOwnKey ? `${workspace.name} runs on its own AI key, so Avala OS's monthly allowance does not apply.`
            : usage.allowance ? `${workspace.name} has no monthly allowance limit set.`
              : 'The monthly allowance could not be read just now. The use below is what has been recorded.'}
        </p>
      )}

      {total === 0 && s.failed === 0 ? (
        <p data-testid="ai-usage-empty">No AI work has been recorded in {workspace.name} since {dateWords(s.from)}.</p>
      ) : (
        <>
          <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3" data-testid="ai-usage-totals">
            <Fact label="On Avala OS's AI" value={tokenWords(s.platform.tokens)} note={requests(s.platform.calls)} />
            <Fact label="On your own key" value={tokenWords(s.own.tokens)} note={requests(s.own.calls)} />
            <Fact label="Did not complete" value={String(s.failed)} note={s.failed === 0 ? 'Nothing failed' : 'Counted in the totals'} />
          </div>

          <Breakdown title="What it was used for" rows={s.byWork.map(w => ({ key: w.work, label: w.work, tokens: w.tokens, note: requests(w.calls) }))} />
          <DayChart days={s.byDay} />
          <Breakdown title="Who asked" rows={s.byPerson.map(p => ({
            key: p.userId ?? '-', tokens: p.tokens, note: requests(p.calls),
            label: p.userId === null ? 'Not tied to a person' : names.get(p.userId) ?? 'Someone no longer in this workspace',
          }))} />
        </>
      )}

      <p className="text-xs text-slate-500">
        AI use is counted in tokens: short pieces of text, roughly three quarters of a word each, in what is sent and what comes back. Months run from the 1st in UTC.
        {usage.partial ? ' This month has more requests than this page reads at once, so the breakdowns cover the most recent ones.' : ''}
      </p>
    </div>
  );
}

function AllowanceMeter({ a, resets, isAdmin }: { a: NonNullable<UsageSummary['allowance']>; resets: string; isAdmin: boolean }) {
  const pct = Math.min(100, Math.round(a.share * 100));
  const bar = a.state === 'reached' ? 'bg-red-600' : a.state === 'near' ? 'bg-amber-500' : 'bg-[#002C4B]';
  return (
    <div data-testid="ai-usage-allowance">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p><span className="font-semibold text-slate-900">{tokenWords(a.used)}</span> of {tokenWords(a.budget)} tokens used ({pct}%)</p>
        <p className="text-xs text-slate-500">Starts again on {resets}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label="Monthly allowance used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% used`}>
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {a.state !== 'ok' && (
        <p className={`mt-2 ${a.state === 'reached' ? 'text-red-700' : 'text-amber-800'}`} role="status">
          {a.state === 'reached' ? `This month's allowance is used up, so AI work here waits until ${resets}.` : `Most of this month's allowance is used. AI work stops when it runs out and starts again on ${resets}.`}
          {' '}{isAdmin ? 'You can connect your organization\'s own key under AI provider; then the allowance no longer applies.' : 'An admin can connect your organization\'s own key instead.'}
        </p>
      )}
    </div>
  );
}

const Fact = ({ label, value, note }: { label: string; value: string; note: string }) => (
  <div className="bg-white p-4">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 font-display text-lg font-semibold text-slate-900">{value}</p>
    <p className="text-xs text-slate-500">{note}</p>
  </div>
);

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; tokens: number; note: string }[] }) {
  const top = Math.max(1, ...rows.map(r => r.tokens));
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <ul className="mt-2 space-y-2">
        {rows.map(r => (
          <li key={r.key}>
            <div className="flex justify-between gap-3"><span>{r.label}</span><span className="text-slate-500">{tokenWords(r.tokens)} · {r.note}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-400" style={{ width: `${(r.tokens / top) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayChart({ days }: { days: UsageSummary['byDay'] }) {
  const top = Math.max(1, ...days.map(d => d.tokens));
  const busiest = days.reduce((b, d) => (d.tokens > b.tokens ? d : b), days[0]);
  const summary = busiest && busiest.tokens > 0 ? `Busiest day: ${dateWords(busiest.day)}, ${tokenWords(busiest.tokens)} tokens.` : 'No use on any day yet.';
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">By day</h3>
      <div className="mt-2 flex h-16 items-end gap-0.5" role="img" aria-label={summary}>
        {days.map(d => (
          <div key={d.day} className="flex-1 rounded-t bg-slate-300" style={{ height: `${d.tokens ? Math.max(4, (d.tokens / top) * 100) : 2}%` }} title={`${dateWords(d.day)}: ${tokenWords(d.tokens)} tokens`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">{summary}</p>
    </div>
  );
}
