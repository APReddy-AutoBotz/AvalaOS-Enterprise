// Pass-1 results become numbered candidates. Each keeps the quote it came from and where that
// quote is, so whatever the merge passes group, the model can cite it.
import type { SourceLocator, SourceRef } from '../processModel/types.ts';
import type { IngestSegment } from '../ingest/segment.ts';

export interface SourceInfo { sourceId: string; title: string; kind: string }

export type CandidateKind = 'role' | 'system' | 'interface' | 'rule' | 'exception' | 'metric' | 'unknown' | 'step' | 'decision';
const PREFIX: Record<CandidateKind, string> = { role: 'R', system: 'Y', interface: 'I', rule: 'B', exception: 'X', metric: 'M', unknown: 'U', step: 'S', decision: 'D' };

export interface Candidate<T = Record<string, any>> {
  id: string;
  kind: CandidateKind;
  sourceId: string;
  /** Position within its source, for order. */
  order: number;
  ref: SourceRef;
  data: T;
}

export interface CandidateSet {
  sources: SourceInfo[];
  items: Candidate[];
}

/** Pass-1 output for one source, after unverifiable quotes were dropped. */
export interface SourcePassOutput {
  sourceId: string;
  facts: { roles: any[]; systems: any[]; interfaces: any[]; rules: any[]; exceptions: any[]; metrics: any[]; unknowns: any[] };
  steps: { steps: any[]; decisions: any[] };
}

export function buildCandidates(sources: SourceInfo[], outputs: SourcePassOutput[], segments: IngestSegment[]): CandidateSet {
  const locator = new Map<string, SourceLocator>(segments.map(s => [s.id, s.locator]));
  const counters: Record<string, number> = {};
  const items: Candidate[] = [];
  const add = (kind: CandidateKind, sourceId: string, order: number, raw: any) => {
    const loc = locator.get(raw.segmentId);
    if (!loc) return; // quote verification already drops unknown segments; be safe
    counters[kind] = (counters[kind] ?? 0) + 1;
    const { segmentId: _s, excerpt, ...data } = raw;
    items.push({ id: `${PREFIX[kind]}${counters[kind]}`, kind, sourceId, order, ref: { sourceId, locator: { ...loc }, excerpt: String(excerpt).trim() }, data });
  };
  for (const src of sources) {
    const out = outputs.find(o => o.sourceId === src.sourceId);
    if (!out) continue;
    out.facts.roles.forEach((x, i) => add('role', src.sourceId, i, x));
    out.facts.systems.forEach((x, i) => add('system', src.sourceId, i, x));
    out.facts.interfaces.forEach((x, i) => add('interface', src.sourceId, i, x));
    out.facts.rules.forEach((x, i) => add('rule', src.sourceId, i, x));
    out.facts.exceptions.forEach((x, i) => add('exception', src.sourceId, i, x));
    out.facts.metrics.forEach((x, i) => add('metric', src.sourceId, i, x));
    out.facts.unknowns.forEach((x, i) => add('unknown', src.sourceId, i, x));
    out.steps.steps.forEach((x, i) => add('step', src.sourceId, i, x));
    out.steps.decisions.forEach((x, i) => add('decision', src.sourceId, i, x));
  }
  return { sources, items };
}

const clip = (s: unknown, n = 220) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.join(', ') : '—');
const range = (m: any) => (m.low !== null && m.high !== null ? `${m.low} to ${m.high}` : m.value !== null ? String(m.value) : '?');

export function formatMetric(m: any): string {
  return `${range(m)} ${m.unit ?? ''}`.trim();
}

function header(set: CandidateSet): string {
  return ['SOURCES', ...set.sources.map(s => `${s.sourceId}: ${s.title} (${s.kind})`)].join('\n');
}

function section(set: CandidateSet, kind: CandidateKind, title: string, line: (c: Candidate) => string): string {
  const xs = set.items.filter(c => c.kind === kind);
  return [`${title} (${xs.length})`, ...xs.map(c => `${c.id} [${c.sourceId} #${c.order + 1}] ${line(c)}`)].join('\n');
}

/** The candidate listing for merge_flow. */
export function flowListing(set: CandidateSet): string {
  return [
    header(set),
    section(set, 'role', 'ROLES', c => `${clip(c.data.name, 80)} (${c.data.kind})`),
    section(set, 'system', 'SYSTEMS', c => `${clip(c.data.name, 80)} (${c.data.kind})`),
    section(set, 'step', 'STEPS', c => `${clip(c.data.name, 80)} — ${clip(c.data.description)} | actors: ${list(c.data.actors)} | systems: ${list(c.data.systems)} | type: ${c.data.taskType}`),
    section(set, 'decision', 'DECISIONS', c => `${clip(c.data.question, 120)} → ${(c.data.outcomes ?? []).map((o: any) => `${clip(o.label, 30)}: ${clip(o.then, 80)}`).join('; ')}`),
  ].join('\n\n');
}

/** The candidate listing for merge_facts. Step names are context only. */
export function factsListing(set: CandidateSet): string {
  const stepNames = [...new Set(set.items.filter(c => c.kind === 'step').map(c => String(c.data.name)))];
  return [
    header(set),
    section(set, 'rule', 'RULES', c => `${clip(c.data.name, 80)}: if ${clip(c.data.condition)} then ${clip(c.data.action)}`),
    section(set, 'exception', 'EXCEPTIONS', c => `${clip(c.data.name, 80)} (${c.data.kind}) | trigger: ${clip(c.data.trigger)} | handling: ${clip(c.data.handling)} | routed to: ${clip(c.data.routedTo, 60) || '—'}`),
    section(set, 'interface', 'INTERFACES', c => `${clip(c.data.system, 60)} · ${c.data.method}${c.data.name ? ` ${clip(c.data.name, 60)}` : ''} · ${list(c.data.operations)} · ${c.data.access}`),
    section(set, 'metric', 'METRICS', c => `${c.data.kind}: ${clip(c.data.label, 100)} = ${formatMetric(c.data)}${c.data.period ? ` (${clip(c.data.period, 40)})` : ''}${c.data.appliesTo ? ` [applies to ${clip(c.data.appliesTo, 60)}]` : ''}`),
    section(set, 'unknown', 'UNKNOWNS', c => clip(c.data.question)),
    ['STEP NAMES (context only)', stepNames.map(n => `- ${clip(n, 80)}`).join('\n')].join('\n'),
  ].join('\n\n');
}
