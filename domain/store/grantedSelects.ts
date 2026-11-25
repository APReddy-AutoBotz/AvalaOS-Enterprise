// What the live store selects from a table a signed-in person may read only column by column (review, 25 November
// 2026: a select naming `source_ids`, which `authenticated` may not read, failed on the preview). Each list here is
// the store's own (journey/store/supabaseStore.ts imports it), checked three ways:
//   - grantedSelects.test.ts: every column is one the migrations grant, and no select on such a table is written
//     anywhere else;
//   - supabase/tests/store_selects.sql: each list, as written here, is run as a signed-in member, so a new column
//     fails in the database trial before any preview;
//   - a table the migrations give column grants must appear here.
// Change a list here, then the same list in store_selects.sql.

/** `extraction_runs`: the latest reading of a process (latestExtraction). */
export const EXTRACTION_COLUMNS = 'id, status, error, result, created_at, updated_at, input_tokens, output_tokens';

/** Every select the store makes on a table with column grants, by table. */
export const GRANTED_SELECTS: Record<string, readonly string[]> = {
  extraction_runs: [EXTRACTION_COLUMNS],
};

/** The columns of a select list. */
export const columnsOf = (list: string): string[] => list.split(',').map(c => c.trim()).filter(Boolean);

/**
 * The columns `authenticated` may select, by table, for tables whose select is granted column by column: read from
 * the migrations in order (a table-wide `revoke select … from authenticated`, then `grant select (…) on public.t
 * to authenticated`). Tables granted whole are not listed.
 */
export function columnGrants(migrations: readonly string[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const sql of migrations) {
    const flat = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    for (const m of flat.matchAll(/grant select \(([^)]*)\) on (?:table )?public\.(\w+) to [^;]*\bauthenticated\b/gi)) {
      (out[m[2]!.toLowerCase()] ??= new Set()).add('');
      for (const c of columnsOf(m[1]!)) out[m[2]!.toLowerCase()]!.add(c.toLowerCase());
    }
    for (const m of flat.matchAll(/revoke select \(([^)]*)\) on (?:table )?public\.(\w+) from [^;]*\bauthenticated\b/gi)) {
      for (const c of columnsOf(m[1]!)) out[m[2]!.toLowerCase()]?.delete(c.toLowerCase());
    }
  }
  for (const t of Object.keys(out)) out[t]!.delete('');
  return out;
}
