// The portfolio: every assessed process in a workspace side by side, in the order to take them.
import React from 'react';
import type { JourneyStore, ProcessRow } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { assessProcess } from '../../domain/assess/process.ts';
import { buildPortfolio, type Portfolio as PortfolioData, type PortfolioRow } from '../../domain/assess/portfolio.ts';
import { QUADRANT, type Quadrant } from '../../domain/assess/priority.ts';
import type { AssessmentSettings } from '../../domain/assess/settings.ts';
import { APPROACH_LABEL } from '../../domain/assess/scoring.ts';
import { cx, EmptyState, ErrorNote, messageOf, Spinner } from '../ui.tsx';

const hrs = (n: number) => Math.round(n).toLocaleString('en');
const mo = (n: number) => `${n.toLocaleString('en', { maximumFractionDigits: 1 })} mo`;
const months = (p: NonNullable<PortfolioRow['payback']>) => (p.worst === null ? `From ${mo(p.best)}` : p.worst === 'never' ? `${mo(p.best)} at best` : p.worst === p.best ? mo(p.best) : `${mo(p.best)} – ${mo(p.worst)}`);
const READY = { ready: ['Ready', 'bg-emerald-100 text-emerald-900'], fix_first: ['Fix first', 'bg-amber-100 text-amber-900'], wait: ['Wait', 'bg-rose-100 text-rose-900'] } as const;
const QUAD_TONE: Record<Quadrant, string> = { quick_win: 'bg-[#002C4B] text-white', major_project: 'bg-sky-100 text-sky-900', fill_in: 'bg-slate-100 text-slate-700', not_now: 'bg-slate-100 text-slate-500' };

