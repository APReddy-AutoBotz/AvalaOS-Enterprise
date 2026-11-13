import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPath, publicPage, TRUST_PAGES } from './pages.ts';
import { parseJourneyPath } from '../workspace/route.ts';

test('the homepage and the three trust pages are public; every other path belongs to the application', () => {
  assert.equal(publicPage('/'), 'home');
  assert.equal(publicPage(''), 'home');
  assert.equal(publicPage('/privacy'), 'privacy');
  assert.equal(publicPage('/terms/'), 'terms');
  assert.equal(publicPage('/Security'), 'security');
  assert.equal(publicPage('/unsubscribe'), 'unsubscribe');
  assert.equal(publicPage('/unsubscribe/'), 'unsubscribe');
  for (const other of ['/signin', '/work', '/processes', '/privacy/x', '/privacy-policy', '/board', '/legal', '/demonstration', '/demo-data/sample.json']) {
    assert.equal(publicPage(other), null, other);
  }
});

test('no trust page path is also a journey route', () => {
  for (const p of TRUST_PAGES) assert.equal(parseJourneyPath(p.path), null, p.path);
});

test('the demo is public and runs the journey under /demo', () => {
  assert.equal(publicPage('/demo'), 'demo');
  assert.equal(publicPage('/demo/'), 'demo');
  assert.equal(publicPage('/demo/process/6f1c2b8e-4a3d-4e5f-9a1b-2c3d4e5f6a7b/assessment'), 'demo');
  assert.equal(demoPath('/demo'), '/work');
  assert.equal(demoPath('/demo/'), '/work');
  assert.equal(demoPath('/demo/board'), '/board');
  assert.equal(demoPath('/demo/process/x/sources'), '/process/x/sources');
});
