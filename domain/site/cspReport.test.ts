// A report of the content security policy carries only the rule, what was blocked (a keyword or a site's
// origin) and our file and line: never a page's query, a path elsewhere or a browser extension's breach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_REPORTS_PER_PAGE, blockedWhat, policyReport, type PolicyBreach } from './cspReport.ts';

const breach = (over: Partial<PolicyBreach> = {}): PolicyBreach => ({
  effectiveDirective: 'connect-src', blockedURI: 'https://tracker.example.com/collect?user=ana.rao%40acme.co.in#x', sourceFile: 'https://avalaos.com/assets/index-OqLiwdUY.js?v=1', lineNumber: 12, disposition: 'report', ...over,
});

test('what was blocked is a keyword or a site, never a path or a query', () => {
  assert.equal(blockedWhat('https://tracker.example.com/collect?user=ana#x'), 'https://tracker.example.com');
  assert.equal(blockedWhat('wss://realtime.example.com/socket?token=abc'), 'wss://realtime.example.com');
  for (const k of ['inline', 'eval', 'wasm-eval', 'data', 'blob']) assert.equal(blockedWhat(k), k);
  assert.equal(blockedWhat('INLINE'), 'inline');
  assert.equal(blockedWhat('data:image/png;base64,AAAA'), 'data');
  assert.equal(blockedWhat('blob:https://avalaos.com/5b0c-11'), 'blob');
  assert.equal(blockedWhat(''), 'unknown');
  assert.equal(blockedWhat('not an address'), 'unknown');
});

test('a report holds the rule, the site blocked and our file and line, in words', () => {
  const r = policyReport(breach(), new Set(), 'https://avalaos.com');
  assert.deepEqual(r, {
    message: 'Content security policy (report only): connect-src would block https://tracker.example.com (/assets/index-OqLiwdUY.js:12)',
    tags: { csp_directive: 'connect-src', csp_blocked: 'https://tracker.example.com' },
  });
  assert.doesNotMatch(JSON.stringify(r), /collect|user=|acme|#x|\?v=1/);
});

test('an inline style with no file says so; once enforced the words say blocked', () => {
  assert.equal(policyReport(breach({ effectiveDirective: 'style-src-elem', blockedURI: 'inline', sourceFile: '', lineNumber: 0 }), new Set())?.message,
    'Content security policy (report only): style-src-elem would block inline');
  assert.equal(policyReport(breach({ disposition: 'enforce', sourceFile: '' }), new Set())?.message,
    'Content security policy: connect-src blocked https://tracker.example.com');
});

test('a file from another site keeps its address without the query', () => {
  assert.match(policyReport(breach({ sourceFile: 'https://cdn.example.com/lib.js?key=abc#frag' }), new Set(), 'https://avalaos.com')!.message, /\(https:\/\/cdn\.example\.com\/lib\.js:12\)$/);
});

test("browser extensions' breaches are not ours and are dropped", () => {
  for (const s of ['chrome-extension://abcdef/content.js', 'moz-extension://1234/x.js', 'safari-web-extension://55/y.js', 'webkit-masked-url://hidden/']) {
    assert.equal(policyReport(breach({ sourceFile: s }), new Set()), null, s);
    assert.equal(policyReport(breach({ blockedURI: s }), new Set()), null, s);
  }
});

test('one report per rule and thing, and at most five a page load', () => {
  const seen = new Set<string>();
  assert.ok(policyReport(breach(), seen));
  assert.equal(policyReport(breach({ lineNumber: 99 }), seen), null, 'the same rule and site again');
  assert.ok(policyReport(breach({ effectiveDirective: 'img-src' }), seen), 'another rule');
  for (let i = 0; seen.size < POLICY_REPORTS_PER_PAGE; i++) assert.ok(policyReport(breach({ blockedURI: `https://site${i}.example.com/` }), seen));
  assert.equal(POLICY_REPORTS_PER_PAGE, 5);
  assert.equal(policyReport(breach({ blockedURI: 'https://one-more.example.com/' }), seen), null);
});
