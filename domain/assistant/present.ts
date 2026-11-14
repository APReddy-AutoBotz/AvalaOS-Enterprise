// How an answer is laid out in the panel, by rule (the owner approved the format on 14 November 2026):
// the sources as compact chips, one action that opens where most of the answer's facts live, and two
// questions to ask next. Nothing here is written by the AI: the action and the questions come from which
// facts the answer cited, so every suggestion is one the record can answer.
import type { Answer, Fact, Target } from './ask.ts';
import { STAGES, type StageId } from '../workspace/route.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { APPROACH_LABEL, FIT, scoreOf, type Approach } from '../assess/scoring.ts';

/** The facts an answer cites, once each, in the order they first appear (the numbers the panel shows). */
export function citedFacts(answer: Answer): Fact[] {
  return [...new Map(answer.sentences.map(s => [s.fact.id, s.fact])).values()];
}

export type Place = StageId | 'board' | 'open-process' | 'applications' | 'people' | 'portfolio';
/** Where a fact lives on screen: a stage of the process, the board, a page of the workspace, or nowhere to open (a source passage). */
export function placeOf(t: Target): Place | null {
  switch (t.kind) {
    case 'step': case 'process': return 'process';
    case 'assessment': return 'assessment';
    case 'requirement': return 'documents';
    case 'platform': return t.stage;
    case 'item': case 'board': return 'board';
    case 'open-process': case 'applications': case 'people': case 'portfolio': return t.kind;
    case 'within': return placeOf(t.target);
    default: return null;
  }
}

const OPEN: Record<Place, string> = {
  sources: 'Open the sources', process: 'Open the process steps', assessment: 'Open the assessment', documents: 'Open the documents',
  flows: 'Open the flows', 'work-items': 'Open the work items', board: 'Open the board item',
  'open-process': 'Open the process', applications: 'Open the applications list', people: 'Open People', portfolio: 'Open the processes',
};
const isStage = (p: Place): p is StageId => STAGES.some(s => s.id === p);

/** Places by how many cited facts live there, most first; ties keep the order they were first cited. */
function placesOf(answer: Answer, stages: StageId[]): Place[] {
  const count = new Map<Place, number>();
  for (const f of citedFacts(answer)) {
    const p = placeOf(f.target);
    if (p && (!isStage(p) || stages.includes(p))) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** One next step: open the place most of the answer's facts come from. None when nothing cited can be opened. */
export function answerAction(answer: Answer, stages: StageId[]): { label: string; target: Target } | null {
  const best = placesOf(answer, stages)[0];
  if (!best) return null;
  const fact = citedFacts(answer).find(f => placeOf(f.target) === best)!;
  const inner = fact.target.kind === 'within' ? fact.target.target : fact.target;
  return { label: inner.kind === 'board' ? 'Open the board' : OPEN[best], target: fact.target };
}

/** Questions the record can answer, by where the cited facts live. */
const NEXT: Record<Place | 'none', string[]> = {
  assessment: ['Which steps stay with people, and why?', 'What could rule-based RPA alone do across this process?', 'What would change the recommendation?'],
  process: ['Who does each step today?', 'Which exceptions does this process have?'],
  documents: ['Which requirements are human checks?', 'Which requirements come from exceptions?'],
  flows: ['Does the As-Is map change when the approach changes?', 'What does the To-Be map follow?'],
  'work-items': ['Which board items have no owner?', 'Which work is still to do?'],
  board: ['Which board items have no owner?', 'Which work is still to do?'],
  sources: ['What is still unknown about this process?'],
  none: ['What is still unknown about this process?', 'Why is this the recommended approach?'],
  'open-process': ['Which processes have no approver named?', 'What is open across the workspace?'],
  portfolio: ['Which processes are quick wins?', 'Which processes carry most of the hours?'],
  applications: ['Which applications are on the list, and how are they reached?', 'Which processes use each application?'],
  people: ['Who are the admins of this workspace?', 'Which processes have no analyst named?'],
};
/** When the answer's facts lead nowhere in particular, by what is asked about. */
const FALLBACK: Record<'process' | 'board' | 'workspace', string[]> = {
  process: NEXT.none,
  board: ['What is blocked or overdue?', 'Which open items have no owner?', 'What is in progress, and who owns it?'],
  workspace: ['Which processes are quick wins?', 'Which processes have no approver named?', 'What is open across the workspace?'],
};

/** Two questions to ask next, none already asked in the panel, from where this answer's facts live. */
export function followUps(answer: Answer, asked: string[], stages: StageId[], max = 2, scope: 'process' | 'board' | 'workspace' = 'process'): string[] {
  const seen = new Set(asked.map(q => q.trim().toLowerCase()));
  const out: string[] = [];
  // On the board or the workspace, a process stage's questions ("…about this process") would not fit.
  const places = placesOf(answer, stages).filter(p => scope === 'process' || !isStage(p));
  for (const list of [...places.map(p => NEXT[p]), FALLBACK[scope]]) {
    for (const q of list) {
      if (out.length >= max) return out;
      if (!seen.has(q.toLowerCase()) && !out.includes(q)) out.push(q);
    }
  }
  return out;
}

/** The stages in the order the process page shows them, for labels. */
export const STAGE_ORDER: StageId[] = STAGES.map(s => s.id);

// ---- Key figures, computed by rule -------------------------------------------------------------


export interface Tile { label: string; value: string; note?: string }

/**
 * Figures to show beside an answer, worked out from the assessment, never taken from the AI's words: when
 * the answer cites what one approach alone could do (`a:only:<approach>`), how many steps it could do and
 * how many it could not; when it cites the verdict, how the steps people do today would be done. The same
 * counts as the facts the answer quotes (singleApproachFacts, the assessment's split).
 */
export function figureTiles(answer: Answer, a: ProcessAssessment | null | undefined): Tile[] {
  if (!a) return [];
  const ids = new Set(citedFacts(answer).map(f => f.id));
  const scored = a.steps.filter(s => !s.alreadyAutomated);
  const only = [...ids].find(id => id.startsWith('a:only:'));
  if (only && scored.length) {
    const approach = only.slice('a:only:'.length) as Approach;
    const fits = scored.filter(s => scoreOf(s, approach) >= FIT.possible).length;
    return [
      { label: `${APPROACH_LABEL[approach]} alone could do`, value: `${fits} of ${scored.length} steps` },
      { label: 'It could not do', value: `${scored.length - fits} ${scored.length - fits === 1 ? 'step' : 'steps'}`, note: 'the reasons are in the answer' },
    ];
  }
  if (ids.has('a:verdict') && scored.length) {
    const c = a.counts;
    return [
      { label: 'By rules (RPA or an API)', value: String(c.rpa + c.api) },
      { label: 'With AI', value: String(c.ai_assist + c.agent) },
      { label: 'Stay with people', value: String(c.human) },
    ];
  }
  return [];
}
