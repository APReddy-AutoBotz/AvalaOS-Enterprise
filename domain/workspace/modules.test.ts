// Start with the part you need: the four set-ups, what each shows, and what is said when a part is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModulesError, navFor, offMessage, planOf, PLANS, stagesFor, validateModules } from './modules.ts';

test('four set-ups, in a fixed order; nothing else is accepted', () => {
  assert.deepEqual(PLANS.map(p => p.modules.join('+')), ['assess+documents+board', 'assess+documents', 'assess', 'board']);
  assert.deepEqual(validateModules(['board', 'assess', 'documents']), ['assess', 'documents', 'board']);
  assert.equal(planOf(['documents', 'assess'])?.id, 'assess-documents');
  for (const bad of [[], ['documents'], ['assess', 'board'], ['documents', 'board'], ['assess', 'billing'], ['board', 'board', 'x']]) {
    assert.throws(() => validateModules(bad), ModulesError, JSON.stringify(bad));
  }
});

test('each set-up shows its stages; work items need the documents and the board', () => {
  assert.deepEqual(stagesFor(undefined), ['sources', 'process', 'assessment', 'documents', 'flows', 'work-items']);
  assert.deepEqual(stagesFor(['assess', 'documents']), ['sources', 'process', 'assessment', 'documents', 'flows']);
  assert.deepEqual(stagesFor(['assess']), ['sources', 'process', 'assessment']);
  assert.deepEqual(stagesFor(['board']), []);
});

test('the main navigation shows a page when any of the person\'s organisations uses it', () => {
  assert.deepEqual(navFor([{ modules: ['board'] }]), { processes: false, board: true, workspaceOnly: true });
  assert.deepEqual(navFor([{ modules: ['assess'] }]), { processes: true, board: false, workspaceOnly: false });
  assert.deepEqual(navFor([{ modules: ['assess'] }, { modules: ['board'] }]), { processes: true, board: true, workspaceOnly: false });
  assert.deepEqual(navFor([]), { processes: true, board: true, workspaceOnly: false });
});

test('a part that is off says so, and that nothing was deleted', () => {
  assert.equal(offMessage('board', 'Acme'), 'The Delivery board is not switched on for Acme. Nothing has been deleted: ask the Avala OS team to switch it on.');
  assert.equal(offMessage('documents', ''), 'Documents and flows are not switched on for this organisation. Nothing has been deleted: ask the Avala OS team to switch it on.');
  assert.match(offMessage('work-items', 'Acme'), /^Work items are not switched on for Acme\./);
  assert.match(offMessage('processes', 'Acme'), /^Processes and their assessment are not switched on/);
});
