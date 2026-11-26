import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { columnGrants, columnsOf, EXTRACTION_COLUMNS, GRANTED_SELECTS } from './grantedSelects.ts';

const root = path.resolve(import.meta.dirname, '../..');
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'));
const grants = columnGrants(migrations);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test('the migrations grant extraction_runs column by column, without source_ids (the fault of 25 November 2026)', () => {
  assert.ok(grants.extraction_runs);
  assert.equal(grants.extraction_runs.has('source_ids'), false);
  assert.equal(grants.extraction_runs.has('token_hash'), false);
});

test('every table with column grants has its selects listed here', () => {
  assert.deepEqual(Object.keys(grants).sort(), Object.keys(GRANTED_SELECTS).sort());
});

test('every column the store selects from such a table is one a signed-in person may read', () => {
  for (const [table, lists] of Object.entries(GRANTED_SELECTS)) {
    for (const list of lists) {
      const refused = columnsOf(list).filter(c => !grants[table]!.has(c.toLowerCase()));
      assert.deepEqual(refused, [], `${table}: ${list}`);
    }
  }
  assert.equal(columnsOf(EXTRACTION_COLUMNS).includes('source_ids'), false);
});

test('no select on such a table is written outside this list (the browser code)', () => {
  for (const f of files(path.join(root, 'journey'))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const table of Object.keys(GRANTED_SELECTS)) {
      const re = new RegExp(`from\\(['"\`]${table}['"\`]\\)\\s*\\.select\\(\\s*(['"\`])`, 'g');
      assert.equal(re.test(text), false, `${path.relative(root, f)} selects from ${table} with its own list`);
    }
  }
});

test('the database test runs each list as written here', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/tests/store_selects.sql'), 'utf8');
  for (const [table, lists] of Object.entries(GRANTED_SELECTS)) {
    for (const list of lists) assert.ok(sql.includes(`('${table}', '${list}')`), `store_selects.sql lacks ${table}: ${list}`);
  }
});
