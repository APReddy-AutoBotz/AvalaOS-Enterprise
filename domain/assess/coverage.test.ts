import test from 'node:test';
import assert from 'node:assert/strict';
import { apiCovers, coverageNotice, operationCovers, partsOf, showsCoverageNotice } from './coverage.ts';
import type { AccessMethod, Step } from '../processModel/types.ts';

test('an operation covers a step only with the same action and the same thing (F09)', () => {
  assert.equal(operationCovers('Read supplier', 'Update supplier'), false, 'the review\'s case');
  assert.equal(operationCovers('Update supplier', 'Update supplier bank details'), true);
  assert.equal(operationCovers('Change supplier', 'Update supplier'), true, 'equal verbs count');
  assert.equal(operationCovers('post supplier invoice', 'Post invoice and attach PDF'), true);
  assert.equal(operationCovers('create supplier invoice', 'Enter PO invoice'), true, 'enter and create name the same action');
  assert.equal(operationCovers('read mail', 'Log invoice'), false);
  assert.equal(operationCovers('MIRO', 'Enter PO invoice'), false, 'a transaction code names no action');
  assert.equal(operationCovers('read invoices', 'Check invoice'), true, 'a plural counts as its singular');
  assert.equal(operationCovers('read invoicing data', 'Check invoice'), false, 'no word stems');
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

test('the words of a name: actions and things', () => {
  const p = partsOf('Read the invoices for all suppliers');
  assert.deepEqual([...p.actions], ['read']);
  assert.deepEqual([...p.things].sort(), ['invoice', 'supplier']);
});

test('the screens say the rule changed until the end of January 2027', () => {
  assert.equal(showsCoverageNotice(new Date('2026-11-19T00:00:00Z')), true);
  assert.equal(showsCoverageNotice(new Date('2027-02-01T00:00:00Z')), false);
});

test('what a person sees where the rule changed a process\'s figures, approved revisions included', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  assert.equal(coverageNotice({ steps: 0, systems: [] }, 'assessment', now), null, 'nothing changed: nothing to say');
  const n = { steps: 2, systems: ['SAP S/4HANA', 'Shared AP mailbox'] };
  assert.match(coverageNotice(n, 'assessment', now)!, /^Since 18 November 2026 .* changes 2 steps, where the API of SAP S\/4HANA and Shared AP mailbox no longer/);
  assert.match(coverageNotice(n, 'documents', now)!, /approved revision too/);
  assert.equal(coverageNotice(n, 'card', now), 'Figures changed on 18 November 2026: a stricter API rule applies to 2 steps.');
  assert.equal(coverageNotice(n, 'card', new Date('2027-02-01T00:00:00Z')), null);
});
