// Scores an extracted Process Model against a hand-checked gold model.
// Pure: no file or network access. eval/run.ts loads the files.
import type { ProcessModel } from '../domain/processModel/types.ts';

export interface Targets {
  stepRecall: number;
  stepPrecision: number;
  roleAccuracy: number;
  systemAccuracy: number;
  verifiedExcerptRate: number;
  openQuestionRecall: number;
  apiOverclaims: number; // maximum allowed
}

export const DEFAULT_TARGETS: Targets = {
  stepRecall: 0.9,
  stepPrecision: 0.9,
  roleAccuracy: 0.85,
  systemAccuracy: 0.85,
  verifiedExcerptRate: 1,
  openQuestionRecall: 0.8,
  apiOverclaims: 0,
};

export interface Scorecard {
  stepRecall: number;
  stepPrecision: number;
  roleAccuracy: number;
  systemAccuracy: number;
  ruleRecall: number;
  exceptionRecall: number;
  metricRecall: number;
  openQuestionRecall: number;
  conflictRecall: number;
  /** Candidate elements with at least one source excerpt. */
  provenanceRate: number;
  /** Excerpts found verbatim in the source text, of those whose source text was supplied. */
  verifiedExcerptRate: number;
  excerptsChecked: number;
  /** An access method marked 'confirmed' where the gold says it is not. */
  apiOverclaims: number;
  /** Roles and systems with no counterpart in the gold. Review them: invented or legitimately extra. */
  unmatchedEntities: string[];
  missedSteps: string[];
  extraSteps: string[];
  unverifiedExcerpts: { sourceId: string; excerpt: string }[];
  overclaims: string[];
  targetResults: { name: keyof Targets; value: number; target: number; pass: boolean }[];
  pass: boolean;
}

// ---- text similarity ---------------------------------------------------------------------
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'by', 'from', 'as', 'at', 'is', 'be', 'into', 'per']);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && !STOP.has(t))
    .map(t => (t.length > 5 && t.endsWith('ing') ? t.slice(0, -3) : t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/** Dice coefficient over token sets. */
export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return (2 * common) / (x.size + y.size);
}

type Named = { id: string; name: string; aliases?: string[] };
const names = (g: Named) => [g.name, ...(g.aliases ?? [])];
const best = (text: string, g: Named) => Math.max(...names(g).map(n => similarity(text, n)));

/** One-to-one greedy matching, highest similarity first. Returns gold id -> candidate id. */
export function matchByName(gold: Named[], candidate: { id: string; name: string }[], threshold = 0.5): Map<string, string> {
  const pairs: [number, string, string][] = [];
  for (const g of gold) for (const c of candidate) {
    const s = best(c.name, g);
    if (s >= threshold) pairs.push([s, g.id, c.id]);
  }
  pairs.sort((p, q) => q[0] - p[0]);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const [, g, c] of pairs) if (!out.has(g) && !used.has(c)) { out.set(g, c); used.add(c); }
  return out;
}

const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);
const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