function Chart({ rows, settings }: { rows: PortfolioRow[]; settings: AssessmentSettings }) {
  const PRIORITY = { valueHoursPerYear: settings.valueHoursPerYear, ease: settings.easeLine };
  const plotted = rows.filter(r => r.hours !== null && r.ease !== null);
  const W = 640, H = 340, L = 56, R = 16, T = 16, B = 40;
  const top = Math.max(PRIORITY.valueHoursPerYear * 2, ...plotted.map(r => r.hours!)) * 1.1;
  // Easier builds sit on the left, so quick wins are top left, as in the priority card of a process.
  const x = (ease: number) => L + ((100 - ease) / 100) * (W - L - R);
  const y = (hours: number) => T + (1 - hours / top) * (H - T - B);
  const corner = (q: Quadrant, cx0: number, cy0: number, anchor: 'start' | 'end') => <text x={cx0} y={cy0} textAnchor={anchor} className="fill-slate-400 text-[11px] font-semibold">{QUADRANT[q].label}</text>;
  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-5" data-testid="portfolio-chart">
      <figcaption className="text-xs font-semibold text-slate-500">Value against ease of implementation</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Processes placed by hours a year and ease of implementation">
        <rect x={L} y={T} width={x(PRIORITY.ease) - L} height={y(PRIORITY.valueHoursPerYear) - T} className="fill-[#FFBC03]/10" />
        <line x1={x(PRIORITY.ease)} x2={x(PRIORITY.ease)} y1={T} y2={H - B} className="stroke-slate-300" strokeDasharray="4 4" />
        <line x1={L} x2={W - R} y1={y(PRIORITY.valueHoursPerYear)} y2={y(PRIORITY.valueHoursPerYear)} className="stroke-slate-300" strokeDasharray="4 4" />
        <rect x={L} y={T} width={W - L - R} height={H - T - B} className="fill-none stroke-slate-200" />
        {corner('quick_win', L + 8, T + 16, 'start')}{corner('major_project', W - R - 8, T + 16, 'end')}
        {corner('fill_in', L + 8, H - B - 8, 'start')}{corner('not_now', W - R - 8, H - B - 8, 'end')}
        <text x={L - 8} y={y(PRIORITY.valueHoursPerYear) + 4} textAnchor="end" className="fill-slate-500 text-[10px]">{hrs(PRIORITY.valueHoursPerYear)} h</text>
        <text x={L - 8} y={T + 10} textAnchor="end" className="fill-slate-500 text-[10px]">{hrs(top)} h</text>
        <text x={L} y={H - 12} className="fill-slate-500 text-[11px]">← Easier to build</text>
        <text x={W - R} y={H - 12} textAnchor="end" className="fill-slate-500 text-[11px]">Harder to build →</text>
        {plotted.map(r => (
          <g key={r.id} transform={`translate(${x(r.ease!)}, ${y(r.hours!)})`}>
            <title>{`${r.name}: ${r.exact ? '' : 'up to '}${hrs(r.hours!)} hours a year, ease ${r.ease}`}</title>
            <circle r={12} className={r.exact ? 'fill-[#002C4B]' : 'fill-white stroke-[#002C4B]'} strokeWidth={2} strokeDasharray={r.exact ? undefined : '3 2'} />
            <text textAnchor="middle" y={4} className={cx('text-[11px] font-semibold', r.exact ? 'fill-white' : 'fill-[#002C4B]')}>{r.rank}</text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-xs leading-5 text-slate-500">Numbers are the rank in the table. A dashed circle is an upper bound on the value, not yet a calculated figure.{plotted.length < rows.length ? ` ${rows.length - plotted.length} ${rows.length - plotted.length === 1 ? 'process is' : 'processes are'} not on the chart because the value is not known yet.` : ''}</p>
    </figure>
  );
}

export function Portfolio({ store, nav, processes, workspaceId }: { store: JourneyStore; nav: Nav; processes: ProcessRow[]; workspaceId: string }) {
  const [data, setData] = React.useState<PortfolioData | null>(null);
  const [settings, setSettings] = React.useState<AssessmentSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    store.getSettings(workspaceId).then(async rec => {
    if (live) setSettings(rec.settings);
    return Promise.all(processes.map(async p => {
      const rev = (await store.listRevisions(p.id))[0];
      const model = rev ? await store.getModel(rev.id) : null;
      if (!model) return null;
      const decisions = await store.getAssessmentDecisions(p.id).catch(() => null);
      return { id: p.id, name: p.name, assessment: assessProcess(model, { settings: rec.settings }), rate: decisions?.rate ?? null, costs: decisions?.costs ?? null };
    }));
    }).then(items => { if (live) setData(buildPortfolio(items.filter((i): i is NonNullable<typeof i> => i !== null))); }).catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [store, processes, workspaceId]);

  if (error) return <ErrorNote message={error} />;
  if (!data || !settings) return <Spinner label="Assessing the processes" />;
  if (data.assessed === 0) return <EmptyState title="Nothing to compare yet">A process appears here once it has steps to assess. Open a process and add its sources, or assess it as one step from the Inputs tab.</EmptyState>;
  const name = (id: string) => data.rows.find(r => r.id === id)?.name ?? id;
  const open = (id: string) => nav.go({ page: 'process', processId: id, stage: 'assessment' });

  return (
    <div className="space-y-5" data-testid="portfolio">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Chart rows={data.rows} settings={settings} />
        <div className="space-y-4">
          <div className="rounded-xl bg-[#002C4B] p-6 text-white shadow-sm">
            <p className="text-xs font-semibold text-[#FFBC03]">Across {data.assessed} {data.assessed === 1 ? 'process' : 'processes'}</p>
            <p className="mt-2 font-display text-3xl font-semibold">{data.totalHours > 0 ? `Up to ${hrs(data.totalHours)}` : 'Not known yet'}</p>
            <p className="mt-1 text-sm text-slate-200">{data.totalHours > 0 ? `hands-on hours a year automation could take, about ${(data.totalHours / settings.hoursPerFte).toFixed(1)} full-time people.` : 'Add volume and time to the processes to see the hours.'}</p>
          </div>
          {data.pareto.ids.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="portfolio-pareto">
              <p className="text-xs font-semibold text-slate-500">Where most of the value is</p>
              <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold text-slate-900">{data.pareto.ids.length} of {data.pareto.of} processes</span> {data.pareto.ids.length === 1 ? 'carries' : 'carry'} {Math.round(data.pareto.share * 100)}% of those hours.</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">{data.pareto.ids.map(id => <li key={id}><button type="button" onClick={() => open(id)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-200">{name(id)}</button></li>)}</ul>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
            <tr>{['#', 'Process', 'Recommended approach', 'Steps that fit', 'Ease', 'Hours a year', 'Payback', 'Priority', 'Readiness', 'Inputs known'].map(h => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map(r => (
              <tr key={r.id} data-testid="portfolio-row" className="cursor-pointer hover:bg-slate-50" onClick={() => open(r.id)}>
                <td className="px-4 py-3 text-xs tabular-nums text-slate-500">{r.rank}</td>
                <td className="px-4 py-3"><button type="button" className="text-left font-medium text-slate-900 hover:underline">{r.name}</button></td>
                <td className="px-4 py-3 text-slate-700">{r.lead ? APPROACH_LABEL[r.lead] : 'Keep with people for now'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{Math.round(r.fit * 100)}%</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.ease ?? '–'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.hours === null ? <span className="text-slate-500">Not known</span> : `${r.exact ? '' : 'Up to '}${hrs(r.hours)}`}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700" data-testid="portfolio-payback">{r.payback ? months(r.payback) : <span className="text-slate-500">No costs</span>}</td>
                <td className="px-4 py-3">{r.quadrant ? <span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', QUAD_TONE[r.quadrant])}>{QUADRANT[r.quadrant].label}</span> : <span className="text-xs text-slate-500">{r.possible.length > 0 && r.possible.length < 4 ? r.possible.map(q => QUADRANT[q].label).join(' or ') : 'Not placed yet'}</span>}</td>
                <td className="px-4 py-3"><span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', READY[r.readiness][1])}>{READY[r.readiness][0]}</span></td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{Math.round(r.inputsKnown * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-slate-500">Ordered by priority, then by hours. Each row is that process's own assessment; open it to see the reasons or to complete its inputs.</p>
    </div>
  );
}
