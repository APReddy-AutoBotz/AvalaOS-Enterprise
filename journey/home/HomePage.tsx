// The public homepage at "/". It loads on its own (no database client) so it opens fast for anyone.
// Every screen on it is the product itself, captured by tests/e2e/tour.spec.ts running the sample case
// in eval/corpus/ap-invoice (a made-up company). Nothing here is a mock-up.
// The tour runs about 30 seconds: five stages of six seconds, two screens each. A stage's progress bar
// is a CSS animation whose end moves to the next stage, so pausing the animation pauses the timing.
// With reduced motion nothing moves or advances on its own and both screens of a stage are shown.
import React from 'react';

const NAVY = '#002C4B';
const AMBER = '#E69F00';
const SECONDS = 6;
const shot = (name: string) => `/marketing/tour/${name}.webp`;

interface Shot { src: string; alt: string; origin: string }
const TOUR: { id: string; name: string; line: string; caption: string; shots: [Shot, Shot] }[] = [
  {
    id: 'assess', name: 'Assess', line: 'Read the sources, score the options',
    caption: 'Five source files go in. Every approach is scored step by step from fixed tables, and the best fit is named with its reasons.',
    shots: [
      { src: 'sources', origin: '30% 75%', alt: 'The Sources screen: three meeting transcripts, a procedure and a flowchart uploaded, with the passages read from each' },
      { src: 'assessment', origin: '30% 55%', alt: 'The Assessment screen: API-led integration recommended, with the approaches ranked by score and the reasons beside each' },
    ],
  },
  {
    id: 'validate', name: 'Validate', line: 'People confirm what is true',
    caption: 'Each step shows the sources it came from. What the sources did not say stays “Not provided” and becomes a question for a person.',
    shots: [
      { src: 'process', origin: '85% 35%', alt: 'The Process screen: 21 steps with who does them, the systems used and how many sources support each, plus 15 open questions' },
      { src: 'document-2', origin: '45% 55%', alt: 'A generated document where two facts the sources did not give are marked Not provided' },
    ],
  },
  {
    id: 'assemble', name: 'Assemble', line: 'Documents and flows from one model',
    caption: 'Requirements, process, functional and solution documents and the flow maps are built from the same confirmed model, and download as Word.',
    shots: [
      { src: 'document', origin: '55% 60%', alt: 'The Documents screen: the process definition document with its contents list and Word download' },
      { src: 'flows', origin: '30% 70%', alt: 'The Flows screen: the To-Be map drawn from the process model, one column per role' },
    ],
  },
  {
    id: 'launch', name: 'Launch', line: 'Work items onto the Delivery board',
    caption: 'Epics, stories and tasks are proposed with acceptance criteria and requirement links. A person chooses what goes to the board.',
    shots: [
      { src: 'work-items', origin: '35% 60%', alt: 'The Work items screen: 6 epics, 15 stories and 23 tasks proposed, each linked to its requirements' },
      { src: 'board', origin: '25% 40%', alt: 'The Delivery board with the confirmed work items in columns by status' },
    ],
  },
  {
    id: 'audit', name: 'Audit', line: 'Every change on record',
    caption: 'Each item keeps the requirement it came from, word for word. Approvals, invitations and role changes are kept in an audit trail.',
    shots: [
      { src: 'board-item', origin: '80% 75%', alt: 'A board item open: its story, acceptance criteria and the linked requirement it was derived from' },
      { src: 'audit', origin: '35% 80%', alt: 'The People screen: what each role can do, and the audit trail of who invited whom' },
    ],
  },
];

const CSS = `
.tour-shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.tour-a{animation:tour-a ${SECONDS}s linear forwards, tour-zoom ${SECONDS / 2}s ease-out forwards}
.tour-b{opacity:0;animation:tour-b ${SECONDS}s linear forwards, tour-zoom ${SECONDS / 2}s ease-out ${SECONDS / 2}s forwards}
.tour-fill{transform-origin:left;transform:scaleX(0);animation:tour-fill ${SECONDS}s linear forwards}
@keyframes tour-a{0%,46%{opacity:1}54%,100%{opacity:0}}
@keyframes tour-b{0%,46%{opacity:0}54%,100%{opacity:1}}
@keyframes tour-zoom{from{transform:scale(1)}to{transform:scale(1.1)}}
@keyframes tour-fill{to{transform:scaleX(1)}}
[data-paused="true"] *{animation-play-state:paused !important}
.shot-frame{border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(15,23,42,.08),0 30px 60px -20px rgba(0,27,47,.35)}
@media (prefers-reduced-motion: reduce){
  .tour-a,.tour-b,.tour-fill{animation:none;opacity:1;transform:none}
  .tour-stack{aspect-ratio:auto !important}
  .tour-stack .tour-shot{position:static;height:auto;display:block}
  .tour-stack .tour-b{border-top:1px solid #e2e8f0}
}
`;

