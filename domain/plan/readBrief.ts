// Reading the brief from the sources (docs/effort-first-plan.md, part A): what this is, whether the work
// is done today, what kind of thing it is, what the team has in mind and which documents are wanted. The
// passages most likely to say so go to the `readBrief` task in journey-ai; every finding quotes one
// passage word for word, and the gateway drops a quote it cannot find. By rule here: a line on which the
// passages disagree stays unknown; a line no passage settles stays unknown ("Not stated"); a line a
// person gave or confirmed is never changed (`adoptBrief`). Nothing is guessed.
import type { Segment, TaskDefinition } from '../ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../ingest/segment.ts';
import type { DoneToday, Fact, InMind, PlannedDoc, ProcessBrief, ProcessModel, SourceRef, WorkKind } from '../processModel/types.ts';
import { DONE_TODAY, IN_MIND, PLANNED_DOCS, WORK_KINDS } from '../processModel/validate.ts';

const str = { type: 'string' } as const;

export const readBrief: TaskDefinition = {
  id: 'readBrief',
  schemaName: 'read_brief',
  reasoningEffort: 'medium',
  instructions: [
    'The segment "process" names the process and its applications. The other segments are passages from its sources: meeting transcripts, notes, requirements, procedures.',
    'Report what the passages say about the five lines below, each finding with one short verbatim quote from one passage and that passage id. Never quote the "process" segment. Report nothing for a line the passages do not settle; never answer from general knowledge.',
    'certainty: "stated" when the passage says it outright, "inferred" when it clearly follows from the passage.',
    'Lines:',
    '- summary: what this is, in one or two plain sentences in the passages\' own terms (value: the sentences). Give at most one.',
    '- doneToday: whether the work is done today, by people or systems. "yes" when a passage describes the work being done now; "partly" when some of it is done now and the rest is new; "no" when the passages describe something to be designed or built (a tool, a solution, a requirement, a future state) and none describes the work being done today. A wish, a plan or a requirement is not work done today.',
    '- kind: what kind of thing this is. "existing_process" for work done today that is to be improved or automated; "new_process" for a way of working that does not exist yet; "tool" for an application, tool, platform or chatbot to be built; "agent" for an AI agent to be built that acts on its own within limits.',
    '- inMind: an approach someone says they want, plan or expect for this work ("we want a bot to…", "the agent will…", "we plan to integrate through the API"). "rpa" for robots or bots on screens, "api" for API or system integration, "ai" for AI that assists a person (reading documents, suggesting answers, a copilot or chatbot that a person checks), "agent" for an AI agent that acts on its own. One finding per approach. An interface, API or capability that merely exists or is described is not something in mind; nor is a possibility someone rejected.',
    '- documents: a document someone asks to be produced for this work ("we need a solution design", "please prepare the PDD"). "brd" business requirements, "pdd" process definition, "frd" functional requirements or specification, "sdd" solution or technical design, "agent" an agent definition. One finding per document. A document that already exists, is quoted or is the source itself is not asked for.',
    'value: for summary, the sentences; otherwise exactly one of the listed words.',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['line', 'value', 'certainty', 'segmentId', 'excerpt'],
          properties: {
            line: { type: 'string', enum: ['summary', 'doneToday', 'kind', 'inMind', 'documents'] },
            value: str,
            certainty: { type: 'string', enum: ['stated', 'inferred'] },
            segmentId: str, excerpt: str,
          },
        },
      },
    },
  },
  maxOutputTokens: 4000,
  verifyArrays: ['findings'],
};

export interface BriefFinding { line: 'summary' | 'doneToday' | 'kind' | 'inMind' | 'documents'; value: string; certainty: 'stated' | 'inferred'; segmentId: string; excerpt: string }

/** The limits of one reading: passages sent and the characters kept of each (about 12,000 tokens in all). */
export const BRIEF_LIMITS = { passages: 50, chars: 900, openingPerSource: 4 } as const;

/** Words that mark a passage as possibly saying what this is, whether it is done today, or what is wanted. */
export const BRIEF_CUES = /\b(goal|objective|purpose|aim|scope|vision|summary|overview|today|currently|current(ly)? (process|state)|as[- ]is|to[- ]be|manual(ly)?|by hand|will (be )?(build|built|develop|design|create)|to be (built|developed|designed)|new (tool|solution|process|platform|system)|tool|solution|prototype|proof of concept|poc|pilot|requirements?|agent|agentic|bots?|rpa|robot|automat\w*|api|integrat\w*|chatbot|copilot|\bai\b|artificial intelligence|machine learning|llm|brd|frd|pdd|sdd|specification|design document|process definition)\b/i;

