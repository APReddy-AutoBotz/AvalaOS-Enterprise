import test from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, extraOrigins, originAllowed } from './origins.ts';

test('the functions answer avalaos.com, www and a preview address with that address, and an outside address with none', () => {
  for (const o of ['https://avalaos.com', 'https://www.avalaos.com', 'https://deploy-preview-196--avala-os.netlify.app', 'https://next--avala-os.netlify.app', 'https://avala-os.netlify.app']) {
    const h = corsHeaders(o, '');
    assert.equal(h['Access-Control-Allow-Origin'], o, o);
    assert.equal(h.Vary, 'Origin');
  }
  for (const o of ['https://evil.example', 'https://avalaos.com.evil.example', 'https://evil-avala-os.netlify.app', 'https://x--avala-os.netlify.app.evil.example', 'http://avalaos.com', 'null']) {
    const h = corsHeaders(o, '');
    assert.equal(h['Access-Control-Allow-Origin'], undefined, o);
    assert.equal(h.Vary, 'Origin', 'Vary is said on every answer');
  }
  assert.equal(corsHeaders(null, '')['Access-Control-Allow-Origin'], undefined, 'a call with no Origin (a server) gets none');
});

test('ALLOWED_ORIGIN adds exact addresses and never "*"', () => {
  assert.deepEqual(extraOrigins('http://localhost:5173, https://staging.example.com/ ,*, not a url'), ['http://localhost:5173', 'https://staging.example.com']);
  assert.equal(originAllowed('http://localhost:5173', 'http://localhost:5173'), true);
  assert.equal(originAllowed('https://evil.example', '*'), false);
  assert.equal(originAllowed('http://localhost:5174', 'http://localhost:5173'), false);
});

test('every answer of a wrapped function carries the headers, worked out for its own caller', async () => {
  const { withCors } = await import('./origins.ts');
  const handler = withCors(req => (req.method === 'OPTIONS' ? new Response('ok') : new Response('{"ok":false}', { status: 403, headers: { 'Content-Type': 'application/json' } })), '');
  const ask = (origin: string, method = 'POST') => handler(new Request('https://x.supabase.co/functions/v1/journey-ai', { method, headers: { Origin: origin } }));
  const a = await ask('https://avalaos.com', 'OPTIONS');
  assert.equal(a.headers.get('Access-Control-Allow-Origin'), 'https://avalaos.com');
  const b = await ask('https://evil.example');
  assert.equal(b.status, 403);
  assert.equal(b.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(b.headers.get('Vary'), 'Origin');
  assert.equal(b.headers.get('Content-Type'), 'application/json');
  assert.equal(await b.text(), '{"ok":false}');
});
