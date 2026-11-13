// The public homepage at "/". It loads on its own (no database client) so it opens fast for anyone.
// The lifecycle animation runs about 30 seconds: five stages of six seconds each. Each stage's progress
// bar is a CSS animation, and its end moves on to the next stage, so pausing the animation pauses the
// timing too. With reduced motion nothing animates and nothing advances on its own.
import React from 'react';

const NAVY = '#002C4B';
const AMBER = '#E69F00';
const STAGE_SECONDS = 6;

const STAGES = [
  { id: 'assess', name: 'Assess', line: 'Read the sources and score the options' },
  { id: 'validate', name: 'Validate', line: 'People confirm what is true' },
  { id: 'assemble', name: 'Assemble', line: 'Documents and flows from one model' },
  { id: 'launch', name: 'Launch', line: 'Work items onto the Delivery board' },
  { id: 'audit', name: 'Audit', line: 'Every change on record' },
] as const;

const CSS = `
.home-rise{opacity:0;transform:translateY(10px);animation:home-rise .55s ease forwards;animation-delay:var(--d,0s)}
.home-fill{transform-origin:left;transform:scaleX(0);animation:home-fill ${STAGE_SECONDS}s linear forwards}
.home-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:home-draw 1.2s ease forwards;animation-delay:var(--d,0s)}
.home-dot{animation:home-dot 1.4s ease-in-out forwards;animation-delay:var(--d,0s)}
.home-grow{transform-origin:left;transform:scaleX(0);animation:home-fill 1s ease forwards;animation-delay:var(--d,0s)}
@keyframes home-rise{to{opacity:1;transform:none}}
@keyframes home-fill{to{transform:scaleX(1)}}
@keyframes home-draw{to{stroke-dashoffset:0}}
@keyframes home-dot{from{left:0}to{left:calc(100% - 14px)}}
[data-paused="true"] *{animation-play-state:paused !important}
@media (prefers-reduced-motion: reduce){
  .home-rise,.home-fill,.home-draw,.home-grow{animation:none;opacity:1;transform:none;stroke-dashoffset:0}
  .home-dot{animation:none;left:calc(100% - 14px)}
}
`;

/** The A in five layers. Layers up to the current stage are lit; the peak turns amber at Audit. */
function Mark({ lit, size }: { lit: number; size: number }) {
  const hw = (y: number) => ((y - 8) / 48) * 26;
  const nw = (y: number) => Math.max(0, (y - 37.75) * 0.6);
  const pts = (a: [number, number][]) => a.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => {
        const y1 = 56 - i * 9.5;
        const y0 = y1 - 8;
        const on = i <= lit;
        const fill = on ? (i === 4 ? AMBER : NAVY) : '#E2E8F0';
        const style = { transition: 'fill .6s ease' };
        return i < 2 ? (
          <g key={i} fill={fill} style={style}>
            {[-1, 1].map(s => <polygon key={s} points={pts([[32 + s * hw(y0), y0], [32 + s * nw(y0), y0], [32 + s * nw(y1), y1], [32 + s * hw(y1), y1]])} />)}
          </g>
        ) : (
          <polygon key={i} fill={fill} style={style} points={pts([[32 - hw(y0), y0], [32 + hw(y0), y0], [32 + hw(y1), y1], [32 - hw(y1), y1]])} />
        );
      })}
    </svg>
  );
}

const d = (s: number) => ({ '--d': `${s}s` }) as React.CSSProperties;
const Check = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0"><circle cx="8" cy="8" r="8" fill="#047857" /><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function AssessPanel() {
  const sources = ['Interview notes.docx', 'Invoice handling procedure.pdf', 'Sample invoices.xlsx'];
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <p className="text-sm font-semibold text-slate-900">Sources in</p>
        <ul className="mt-3 space-y-2">
          {sources.map((s, i) => <li key={s} className="home-rise rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" style={d(0.2 + i * 0.5)}>{s}</li>)}
        </ul>
      </div>
      <div className="home-rise rounded-xl border border-slate-200 p-4" style={d(2)}>
        <p className="text-xs font-semibold text-slate-500">Recommended approach</p>
        <p className="mt-1 font-display text-2xl font-semibold text-slate-900">Rule-based automation</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap justify-between">
            <dt className="text-slate-600">Ease of implementation</dt>
            <dd className="font-semibold tabular-nums text-slate-900">82 of 100</dd>
            <dd aria-hidden="true" className="mt-1.5 h-2 basis-full rounded-full bg-slate-100"><div className="home-grow h-full rounded-full" style={{ ...d(2.6), width: '82%', background: NAVY }} /></dd>
          </div>
          <div className="flex justify-between"><dt className="text-slate-600">Value</dt><dd className="font-semibold text-slate-900">Up to 192 hours a year</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Readiness</dt><dd className="font-semibold text-emerald-800">Ready</dd></div>
        </dl>
      </div>
    </div>
  );
}

