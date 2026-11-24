// The content security policy: what it allows, built from the build's own settings, and where it is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CSP_HEADER, cspDirectives, cspHeadersFile, cspPolicy, secureOrigin } from './csp.ts';

// Made-up settings of the same shape as Netlify's (no real project address is written in the code).
const SITES = { supabaseUrl: 'https://example-project.supabase.co', sentryDsn: 'https://publickey123@o12345.ingest.de.sentry.io/678' };
const directive = (name: string, sites = SITES) => cspDirectives(sites).find(d => d.name === name)?.values;

test('the policy, report-only, as the live site and its previews are sent it', () => {
  assert.equal(CSP_HEADER, 'Content-Security-Policy-Report-Only');
  assert.equal(cspPolicy(SITES),
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
    + "connect-src 'self' https://example-project.supabase.co https://o12345.ingest.de.sentry.io https://gateway.umami.is; "
    + "worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
});

test("the page may connect only to the site, the build's Supabase project, Sentry's host and Umami", () => {
  assert.deepEqual(directive('connect-src'), ["'self'", 'https://example-project.supabase.co', 'https://o12345.ingest.de.sentry.io', 'https://gateway.umami.is']);
  assert.doesNotMatch(cspPolicy(SITES), /publickey123|\/678/, "never Sentry's key or project number");
  // A build without them (a local build, the browser tests) names only the site and Umami.
  assert.deepEqual(directive('connect-src', {}), ["'self'", 'https://gateway.umami.is']);
  assert.equal(secureOrigin('http://example-project.supabase.co'), null, 'only https');
  assert.equal(secureOrigin('not an address'), null);
  assert.equal(secureOrigin('https://example-project.supabase.co/rest/v1?x=1'), 'https://example-project.supabase.co');
});

test('scripts come only from the site: no inline script, no eval', () => {
  assert.deepEqual(directive('script-src'), ["'self'"]);
  assert.doesNotMatch(cspPolicy(SITES), /unsafe-eval|wasm-unsafe-eval|strict-dynamic|nonce-|sha256-/);
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('frame-ancestors'), ["'none'"]);
});

test('reports go through the error reports and their scrubber, never to an address in the header', () => {
  assert.doesNotMatch(cspPolicy(SITES), /report-uri|report-to/);
});

test("the built site's _headers file puts the policy on every page", () => {
  const file = cspHeadersFile(cspPolicy(SITES));
  assert.match(file, /^\/\*\n {2}Content-Security-Policy-Report-Only: default-src 'self'; .+ frame-ancestors 'none'\n$/m);
  assert.equal(file.match(/Content-Security-Policy/g)?.length, 1);
  assert.equal(fs.existsSync(new URL('../../public/_headers', import.meta.url)), false, 'the built file is the only _headers');
});

test('netlify.toml keeps its own headers and carries no policy of its own', () => {
  const toml = fs.readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
  const block = (toml.split('[[headers]]').find(b => /for = "\/\*"/.test(b)) ?? '').split('[headers.values]')[1] ?? '';
  const values = Object.fromEntries([...block.matchAll(/^\s*([A-Za-z-]+) = "([^"]*)"/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(values, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
    'X-Frame-Options': 'DENY',
  });
  assert.doesNotMatch(toml, /Content-Security-Policy/);
});

test('each directive is named once and says why', () => {
  const names = cspDirectives(SITES).map(d => d.name);
  assert.equal(new Set(names).size, names.length);
  for (const d of cspDirectives(SITES)) assert.ok(d.why.length > 10, d.name);
});
