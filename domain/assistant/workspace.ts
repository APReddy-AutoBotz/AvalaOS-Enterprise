// Ask Avala about the whole workspace (docs/product-plan.md, "Ask Avala: the plan", stage 1, workspace
// scope). The facts are built here, by rule, from what My work, the Processes page, the Portfolio, the
// applications list, People and the board already read: one summary per process (where it stands, who is
// named, what is open, the assessment in short, its place in the portfolio, the applications it uses), the
// applications list, the people and their access (names, never email addresses), and each board in short.
// Totals are worked out here and given as facts. A process's own record (its steps, sources and so on) is
// added only when the question names that process (`namedProcess`), so sources stay with their process.
import type { TaskDefinition } from '../ai/gateway.ts';
import type { ProcessCard, Portfolio } from '../assess/portfolio.ts';
import { QUADRANT } from '../assess/priority.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import type { Application } from '../workspace/applications.ts';
import { applicationSummary, matchApplication } from '../workspace/applications.ts';
import type { WorkItem } from '../workitems/board.ts';
import { askProcess, type Fact } from './ask.ts';
import { boardFacts } from './board.ts';
import { PLATFORM_FACTS, PLATFORM_LABEL } from './platform.ts';

export interface WorkspaceProcess {
  id: string; name: string;
  /** Where its revision stands, in the words the Processes page uses ("Approved revision 2"). */
  status: string;
  openQuestions: number; proposalsWaiting: number;
  /** Who is named on it, by name; null where nobody is. */
  named: { analyst: string | null; architect: string | null; approver: string | null };
  /** The assessment in short, people's choices included; null until it has a step. */
  card: ProcessCard | null;
  /** The applications its process model names. */
  systems: string[];
}

export interface WorkspaceContext {
  workspace: { name: string };
  /** False where the organisation does not use processes: none are listed. */
  processesInUse: boolean;
  processes: WorkspaceProcess[];
  portfolio: Portfolio | null;
  applications: Application[];
  people: { name: string; role: 'admin' | 'editor' | 'viewer' }[];
  boards: { id: string; name: string; items: WorkItem[] }[];
  /** Today, as YYYY-MM-DD, for what is overdue. */
  today: string;
}

/** At most this many process and application summaries; the counts above them always cover every one. */
export const WORKSPACE_LIMITS = { processes: 60, applications: 60 } as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names: string[], max = 15) => names.slice(0, max).map(n => `"${n}"`).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '');
const STOP = new Set('the and for with from this that process processes'.split(' '));
const words = (s: string) => (s.toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z0-9]{3,}/g) ?? []).filter(w => !STOP.has(w));
const like = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/**
 * The process a question names, if exactly one: every word of its name (words in brackets aside) is in the
 * question, allowing one word missing for names of three words or more ("invoice processing" for "Vendor
 * invoice processing" does not count; "vendor invoice process" does). A question that names two is about neither.
 */
export function namedProcess(question: string, processes: { id: string; name: string }[]): string | null {
  const q = words(question);
  const scored = processes.map(p => {
    const w = [...new Set(words(p.name))];
    const hit = w.filter(x => q.some(y => like(x, y))).length;
    return { id: p.id, hit, ok: w.length > 0 && hit >= (w.length >= 3 ? w.length - 1 : w.length) };
  }).filter(x => x.ok);
  // Two processes named (a comparison) is not one process: the workspace summaries answer it.
  return scored.length === 1 ? scored[0].id : null;
}

