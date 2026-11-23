import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalUrl, demoPath, publicPage, TRUST_PAGES, type PublicPage } from './pages.ts';
import { parseJourneyPath } from '../workspace/route.ts';
import { teardownCanonical } from './teardownPath.ts';

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

test('each public page names its canonical address, the same addresses as the sitemap', () => {
  assert.equal(canonicalUrl(publicPage('/')!), 'https://avalaos.com/');
  assert.equal(canonicalUrl(publicPage('/Privacy/')!), 'https://avalaos.com/privacy');
  assert.equal(canonicalUrl(publicPage('/demo/process/6f1c2b8e-4a3d-4e5f-9a1b-2c3d4e5f6a7b/assessment')!), 'https://avalaos.com/demo');
  assert.equal(canonicalUrl('unsubscribe'), null);
  const pages: PublicPage[] = ['home', ...TRUST_PAGES.map(p => p.id), 'demo', 'unsubscribe'];
  // Each teardown in the demo's index has its own address (domain/site/teardownPath.ts).
  const teardowns: { slug: string }[] = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/teardowns/index.json', import.meta.url), 'utf8'));
  const canonical = [...pages.map(canonicalUrl), ...teardowns.map(t => teardownCanonical(`/demo/teardowns/${t.slug}`))].filter((u): u is string => u !== null).sort();
  const sitemap = [...fs.readFileSync(new URL('../../public/sitemap.xml', import.meta.url), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).sort();
  assert.deepEqual(canonical, sitemap);
});
