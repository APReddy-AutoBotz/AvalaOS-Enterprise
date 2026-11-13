import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledProviders, providerLabel, providerScopes, redirectError, withoutRedirectError } from './providers.ts';

test('only the providers the server has turned on are offered, Google first', () => {
  assert.deepEqual(enabledProviders({ external: { azure: true, google: true, github: true, email: true } }), ['google', 'azure']);
  assert.deepEqual(enabledProviders({ external: { google: false, azure: true } }), ['azure']);
  assert.deepEqual(enabledProviders({ external: { google: 'true' } }), []);
  assert.deepEqual(enabledProviders({}), []);
  assert.deepEqual(enabledProviders(null), []);
  assert.deepEqual(enabledProviders('nonsense'), []);
  assert.equal(providerLabel('azure'), 'Microsoft');
  assert.equal(providerScopes('azure'), 'email');
  assert.equal(providerScopes('google'), undefined);
});

test('an uninvited email coming back from a provider is told sign-up is by invitation', () => {
  // What Supabase sends when the invite-only trigger refuses the new account.
  const m = redirectError('?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user', '');
  assert.match(m!, /^Sign-up is by invitation/);
  assert.match(redirectError('', '#error=server_error&error_description=Database%20error%20saving%20new%20user')!, /^Sign-up is by invitation/);
});

test('other provider errors get a plain message; an address without an error gets none', () => {
  assert.match(redirectError('?error=access_denied&error_description=The+user+cancelled', '')!, /cancelled/);
  assert.match(redirectError('', '#error=server_error&error_description=Unverified+email+with+azure.+A+confirmation+email+has+been+sent+to+your+azure+email')!, /confirmation email/);
  assert.match(redirectError('?error=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled', '')!, /not available yet/);
  assert.equal(redirectError('?error=temporarily_unavailable', ''), 'Sign-in did not complete.');
  assert.equal(redirectError('', '#access_token=abc&refresh_token=def'), null);
  assert.equal(redirectError('?next=%2Fwork', ''), null);
});

test('the error is taken out of the address and nothing else is', () => {
  assert.equal(withoutRedirectError('/signin', '?error=server_error&error_description=x', ''), '/signin');
  assert.equal(withoutRedirectError('/signin', '?next=a&error=e', '#error=e&error_code=c&error_description=d'), '/signin?next=a');
  assert.equal(withoutRedirectError('/signin', '', '#access_token=abc'), '/signin#access_token=abc');
});