// ---- scoring -----------------------------------------------------------------------------
export function score(gold: ProcessModel, candidate: ProcessModel, sourceTexts: Record<string, string> = {}, targets: Targets = DEFAULT_TARGETS): Scorecard {
  const g = gold as ProcessModel & Record<string, any>;

  // Roles and systems first, so steps can be compared on them.
  const roleMap = matchByName(g.roles, candidate.roles);
  const systemMap = matchByName(g.systems, candidate.systems);
  const candRoleToGold = new Map([...roleMap].map(([gid, cid]) => [cid, gid]));
  const candSysToGold = new Map([...systemMap].map(([gid, cid]) => [cid, gid]));
  const unmatchedEntities = [
    ...candidate.roles.filter(r => !candRoleToGold.has(r.id)).map(r => `role: ${r.name}`),
    ...candidate.systems.filter(s => !candSysToGold.has(s.id)).map(s => `system: ${s.name}`),
  ];

  const stepMap = matchByName(g.steps, candidate.steps);
  const candStep = new Map(candidate.steps.map(s => [s.id, s]));
  let roleHits = 0, systemScore = 0;
  for (const [gid, cid] of stepMap) {
    const gs = g.steps.find((s: any) => s.id === gid)!;
    const cs = candStep.get(cid)!;
    const cRoles = new Set(cs.roleIds.map(r => candRoleToGold.get(r) ?? `?${r}`));
    const gRoles = new Set<string>(gs.roleIds);
    if (gRoles.size === cRoles.size && [...gRoles].every(r => cRoles.has(r))) roleHits++;
    const cSys = new Set(cs.systemIds.map(s => candSysToGold.get(s) ?? `?${s}`));
    const gSys = new Set<string>(gs.systemIds);
    const union = new Set([...cSys, ...gSys]);
    systemScore += union.size === 0 ? 1 : [...gSys].filter(s => cSys.has(s)).length / union.size;
  }

  // Rules and exceptions match on name plus condition or trigger, or on a gold alias.
  const withText = <T extends { id: string; name: string; aliases?: string[] }>(xs: T[], extra: (x: T) => string) =>
    xs.map(x => ({ id: x.id, name: `${x.name} ${extra(x)}`, aliases: [x.name, ...(x.aliases ?? [])] }));
  const ruleMap = matchByName(withText<any>(g.rules, r => r.condition), withText(candidate.rules, r => r.condition), 0.45);
  const excMap = matchByName(withText<any>(g.exceptions, x => x.trigger), withText(candidate.exceptions, x => x.trigger), 0.45);

  // Metrics: same kind and a value inside the gold value or range (5% slack).
  let metricHits = 0;
  for (const m of g.meta.metrics) {
    const lo = (m.range?.[0] ?? m.value ?? NaN) * 0.95, hi = (m.range?.[1] ?? m.value ?? NaN) * 1.05;
    const hit = candidate.meta.metrics.some(c => c.kind === m.kind && [c.value, ...(c.range ?? [])].some(v => v !== null && v !== undefined && v >= lo && v <= hi));
    if (hit) metricHits++;
  }

  const containsAll = (text: string, kws: string[]) => kws.every(k => text.toLowerCase().includes(k.toLowerCase()));
  const qTexts = candidate.openQuestions.map(q => `${q.question} ${q.whyItMatters ?? ''}`);
  const qHits = g.openQuestions.filter((q: any) => qTexts.some(t => containsAll(t, q.matchKeywords ?? tokens(q.question).slice(0, 2)))).length;
  const kTexts = candidate.conflicts.map(k => `${k.summary} ${k.values.map(v => v.value).join(' ')}`);
  const kHits = g.conflicts.filter((k: any) => kTexts.some(t => containsAll(t, k.matchKeywords ?? tokens(k.summary).slice(0, 1)))).length;

  // API overclaims: a named access method the gold does not treat as confirmed.
  const overclaims: string[] = [];
  for (const [gid, cid] of systemMap) {
    const gsys = g.systems.find((s: any) => s.id === gid)!;
    const csys = candidate.systems.find(s => s.id === cid)!;
    for (const ca of csys.access) {
      if (ca.access !== 'confirmed') continue;
      const ga = gsys.access.find((a: any) => a.method === ca.method && ((a.name && ca.name && a.name.toLowerCase() === ca.name.toLowerCase()) || (!a.name && !ca.name && similarity(a.operations.join(' '), ca.operations.join(' ')) >= 0.5)));
      if (ga && ga.access !== 'confirmed') overclaims.push(`${csys.name}: ${ca.name ?? ca.operations.join(', ')} is ${ga.access} in the gold`);
    }
  }

  // Provenance.
  const elements = [...candidate.steps, ...candidate.rules, ...candidate.exceptions, ...candidate.roles, ...candidate.systems];
  const withSource = elements.filter(e => e.sources?.some(s => s.excerpt?.trim())).length;
  const unverified: { sourceId: string; excerpt: string }[] = [];
  let checked = 0;
  const normTexts = Object.fromEntries(Object.entries(sourceTexts).map(([k, v]) => [k, normalize(v)]));
  for (const e of elements) for (const s of e.sources ?? []) {
    const text = normTexts[s.sourceId];
    if (text === undefined || !s.excerpt) continue;
    checked++;
    if (!text.includes(normalize(s.excerpt))) unverified.push({ sourceId: s.sourceId, excerpt: s.excerpt });
  }

  const card = {
    stepRecall: ratio(stepMap.size, g.steps.length),
    stepPrecision: ratio(stepMap.size, candidate.steps.length),
    roleAccuracy: ratio(roleHits, stepMap.size),
    systemAccuracy: ratio(systemScore, stepMap.size),
    ruleRecall: ratio(ruleMap.size, g.rules.length),
    exceptionRecall: ratio(excMap.size, g.exceptions.length),
    metricRecall: ratio(metricHits, g.meta.metrics.length),
    openQuestionRecall: ratio(qHits, g.openQuestions.length),
    conflictRecall: ratio(kHits, g.conflicts.length),
    provenanceRate: ratio(withSource, elements.length),
    verifiedExcerptRate: ratio(checked - unverified.length, checked),
    excerptsChecked: checked,
    apiOverclaims: overclaims.length,
    unmatchedEntities,
    missedSteps: g.steps.filter((s: any) => !stepMap.has(s.id)).map((s: any) => s.name),
    extraSteps: candidate.steps.filter(s => ![...stepMap.values()].includes(s.id)).map(s => s.name),
    unverifiedExcerpts: unverified,
    overclaims,
  };
  const targetResults = (Object.keys(targets) as (keyof Targets)[]).map(name => {
    const value = card[name];
    const target = targets[name];
    return { name, value, target, pass: name === 'apiOverclaims' ? value <= target : value >= target };
  });
  return { ...card, targetResults, pass: targetResults.every(t => t.pass) };
}
