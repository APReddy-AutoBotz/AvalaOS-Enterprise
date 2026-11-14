// Error reports carry no account, no email address and no token from a link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './errors.ts';

test('addresses lose their query and fragment, where tokens travel', () => {
  assert.equal(scrubUrl('https://avalaos.com/unsubscribe?token=8d6f0c1e-1b2a-4c3d-9e8f-001122334455'), 'https://avalaos.com/unsubscribe');
  assert.equal(scrubUrl('https://avalaos.com/reset-password#access_token=abc&type=recovery'), 'https://avalaos.com/reset-password');
  assert.equal(scrubUrl('/process/5b0c/sources'), '/process/5b0c/sources');
});

test('text loses email addresses, tokens and keys', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLXZhbHVlLWhlcmU'].join('.');
  const key = ['sk', 'proj', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('-');
  assert.equal(scrubText(`Failed for ana.rao@acme.co.in with ${jwt}`), 'Failed for [email] with [token]');
  assert.equal(scrubText(`Bad key ${key}`), 'Bad key [key]');
  assert.equal(scrubText('GET https://x.supabase.co/rest/v1/processes?select=*&workspace_id=eq.1 failed'), 'GET https://x.supabase.co/rest/v1/processes failed');
  assert.equal(scrubText('Cannot read properties of undefined (reading \'steps\')'), 'Cannot read properties of undefined (reading \'steps\')');
});

test('an error report keeps what explains the error and nothing that identifies a person', () => {
  const e = scrubEvent({
    message: 'Saved by ben@acme.com',
    user: { id: 'u1', email: 'ben@acme.com' },
    extra: { model: { steps: [] } },
    request: { url: 'https://avalaos.com/unsubscribe?token=abc', cookies: 'sb=1', headers: { Authorization: 'Bearer x' }, query_string: 'token=abc' },
    exception: { values: [{ type: 'TypeError', value: 'No member ana@acme.com' }] },
    breadcrumbs: [
      { category: 'console', message: 'model', data: { arguments: ['secret'] } },
      { category: 'navigation', data: { from: '/signin#access_token=t', to: '/work' } },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?id=eq.1', method: 'GET', status_code: 500 } },
      { category: 'ui.click', message: 'button.Save' },
    ],
  });
  assert.equal(e.user, undefined);
  assert.equal(e.extra, undefined);
  assert.deepEqual(e.request, { url: 'https://avalaos.com/unsubscribe' });
  assert.equal(e.message, 'Saved by [email]');
  assert.deepEqual(e.exception?.values, [{ type: 'TypeError', value: 'No member [email]' }]);
  assert.deepEqual(e.breadcrumbs, [
    { category: 'navigation', data: { from: '/signin', to: '/work' } },
    { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles', method: 'GET', status_code: 500 } },
    { category: 'ui.click', message: 'button.Save' },
  ]);
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'x' }), null);
});
