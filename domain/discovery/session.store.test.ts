// Package B, pull request 4a (plan `claude/package-b-pr4-plan-24-nov.md`, section 1): the in-browser store keeps
// discovery sessions by the database's rules (migration discovery_sessions), so the browser tests and the demo
// behave as the live site does. Review, 24 November 2026: every write names the version it read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../../journey/store/memoryStore.ts';
import type { JourneyStore } from '../../journey/store/types.ts';
import { commitSessionStep, emptyState, keepAnswer, readState, skip, type SessionServer } from './session.ts';

const demo = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8'));

async function open() {
  const store = createMemoryStore({ demo });
  const ws = (await store.listWorkspaces())[0]!;
  const p = (await store.listProcesses(ws.id))[0]!;
  return { store, ws, p };
}

const serverOf = (store: JourneyStore, processId: string): SessionServer => ({
  get: () => store.getDiscoverySession(processId),
  save: (id, next, version) => store.saveDiscoverySession(id, next, version),
});

test('one open session per process; the store records who started it and when, at version 1', async () => {
  const { store, ws, p } = await open();
  assert.equal(await store.getDiscoverySession(p.id), null);
  const s = (await store.startDiscoverySession(p.id, ws.id, emptyState()))!;
  assert.equal(s.version, 1);
  assert.equal(s.status, 'open');
  assert.ok(s.startedBy);
  assert.ok(Date.parse(s.startedAt) > Date.now() - 60_000);
  // A second start on the same process gives way to the first.
  assert.equal(await store.startDiscoverySession(p.id, ws.id, emptyState()), null);
  assert.equal((await store.getDiscoverySession(p.id))!.id, s.id);
});

test('a write from an older copy is refused and changes nothing; committed, the step lands on the newer copy', async () => {
  const { store, ws, p } = await open();
  const s = (await store.startDiscoverySession(p.id, ws.id, emptyState()))!;
  const a = (await store.getDiscoverySession(p.id))!;
  const b = (await store.getDiscoverySession(p.id))!;
  const at = '2026-11-24T08:00:00Z';
  assert.deepEqual(await store.saveDiscoverySession(s.id, keepAnswer({ key: 'one', words: 'By email', question: 'How?', at })(readState(a.state)), a.version), { version: 2 });
  // The second page's copy is older: refused, and the session is as the first page left it.
  assert.equal(await store.saveDiscoverySession(s.id, keepAnswer({ key: 'two', words: 'On Mondays', question: 'When?', at })(readState(b.state)), b.version), 'stale');
  const now = (await store.getDiscoverySession(p.id))!;
  assert.equal(now.version, 2);
  assert.deepEqual(now.state.waiting.map(w => w.key), ['one']);
  // Through the step, as the page does it: applied to the newer copy, both answers kept.
  const r = await commitSessionStep(serverOf(store, p.id), keepAnswer({ key: 'two', words: 'On Mondays', question: 'When?', at }));
  assert.equal(r.kind, 'saved');
  const after = (await store.getDiscoverySession(p.id))!;
  assert.equal(after.version, 3);
  assert.deepEqual(after.state.waiting.map(w => w.key), ['one', 'two']);
});

test('a finished session is never changed, and a new one can start on the process', async () => {
  const { store, ws, p } = await open();
  const s = (await store.startDiscoverySession(p.id, ws.id, emptyState()))!;
  assert.equal(await store.finishDiscoverySession(s.id, 0), 'stale');
  assert.deepEqual(await store.finishDiscoverySession(s.id, 1), { version: 2 });
  assert.equal(await store.getDiscoverySession(p.id), null);
  assert.equal(await store.saveDiscoverySession(s.id, emptyState(), 2), 'finished');
  assert.equal(await store.finishDiscoverySession(s.id, 2), 'finished');
  assert.deepEqual(await commitSessionStep(serverOf(store, p.id), skip('x')), { kind: 'gone' });
  const again = (await store.startDiscoverySession(p.id, ws.id, emptyState()))!;
  assert.notEqual(again.id, s.id);
});

test('a state past 256 KB is refused as full, and nothing is written', async () => {
  const { store, ws, p } = await open();
  const s = (await store.startDiscoverySession(p.id, ws.id, emptyState()))!;
  const big = keepAnswer({ key: 'big', words: 'x'.repeat(262_200), question: 'Q?', at: 't' })(emptyState());
  assert.equal(await store.saveDiscoverySession(s.id, big, 1), 'full');
  assert.deepEqual(await commitSessionStep(serverOf(store, p.id), keepAnswer({ key: 'big', words: 'x'.repeat(262_200), question: 'Q?', at: 't' })), { kind: 'full' });
  const now = (await store.getDiscoverySession(p.id))!;
  assert.equal(now.version, 1);
  assert.deepEqual(now.state.waiting, []);
});
