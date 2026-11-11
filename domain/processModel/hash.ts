// Stable hashes of a model or of parts of it, for change detection ("needs review").
// FNV-1a 64-bit over canonical JSON: fast, synchronous, the same in the browser, Node and Deno.
// It detects change; it is not a security hash.
import type { ProcessModel } from './types.ts';
import { select, selectorKey, type Selector } from './selectors.ts';

/** JSON with object keys sorted and undefined values dropped, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function fnv1a64(text: string): string {
  let h = OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}

export const hashValue = (value: unknown): string => fnv1a64(canonicalJson(value));
export const hashModel = (m: ProcessModel): string => hashValue(m);

/** One hash per selector, keyed by the selector, for storing beside an output. */
export function hashSelections(m: ProcessModel, selectors: Selector[]): Record<string, string> {
  return Object.fromEntries(selectors.map(s => [selectorKey(s), hashValue(select(m, s))]));
}

/** The selectors whose content changed since the hashes were recorded. Empty means up to date. */
export function changedSelections(m: ProcessModel, selectors: Selector[], recorded: Record<string, string>): Selector[] {
  return selectors.filter(s => recorded[selectorKey(s)] !== hashValue(select(m, s)));
}