/**
 * The passages to read: the first few of each source (where a document says what it is about), then
 * those with a cue, in source order, at most `BRIEF_LIMITS.passages`. Empty when there is nothing to read.
 */
export function briefSegments(model: ProcessModel, sources: { key: string; title: string; segments: IngestSegment[] }[]): { segments: Segment[]; ingest: Map<string, { seg: IngestSegment; sourceKey: string }> } {
  const ingest = new Map<string, { seg: IngestSegment; sourceKey: string }>();
  const take = (seg: IngestSegment, sourceKey: string) => { if (!ingest.has(seg.id) && ingest.size < BRIEF_LIMITS.passages && seg.text.trim()) ingest.set(seg.id, { seg, sourceKey }); };
  for (const src of sources) src.segments.slice(0, BRIEF_LIMITS.openingPerSource).forEach(s => take(s, src.key));
  for (const src of sources) src.segments.filter(s => BRIEF_CUES.test(s.text)).forEach(s => take(s, src.key));
  if (!ingest.size) return { segments: [], ingest };
  const apps = model.systems.map(s => s.name).join('; ') || 'none recorded';
  const picked = [...ingest.values()].map(({ seg }) => ({ ...seg, text: seg.text.slice(0, BRIEF_LIMITS.chars) }));
  return { segments: [{ id: 'process', text: `Process: ${model.meta.name}\nApplications: ${apps}` }, ...toGatewaySegments(picked)], ingest };
}

const LISTS: Record<Exclude<BriefFinding['line'], 'summary'>, readonly string[]> = { doneToday: DONE_TODAY, kind: WORK_KINDS, inMind: IN_MIND, documents: PLANNED_DOCS };

/**
 * The brief the findings support. A finding whose passage was not sent, or whose value is not one of
 * the line's words, is dropped. One-value lines: the findings must agree, else the line stays unknown.
 * Several-value lines (in mind, documents): every value found, each with its passage. Every line no
 * finding settles is unknown, so a later reading can clear what an earlier one read.
 */
export function briefFromFindings(findings: BriefFinding[], ingest: Map<string, { seg: IngestSegment; sourceKey: string }>): ProcessBrief {
  const ok = findings.filter(f => ingest.has(f.segmentId) && f.excerpt.trim());
  const ref = (f: BriefFinding): SourceRef => { const { seg, sourceKey } = ingest.get(f.segmentId)!; return { sourceId: sourceKey, locator: seg.locator, excerpt: f.excerpt.trim() }; };
  const unknown = <T>(): Fact<T> => ({ value: null, status: 'unknown', sources: [] });
  const status = (fs: BriefFinding[]) => (fs.some(f => f.certainty === 'stated') ? 'stated' as const : 'inferred' as const);
  const of = (line: BriefFinding['line']) => ok.filter(f => f.line === line);

  const summary = of('summary').map(f => ({ ...f, value: f.value.replace(/\s+/g, ' ').trim().slice(0, 400) })).filter(f => f.value);
  const one = <T extends string>(line: 'doneToday' | 'kind'): Fact<T> => {
    const fs = of(line).map(f => ({ ...f, value: f.value.trim().toLowerCase() })).filter(f => LISTS[line].includes(f.value));
    const values = new Set(fs.map(f => f.value));
    return values.size === 1 ? { value: fs[0].value as T, status: status(fs), sources: fs.slice(0, 3).map(ref) } : unknown<T>();
  };
  const many = <T extends string>(line: 'inMind' | 'documents'): Fact<T[]> => {
    const fs = of(line).map(f => ({ ...f, value: f.value.trim().toLowerCase() })).filter(f => LISTS[line].includes(f.value));
    const values = LISTS[line].filter(v => fs.some(f => f.value === v)) as T[];
    return values.length ? { value: values, status: status(fs), sources: values.map(v => ref(fs.find(f => f.value === v)!)) } : unknown<T[]>();
  };
  return {
    summary: summary.length ? { value: summary[0].value, status: summary[0].certainty, sources: [ref(summary[0])] } : unknown<string>(),
    doneToday: one<DoneToday>('doneToday'),
    kind: one<WorkKind>('kind'),
    inMind: many<InMind>('inMind'),
    documents: many<PlannedDoc>('documents'),
  };
}
