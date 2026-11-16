// What is stored with an assessment (table `assessments`): a summary of the scoring and every decision a
// person made, as entries. One builder, so the Assessment stage and the Flows stage (which keeps the
// shape of the maps among the decisions) write the same record.
import type { ProcessAssessment } from './process.ts';
import { decisionsToEntries, type Decisions } from './decisions.ts';

export function assessmentResult(result: ProcessAssessment, decisions: Decisions): Record<string, unknown> {
  return {
    verdict: result.verdict, split: result.split,
    ranking: result.ranking.map(r => ({ approach: r.approach, rank: r.rank, score: r.score, stepsWon: r.stepsWon })),
    steps: result.steps.map(s => ({ stepId: s.stepId, winner: s.winner, score: s.scores[0]?.score ?? null, human: s.human })),
    decisions: decisionsToEntries(decisions),
  };
}
