// The public homepage at "/". It loads on its own (no database client) so it opens fast for anyone.
// Every screen on it is the product itself, captured by tests/e2e/tour.spec.ts running the sample case
// in eval/corpus/ap-invoice (a made-up company). Nothing here is a mock-up.
// The tour runs about 30 seconds: five stages of six seconds, two screens each. A stage's progress bar
// is a CSS animation whose end moves to the next stage, so pausing the animation pauses the timing.
// With reduced motion nothing moves or advances on its own and both screens of a stage are shown.
// The tour starts when it comes into view, and a stage a visitor picks plays its two screens and stays.
// The page is kept short on purpose (owner, 16 November 2026: about seven screens on a laptop): each
// section says its point in a sentence or two, and the longer explanation sits behind "Read more".
import { countEvent } from './visits.ts';
import React from 'react';
import { InquiryDialog } from './InquiryDialog.tsx';
import { SiteFooter, focus, useGo } from './site.tsx';
import { PLANS } from '../../domain/workspace/modules.ts';
import { AI_PROVIDERS, type AiProvider } from '../../domain/ai/providers.ts';
import { CONTACT_EMAIL } from '../../domain/site/trust.ts';
import { TRUST_PAGES } from '../../domain/site/pages.ts';

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
      { src: 'assessment', origin: '30% 55%', alt: 'The Assessment screen: RPA-led automation recommended, 1 step of 20 needs AI, with the approaches ranked by score' },
    ],
  },
  {
    id: 'validate', name: 'Validate', line: 'People confirm what is true',
    caption: 'Each step shows the sources it came from. What the sources did not say stays “Not provided” and becomes a question for a person.',
    shots: [
      { src: 'process', origin: '85% 35%', alt: 'The Process screen: 21 steps with who does them, the systems used and how many sources support each, and the questions still open' },
      { src: 'document-2', origin: '50% 12%', alt: 'A generated document where access nobody has confirmed is marked Not provided or reported, not confirmed' },
    ],
  },
  {
    id: 'assemble', name: 'Assemble', line: 'Documents and flows from one model',
    caption: 'Requirements, process, functional and solution documents and the flow maps are built from the same confirmed model, and download as Word.',
    shots: [
      { src: 'document', origin: '55% 60%', alt: 'The Documents screen: the process definition document with its contents list and Word download' },
      { src: 'flows', origin: '30% 70%', alt: 'The Flows screen: the To-Be map, each step coloured by how it will be done, one column per role' },
    ],
  },
  {
    id: 'launch', name: 'Launch', line: 'Work items onto the Delivery board',
    caption: 'Epics, stories and tasks are proposed with acceptance criteria and requirement links. A person chooses what goes to the board.',
    shots: [
      { src: 'work-items', origin: '35% 60%', alt: 'The Work items screen: 7 epics, 18 stories and 21 tasks proposed, each linked to its requirements' },
      { src: 'board', origin: '25% 40%', alt: 'The Delivery board part-way through delivery: work items in six status columns, grouped by epic' },
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
@media (min-width: 1280px){
  .hero-shot{margin-right:calc(-1 * clamp(0px, (100vw - 80rem) / 2 - 1rem, 10rem))}
}
@media (max-width: 640px){
  .tour-shot{transform:scale(1.7)}
  @keyframes tour-zoom{from{transform:scale(1.7)}to{transform:scale(1.9)}}
}
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

function Tour() {
  const [stage, setStage] = React.useState(0);
  // auto: the stages follow one another. held: a visitor picked a stage; it plays its two screens and stays.
  // paused: nothing moves.
  const [mode, setMode] = React.useState<'auto' | 'held' | 'paused'>('auto');
  // Nothing plays until the tour is on screen, so a visitor sees it from the first stage.
  const [seen, setSeen] = React.useState(typeof IntersectionObserver === 'undefined');
  const ref = React.useRef<HTMLDivElement>(null);
  const cur = TOUR[stage];
  const play = () => { if (mode === 'held') setStage(n => (n + 1) % TOUR.length); setMode(mode === 'auto' ? 'paused' : 'auto'); };

  React.useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

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
    <div ref={ref} data-paused={!seen || mode === 'paused'} className="mt-8 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <div className="mb-6 hidden lg:block"><Mark lit={stage} size={112} dark /></div>
        <ol aria-label="The five stages" className="grid grid-cols-5 gap-1 lg:block lg:space-y-1">
          {TOUR.map((s, i) => {
            const here = i === stage;
            return (
              <li key={s.id}>
                <button type="button" aria-label={`${s.name}. ${s.line}`} aria-current={here ? 'step' : undefined} onClick={() => { setStage(i); setMode('held'); countEvent('Tour stage picked', s.name); }}
                  className={`w-full rounded-lg px-2 py-2 text-center transition-colors lg:px-3 lg:py-2.5 lg:text-left ${focus} focus-visible:outline-white ${here ? 'bg-white/10 ring-1 ring-white/25' : 'hover:bg-white/5'}`}>
                  <span className={`block font-display text-xs font-semibold sm:text-sm lg:text-lg ${here ? 'text-white' : 'text-slate-300'}`}><span data-initial className="text-[#F2B21E]">{s.name[0]}</span>{s.name.slice(1)}</span>
                  <span className="hidden text-sm text-slate-300 lg:block">{s.line}</span>
                  <span className={`mt-2 block h-1 overflow-hidden rounded-full ${here ? 'bg-white/20' : 'bg-transparent'}`} aria-hidden="true">
                    {here && <span key={stage} className="tour-fill block h-full rounded-full" style={{ background: AMBER }} onAnimationEnd={() => { if (mode === 'auto') setStage(n => (n + 1) % TOUR.length); }} />}
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
            <p className="max-w-2xl text-lg leading-7 text-slate-100">{cur.caption}</p>
            <button type="button" onClick={play} className={`shrink-0 rounded-lg border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 motion-reduce:hidden ${focus} focus-visible:outline-white`}>
              {mode === 'auto' ? 'Pause the tour' : 'Play the tour'}
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
    text: 'Every step is scored out of 100 for each approach, from fixed tables you can read. Your people can overrule any step, with a reason.',
    more: 'The same facts always give the same ranking. AI helps read your sources, but it does not decide, and where rules are enough the answer is “AI unnecessary”. A person’s choice is recorded beside the scoring’s own recommendation, never in place of it.',
    id: 'why-score', img: 'reason-score', w: 1700, h: 907, tint: 'bg-sky-100',
    alt: 'The step-by-step table: one step marked AI needed, the others AI unnecessary, each with its score and reasons',
  },
  {
    title: 'Every line traces to a source',
    text: 'A fact your sources did not give is never filled in. It becomes an open question with a likely owner.',
    more: 'It shows as “Not provided” in the documents. What is reported but not confirmed is marked so, and every gap is listed again at the end of each document, so it cannot hide in a confident paragraph. Start from a typical process if you like: it stays labelled Typical until your people confirm it.',
    id: 'why-facts', img: 'reason-facts', w: 1700, h: 1172, tint: 'bg-amber-100',
    alt: 'Part of a generated document: one access marked Not provided, one reported but not confirmed, and a figure marked Inferred',
  },
  {
    title: 'A named person signs off',
    text: 'Each process names its analyst, architect and approver. An approved revision is never changed.',
    more: 'Only an approver can approve a revision. Who invited, changed and approved what is kept in the audit trail.',
    id: 'why-people', img: 'reason-people', w: 1700, h: 963, tint: 'bg-emerald-100',
    alt: 'The list of what each of the six roles can do, above the audit trail',
  },
];

const APPROACHES: [string, string][] = [
  ['Rule-based RPA', 'bg-sky-50 text-sky-900 ring-sky-200'],
  ['API integration', 'bg-emerald-50 text-emerald-900 ring-emerald-200'],
  ['AI-assisted', 'bg-violet-50 text-violet-900 ring-violet-200'],
  ['Agent', 'bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-200'],
  ['A person', 'bg-slate-100 text-slate-800 ring-slate-200'],
];

// The sample case in four lines, as the product computes it (tests/e2e/tour.spec.ts): update them if the
// sample or the scoring tables change.
const CASE: [string, string][] = [
  ['What went in', 'Three call transcripts, a procedure and a flowchart.'],
  ['Rules do the work', '15 of the 20 scored steps. One more the system already does.'],
  ['AI where it is needed', 'One step: reading the invoice. A person reviews what it read.'],
  ['People keep', 'Four steps, and the sign-off.'],
];

// What comes out, one line each. The evidence pack and the simple flow are in the product since the
// release of 16 November 2026.
const OUTPUTS: [string, string][] = [
  ['The documents this process needs', 'PDD and SDD, BRD and FRD, or an agent definition, chosen by rule. In Word, in your company’s template.'],
  ['Test cases', 'One for each acceptance criterion. Testers edit and add their own; the pack downloads for Excel.'],
  ['As-Is and To-Be flows', 'Drawn from the process, as swimlanes or a simple flow. Both download as BPMN.'],
  ['A backlog and a Delivery board', 'Epics, stories and tasks with acceptance criteria. Run delivery here, or move it to Jira or Azure DevOps as CSV.'],
  ['A portfolio view', 'Every assessed process side by side, by value against ease of implementation.'],
  ['An evidence pack', 'Each requirement traced to its source, its approval, its work and its tests, in one document.'],
];

// What the page says about the parts and the AI comes from the product's own lists, so it cannot claim
// more than the product does: the four set-ups (domain/workspace/modules.ts) and the providers, with only
// those the extraction check has been run with called available (domain/ai/providers.ts, `checked`).
const PART_NOTES: Record<string, string> = {
  full: 'One record from the first transcript to the last work item.',
  'assess-documents': 'For teams that build in their own tools.',
  assess: 'Find out what to automate first, and how.',
  board: 'A board your team can run on its own. Bring your Jira work over from a CSV export.',
};
const providers = (Object.keys(AI_PROVIDERS) as AiProvider[]).map(p => ({ id: p, label: AI_PROVIDERS[p].label, ready: AI_PROVIDERS[p].checked }));
// What a security reviewer asks, beside "Your AI, your key". A client's own workspace and an install in a
// company's own cloud are offered, not described (no such install has been done yet).
const TRUST_POINTS: [string, string][] = [
  ['Your key stays on the server', 'Stored encrypted, never sent back to the browser. If it stops working, the work stops and says why: it never moves to our key without you.'],
  ['AI only where it reads or drafts', 'AI reads your sources and drafts text a person checks. The scores and the recommendation come from fixed tables, never from AI.'],
  ['A workspace for each client', 'With its own people, document set-up and AI key. People see only the workspaces they are members of.'],
  ['Inside your own cloud, on request', 'Avala OS can be installed in your company’s own cloud. We plan it with your security team.'],
];
// The effort promise (docs/effort-first-plan.md: "Avala OS does the work; people confirm it") as three
// outcomes a buyer recognises, with the product's own detail behind "Read more". Each point names
// something built: the scoring on one scale, the first list's cap of seven (domain/questions/firstList.ts),
// the delivery plan by rule (domain/plan/delivery.ts), the test pack and the effort card. The typical
// process is named as the one that exists, and the page never says Avala OS picks it: a person does.
const OUTCOMES: [string, string][] = [
  ['Choose the right approach', 'Every step is compared for RPA, an API, AI or a person on one scale you can inspect. AI is never the default.'],
  ['Less preparation for your people', 'Your documents answer first. Of everything a process raises, at most seven questions go to your people at the start; the rest waits until sign-off.'],
  ['Delivery tied to the decision', 'Requirements, test cases and work items carry their reasons with them, and only the documents this process needs are planned.'],
];
const EFFORT_POINTS: [string, string][] = [
  ['Your documents answer first', 'Avala OS looks in your own sources for the answer before anyone is asked. What it finds is shown with its passage, for a person to confirm.'],
  ['Start from what you have', 'Transcripts, procedures, trackers and flowcharts. No documents? Describe the work in a few sentences, or pick a typical process from the list (supplier invoice processing today) and confirm it step by step. It stays marked Typical until your people confirm it.'],
  ['Effort you can show', 'Each process shows what it took: the time from the first source to a first draft, the questions your people answered and the ones your documents answered. Counted from the record, never estimated.'],
];
// Ask Avala, as it works: answers with a source on every sentence, the open questions asked one at a
// time, suggestions a person confirms. It never writes on its own, so the page never says it does.
const ASK_POINTS: [string, string][] = [
  ['Every sentence shows its source', 'Ask about one process, the Delivery board or the whole workspace. A sentence it cannot support is left out.'],
  ['It asks the open questions', 'One at a time, the most decisive first, and nothing is written until you press Save.'],
  ['It suggests, a person confirms', 'It reads only what the signed-in person can see, and never changes a score or an approved revision.'],
];
// The first step a buyer is asked for is a walkthrough, not a pilot (owner, 16 November 2026). The button opens
// the request window (InquiryDialog, package 11); with JavaScript off it is still this email link, and the
// close shows the address as text.
const WALK = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('A walkthrough of Avala OS')}&body=${encodeURIComponent('Company:\nA process you would like to see assessed (optional):\n')}`;
const WALK_LABEL = 'Book a walkthrough';
const NAV: [string, string][] = [['#tour', 'Product tour'], ['#why', 'Why Avala OS'], ['#trust', 'Trust'], ['/demo', 'Live demo']];
// What a buyer asks first, on the first screen: each line leads to the part of the page that shows it.
const HERO_FACTS: [string, string][] = [
  ['#ai', 'Bring your own AI key (BYOK)'],
  ['#why-score', 'Scores come from fixed tables, not from AI'],
  ['#why-people', 'A named person signs off'],
];

/** The longer explanation of a point, one click away, so the page stays short. */
function More({ children, dark, which }: { children: React.ReactNode; dark?: boolean; which: string }) {
  return (
    <details className="mt-2" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) countEvent('Read more opened', which); }}>
      <summary className={`w-fit cursor-pointer rounded text-sm font-semibold underline decoration-[#E69F00] decoration-2 underline-offset-4 ${dark ? 'text-white' : 'text-[#002C4B]'} ${focus} ${dark ? 'focus-visible:outline-white' : 'focus-visible:outline-[#002C4B]'}`}>Read more</summary>
      <div className={`mt-2 text-base leading-7 ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{children}</div>
    </details>
  );
}

/** Why the answer can be defended: three short points; the one picked shows its product screen beside them. */
function Reasons() {
  const [open, setOpen] = React.useState(0);
  const cur = REASONS[open];
  const picture = (r: typeof REASONS[number]) => (
    <div className={`rounded-3xl p-4 sm:p-8 ${r.tint}`}>
      <div className="shot-frame"><img key={r.img} src={shot(r.img)} width={r.w} height={r.h} loading="lazy" className="block h-auto w-[160%] max-w-none sm:w-full" alt={r.alt} /></div>
    </div>
  );
  return (
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
      <ul aria-label="Why the answer can be defended" className="space-y-2.5">
        {REASONS.map((r, i) => (
          <li key={r.id} id={r.id} onMouseEnter={() => setOpen(i)} className={`scroll-mt-10 rounded-2xl bg-white px-5 py-4 ring-1 ring-inset ${i === open ? 'ring-2 ring-[#002C4B]' : 'ring-slate-200'}`}>
            <h3 className="font-display text-xl font-semibold tracking-tight text-[#002C4B]">
              <button type="button" aria-pressed={i === open} onClick={() => setOpen(i)} className={`rounded text-left ${focus} focus-visible:outline-[#002C4B]`}>{r.title}</button>
            </h3>
            <p className="mt-1.5 text-base leading-7 text-slate-700">{r.text}</p>
            <More which={r.id}>{r.more}</More>
            <div className="mt-4 lg:hidden">{picture(r)}</div>
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">{picture(cur)}</div>
    </div>
  );
}

/** The page's links: in the bar on a wide screen, behind Menu on a narrow one. */
function SiteNav({ go, onWalk }: { go: { href: string; label: string }; onWalk: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const [open, setOpen] = React.useState(false);
  const signedIn = go.href === '/work';
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const link = `whitespace-nowrap rounded-lg px-3 py-2 text-slate-200 hover:bg-white/10 ${focus} focus-visible:outline-white`;
  return (
    <nav aria-label="Main" className="relative flex items-center gap-1 text-sm font-semibold">
      {NAV.map(([href, label]) => <a key={href} href={href} className={`hidden lg:block ${link}`}>{label}</a>)}
      <button type="button" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)} className={`lg:hidden ${link}`}>Menu</button>
      {open && (
        <ul id="site-menu" className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl bg-[#002C4B] p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/15 lg:hidden">
          {NAV.map(([href, label]) => <li key={href}><a href={href} onClick={() => setOpen(false)} className={`block ${link}`}>{label}</a></li>)}
          {!signedIn && <li className="sm:hidden"><a href={WALK} onClick={e => { setOpen(false); onWalk(e); }} className={`block ${link}`}>{WALK_LABEL}</a></li>}
        </ul>
      )}
      <a href={go.href} data-testid="site-go" className={`ml-1 whitespace-nowrap rounded-lg border border-white/30 px-3 py-2 sm:px-4 text-white hover:bg-white/10 ${focus} focus-visible:outline-white`}>{go.label}</a>
      {!signedIn && <a href={WALK} onClick={onWalk} className={`ml-1 hidden whitespace-nowrap rounded-lg bg-[#E69F00] px-4 py-2 text-[#001B2F] hover:bg-[#F2B21E] sm:block ${focus} focus-visible:outline-white`}>{WALK_LABEL}</a>}
    </nav>
  );
}

export default function HomePage() {
  const go = useGo();
  // The request window, and the button that opened it, which gets focus back when it closes.
  const [asking, setAsking] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const onWalk = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // A click with a modifier key opens the email link as it would anywhere else.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    opener.current = e.currentTarget;
    setAsking(true);
  };
  const closeAsking = () => {
    setAsking(false);
    // The bar's menu item goes with the menu; focus then goes to the bar's own button.
    const back = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('[data-walk]');
    back?.focus();
  };
  const signedIn = go.href === '/work';
  const cta = `rounded-lg bg-[#E69F00] px-5 py-3 text-sm font-semibold text-[#001B2F] hover:bg-[#F2B21E] ${focus} focus-visible:outline-white`;
  const second = `rounded-lg border border-white/30 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 ${focus} focus-visible:outline-white`;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{CSS}</style>
      {asking && <InquiryDialog onClose={closeAsking} />}

      <div className="overflow-hidden bg-[#001B2F] text-white">
        {/* On a phone the logo is a little smaller and the bar's buttons a little narrower, so "Open my work" stays on one line at 360 wide. */}
        <header className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
          <a href="/" className={`shrink-0 rounded ${focus} focus-visible:outline-white`}><img src="/brand/avala-os-logo-light.svg" alt="Avala OS, home" className="h-7 w-auto sm:h-10" /></a>
          <SiteNav go={go} onWalk={onWalk} />
        </header>
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-14 pt-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:pb-16 lg:pt-10 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
          <div>
            <p data-balanced className="text-balance text-sm font-semibold text-[#F2B21E]">For automation, analysis and delivery teams, and their consulting partners</p>
            <h1 className="text-wrap mt-3 font-display text-5xl font-semibold leading-[1.03] tracking-tight sm:text-6xl xl:text-7xl"><span className="text-[#F2B21E]">Evaluate</span> before you automate.</h1>
            <p className="text-balance mt-6 border-l-4 border-[#E69F00] pl-4 font-display text-2xl font-semibold leading-8 tracking-tight text-white sm:text-3xl">Not every process needs AI.</p>
            <p className="mt-4 text-lg leading-8 text-slate-300">Decide where RPA, an API, AI or a person fits each step, from the documents you already have. You get a recommendation with its reasons, documents your reviewers can check, and a plan your team can deliver.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {signedIn ? <a href={go.href} className={cta}>{go.label}</a> : <a href={WALK} onClick={onWalk} data-walk className={cta}>{WALK_LABEL}</a>}
              <a href="/demo" className={second}>Try the live demo</a>
            </div>
            <ul aria-label="In short" className="mt-6 space-y-2 text-sm font-semibold text-slate-100">
              {HERO_FACTS.map(([href, label]) => (
                <li key={href} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#E69F00]" />
                  <a href={href} className={`rounded underline-offset-4 hover:underline ${focus} focus-visible:outline-white`}>{label}</a>
                </li>
              ))}
            </ul>
          </div>
          {/* The opening picture is always whole (owner, 16 November 2026): it grows past the text column only as far as
              the window has room, and a phone gets the product's own phone screen, not a cropped desktop one. */}
          <div className="hero-shot">
            <div className="shot-frame">
              <picture>
                <source media="(max-width: 639px)" srcSet={shot('assessment-phone')} width={780} height={1688} />
                <img src={shot('assessment')} width={2000} height={1250} className="block h-auto w-full" alt="The Avala OS assessment of a vendor invoice process: RPA-led automation recommended, 80% of steps fit automation, 1 step of 20 needs AI" />
              </picture>
            </div>
          </div>
        </section>
      </div>

      <p className="border-b border-slate-200 bg-slate-50 px-6 py-3 text-center text-sm text-slate-700">
        Real product screens. A made-up sample case: five source files in; four documents, 32 test cases and a 43-item Delivery board out.
      </p>

      <main>
        <section aria-labelledby="motto-h">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
              <h2 id="motto-h" className="font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">AI is not the answer to every step</h2>
              <div>
                <p className="text-lg leading-8 text-slate-700">Most of a process is rules, screens and hand-offs. Avala OS puts every approach on one scale and recommends AI or an agent only where the work needs it.</p>
                <ul aria-label="The approaches every step is scored for" className="mt-5 flex flex-wrap gap-2 text-sm font-semibold">
                  {APPROACHES.map(([name, cls]) => <li key={name} className={`rounded-full px-3 py-1.5 ring-1 ring-inset ${cls}`}>{name}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-8 rounded-3xl bg-amber-100 p-4 sm:p-6">
              <div className="shot-frame"><img src={shot('motto-split')} width={1800} height={563} loading="lazy" className="block h-auto w-[170%] max-w-none sm:w-full" alt="How the 20 steps of the sample split: 15 rule-based RPA, 1 AI-assisted, 4 stay with people, with the reasons for each" /></div>
            </div>
            <dl className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {CASE.map(([t, x]) => (
                <div key={t} className="border-l-4 border-[#E69F00] pl-4">
                  <dt className="font-display text-lg font-semibold text-[#002C4B]">{t}</dt>
                  <dd className="mt-1 text-base leading-7 text-slate-700">{x}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="tour" aria-labelledby="tour-h" className="scroll-mt-6 bg-[#002C4B] text-white">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <h2 id="tour-h" className="max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">From your documents to a Delivery board</h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-200">Five stages take a process from its source files to the board: Assess, Validate, Assemble, Launch, Audit. Watch the sample case go through them, or pick a stage to look at it.</p>
            <Tour />
          </div>
        </section>

        <section id="effort" aria-labelledby="effort-h" className="scroll-mt-6">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
              <div>
                <p className="text-sm font-semibold text-[#9A6700]">Less work for your people</p>
                <h2 id="effort-h" className="mt-2 font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">Avala OS does the work. Your people confirm it.</h2>
              </div>
              <p className="self-end text-lg leading-8 text-slate-700">An assessment should not turn into weeks of workshops. Avala OS reads what you already have, asks only what it cannot find, and shows what it took.</p>
            </div>
            <ul aria-label="What you get" className="mt-10 grid gap-4 lg:grid-cols-3">
              {OUTCOMES.map(([t, x]) => (
                <li key={t} className="rounded-2xl bg-slate-50 p-6 ring-1 ring-inset ring-slate-200">
                  <h3 className="font-display text-xl font-semibold tracking-tight text-[#002C4B]">{t}</h3>
                  <p className="mt-2 text-base leading-7 text-slate-700">{x}</p>
                </li>
              ))}
            </ul>
            <More which="effort">
              <dl className="grid gap-x-10 gap-y-4 lg:grid-cols-3">
                {EFFORT_POINTS.map(([t, x]) => (
                  <div key={t}>
                    <dt className="font-semibold text-slate-900">{t}</dt>
                    <dd className="mt-1">{x}</dd>
                  </div>
                ))}
              </dl>
            </More>
          </div>
        </section>

        <section id="why" aria-labelledby="why-h" className="scroll-mt-6 bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <h2 id="why-h" className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">Built so you can defend the answer</h2>
            <Reasons />
          </div>
        </section>

        <section id="ask" aria-labelledby="ask-h" className="scroll-mt-6">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
            <div>
              <h2 id="ask-h" className="font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">Ask Avala, and check its answer</h2>
              <p className="mt-4 text-lg leading-8 text-slate-700">One assistant on every page, answering only from your own record.</p>
              <dl className="mt-6 space-y-4">
                {ASK_POINTS.map(([t, x]) => (
                  <div key={t} className="border-l-4 border-[#E69F00] pl-4">
                    <dt className="font-display text-lg font-semibold text-[#002C4B]">{t}</dt>
                    <dd className="mt-1 text-base leading-7 text-slate-700">{x}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6"><a href="/demo" className={`rounded font-semibold text-[#002C4B] underline decoration-[#E69F00] decoration-2 underline-offset-4 ${focus} focus-visible:outline-[#002C4B]`}>Try it in the demo</a></p>
            </div>
            <div className="rounded-3xl bg-amber-100 p-4 sm:p-8">
              <div className="shot-frame"><img src={shot('ask')} width={1600} height={1173} loading="lazy" className="block h-auto w-full" alt="Ask Avala open on the sample case: the question “Why is this the recommended approach?” answered in sentences, each with a numbered source" /></div>
            </div>
          </div>
        </section>

        <section aria-labelledby="out-h" className="bg-[#FFF3D1]">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <h2 id="out-h" className="font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">What comes out</h2>
            <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {OUTPUTS.map(([t, x]) => (
                <div key={t} className="border-t border-[#002C4B]/20 pt-4">
                  <dt className="font-display text-xl font-semibold text-[#002C4B]">{t}</dt>
                  <dd className="mt-1 text-base leading-7 text-slate-800">{x}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="trust" aria-labelledby="trust-h" className="scroll-mt-6">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <h2 id="trust-h" className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">What your security team will ask</h2>
            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
              <div id="ai" className="scroll-mt-10 self-start rounded-2xl bg-[#002C4B] p-6 text-white">
                <p className="text-sm font-semibold text-[#F2B21E]">Bring your own AI key (BYOK)</p>
                <h3 className="mt-2 font-display text-3xl font-semibold tracking-tight">Your AI, your key</h3>
                <p className="mt-4 text-base leading-7 text-slate-200">Connect the AI provider your company already trusts, with your own key. For AI reading, your documents then go to that provider and to no other AI provider.</p>
                <p className="mt-6 text-sm font-semibold text-white">Available now</p>
                <ul aria-label="AI providers available now" className="mt-2 flex flex-wrap gap-2">
                  {providers.filter(p => p.ready).map(p => <li key={p.id} className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200">{p.label}</li>)}
                </ul>
                <p className="mt-5 text-sm font-semibold text-white">Coming once each passes our extraction check</p>
                <ul aria-label="AI providers coming" className="mt-2 flex flex-wrap gap-2">
                  {providers.filter(p => !p.ready).map(p => <li key={p.id} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-inset ring-white/25">{p.label}</li>)}
                </ul>
              </div>
              <div>
                <dl className="grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2">
                  {TRUST_POINTS.map(([t, x]) => (
                    <div key={t} className="bg-white p-6">
                      <dt className="font-display text-lg font-semibold text-[#002C4B]">{t}</dt>
                      <dd className="mt-2 text-base leading-7 text-slate-700">{x}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-5 text-base text-slate-700">The detail is written down:{' '}
                  {TRUST_PAGES.map((p, i) => <React.Fragment key={p.id}>{i ? ', ' : ''}<a href={p.path} className={`rounded font-semibold text-[#002C4B] underline decoration-[#E69F00] decoration-2 underline-offset-4 ${focus} focus-visible:outline-[#002C4B]`}>{p.label}</a></React.Fragment>)}.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="start" aria-labelledby="start-h" className="scroll-mt-6 bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <h2 id="start-h" className="font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">Start with one part, or use it all</h2>
            <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-700">Add the rest later; nothing is lost. Not automating? Document a process as it is, with no assessment. Technology already chosen? The documents follow it.</p>
            <ul aria-label="Ways to start" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((p, i) => (
                <li key={p.id} className={`flex flex-col rounded-2xl p-6 ring-1 ring-inset ${i === 0 ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white ring-slate-200'}`}>
                  <h3 className={`font-display text-xl font-semibold ${i === 0 ? 'text-white' : 'text-[#002C4B]'}`}>{p.label}</h3>
                  <p className={`mt-2 text-sm font-semibold ${i === 0 ? 'text-[#F2B21E]' : 'text-[#9A6700]'}`}>{PART_NOTES[p.id]}</p>
                  <p className={`mt-3 text-sm leading-6 ${i === 0 ? 'text-slate-200' : 'text-slate-600'}`}>{p.what}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="close-h" className="bg-[#001B2F] text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start gap-10 px-6 py-14 lg:flex-row lg:items-center lg:gap-16">
            <Mark lit={4} size={168} dark />
            <div>
              <p className="font-display text-xl font-semibold tracking-tight text-slate-200">
                {TOUR.map(s => <React.Fragment key={s.id}><span className="mr-2 inline-block"><span className="text-[#E69F00]">{s.name[0]}</span>{s.name.slice(1)}.</span>{' '}</React.Fragment>)}
              </p>
              <h2 id="close-h" className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Start with one process. Decide with evidence.</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">In a walkthrough we take one process through Avala OS with you: the recommendation, the evidence behind it, and the documents and plan that come out. A pilot on a process of your own follows from there.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {signedIn ? <a href={go.href} className={cta}>{go.label}</a> : <a href={WALK} onClick={onWalk} data-walk className={cta}>{WALK_LABEL}</a>}
                <a href="/demo" className={second}>Try the live demo</a>
              </div>
              {!signedIn && <p className="mt-5 text-base text-slate-300">Or write to <a href={`mailto:${CONTACT_EMAIL}`} className={`rounded font-semibold text-white underline decoration-[#E69F00] decoration-2 underline-offset-4 ${focus} focus-visible:outline-white`}>{CONTACT_EMAIL}</a>.</p>}
              <p className="mt-6 max-w-2xl border-l-4 border-[#E69F00] pl-4 text-base leading-7 text-slate-300"><span className="font-semibold text-white">Built by a practitioner.</span> A business analyst and project manager with 13+ years leading RPA and AI automation delivery across regulated industries. The scoring tables, document sections and sign-off rules follow how that work is done.</p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter go={go} />
    </div>
  );
}