function ValidatePanel() {
  const qs = [
    ['Who approves invoices over the limit?', 'Finance controller'],
    ['Can the supplier portal be reached by API?', 'No, screen only'],
    ['How many invoices arrive each month?', 'About 1,200'],
  ];
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">Open questions, answered by the people who know</p>
      <ul className="mt-3 space-y-2">
        {qs.map(([q, a], i) => (
          <li key={q} className="home-rise flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5" style={d(0.2 + i * 1.1)}>
            <Check />
            <span className="text-sm"><span className="block text-slate-900">{q}</span><span className="block text-slate-600">{a}</span></span>
          </li>
        ))}
      </ul>
      <p className="home-rise mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200" style={d(3.8)}>
        <Check /> Revision 1 approved by the approver
      </p>
    </div>
  );
}

function AssemblePanel() {
  const docs = ['Business requirements', 'Process design', 'Functional design', 'System design'];
  const nodes = ['Receive invoice', 'Match to order', 'Approve', 'Post to ledger'];
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {docs.map((x, i) => <li key={x} className="home-rise rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700" style={d(0.2 + i * 0.5)}>{x}</li>)}
      </ul>
      <p className="mt-5 text-sm font-semibold text-slate-900">And the flow, drawn from the same model</p>
      <svg viewBox="0 0 640 110" className="mt-3 w-full" role="img" aria-label="A flow of four steps: receive invoice, match to order, approve, post to ledger">
        {nodes.map((n, i) => (
          <g key={n} className="home-rise" style={d(2.2 + i * 0.5)}>
            <rect x={i * 165 + 2} y="30" width="130" height="50" rx="10" fill="#fff" stroke={i === 3 ? AMBER : '#94A3B8'} strokeWidth="2" />
            <text x={i * 165 + 67} y="60" textAnchor="middle" fontSize="15" fill="#0F172A" fontFamily="Inter Variable, Inter, sans-serif">{n}</text>
          </g>
        ))}
        {[0, 1, 2].map(i => <path key={i} d={`M${i * 165 + 134} 55H${i * 165 + 165}`} pathLength={1} className="home-draw" style={d(2.5 + i * 0.5)} stroke={NAVY} strokeWidth="2.5" fill="none" strokeLinecap="round" />)}
      </svg>
    </div>
  );
}

