// The extraction pipeline with the AI call injected, so the edge function runs it stage by stage
// and tests run it with a fake provider.
import { verifyExcerpts, type DroppedItem, type Segment, type TaskDefinition } from '../ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../ingest/segment.ts';
import { buildCandidates, factsListing, flowListing, type CandidateSet, type SourceInfo, type SourcePassOutput } from './candidates.ts';
import { assembleModel, type MergeFactsOutput, type MergeFlowOutput } from './assemble.ts';
import { mergeFacts, mergeFlow, sourceFacts, sourceSteps } from './tasks.ts';

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

export interface MergeStageResult { flow: MergeFlowOutput; facts: MergeFactsOutput; usage: Usage }

/** Pass 2: both merges in parallel over the candidate listings. */
export async function runMergeStage(run: RunTask, set: CandidateSet): Promise<MergeStageResult> {
  const [flow, facts] = await Promise.all([run(mergeFlow, { listing: flowListing(set) }), run(mergeFacts, { listing: factsListing(set) })]);
  return { flow: flow.data as MergeFlowOutput, facts: facts.data as MergeFactsOutput, usage: addUsage(flow.usage, facts.usage) };
}

/** The whole pipeline in one call, for tests and local runs. */
export async function extractProcessModel(run: RunTask, processName: string, sources: SourceInput[]) {
  const stage1 = await Promise.all(sources.map(s => runSourceStage(run, s)));
  const set = buildCandidates(sources, stage1.map(r => r.output), sources.flatMap(s => s.segments));
  const merged = await runMergeStage(run, set);
  const { model, report } = assembleModel(processName, set, merged.flow, merged.facts);
  const usage = [...stage1.map(r => r.usage), merged.usage].reduce(addUsage, { input: 0, output: 0 });
  return { model, report: { ...report, droppedQuotes: stage1.flatMap(r => r.dropped), candidates: set.items.length }, usage };
}
