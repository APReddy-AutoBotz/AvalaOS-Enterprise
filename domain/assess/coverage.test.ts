import test from 'node:test';
import assert from 'node:assert/strict';
import { apiCovers, COVERAGE_RULE, coverageNotice, operationCovers, partsOf, showsCoverageNotice } from './coverage.ts';
import type { AccessMethod, Step } from '../processModel/types.ts';

test('an operation covers a step only with the same action and the same thing (F09)', () => {
  assert.equal(operationCovers('Read supplier', 'Update supplier'), false, 'the review\'s case');
  assert.equal(operationCovers('Update supplier', 'Update supplier bank details'), true);
  assert.equal(operationCovers('Change supplier', 'Update supplier'), true, 'equal verbs count');
  assert.equal(operationCovers('post supplier invoice', 'Post invoice and attach PDF'), true);
  assert.equal(operationCovers('create supplier invoice', 'Enter PO invoice'), false, '"enter" is not in the table: it matches only itself');
  assert.equal(operationCovers('read mail', 'Log invoice'), false);
  assert.equal(operationCovers('MIRO', 'Enter PO invoice'), false, 'a transaction code names no action');
  assert.equal(operationCovers('read invoices', 'Read invoice'), true, 'a plural counts as its singular');
  assert.equal(operationCovers('read invoicing data', 'Read invoice'), false, 'no word stems');
  assert.equal(operationCovers('Scan paper invoices', 'Scan paper invoice'), true, 'a verb outside the table matches itself');
  assert.equal(operationCovers('Scan documents', 'Archive paper invoice'), false);
});

test('a person who confirms an API without listing its operations has confirmed it for the process', () => {
  const step = { id: 's', name: 'Anything at all', description: '' } as Step;
  const a = (status: string, operations: string[]) => ({ method: 'api', access: 'confirmed', status, operations, sources: [] }) as unknown as AccessMethod;
  assert.equal(apiCovers(a('user-confirmed', []), step), true);
  assert.equal(apiCovers(a('stated', []), step), false);
  assert.equal(apiCovers(a('user-confirmed', ['read mail']), step), false);
});

test('the words of a name: the action is the first word, the rest are things', () => {
  const p = partsOf('Read the invoices for all suppliers');
  assert.equal(p.action, 'read');
  assert.deepEqual([...p.things].sort(), ['invoice', 'supplier']);
});

test('a noun that is also a verb is a thing, not an action (owner, 18 November 2026)', () => {
  assert.equal(operationCovers('Create vendor', 'Update vendor record'), false, '"record" is the thing updated, not a second action');
  assert.equal(operationCovers('Read vendor email', 'Email vendor'), false, '"email" in the operation is a thing');
  assert.equal(operationCovers('record vendor details', 'Record vendor'), true, 'record as the first word is the action, matching itself');
  // Each word of the table that is also a noun: as the first word an action, anywhere else a thing.
  for (const w of ['list', 'log', 'post', 'set', 'change', 'check', 'query', 'return', 'release', 'match', 'record', 'email', 'open', 'new', 'book', 'export', 'reply', 'share']) {
    const later = partsOf(`read ${w} details`);
    assert.equal(later.action, 'read', w);
    if (w.length >= 3 && w !== 'new') assert.ok(later.things.has(w), `${w} is a thing after the first word`);
    const first = partsOf(`${w} details`);
    assert.notEqual(first.action, null, w);
  }
  assert.equal(operationCovers('read the post list', 'Post invoice'), false);
  assert.equal(operationCovers('read price list', 'List prices'), false, '"list" is not in the table');
  assert.equal(operationCovers('read the change log', 'Log invoice'), false);
  assert.equal(operationCovers('get release notes', 'Release payment'), false);
  assert.equal(operationCovers('read match results', 'Match invoice to PO'), false);
});

test('only verbs with one plain meaning are equal (owner, 18 November 2026)', () => {
  assert.equal(operationCovers('Create invoice', 'Open invoice'), false, 'opening may be viewing');
  assert.equal(operationCovers('Delete order', 'Close order'), false, 'closing is not deleting');
  assert.equal(operationCovers('Create invoice', 'Post invoice in SAP'), false, 'posting is not creating');
  assert.equal(operationCovers('Add invoice', 'Create invoice'), true);
  assert.equal(operationCovers('Change vendor', 'Update vendor bank details'), true);
});

test('a step\'s own name, as a person\'s yes records it, covers that step', () => {
  assert.equal(operationCovers('Approval', 'Approval'), true, 'even a name with no thing after its first word');
  assert.equal(operationCovers('Scan paper invoice', 'Scan paper invoice'), true);
});

test('the screens say the rule changed until the end of January 2027', () => {
  assert.equal(showsCoverageNotice(new Date('2026-11-19T00:00:00Z')), true);
  assert.equal(showsCoverageNotice(new Date('2027-02-01T00:00:00Z')), false);
});

test('what a person sees where the rule changed a process\'s figures, approved revisions included', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  assert.equal(coverageNotice({ steps: 0, systems: [] }, 'assessment', now), null, 'nothing changed: nothing to say');
  const n = { steps: 2, systems: ['SAP S/4HANA', 'Shared AP mailbox'] };
  assert.equal(coverageNotice(n, 'assessment', now), 'Since [release date], an application\'s API counts for a step only when one of its listed operations does that step\'s work: the same action on the same thing. For this process, 2 steps are no longer counted as covered by the API of SAP S/4HANA and Shared AP mailbox, so the figures may differ from before. If the API does do that work, answer yes to the question on that step and it will count again.');
  assert.match(coverageNotice(n, 'documents', now)!, /it will count again\. These documents are rebuilt each time they are opened, so this applies to an approved revision too\.$/);
  assert.equal(coverageNotice(n, 'card', now), 'Figures changed on [release date]: a stricter API rule applies to 2 steps.');
  assert.match(coverageNotice({ steps: 1, systems: ['SAP'] }, 'assessment', now)!, /1 step is no longer counted/);
  assert.equal(coverageNotice(n, 'card', new Date('2027-02-01T00:00:00Z')), null);
  COVERAGE_RULE.since = '25 November 2026';
  try { assert.equal(coverageNotice(n, 'card', now), 'Figures changed on 25 November 2026: a stricter API rule applies to 2 steps.', 'the release sets the date'); }
  finally { COVERAGE_RULE.since = null; }
});
