// Reading the assessment traits of steps from the sources.
//
// The AI sees, for a batch of steps, each step's name and the passages its quotes come from (with
// their neighbours), and reports only traits the passages support, each with a verbatim quote.
// The findings become Facts on the steps. A trait a person has set is never changed; a trait the
// sources do not settle stays unknown.
import type { Segment, TaskDefinition } from '../ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../ingest/segment.ts';
import type { Fact, InputForm, ProcessModel, SourceRef, Step, StepTraits, WriteImpact } from '../processModel/types.ts';
import { quoteInContext } from '../workspace/sources.ts';

const str = { type: 'string' } as const;

export const TRAIT_NAMES = [
  'rework', 'physical', 'judgment', 'input', 'rulesComplete', 'language', 'write', 'effortMinutes', 'sharePercent',
  'agent.ambiguity', 'agent.adaptive', 'agent.toolChoice', 'agent.value', 'agent.controllable',
] as const;
export type TraitKey = typeof TRAIT_NAMES[number];

export const stepTraits: TaskDefinition = {
  id: 'stepTraits',
  schemaName: 'step_traits',
  reasoningEffort: 'medium',
  instructions: [
    'Segments whose id starts with "step:" describe the steps to assess. The other segments are passages from the sources.',
    'For each step, report the traits below that the passages state or clearly imply, each with one short verbatim quote from a source passage (never from a "step:" segment) and its segment id.',
    'Report nothing for a trait the passages do not settle. Do not guess. Report a trait as false only when the passages say so.',
    'certainty: "stated" when the passage says it outright, "inferred" when it follows clearly but is not said.',
    'Traits and their values:',
    '- rework: "true" if the step redoes or re-keys work done elsewhere, or produces no output of its own; "false" if it clearly produces its own output.',
    '- physical: "true" if it needs a physical action (handling paper, scanning, signing, moving goods).',
    '- judgment: "true" if it needs a policy or legal judgment or a decision someone is accountable for (approvals, write-offs, disputes); "false" if it is a mechanical check.',
    '- input: "structured" (fields in a system or a fixed form), "semi_structured" (emails or forms with varying layout), "unstructured" (free documents, PDFs to read), "paper".',
    '- rulesComplete: "true" if the rules for the step are written out in full (tolerances, thresholds, matching rules); "false" if the passages say the rules are unclear, vary or rely on experience.',
    '- language: "true" if the step drafts, summarises or classifies free text (writing to vendors, reading email requests).',
    '- write: "none", "record" (updates a record), "financial" (posts, pays, blocks or releases money), "irreversible" (cannot be undone).',
    '- effortMinutes: hands-on minutes per case for this step, only when a passage gives a number for this step. Use the middle of a range.',
    '- sharePercent: the percentage of cases that go through this step, only when a passage gives it.',
    '- agent.ambiguity, agent.adaptive, agent.toolChoice, agent.value, agent.controllable: only when the passages discuss investigation work whose path cannot be fixed in advance.',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['stepId', 'trait', 'value', 'certainty', 'segmentId', 'excerpt'],
          properties: {
            stepId: str,
            trait: { type: 'string', enum: [...TRAIT_NAMES] },
            value: str,
            certainty: { type: 'string', enum: ['stated', 'inferred'] },
            segmentId: str,
            excerpt: str,
          },
        },
      },
    },
  },
  maxOutputTokens: 16000,
  verifyArrays: ['findings'],
};

export interface TraitFinding { stepId: string; trait: TraitKey; value: string; certainty: 'stated' | 'inferred'; segmentId: string; excerpt: string }

/** Segments for one batch of steps: a card per step, then the passages its quotes come from, with neighbours. */
export function traitSegments(model: ProcessModel, steps: Step[], sources: { key: string; segments: IngestSegment[] }[]): { segments: Segment[]; ingest: Map<string, IngestSegment> } {
  const ingest = new Map<string, IngestSegment>();
  const picked: IngestSegment[] = [];
  const add = (s: IngestSegment | undefined) => { if (s && !ingest.has(s.id)) { ingest.set(s.id, s); picked.push(s); } };
  const cards: Segment[] = steps.map(s => {
    const roles = s.roleIds.map(id => model.roles.find(r => r.id === id)?.name).filter(Boolean).join(', ');
    const systems = s.systemIds.map(id => model.systems.find(x => x.id === id)?.name).filter(Boolean).join(', ');
    const rules = s.ruleIds.map(id => model.rules.find(r => r.id === id)).filter(Boolean).map(r => `${r!.name}: ${r!.condition} → ${r!.action}`).join('; ');
    return { id: `step:${s.id}`, text: [`Step ${s.id}: ${s.name}`, s.description, roles && `Done by: ${roles}`, systems && `Systems: ${systems}`, rules && `Rules: ${rules}`].filter(Boolean).join('\n') };
  });
  for (const s of steps) {
    for (const ref of s.sources) {
      const src = sources.find(x => x.key === ref.sourceId);
      if (!src) continue;
      const q = quoteInContext(src.segments, ref);
      if (!q) continue;
      add(q.before); add(q.segment); add(q.after);
    }
  }
  return { segments: [...cards, ...toGatewaySegments(picked)], ingest };
}

