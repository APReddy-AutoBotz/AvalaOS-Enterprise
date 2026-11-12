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
  // Batches are five steps, so medium effort stays well inside the edge function's time limit.
  reasoningEffort: 'medium',
  instructions: [
    'Segments whose id starts with "step:" are cards describing the steps to assess; each lists the ids of the passages that describe it. The other segments are passages from the sources.',
    'For each step, report the traits below that its own passages state or clearly imply, each with one short verbatim quote and the id of the passage it comes from. Quote only a passage listed on that step\'s card, and only words that are about that step; never quote a "step:" card.',
    'Report nothing for a trait the passages do not settle. Do not guess, and do not carry a trait over from a neighbouring step.',
    'certainty: "stated" when the passage says it outright, "inferred" when it follows clearly but is not said.',
    'Traits and their values:',
    '- physical: "true" only when the step itself cannot be done without handling a physical object: scanning or opening paper, signing by hand, moving goods. Typing into a system, reading or sending email, saving or attaching a file, parking or posting a document in a system, and routing or requesting something are not physical: report "false" when the passage shows the step is done in a system or by email.',
    '- judgment: "true" only when the passage says a person uses discretion or holds the authority for this step: approving, deciding without a written rule, negotiating, resolving a dispute. Entering, logging, checking against a written rule or tolerance, matching, parking, posting, routing and requesting are clerical, not judgment: report "false" when the passage shows the step follows a stated rule or is clerical.',
    '- rulesComplete: "true" if the rules for the step are written out (tolerances, thresholds, matching rules, a fixed procedure); "false" only if the passages say the rules are unclear, vary by person or rely on experience.',
    '- input: what the step works from: "structured" (fields in a system, a tracker or a fixed form), "semi_structured" (emails or forms with varying layout), "unstructured" (documents or PDFs whose content has to be read), "paper".',
    '- language: "true" if the step drafts, summarises or classifies free text (writing to a vendor, reading a free-text request); "false" if it only moves or checks fields.',
    '- write: the most serious thing the step changes: "none", "record" (creates or updates a record, a file or a tracker row), "financial" (posts, pays, blocks or releases money), "irreversible" (cannot be undone).',
    '- rework: "true" if the step redoes or re-keys work already done elsewhere, or produces no output of its own.',
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

/**
 * Segments for one batch of steps: a card per step, then the passages its quotes come from, with
 * their neighbours. `owners` records which steps each passage belongs to, so a finding can only
 * quote a passage of its own step.
 */
export function traitSegments(model: ProcessModel, steps: Step[], sources: { key: string; segments: IngestSegment[] }[]): { segments: Segment[]; ingest: Map<string, IngestSegment>; owners: Map<string, Set<string>> } {
  const ingest = new Map<string, IngestSegment>();
  const owners = new Map<string, Set<string>>();
  const picked: IngestSegment[] = [];
  const passages = new Map<string, string[]>();
  for (const s of steps) {
    const mine: string[] = [];
    const add = (seg: IngestSegment | undefined) => {
      if (!seg) return;
      if (!ingest.has(seg.id)) { ingest.set(seg.id, seg); picked.push(seg); }
      const key = `${s.id}|${seg.id}`;
      owners.set(key, new Set([s.id]));
      if (!mine.includes(seg.id)) mine.push(seg.id);
    };
    for (const ref of s.sources) {
      const src = sources.find(x => x.key === ref.sourceId);
      const q = src && quoteInContext(src.segments, ref);
      if (!q) continue;
      add(q.before); add(q.segment); add(q.after);
    }
    passages.set(s.id, mine);
  }
  const cards: Segment[] = steps.map(s => {
    const roles = s.roleIds.map(id => model.roles.find(r => r.id === id)?.name).filter(Boolean).join(', ');
    const systems = s.systemIds.map(id => model.systems.find(x => x.id === id)?.name).filter(Boolean).join(', ');
    const rules = s.ruleIds.map(id => model.rules.find(r => r.id === id)).filter(Boolean).map(r => `${r!.name}: ${r!.condition} → ${r!.action}`).join('; ');
    return { id: `step:${s.id}`, text: [`Step ${s.id}: ${s.name}`, s.description, roles && `Done by: ${roles}`, systems && `Systems: ${systems}`, rules && `Rules: ${rules}`, `Passages: ${passages.get(s.id)!.join(', ') || 'none'}`].filter(Boolean).join('\n') };
  });
  return { segments: [...cards, ...toGatewaySegments(picked)], ingest, owners };
}

/** Steps in batches small enough for one AI call each. */
export function batches<T>(items: T[], size = 5): T[][] {
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
 * already checked the quote against it), and with `owners` only a passage of its own step.
 * Disagreeing findings for one trait leave it unknown.
 * Traits a person set are never changed. Returns the next model and what changed.
 */
export function applyTraitFindings(model: ProcessModel, findings: TraitFinding[], ingest: Map<string, IngestSegment>, options: { owners?: Map<string, Set<string>>; replace?: boolean } = {}): { model: ProcessModel; changes: TraitChange[] } {
  const next: ProcessModel = JSON.parse(JSON.stringify(model));
  const changes: TraitChange[] = [];
  const groups = new Map<string, { value: unknown; certainty: TraitFinding['certainty']; ref: SourceRef }[]>();
  for (const f of findings) {
    const seg = ingest.get(f.segmentId);
    if (!seg || f.segmentId.startsWith('step:') || !TRAIT_NAMES.includes(f.trait)) continue;
    // A finding may only quote a passage of its own step.
    if (options.owners && !options.owners.has(`${f.stepId}|${f.segmentId}`)) continue;
    const value = parseValue(f.trait, f.value);
    if (value === undefined) continue;
    const key = `${f.stepId}|${f.trait}`;
    groups.set(key, [...(groups.get(key) ?? []), { value, certainty: f.certainty, ref: { sourceId: seg.sourceId, locator: seg.locator, excerpt: f.excerpt } }]);
  }
  const kept = new Set<string>();
  for (const [key, list] of groups) {
    const [stepId, trait] = key.split('|') as [string, TraitKey];
    const step = next.steps.find(s => s.id === stepId);
    if (!step) continue;
    const traits: StepTraits = step.traits ?? {};
    const current = getTrait(traits, trait);
    if (current?.status === 'user-confirmed') continue;
    const values = [...new Set(list.map(x => JSON.stringify(x.value)))];
    if (values.length !== 1) continue;
    kept.add(key);
    const value = list[0].value;
    const fact: Fact<unknown> = { value, status: list.some(x => x.certainty === 'stated') ? 'stated' : 'inferred', sources: list.map(x => x.ref).filter((r, i, all) => all.findIndex(y => y.excerpt === r.excerpt && y.sourceId === r.sourceId) === i) };
    if (current && JSON.stringify(current.value) === JSON.stringify(value) && current.status === fact.status) continue;
    changes.push({ stepId, trait, from: current?.value ?? null, to: value });
    putTrait(traits, trait, fact);
    step.traits = traits;
  }
  // Reading again replaces what was read before: a trait from the sources that this reading no
  // longer supports is cleared. Traits a person set stay.
  if (options.replace) {
    for (const step of next.steps) {
      const traits = step.traits;
      if (!traits) continue;
      for (const k of TRAIT_NAMES) {
        const cur = getTrait(traits, k);
        if (!cur || cur.status === 'user-confirmed' || cur.status === 'unknown' || kept.has(`${step.id}|${k}`)) continue;
        changes.push({ stepId: step.id, trait: k, from: cur.value, to: null });
        if (k.startsWith('agent.')) delete (traits.agent as Record<string, unknown>)[k.slice(6)];
        else delete (traits as Record<string, unknown>)[k];
      }
    }
  }
  return { model: next, changes };
}
