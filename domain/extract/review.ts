// The review pass sees the merged step list and returns corrections: merge a step into another,
// or remove one that is not an activity of the process. Corrections are applied here, by rule:
// merged steps pool their candidates and systems; removed steps are bypassed in the flow.
import type { CandidateSet } from './candidates.ts';
import type { MergeFlowOutput } from './assemble.ts';

export interface ReviewOutput {
  merges: { step: string; into: string; reason: string }[];
  removals: { step: string; kind: 'outcome' | 'outside_scope' | 'not_an_activity'; reason: string }[];
}

/** At most this share of the steps may be changed by one review; the rest is ignored. */
export const MAX_REVIEW_SHARE = 0.4;

const clip = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function reviewListing(flow: MergeFlowOutput, set: CandidateSet): string {
  const byId = new Map(set.items.map(c => [c.id, c]));
  const role = new Map(flow.roles.map(r => [r.key, r.name]));
  const steps = flow.steps.map(s => {
    const from = s.members.map(id => byId.get(id)).filter(Boolean).map(c => `"${clip(c!.data.name, 60)}" (${c!.sourceId})`);
    const shown = from.slice(0, 5).join(', ') + (from.length > 5 ? `, and ${from.length - 5} more` : '');
    return `${s.key} ${clip(s.name, 80)} — ${clip(s.description, 160)} | roles: ${s.roles.map(k => role.get(k) ?? k).join(', ') || '—'} | from: ${shown || '—'}`;
  });
  return [
    `STEPS IN PROCESS ORDER (${flow.steps.length})`, ...steps,
    '', 'DECISIONS', ...flow.gateways.map(g => `${g.key} ${clip(g.question, 100)}`),
    '', 'EVENTS', ...flow.events.map(e => `${e.key} ${e.kind}: ${clip(e.name, 80)}`),
  ].join('\n');
}

export function applyReview(flow: MergeFlowOutput, review: ReviewOutput): { flow: MergeFlowOutput; applied: string[]; skipped: string[] } {
  const out: MergeFlowOutput = structuredClone(flow);
  const applied: string[] = [];
  const skipped: string[] = [];
  const steps = new Map(out.steps.map(s => [s.key, s]));
  let budget = Math.floor(out.steps.length * MAX_REVIEW_SHARE);
  const mergedInto = new Map<string, string>();
  const resolve = (k: string) => { let x = k; for (let i = 0; i < 20 && mergedInto.has(x); i++) x = mergedInto.get(x)!; return x; };

  for (const m of review.merges ?? []) {
    const src = steps.get(m.step);
    const target = steps.get(resolve(m.into));
    if (!src || !target || src === target || mergedInto.has(m.step) || budget <= 0) { skipped.push(`merge ${m.step} into ${m.into}`); continue; }
    target.members = [...new Set([...target.members, ...src.members])];
    target.systems = [...new Set([...target.systems, ...src.systems])];
    if (!target.roles.length) target.roles = [...src.roles];
    mergedInto.set(src.key, target.key);
    steps.delete(src.key);
    budget--;
    applied.push(`merged "${src.name}" into "${target.name}": ${m.reason}`);
  }
  out.flows = out.flows.map(f => ({ ...f, from: resolve(f.from), to: resolve(f.to) }));

  for (const r of review.removals ?? []) {
    const s = steps.get(r.step);
    if (!s || budget <= 0) { skipped.push(`remove ${r.step}`); continue; }
    const ins = out.flows.filter(f => f.to === s.key);
    const outs = out.flows.filter(f => f.from === s.key);
    out.flows = out.flows.filter(f => f.to !== s.key && f.from !== s.key);
    for (const i of ins) for (const o of outs) out.flows.push({ from: i.from, to: o.to, label: i.label || o.label });
    steps.delete(s.key);
    budget--;
    applied.push(`removed "${s.name}" (${r.kind}): ${r.reason}`);
  }

  out.steps = out.steps.filter(s => steps.has(s.key));
  const seen = new Set<string>();
  out.flows = out.flows.filter(f => {
    const k = `${f.from}>${f.to}`;
    if (f.from === f.to || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { flow: out, applied, skipped };
}
