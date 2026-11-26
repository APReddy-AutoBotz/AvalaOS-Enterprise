// "Make it a requirement" on what a person wants to change (package B, pull request 5b; decision 1 of the plan of
// 23 November 2026). A wanted statement (`meta.wanted`) becomes one business requirement in the register, with
// origin `user`: its statement as the person kept it, linked to the wanted entry by its key. Nothing is derived
// from it and nothing else moves: the As-Is map and the PDD's steps never read it. The BRD lists it with the
// business requirements, the FRD counts it and traces to it, and `reconcile` keeps it as it keeps any user row.
import type { WantedStatement } from '../processModel/types.ts';
import type { StoredRequirement } from './register.ts';

/** The register's key for a requirement made from a wanted entry. */
export const wantedKey = (w: Pick<WantedStatement, 'id'>) => `wanted:${w.id}`;

/** Whether the wanted entry is already a requirement. */
export const isRequirement = (w: Pick<WantedStatement, 'id'>, stored: readonly StoredRequirement[]) => stored.some(r => r.key === wantedKey(w));

/** The requirement row: the next business requirement code, never reused, after every stored one. */
export function requirementFromWanted(w: WantedStatement, stored: readonly StoredRequirement[]): StoredRequirement {
  const next = Math.max(0, ...stored.filter(r => r.kind === 'BR').map(r => Number(r.code.split('-')[1]) || 0)) + 1;
  const statement = w.statement.trim();
  return {
    code: `BR-${String(next).padStart(3, '0')}`,
    kind: 'BR',
    key: wantedKey(w),
    category: 'user',
    title: statement.length > 80 ? `${statement.slice(0, 77).trimEnd()}…` : statement,
    statement,
    rationale: 'What a person wants to change, kept in a discovery session.',
    priority: null,
    acceptance: [],
    stepIds: [], ruleIds: [], exceptionIds: [], traces: [], gaps: [],
    origin: 'user',
    edited: false,
    state: 'active',
    order: stored.length,
    baseHash: null,
  };
}
