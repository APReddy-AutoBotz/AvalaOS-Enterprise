// The extraction pipeline with the AI call injected, so the edge function runs it stage by stage
// and tests run it with a fake provider.
import { verifyExcerpts, type DroppedItem, type Segment, type TaskDefinition } from '../ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../ingest/segment.ts';
import { buildCandidates, factsListing, flowListing, type CandidateSet, type SourceInfo, type SourcePassOutput } from './candidates.ts';
import { assembleModel, type MergeFactsOutput, type MergeFlowOutput } from './assemble.ts';
import { FACTS_TASKS, mergeFlow, reviewFlow, sourceFacts, sourceSteps } from './tasks.ts';
import { factsProgress, joinFacts, listingKinds, splitAfter, startParts, type FactsStart } from './factsParts.ts';
import { codeOf, spentOn, TaskError } from './failure.ts';
import { applyReview, reviewListing, type ReviewOutput } from './review.ts';

export interface Usage { input: number; output: number }

/** Runs one task. `segments` for source passes, `listing` for merge passes. Throws on failure. */
export type RunTask = (task: TaskDefinition, input: { segments: Segment[] } | { listing: string }) => Promise<{ data: unknown; usage: Usage }>;

export interface SourceInput extends SourceInfo { segments: IngestSegment[] }

export interface SourceStageResult { output: SourcePassOutput; dropped: DroppedItem[]; usage: Usage }

const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output });

/** Pass 1 for one source: facts and steps in parallel, quotes checked against the segments. */
export async function runSourceStage(run: RunTask, source: SourceInput): Promise<SourceStageResult> {
  const segments = toGatewaySegments(source.segments);
  const [facts, steps] = await Promise.all([run(sourceFacts, { segments }), run(sourceSteps, { segments })]);
  const f = verifyExcerpts(facts.data, sourceFacts.verifyArrays, segments);
  const s = verifyExcerpts(steps.data, sourceSteps.verifyArrays, segments);
  return {
    output: { sourceId: source.sourceId, facts: f.data as SourcePassOutput['facts'], steps: s.data as SourcePassOutput['steps'] },
    dropped: [...f.dropped, ...s.dropped],
    usage: addUsage(facts.usage, steps.usage),
  };
}

export interface MergeStageResult { flow: MergeFlowOutput; facts: MergeFactsOutput; usage: Usage; factsParts: Record<string, unknown> }

/**
 * The facts merge in parts (factsParts.ts), as the server runs it: each part one answer; a part that is
 * cut off is replaced by smaller ones, whose answers are joined into one. A part that cannot be split
 * further throws, which stops the reading. Returns what was stored per part, split notes included.
 */
export async function runFactsMerge(run: RunTask, set: CandidateSet, start: FactsStart = 'pairs'): Promise<{ facts: MergeFactsOutput; usage: Usage; stored: Record<string, unknown> }> {
  const stored: Record<string, unknown> = {};
  let usage: Usage = { input: 0, output: 0 };
  const ask = async (part: string): Promise<void> => {
    try {
      const r = await run(FACTS_TASKS[part], { listing: factsListing(set, listingKinds(part) ?? undefined) });
      usage = addUsage(usage, r.usage);
      stored[part] = { data: r.data, usage: r.usage };
    } catch (e) {
      // Here there is no second try after a time-out; the server tries once more first.
      const children = splitAfter(part, codeOf(e), true);
      usage = addUsage(usage, spentOn(e));
      if (!children) throw e;
      stored[part] = { splitInto: children, reason: codeOf(e), usage: spentOn(e) };
      await Promise.all(children.map(ask));
    }
  };
  await Promise.all(startParts(start).map(ask));
  const progress = factsProgress(start, stored);
  return { facts: joinFacts(progress.leaves, stored), usage, stored };
}

/** Pass 2: the flow merge and the facts merge in parallel over the candidate listings. */
export async function runMergeStage(run: RunTask, set: CandidateSet, start: FactsStart = 'pairs'): Promise<MergeStageResult> {
  const [flow, facts] = await Promise.all([run(mergeFlow, { listing: flowListing(set) }), runFactsMerge(run, set, start)]);
  return { flow: flow.data as MergeFlowOutput, facts: facts.facts, usage: addUsage(flow.usage, facts.usage), factsParts: facts.stored };
}

/** Pass 3: review the merged step list. */
export async function runReviewStage(run: RunTask, flow: MergeFlowOutput, set: CandidateSet): Promise<{ review: ReviewOutput; usage: Usage }> {
  const r = await run(reviewFlow, { listing: reviewListing(flow, set) });
  return { review: r.data as ReviewOutput, usage: r.usage };
}

/** Assembly with the review applied. */
export function finish(processName: string, set: CandidateSet, flow: MergeFlowOutput, facts: MergeFactsOutput, review: ReviewOutput | null) {
  const reviewed = review ? applyReview(flow, review, set) : { flow, applied: [], skipped: [] };
  const { model, report } = assembleModel(processName, set, reviewed.flow, facts);
  return { model, report: { ...report, review: { applied: reviewed.applied, skipped: reviewed.skipped }, flowMergedAgain: false } };
}

/**
 * A reading whose sources gave steps never ends with none (27 November 2026): when the candidates hold a step
 * and the process has none, the flow merge's answer named no candidate the process could use, and the merge
 * is asked once more (`FLOW_AGAIN_PART` on the server).
 */
export const gaveNoSteps = (set: CandidateSet, model: { steps: unknown[] }) => set.items.some(c => c.kind === 'step') && model.steps.length === 0;
/** Where the server keeps the second flow merge's answer: a merge part that moves no stage on. */
export const FLOW_AGAIN_PART = 'merge:flow:again';
/** The failure when the second answer gives no step either (failure.ts says it in plain words). */
export const noStepsError = () => new TaskError('NO_STEPS: the sources gave step candidates, but no step came together after a second flow merge', { input: 0, output: 0 }, 'NO_STEPS');

/**
 * Assembly with the second flow merge's answer. The review is not applied: its keys name the first answer's
 * steps. Throws NO_STEPS when there is still no step.
 */
export function finishAgain(processName: string, set: CandidateSet, flow: MergeFlowOutput, facts: MergeFactsOutput) {
  const out = finish(processName, set, flow, facts, null);
  if (gaveNoSteps(set, out.model)) throw noStepsError();
  return { model: out.model, report: { ...out.report, flowMergedAgain: true } };
}

/** The whole pipeline in one call, for tests and local runs. */
export async function extractProcessModel(run: RunTask, processName: string, sources: SourceInput[], start: FactsStart = 'pairs') {
  const stage1 = await Promise.all(sources.map(s => runSourceStage(run, s)));
  const set = buildCandidates(sources, stage1.map(r => r.output), sources.flatMap(s => s.segments));
  const merged = await runMergeStage(run, set, start);
  const reviewed = await runReviewStage(run, merged.flow, set);
  let { model, report } = finish(processName, set, merged.flow, merged.facts, reviewed.review);
  const used = [...stage1.map(r => r.usage), merged.usage, reviewed.usage];
  if (gaveNoSteps(set, model)) {
    const again = await run(mergeFlow, { listing: flowListing(set) });
    used.push(again.usage);
    ({ model, report } = finishAgain(processName, set, again.data as MergeFlowOutput, merged.facts));
  }
  const usage = used.reduce(addUsage, { input: 0, output: 0 });
  return { model, report: { ...report, droppedQuotes: stage1.flatMap(r => r.dropped), candidates: set.items.length }, usage, factsParts: merged.factsParts };
}
