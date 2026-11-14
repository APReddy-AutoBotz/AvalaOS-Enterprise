import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { adoptApplication } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { ApplicationError, applicationFromSystem, applicationOffer, applicationSummary, matchApplication, nameKey, parseAliases, validateApplication, type Application, type ApplicationInput } from './applications.ts';

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

// ---------------------------------------------------------------- the list and a process

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const sap = () => gold.systems.find(s => s.id === 'sys-sap')!;

test('a system taken from a process brings only what a source states or a person confirmed', () => {
  const a = applicationFromSystem(sap());
  assert.equal(a.name, 'SAP S/4HANA');
  assert.equal(a.kind, sap().kind);
  assert.ok(a.access.every(x => x.access !== 'unknown'), 'unknown ways in stay behind');
  assert.ok(a.access.some(x => x.name === 'API_PURCHASEORDER_PROCESS_SRV' && x.access === 'confirmed'));
  assert.ok(!('sources' in a.access[0]), 'no source references on the list');
  const inferred = { ...sap(), access: sap().access.map(x => ({ ...x, status: 'inferred' as const })) };
  assert.deepEqual(applicationFromSystem(inferred).access, []);
  // The same facts back on the process: nothing to offer.
  assert.deepEqual(applicationOffer(sap(), { id: 'x', ...a }), []);
});

test('the list\'s entry offers what differs, in words, and accepting it changes the recommendation', () => {
  const entry: Application = { id: 'x', name: 'SAP S/4HANA', aliases: ['SAP'], kind: 'erp', notes: '', uiAllowed: null, remote: false,
    access: [
      { method: 'api', name: 'API_SUPPLIERINVOICE_PROCESS_SRV', operations: ['post supplier invoice', 'park supplier invoice'], access: 'confirmed' },
      { method: 'api', name: 'API_MATERIAL_DOCUMENT_SRV', operations: [], access: 'confirmed' },
      { method: 'file', name: 'Payment run export', operations: [], access: 'confirmed' },
    ] };
  const lines = applicationOffer(sap(), entry);
  assert.deepEqual(lines, [
    'API API_SUPPLIERINVOICE_PROCESS_SRV: reported, not confirmed becomes confirmed available',
    'API API_SUPPLIERINVOICE_PROCESS_SRV: add the operation park supplier invoice',
    'API API_MATERIAL_DOCUMENT_SRV: unknown becomes confirmed available',
    'Add File Payment run export: confirmed available',
    'Not reached through a remote desktop',
  ]);
  const next = adoptApplication(gold, { systemId: 'sys-sap', app: entry }).model;
  const sys = next.systems.find(s => s.id === 'sys-sap')!;
  const inv = sys.access.find(a => a.name === 'API_SUPPLIERINVOICE_PROCESS_SRV')!;
  assert.deepEqual([inv.access, inv.status, inv.sources.length > 0], ['confirmed', 'user-confirmed', true], 'the sources stay; the status is a person\'s');
  assert.deepEqual(sys.remote, { value: false, status: 'user-confirmed', sources: [] });
  assert.deepEqual(applicationOffer(sys, entry), [], 'accepted: nothing left to offer');
  const moved = assessProcess(next).steps.filter(s => s.winner !== assessProcess(gold).steps.find(o => o.stepId === s.stepId)!.winner);
  assert.ok(moved.length > 0, 'a confirmed API moves at least one step');
  // Other systems are untouched.
  assert.deepEqual(next.systems.filter(s => s.id !== 'sys-sap'), gold.systems.filter(s => s.id !== 'sys-sap'));
});
