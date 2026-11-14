import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationError, applicationSummary, matchApplication, nameKey, parseAliases, validateApplication, type Application, type ApplicationInput } from './applications.ts';

const base: ApplicationInput = { name: 'SAP S/4HANA', aliases: [], kind: 'erp', access: [], uiAllowed: null, remote: null, notes: '' };
const app = (over: Partial<Application> = {}): Application => ({ id: 'a1', ...base, ...over });

test('names compare without case, spaces or punctuation', () => {
  assert.equal(nameKey('SAP S/4HANA'), nameKey('sap s4hana'));
  assert.notEqual(nameKey('SAP'), nameKey('SAP Ariba'));
});

test('validation tidies names and ways in, and drops repeated other names', () => {
  const v = validateApplication({ ...base, name: '  SAP   S/4HANA ', aliases: ['SAP', 'sap', 'S/4 HANA', 'SAP S4HANA'],
    access: [{ method: 'api', name: ' API_SUPPLIERINVOICE ', operations: ['post invoice', 'post invoice', ' '], access: 'confirmed', note: '' }] });
  assert.equal(v.name, 'SAP S/4HANA');
  assert.deepEqual(v.aliases, ['SAP', 'S/4 HANA']);
  assert.deepEqual(v.access, [{ method: 'api', name: 'API_SUPPLIERINVOICE', operations: ['post invoice'], access: 'confirmed' }]);
});

test('validation refuses a missing name, an unknown kind, and a name already on the list', () => {
  assert.throws(() => validateApplication({ ...base, name: ' ' }), ApplicationError);
  assert.throws(() => validateApplication({ ...base, kind: 'database' as never }), /kind/);
  const others = [app({ id: 'x', name: 'Workday', aliases: ['Workday Financials'] })];
  assert.throws(() => validateApplication({ ...base, name: 'workday financials' }, others), /"Workday Financials" is already on the list as another name of Workday/);
  assert.doesNotThrow(() => validateApplication({ ...base, name: 'Workday' }, others, 'x'), 'the same application, edited');
  assert.throws(() => validateApplication({ ...base, access: [{ method: 'fax' as never, operations: [], access: 'confirmed' }] }), /reached/);
});

test('a process system matches by name or other name, ignoring a name in brackets, never by part of a name', () => {
  const apps = [app({ name: 'AP shared mailbox', aliases: ['AP mailbox'] }), app({ id: 'a2', name: 'SAP S/4HANA', aliases: ['SAP'] })];
  assert.equal(matchApplication({ name: 'AP shared mailbox (Microsoft 365)' }, apps)?.id, 'a1');
  assert.equal(matchApplication({ name: 'ap mailbox' }, apps)?.id, 'a1');
  assert.equal(matchApplication({ name: 'SAP' }, apps)?.id, 'a2');
  assert.equal(matchApplication({ name: 'SAP Ariba' }, apps), null);
});

test('other names typed on one line; the summary says only what is recorded', () => {
  assert.deepEqual(parseAliases('SAP, S4 ; ECC\n'), ['SAP', 'S4', 'ECC']);
  assert.equal(applicationSummary(app()), 'Nothing recorded yet about how it is reached');
  assert.equal(applicationSummary(app({ access: [{ method: 'api', name: 'Graph', operations: [], access: 'confirmed' }, { method: 'ui', operations: [], access: 'confirmed_absent' }], uiAllowed: false, remote: true })),
    'API Graph: confirmed available; Screens: not available; robots may not use its screens; reached through a remote desktop');
});
