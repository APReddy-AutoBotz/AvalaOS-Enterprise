import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressName, checkName, NAME_MAX, NAME_WORDS, nameFromAddress } from './name.ts';

// The same cases as supabase/tests/own_display_name.sql, groups 1 to 3.
test('a name is trimmed and kept; empty, too long and an email address are refused in plain words', () => {
  assert.deepEqual(checkName('   Ann  Reddy   '), { ok: true, name: 'Ann  Reddy', reason: '' });
  assert.deepEqual(checkName('A'), { ok: true, name: 'A', reason: '' });
  assert.deepEqual(checkName('b'.repeat(NAME_MAX)), { ok: true, name: 'b'.repeat(80), reason: '' });
  assert.deepEqual(checkName("Siobhán O'Brien-Núñez"), { ok: true, name: "Siobhán O'Brien-Núñez", reason: '' });
  assert.deepEqual(checkName(''), { ok: false, name: '', reason: NAME_WORDS.empty });
  assert.deepEqual(checkName('    '), { ok: false, name: '', reason: NAME_WORDS.empty });
  assert.deepEqual(checkName('a'.repeat(81)), { ok: false, name: '', reason: NAME_WORDS.long });
  assert.deepEqual(checkName('ann@example.com'), { ok: false, name: '', reason: NAME_WORDS.email });
  assert.deepEqual(checkName('Ann <ann@x.com>'), { ok: false, name: '', reason: NAME_WORDS.email });
  assert.deepEqual(checkName('a@b.c'), { ok: false, name: '', reason: NAME_WORDS.email });
});

test('characters are counted as the database counts them, not as UTF-16 units', () => {
  // Eighty emoji are 160 UTF-16 units but 80 characters, as Postgres's char_length counts them.
  assert.equal(checkName('😀'.repeat(80)).ok, true);
  assert.equal(checkName('😀'.repeat(81)).ok, false);
});

test('a name still made from the address is noticed, and nothing else is', () => {
  assert.equal(addressName('mailtoapreddy@example.com'), 'mailtoapreddy');
  assert.equal(nameFromAddress('mailtoapreddy', 'mailtoapreddy@example.com'), true);
  assert.equal(nameFromAddress('', 'ann@example.com'), true);
  assert.equal(nameFromAddress(null, 'ann@example.com'), true);
  assert.equal(nameFromAddress('Ann Reddy', 'ann@example.com'), false);
  assert.equal(nameFromAddress('ann', 'ann.reddy@example.com'), false);
});