const ps0 = (ctx: WorkspaceContext) => (ctx.processesInUse ? ctx.processes : []);
/** The `max` whose names share the most words with the question, in their own order. */
function mostAsked<T extends { name: string }>(question: string, all: T[], max: number): T[] {
  if (all.length <= max) return all;
  const q = words(question);
  const score = (n: string) => words(n).filter(x => q.some(y => like(x, y))).length;
  return all.map((x, i) => ({ x, i, s: score(x.name) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map(e => e.x);
}

/** Every fact Ask Avala may answer from about the workspace; `named` is the record of the process the question names. */
export function workspaceFacts(question: string, ctx: WorkspaceContext, named?: { processId: string; facts: Fact[] } | null): Fact[] {
  const out: Fact[] = [];
  const label = `Workspace: ${ctx.workspace.name}`;
  const add = (id: string, text: string, target: Fact['target'], l = label) => out.push({ id: `ws:${id}`, text, label: l, target });
  const portfolio = { kind: 'portfolio' as const };

  // ---- processes
  if (ctx.processesInUse) {
    const ps = ctx.processes;
    const byStatus = [...new Set(ps.map(p => p.status))].map(s => `${ps.filter(p => p.status === s).length} ${s.toLowerCase()}`);
    const assessed = ps.filter(p => p.card);
    add('processes', ps.length
      ? `The workspace "${ctx.workspace.name}" has ${plural(ps.length, 'process', 'processes')}: ${list(ps.map(p => p.name))}. Where they stand: ${byStatus.join(', ')}. ${assessed.length} of them ${assessed.length === 1 ? 'has' : 'have'} steps to assess.`
      : `The workspace "${ctx.workspace.name}" has no processes yet.`, portfolio);
    if (assessed.length) {
      const t = assessed.reduce((s, p) => ({ steps: s.steps + p.card!.steps, rules: s.rules + p.card!.split.rules, ai: s.ai + p.card!.split.ai, people: s.people + p.card!.split.people }), { steps: 0, rules: 0, ai: 0, people: 0 });
      add('split', `Across the ${plural(assessed.length, 'assessed process', 'assessed processes')}, people do ${plural(t.steps, 'step')} today: ${t.rules} would be done by rules (RPA or an API), ${t.ai} with AI and ${t.people} would stay with people, following the approach in effect for each step.`, portfolio);
    }
    const pf = ctx.portfolio;
    if (pf && pf.rows.length) {
      add('portfolio', `In the portfolio, ordered by placement then hours: ${pf.rows.map(r => `${r.rank}. "${r.name}" (${r.quadrant ? QUADRANT[r.quadrant].label.toLowerCase() : 'not placed yet'})`).join(', ')}.`, portfolio, 'Portfolio');
      if (pf.totalHours > 0) add('hours', `Where the value is known, automation could take up to ${Math.round(pf.totalHours).toLocaleString('en')} hours a year across the processes (the upper ends of each process's estimate).`, portfolio, 'Portfolio');
      if (pf.pareto.ids.length) {
        const names = pf.pareto.ids.map(id => pf.rows.find(r => r.id === id)?.name ?? '').filter(Boolean);
        add('pareto', `${list(names)} ${names.length === 1 ? 'carries' : 'carry'} ${Math.round(pf.pareto.share * 100)}% of those hours, of ${plural(pf.pareto.of, 'process', 'processes')} whose value is known.`, portfolio, 'Portfolio');
      }
    }
    const none = (role: 'analyst' | 'architect' | 'approver') => ps.filter(p => !p.named[role]).map(p => p.name);
    for (const role of ['analyst', 'architect', 'approver'] as const) {
      const missing = none(role);
      if (ps.length) add(`no-${role}`, missing.length ? `Processes with no ${role} named: ${list(missing)}.` : `Every process has an ${role} named.`, portfolio);
    }
    const open = ps.filter(p => p.openQuestions > 0), waiting = ps.filter(p => p.proposalsWaiting > 0);
    add('open', open.length ? `${plural(open.reduce((t, p) => t + p.openQuestions, 0), 'open question')} across ${plural(open.length, 'process', 'processes')}: ${open.map(p => `"${p.name}" ${p.openQuestions}`).join(', ')}.` : 'No process has an open question.', portfolio);
    add('proposals', waiting.length ? `Work-item proposals waiting for review: ${waiting.map(p => `"${p.name}" ${p.proposalsWaiting}`).join(', ')}.` : 'No process has work-item proposals waiting for review.', portfolio);
    for (const p of mostAsked(question, ps, WORKSPACE_LIMITS.processes)) {
      const c = p.card;
      const row = ctx.portfolio?.rows.find(r => r.id === p.id);
      const people = (['analyst', 'architect', 'approver'] as const).map(r => (p.named[r] ? `${r} ${p.named[r]}` : `no ${r} named`)).join(', ');
      const parts = [
        `where it stands: ${p.status}`, people,
        plural(p.openQuestions, 'open question'),
        p.proposalsWaiting ? `${plural(p.proposalsWaiting, 'work-item proposal')} waiting for review` : '',
        c ? `${c.lead ? `${APPROACH_LABEL[c.lead]} leads` : 'no step recommended for automation'}; of ${plural(c.steps, 'step')} people do today, ${c.split.rules} by rules (RPA or an API), ${c.split.ai} with AI, ${c.split.people} stay with people` : 'no steps to assess yet',
        c?.hours ? `automation could take up to ${Math.round(c.hours).toLocaleString('en')} hours a year` : '',
        row ? `in the portfolio ${row.rank} of ${ctx.portfolio!.rows.length}${row.quadrant ? `, ${QUADRANT[row.quadrant].label.toLowerCase()}` : ', not placed yet'}` : '',
        p.systems.length ? `applications: ${p.systems.join(', ')}` : '',
      ].filter(Boolean);
      add(`p:${p.id}`, `Process "${p.name}": ${parts.join('; ')}.`, { kind: 'open-process', processId: p.id }, `Process: ${p.name}`);
    }
  }

  // ---- the applications list
  const apps = ctx.applications;
  add('apps', apps.length ? `The applications list has ${plural(apps.length, 'application')}: ${list(apps.map(a => a.name), 30)}.` : 'The applications list is empty.', { kind: 'applications' }, 'Applications list');
  if (ps0(ctx).length > WORKSPACE_LIMITS.processes) add('more-processes', `${plural(ps0(ctx).length - WORKSPACE_LIMITS.processes, 'more process is', 'more processes are')} in the workspace and not summed up here.`, portfolio);
  for (const a of mostAsked(question, apps, WORKSPACE_LIMITS.applications)) {
    const users = ctx.processes.filter(p => p.systems.some(s => matchApplication({ name: s }, [a]))).map(p => p.name);
    add(`app:${a.id}`, `Application "${a.name}"${a.aliases.length ? ` (also called ${a.aliases.join(', ')})` : ''}: ${applicationSummary(a)}.${users.length ? ` Used by ${list(users)}.` : ''}`, { kind: 'applications' }, `Application: ${a.name}`);
  }

  if (apps.length > WORKSPACE_LIMITS.applications) add('more-apps', `${plural(apps.length - WORKSPACE_LIMITS.applications, 'more application is', 'more applications are')} on the list and not described here.`, { kind: 'applications' }, 'Applications list');

  // ---- people, by name and access, never email addresses
  const by = (r: 'admin' | 'editor' | 'viewer') => ctx.people.filter(p => p.role === r).map(p => p.name);
  const groups = ([['admin', 'Admins'], ['editor', 'Can edit'], ['viewer', 'Can view only']] as const).map(([r, l]) => [l, by(r)] as const).filter(([, n]) => n.length);
  add('people', `The workspace has ${plural(ctx.people.length, 'person', 'people')}. ${groups.map(([l, n]) => `${l}: ${n.join(', ')}.`).join(' ')}`.trim(), { kind: 'people' }, 'People');

  // ---- each board in short, with the board's own counts
  for (const b of ctx.boards) {
    const f = boardFacts('', { project: { id: b.id, name: b.name }, items: b.items, sprints: [], members: [], processes: [], today: ctx.today });
    for (const key of ['summary', 'blocked', 'on-hold', 'overdue', 'no-owner']) {
      const x = f.find(y => y.id === `b:${key}`)!;
      add(`b:${b.id}:${key}`, key === 'summary' ? x.text : `On the board "${b.name}": ${x.text.charAt(0).toLowerCase()}${x.text.slice(1)}`, { kind: 'board', projectId: b.id }, `Board: ${b.name}`);
    }
  }
  if (!ctx.boards.length) add('boards', 'The workspace has no Delivery board yet.', portfolio);

  // ---- the process the question names, with its own record; what it cites opens in that process
  if (named) {
    for (const f of named.facts.filter(f => !f.id.startsWith('h:'))) out.push({ ...f, target: f.target.kind === 'within' ? f.target : { kind: 'within', processId: named.processId, target: f.target } });
  }
  for (const p of PLATFORM_FACTS) out.push({ id: p.id, text: p.text, label: PLATFORM_LABEL, target: { kind: 'platform', stage: p.stage } });
  return out;
}

/** The same rules and shape of answer as on a process, about the whole workspace. */
export const askWorkspace: TaskDefinition = {
  ...askProcess,
  id: 'askWorkspace',
  schemaName: 'workspace_answer',
  instructions: askProcess.instructions.split('\n').map(line => {
    if (line.startsWith('Every other segment is one fact.')) return 'Every other segment is one fact. Segments whose id starts with "h:" say how Avala OS works for every process; when a sentence relies on one, say it as how Avala OS works, never as what this workspace holds. Segments whose id starts with "ws:" are facts about this workspace: counts and totals worked out from it, one summary per process (where it stands, who is named, what is open, the assessment in short, its place in the portfolio, the applications it uses), the applications list, the people and their access, and each Delivery board in short. The counts are exact: use them rather than counting yourself. When the question names a process, the other segments are facts from that process\'s record: its model, its assessment, its requirements, its board items and passages from its source documents.';
    return line.replace(/this process's record/g, "this workspace's record").replace(/this process/g, 'this workspace');
  }).join('\n'),
};
