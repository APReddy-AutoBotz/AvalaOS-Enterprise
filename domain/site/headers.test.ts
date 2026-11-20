// The site's own settings (netlify.toml) and its two files for search engines (public/robots.txt,
// public/sitemap.xml), read as text: what the browser and a crawler are told.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRUST_PAGES } from './pages.ts';

const read = (f: string) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

test('the microphone is allowed for this site only; camera and location stay off (F12)', () => {
  const policy = read('netlify.toml').match(/Permissions-Policy = "([^"]+)"/)?.[1];
  assert.equal(policy, 'camera=(), microphone=(self), geolocation=()');
});

test('robots.txt keeps search engines out of the signed-in product and names the sitemap', () => {
  const robots = read('public/robots.txt');
  for (const p of ['/signin', '/reset-password', '/unsubscribe', '/work', '/processes', '/process/', '/board', '/settings']) assert.match(robots, new RegExp(`^Disallow: ${p}$`, 'm'));
  assert.doesNotMatch(robots, /^Disallow: \/$/m, 'the public pages stay readable');
  assert.match(robots, /^Sitemap: https:\/\/avalaos\.com\/sitemap\.xml$/m);
});

test('the sitemap lists the public pages and nothing that needs signing in', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs, ['https://avalaos.com/', 'https://avalaos.com/demo', ...TRUST_PAGES.map(p => `https://avalaos.com${p.path}`)]);
});