function LaunchPanel() {
  const items = ['Read invoice fields', 'Match to purchase order', 'Post approved invoices'];
  const cols = ['Proposed', 'Confirmed', 'On the board'];
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">Work items proposed from the design, confirmed by a person</p>
      <div className="mt-4 grid grid-cols-3 text-xs font-semibold text-slate-500">{cols.map((c, i) => <span key={c} className={i === 1 ? 'text-center' : i === 2 ? 'text-right' : ''}>{c}</span>)}</div>
      <ul className="mt-2 space-y-3">
        {items.map((x, i) => (
          <li key={x} className="home-rise" style={d(0.2 + i * 0.4)}>
            <div className="relative h-8 rounded-lg border border-slate-200 bg-slate-50">
              <span className="home-dot absolute top-1.5 h-4 w-3.5 rounded" style={{ ...d(1.2 + i * 0.9), background: i === 2 ? AMBER : NAVY }} />
            </div>
            <p className="mt-1 text-sm text-slate-700">{x}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditPanel() {
  const rows = [
    ['Revision 1 approved', 'Approver'],
    ['Role changed to architect', 'Workspace admin'],
    ['Work item confirmed: Post approved invoices', 'Business analyst'],
    ['Document branding changed', 'Workspace admin'],
  ];
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">Who changed what, kept for review</p>
      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rows.map(([what, who], i) => (
          <li key={what} className="home-rise flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm" style={d(0.2 + i * 0.9)}>
            <span className="text-slate-900">{what}</span><span className="text-slate-600">{who}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PANELS = [AssessPanel, ValidatePanel, AssemblePanel, LaunchPanel, AuditPanel];

function Lifecycle() {
  const [stage, setStage] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const Panel = PANELS[stage];
  return (
    <div data-paused={!playing} className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex gap-6 lg:flex-col">
        <div className="hidden shrink-0 sm:block lg:mb-2"><Mark lit={stage} size={160} /></div>
        <ol className="flex-1 space-y-1" aria-label="The five stages">
          {STAGES.map((s, i) => {
            const here = i === stage;
            return (
              <li key={s.id}>
                <button type="button" aria-current={here ? 'step' : undefined} onClick={() => setStage(i)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B] ${here ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`font-display text-lg font-semibold ${here ? 'text-[#002C4B]' : 'text-slate-700'}`}>{s.name}</span>
                    <span className="text-xs text-slate-500">{i + 1} of 5</span>
                  </span>
                  <span className="block text-sm text-slate-600">{s.line}</span>
                  {here && (
                    <span className="mt-2 block h-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                      <span key={`${stage}-${playing}`} className="home-fill block h-full rounded-full" style={{ background: AMBER }}
                        onAnimationEnd={() => setStage(n => (n + 1) % STAGES.length)} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="min-w-0">
        <div role="region" aria-label={`${STAGES[stage].name}: example`} className="min-h-[21rem] rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <h3 className="font-display text-xl font-semibold text-slate-900">{STAGES[stage].name}</h3>
            <span className="text-xs text-slate-500">Example with made-up data</span>
          </div>
          <Panel key={stage} />
        </div>
        <div className="mt-3 flex justify-end motion-reduce:hidden">
          <button type="button" onClick={() => setPlaying(p => !p)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">
            {playing ? 'Pause the demo' : 'Play the demo'}
          </button>
        </div>
      </div>
    </div>
  );
}

const PARTS = [
  ['A scored recommendation', 'Which approach fits, ranked from fixed tables, with ease, value and payback shown and the missing facts named. It is arithmetic, not a model’s opinion.'],
  ['Documents from one model', 'Business requirements, process design, functional design and system design, plus flow diagrams, all built from the same confirmed process and carrying your branding.'],
  ['Work items you confirm', 'Work items are proposed from the design. A person confirms each one onto the Delivery board.'],
  ['People and roles', 'An analyst, an architect and an approver are named for each process, and only approvers sign off.'],
  ['A record', 'Changes to a process, its people and its work items are logged and can be reviewed.'],
];

export default function HomePage() {
  const signedIn = React.useMemo(() => {
    try { return Object.keys(window.localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch { return false; }
  }, []);
  const go = signedIn ? { href: '/work', label: 'Open my work' } : { href: '/signin', label: 'Sign in' };
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{CSS}</style>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="/" aria-label="Avala OS, home"><img src="/brand/avala-os-logo.svg" alt="Avala OS" className="h-9 w-auto" /></a>
          <a href={go.href} className="rounded-lg bg-[#002C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#073B60] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">{go.label}</a>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-8 pt-16 sm:pt-24">
          <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-6xl">Evaluate before you automate.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700">AvalaOS takes a business process from its sources to a scored recommendation, the documents to build it and a delivery board, with a person approving each step and every change on record.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href={go.href} className="rounded-lg bg-[#002C4B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#073B60] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">{go.label}</a>
            <a href="#how" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">See how it works</a>
          </div>
          {!signedIn && <p className="mt-4 text-sm text-slate-600">AvalaOS is by invitation. Ask your workspace admin to invite you.</p>}
        </section>

        <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-16">
          <h2 id="how-h" className="font-display text-3xl font-semibold tracking-tight text-[#002C4B]">Five stages, one record</h2>
          <p className="mt-3 max-w-2xl text-slate-700">Avala is the five stages every process passes through. Watch an example, or pick a stage.</p>
          <Lifecycle />
        </section>

        <section aria-labelledby="parts-h" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 id="parts-h" className="font-display text-3xl font-semibold tracking-tight text-[#002C4B]">What is in it</h2>
            <dl className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
              {PARTS.map(([t, x]) => (
                <div key={t} className="grid gap-1 py-5 sm:grid-cols-[16rem_minmax(0,1fr)] sm:gap-8">
                  <dt className="font-display text-lg font-semibold text-slate-900">{t}</dt>
                  <dd className="max-w-2xl text-slate-700">{x}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-slate-600">
          <p>Avala stands for Assess, Validate, Assemble, Launch, Audit.</p>
          <a href={go.href} className="font-semibold text-[#002C4B] underline decoration-[#E69F00] decoration-2 underline-offset-4">{go.label}</a>
        </div>
      </footer>
    </div>
  );
}