/** Steps in batches small enough for one AI call each. */
export function batches<T>(items: T[], size = 7): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const BOOL = new Set(['rework', 'physical', 'judgment', 'rulesComplete', 'language', 'agent.ambiguity', 'agent.adaptive', 'agent.toolChoice', 'agent.value', 'agent.controllable']);
const INPUTS: InputForm[] = ['structured', 'semi_structured', 'unstructured', 'paper'];
const WRITES: WriteImpact[] = ['none', 'record', 'financial', 'irreversible'];

function parseValue(trait: TraitKey, raw: string): unknown | undefined {
  const v = raw.trim().toLowerCase();
  if (BOOL.has(trait)) return v === 'true' ? true : v === 'false' ? false : undefined;
  if (trait === 'input') return INPUTS.includes(v as InputForm) ? v : undefined;
  if (trait === 'write') return WRITES.includes(v as WriteImpact) ? v : undefined;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  if (!v || !Number.isFinite(n)) return undefined;
  if (trait === 'sharePercent' && (n < 0 || n > 100)) return undefined;
  return n;
}

const getTrait = (t: StepTraits, k: TraitKey): Fact<unknown> | undefined => (k.startsWith('agent.') ? (t.agent as any)?.[k.slice(6)] : (t as any)[k]);
function putTrait(t: StepTraits, k: TraitKey, f: Fact<unknown>) {
  if (k.startsWith('agent.')) t.agent = { ...(t.agent ?? {}), [k.slice(6)]: f } as StepTraits['agent'];
  else (t as any)[k] = f;
}

export interface TraitChange { stepId: string; trait: TraitKey; from: unknown; to: unknown }

/**
 * Writes verified findings into the model. Findings must quote a source passage (verifyExcerpts has
 * already checked the quote against it). Disagreeing findings for one trait leave it unknown.
 * Traits a person set are never changed. Returns the next model and what changed.
 */
export function applyTraitFindings(model: ProcessModel, findings: TraitFinding[], ingest: Map<string, IngestSegment>): { model: ProcessModel; changes: TraitChange[] } {
  const next: ProcessModel = JSON.parse(JSON.stringify(model));
  const changes: TraitChange[] = [];
  const groups = new Map<string, { value: unknown; certainty: TraitFinding['certainty']; ref: SourceRef }[]>();
  for (const f of findings) {
    const seg = ingest.get(f.segmentId);
    if (!seg || f.segmentId.startsWith('step:') || !TRAIT_NAMES.includes(f.trait)) continue;
    const value = parseValue(f.trait, f.value);
    if (value === undefined) continue;
    const key = `${f.stepId}|${f.trait}`;
    groups.set(key, [...(groups.get(key) ?? []), { value, certainty: f.certainty, ref: { sourceId: seg.sourceId, locator: seg.locator, excerpt: f.excerpt } }]);
  }
  for (const [key, list] of groups) {
    const [stepId, trait] = key.split('|') as [string, TraitKey];
    const step = next.steps.find(s => s.id === stepId);
    if (!step) continue;
    const traits: StepTraits = step.traits ?? {};
    const current = getTrait(traits, trait);
    if (current?.status === 'user-confirmed') continue;
    const values = [...new Set(list.map(x => JSON.stringify(x.value)))];
    if (values.length !== 1) continue;
    const value = list[0].value;
    const fact: Fact<unknown> = { value, status: list.some(x => x.certainty === 'stated') ? 'stated' : 'inferred', sources: list.map(x => x.ref).filter((r, i, all) => all.findIndex(y => y.excerpt === r.excerpt && y.sourceId === r.sourceId) === i) };
    if (current && JSON.stringify(current.value) === JSON.stringify(value) && current.status === fact.status) continue;
    changes.push({ stepId, trait, from: current?.value ?? null, to: value });
    putTrait(traits, trait, fact);
    step.traits = traits;
  }
  return { model: next, changes };
}
