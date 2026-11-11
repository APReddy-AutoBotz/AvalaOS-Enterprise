// A small RFC 6902 JSON Patch: apply (add, remove, replace, test) and diff.
// Edits to a Process Model are stored as JSON Patches, so the server can replay, audit and
// conflict-check them without knowing the operation that produced them.

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'test'; path: string; value: unknown };

export class JsonPatchError extends Error {
  readonly op?: JsonPatchOp;
  constructor(message: string, op?: JsonPatchOp) { super(message); this.op = op; }
}

const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const unescape = (token: string) => token.replace(/~1/g, '/').replace(/~0/g, '~');

export const pointer = (...parts: (string | number)[]) => parts.map(p => `/${escape(String(p))}`).join('');

function parse(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new JsonPatchError(`Invalid pointer ${path}`);
  return path.slice(1).split('/').map(unescape);
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter(k => (a as any)[k] !== undefined);
  const kb = Object.keys(b as object).filter(k => (b as any)[k] !== undefined);
  return ka.length === kb.length && ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (token === '-' && allowEnd) return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new JsonPatchError(`Invalid array index ${token}`);
  const i = Number(token);
  if (i > length || (!allowEnd && i === length)) throw new JsonPatchError(`Array index ${token} out of range`);
  return i;
}

/** Applies a patch to a copy of `doc`. Throws JsonPatchError and leaves `doc` untouched on failure. */
export function applyPatch<T>(doc: T, patch: JsonPatchOp[]): T {
  let root: any = clone(doc);
  for (const op of patch) {
    const tokens = parse(op.path);
    if (tokens.length === 0) {
      if (op.op === 'test') { if (!deepEqual(root, op.value)) throw new JsonPatchError('Test failed at root', op); continue; }
      if (op.op === 'remove') throw new JsonPatchError('Cannot remove the root', op);
      root = clone(op.value);
      continue;
    }
    let parent: any = root;
    for (const t of tokens.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object') throw new JsonPatchError(`Path not found: ${op.path}`, op);
      parent = Array.isArray(parent) ? parent[arrayIndex(t, parent.length, false)] : parent[t];
      if (parent === undefined) throw new JsonPatchError(`Path not found: ${op.path}`, op);
    }
    if (parent === null || typeof parent !== 'object') throw new JsonPatchError(`Path not found: ${op.path}`, op);
    const last = tokens[tokens.length - 1];
    if (Array.isArray(parent)) {
      if (op.op === 'add') parent.splice(arrayIndex(last, parent.length, true), 0, clone(op.value));
      else {
        const i = arrayIndex(last, parent.length, false);
        if (op.op === 'remove') parent.splice(i, 1);
        else if (op.op === 'replace') parent[i] = clone(op.value);
        else if (!deepEqual(parent[i], op.value)) throw new JsonPatchError(`Test failed at ${op.path}`, op);
      }
    } else {
      const has = Object.prototype.hasOwnProperty.call(parent, last);
      if (op.op === 'add') parent[last] = clone(op.value);
      else if (!has) throw new JsonPatchError(`Path not found: ${op.path}`, op);
      else if (op.op === 'remove') delete parent[last];
      else if (op.op === 'replace') parent[last] = clone(op.value);
      else if (!deepEqual(parent[last], op.value)) throw new JsonPatchError(`Test failed at ${op.path}`, op);
    }
  }
  return root;
}

/**
 * The patch that turns `a` into `b`. Objects are compared key by key. Arrays of equal length are
 * compared item by item; otherwise a single run of inserted or removed items becomes add or remove
 * operations and anything else replaces the array.
 */
export function diff(a: unknown, b: unknown, path = ''): JsonPatchOp[] {
  if (deepEqual(a, b)) return [];
  const bothObjects = a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) return [{ op: 'replace', path, value: clone(b) }];
  if (Array.isArray(a)) return diffArray(a, b as unknown[], path);
  const ops: JsonPatchOp[] = [];
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of Object.keys(ao)) {
    if (ao[k] === undefined) continue;
    if (!(k in bo) || bo[k] === undefined) ops.push({ op: 'remove', path: `${path}/${escape(k)}` });
  }
  for (const k of Object.keys(bo)) {
    if (bo[k] === undefined) continue;
    if (!(k in ao) || ao[k] === undefined) ops.push({ op: 'add', path: `${path}/${escape(k)}`, value: clone(bo[k]) });
    else ops.push(...diff(ao[k], bo[k], `${path}/${escape(k)}`));
  }
  return ops;
}

function diffArray(a: unknown[], b: unknown[], path: string): JsonPatchOp[] {
  if (a.length === b.length) return a.flatMap((x, i) => diff(x, b[i], `${path}/${i}`));
  let start = 0;
  while (start < a.length && start < b.length && deepEqual(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && deepEqual(a[endA - 1], b[endB - 1])) { endA--; endB--; }
  if (endA === start) {
    // pure insertion
    return b.slice(start, endB).map((v, i) => ({ op: 'add' as const, path: `${path}/${start + i}`, value: clone(v) }));
  }
  if (endB === start) {
    // pure removal, highest index first so each index stays valid
    const ops: JsonPatchOp[] = [];
    for (let i = endA - 1; i >= start; i--) ops.push({ op: 'remove', path: `${path}/${i}` });
    return ops;
  }
  return [{ op: 'replace', path, value: clone(b) }];
}
