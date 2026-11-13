import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPage, TRUST_PAGES } from './pages.ts';
import { parseJourneyPath } from '../workspace/route.ts';

test('the homepage and the three trust pages are public; every other path belongs to the application', () => {
  assert.equal(publicPage('/'), 'home');
  assert.equal(publicPage(''), 'home');
  assert.equal(publicPage('/privacy'), 'privacy');
  assert.equal(publicPage('/terms/'), 'terms');
  assert.equal(publicPage('/Security'), 'security');
  for (const other of ['/signin', '/work', '/processes', '/privacy/x', '/privacy-policy', '/board', '/legal']) {
    assert.equal(publicPage(other), null, other);
  }
});

test('no trust page path is also a journey route', () => {
  for (const p of TRUST_PAGES) assert.equal(parseJourneyPath(p.path), null, p.path);
});