/** The A in five layers. Layers up to the current stage are lit; the peak is amber. */
function Mark({ lit, size, dark }: { lit: number; size: number; dark?: boolean }) {
  const hw = (y: number) => ((y - 8) / 48) * 26;
  const nw = (y: number) => Math.max(0, (y - 37.75) * 0.6);
  const pts = (a: [number, number][]) => a.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => {
        const y1 = 56 - i * 9.5;
        const y0 = y1 - 8;
        const fill = i <= lit ? (i === 4 ? AMBER : dark ? '#FFFFFF' : NAVY) : dark ? 'rgba(255,255,255,.16)' : '#DCE3EA';
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

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2';

function Tour() {
  const [stage, setStage] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const ref = React.useRef<HTMLDivElement>(null);
  const cur = TOUR[stage];

  // Fetch the other stages' screens once the tour is near the screen, so a change of stage never shows a blank frame.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      TOUR.forEach(t => t.shots.forEach(s => { new Image().src = shot(s.src); }));
      io.disconnect();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} data-paused={!playing} className="mt-10 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <div className="mb-6 hidden lg:block"><Mark lit={stage} size={112} /></div>
        <ol aria-label="The five stages" className="grid grid-cols-5 gap-1 lg:block lg:space-y-1">
          {TOUR.map((s, i) => {
            const here = i === stage;
            return (
              <li key={s.id}>
                <button type="button" aria-current={here ? 'step' : undefined} onClick={() => setStage(i)}
                  className={`w-full rounded-lg px-2 py-2 text-center transition-colors lg:px-3 lg:py-2.5 lg:text-left ${focus} focus-visible:outline-[#002C4B] ${here ? 'bg-white shadow-sm ring-1 ring-slate-200' : 'hover:bg-white/70'}`}>
                  <span className={`block font-display text-sm font-semibold lg:text-lg ${here ? 'text-[#002C4B]' : 'text-slate-600'}`}>{s.name}</span>
                  <span className="hidden text-sm text-slate-600 lg:block">{s.line}</span>
                  <span className={`mt-2 block h-1 overflow-hidden rounded-full ${here ? 'bg-slate-200' : 'bg-transparent'}`} aria-hidden="true">
                    {here && <span key={stage} className="tour-fill block h-full rounded-full" style={{ background: AMBER }} onAnimationEnd={() => setStage(n => (n + 1) % TOUR.length)} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="min-w-0">
        <div role="region" aria-label={`${cur.name}: the product on the sample case`}>
          <div className="shot-frame">
            <div key={stage} className="tour-stack relative" style={{ aspectRatio: '16 / 10' }}>
              <img className="tour-shot tour-a" src={shot(cur.shots[0].src)} alt={cur.shots[0].alt} style={{ transformOrigin: cur.shots[0].origin }} />
              <img className="tour-shot tour-b" src={shot(cur.shots[1].src)} alt={cur.shots[1].alt} style={{ transformOrigin: cur.shots[1].origin }} />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-2xl text-lg leading-7 text-slate-800">{cur.caption}</p>
            <button type="button" onClick={() => setPlaying(p => !p)} className={`shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 motion-reduce:hidden ${focus} focus-visible:outline-[#002C4B]`}>
              {playing ? 'Pause the tour' : 'Play the tour'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const REASONS = [
  {
    title: 'The score is arithmetic, not an opinion',
    text: 'Every step gets a score out of 100 for each approach, worked out from fixed tables you can read. The same facts always give the same ranking. AI reads your sources, but it does not decide, and where rules are enough the answer is “AI unnecessary”.',
    img: 'reason-score', w: 1700, h: 1020,
    alt: 'The step-by-step table: each step with its recommended approach, score, next best approach and whether AI is needed',
  },
  {
    title: 'Nothing is invented',
    text: 'A fact the sources did not give is never filled in. It shows as “Not provided”, becomes an open question with a likely owner, and is listed again at the end of each document, so a gap cannot hide in a confident paragraph.',
    img: 'reason-facts', w: 1700, h: 1143,
    alt: 'A process overview table in a generated document, with two missing facts marked Not provided and one marked Inferred',
  },
  {
    title: 'A named person signs off',
    text: 'Each process names its analyst, architect and approver. Only an approver can approve a revision, an approved revision is never changed, and who invited, changed and approved what is kept in the audit trail.',
    img: 'reason-people', w: 1700, h: 982,
    alt: 'The list of what each of the six roles can do, above the audit trail',
  },
];

const OUTPUTS = [
  ['Four documents', 'Business requirements, process definition, functional requirements and solution design, in your branding, as Word.'],
  ['As-Is and To-Be flows', 'Drawn from the process model. The As-Is flow can be edited, and both download as BPMN for other tools.'],
  ['A reviewed backlog', 'Epics, stories, tasks and spikes with acceptance criteria. You can merge, split and reject before anything reaches the board.'],
  ['A Delivery board', 'Six status columns, owners, estimates and dates, with export to Jira and Azure DevOps as CSV.'],
  ['A portfolio view', 'Every assessed process side by side, by value against ease of implementation.'],
];

export default function HomePage() {
  const signedIn = React.useMemo(() => {
    try { return Object.keys(window.localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch { return false; }
  }, []);
  const go = signedIn ? { href: '/work', label: 'Open my work' } : { href: '/signin', label: 'Sign in' };
  const cta = `rounded-lg bg-[#E69F00] px-5 py-3 text-sm font-semibold text-[#001B2F] hover:bg-[#F2B21E] ${focus} focus-visible:outline-white`;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{CSS}</style>

      <div className="overflow-hidden bg-[#001B2F] text-white">
        <header className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <a href="/" className={`rounded ${focus} focus-visible:outline-white`}><img src="/brand/avala-os-logo-light.svg" alt="Avala OS, home" className="h-10 w-auto" /></a>
          <nav aria-label="Main" className="flex items-center gap-2 text-sm font-semibold">
            <a href="#tour" className={`hidden rounded-lg px-3 py-2 text-slate-200 hover:bg-white/10 sm:block ${focus} focus-visible:outline-white`}>Product tour</a>
            <a href="#why" className={`hidden rounded-lg px-3 py-2 text-slate-200 hover:bg-white/10 sm:block ${focus} focus-visible:outline-white`}>Why AvalaOS</a>
            <a href={go.href} className={`rounded-lg border border-white/30 px-4 py-2 text-white hover:bg-white/10 ${focus} focus-visible:outline-white`}>{go.label}</a>
          </nav>
        </header>

        <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:pb-28 lg:pt-16">
          <div>
            <h1 className="font-display text-5xl font-semibold leading-[1.03] tracking-tight sm:text-6xl xl:text-7xl">Evaluate before you automate.</h1>
            <p className="mt-6 text-lg leading-8 text-slate-200">AvalaOS reads a process from your transcripts, procedures and flowcharts, scores how to automate each step, writes the documents to build it and puts the work on a delivery board. People confirm the facts and approve the result, and every change is on record.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a href={go.href} className={cta}>{go.label}</a>
              <a href="#tour" className={`rounded-lg px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 ${focus} focus-visible:outline-white`}>Watch the 30-second tour</a>
            </div>
            {!signedIn && <p className="mt-5 text-sm text-slate-300">AvalaOS is by invitation. Ask your workspace admin to invite you.</p>}
          </div>
          <div className="lg:-mr-56 xl:-mr-40">
            <div className="shot-frame">
              <img src={shot('assessment')} width={2000} height={1250} className="block h-auto w-full" alt="The AvalaOS assessment of a vendor invoice process: API-led integration recommended, 70% of steps fit automation, approaches ranked by score" />
            </div>
          </div>
        </section>
      </div>

      <p className="border-b border-slate-200 bg-slate-50 px-6 py-4 text-center text-sm text-slate-700">
        Every screen on this page is the product itself, running a sample case from a made-up company: 5 source files in; 21 steps, 4 documents and a 43-item delivery board out.
      </p>

      <main>
        <section id="tour" aria-labelledby="tour-h" className="scroll-mt-6 bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-20">
            <h2 id="tour-h" className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">From five files to a delivery board</h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-700">Avala is the five stages every process passes through. Watch the sample case go through them, or pick a stage.</p>
            <Tour />
          </div>
        </section>

        <section id="why" aria-labelledby="why-h" className="scroll-mt-6">
          <div className="mx-auto max-w-7xl px-6 py-20">
            <h2 id="why-h" className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">Built so you can defend the answer</h2>
            <div className="mt-14 space-y-20">
              {REASONS.map((r, i) => (
                <div key={r.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                  <div className={i % 2 ? 'lg:order-2' : ''}>
                    <h3 className="font-display text-3xl font-semibold tracking-tight text-slate-900">{r.title}</h3>
                    <p className="mt-4 max-w-xl text-lg leading-8 text-slate-700">{r.text}</p>
                  </div>
                  <div className="shot-frame"><img src={shot(r.img)} width={r.w} height={r.h} loading="lazy" className="block h-auto w-full" alt={r.alt} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="out-h" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <h2 id="out-h" className="font-display text-4xl font-semibold tracking-tight text-[#002C4B]">What comes out</h2>
            <dl className="divide-y divide-slate-200 border-y border-slate-200">
              {OUTPUTS.map(([t, x]) => (
                <div key={t} className="grid gap-1 py-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-8">
                  <dt className="font-display text-lg font-semibold text-slate-900">{t}</dt>
                  <dd className="text-slate-700">{x}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="name-h" className="bg-[#001B2F] text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start gap-10 px-6 py-24 lg:flex-row lg:items-center lg:gap-16">
            <Mark lit={4} size={168} dark />
            <div>
              <h2 id="name-h" className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                {TOUR.map(s => <span key={s.id} className="mr-4 inline-block"><span className="text-[#E69F00]">{s.name[0]}</span>{s.name.slice(1)}.</span>)}
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">Five stages and one record, from the first transcript to the last work item.</p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a href={go.href} className={cta}>{go.label}</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#001B2F] text-slate-300">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-white/15 px-6 py-8 text-sm">
          <p>© 2026 Avala OS</p>
          <a href={go.href} className={`font-semibold text-white underline decoration-[#E69F00] decoration-2 underline-offset-4 ${focus} focus-visible:outline-white`}>{go.label}</a>
        </div>
      </footer>
    </div>
  );
}
