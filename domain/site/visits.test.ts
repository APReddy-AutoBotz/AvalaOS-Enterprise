import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTED_HOSTS, UMAMI, countable, countedUrl, eventBody, optOutChange, pageViewBody, referrerSite, type CountEnv } from './visits.ts';

const env = (over: Partial<CountEnv> = {}): CountEnv => ({ hostname: 'avalaos.com', page: 'home', signedIn: false, privacySignal: false, automated: false, optedOut: false, ...over });
const facts = { hostname: 'avalaos.com', pathname: '/', search: '', title: 'Avala OS', referrer: '', language: 'en-IN', screen: '1536x864' };

test('only the real site counts, signed out, on the public pages, without a privacy signal', () => {
  assert.equal(countable(env()), true);
  assert.equal(countable(env({ hostname: 'www.avalaos.com', page: 'privacy' })), true);
  assert.equal(countable(env({ page: 'demo' })), true);
  for (const hostname of ['deploy-preview-196--avala-os.netlify.app', 'localhost', '127.0.0.1', 'avalaos.com.evil.example', 'staging.avalaos.com'])
    assert.equal(countable(env({ hostname })), false, hostname);
  assert.equal(countable(env({ page: 'unsubscribe' })), false, 'never the unsubscribe page');
  assert.equal(countable(env({ page: null })), false, 'never the signed-in product or sign-in');
  assert.equal(countable(env({ signedIn: true })), false);
  assert.equal(countable(env({ privacySignal: true })), false, 'Do Not Track or Global Privacy Control');
  assert.equal(countable(env({ automated: true })), false, 'a browser driven by test tools');
  assert.equal(countable(env({ optedOut: true })), false, 'the owner\'s own browser');
  assert.deepEqual([...COUNTED_HOSTS], ['avalaos.com', 'www.avalaos.com']);
});

test('a page\'s address keeps only the campaign words, and nothing after #', () => {
  assert.equal(countedUrl('/', '?utm_source=linkedin&utm_medium=post&utm_campaign=nov&email=a@b.c&token=x'), '/?utm_source=linkedin&utm_medium=post&utm_campaign=nov');
  assert.equal(countedUrl('/privacy', '?ref=abc'), '/privacy');
  assert.equal(countedUrl('', ''), '/');
});

test('the referring site by its address alone', () => {
  assert.equal(referrerSite('https://www.linkedin.com/feed/update/urn:li:activity:1?trk=x', 'avalaos.com'), 'https://www.linkedin.com');
  assert.equal(referrerSite('https://avalaos.com/privacy', 'avalaos.com'), '', 'our own site is not a referrer');
  assert.equal(referrerSite('https://www.avalaos.com/', 'avalaos.com'), '');
  assert.equal(referrerSite('', 'avalaos.com'), '');
  assert.equal(referrerSite('android-app://com.slack', 'avalaos.com'), '');
});

test('a count holds exactly the listed fields: no visitor identifier, no other data', () => {
  const pv = pageViewBody({ ...facts, search: '?utm_source=x&id=7', referrer: 'https://news.ycombinator.com/item?id=1' });
  assert.deepEqual(pv, { type: 'event', payload: { website: UMAMI.website, hostname: 'avalaos.com', url: '/?utm_source=x', title: 'Avala OS', referrer: 'https://news.ycombinator.com', language: 'en-IN', screen: '1536x864' } });
  assert.equal('id' in pv.payload, false);
  const tour = eventBody(facts, 'Tour stage picked', 'Validate');
  assert.deepEqual(tour?.payload.data, { stage: 'Validate' });
  assert.equal(tour?.payload.name, 'Tour stage picked');
  const sent = eventBody(facts, 'Walkthrough sent', 'someone@example.com');
  assert.equal(sent?.payload.data, undefined, 'an event with no detail carries none, whatever is passed');
  assert.equal(eventBody(facts, 'Clicked a link'), null, 'only the listed events');
  assert.equal(eventBody(facts, 'constructor'), null);
  assert.deepEqual(Object.keys(eventBody(facts, 'Read more opened', 'effort')!.payload).sort(), ['data', 'hostname', 'language', 'name', 'referrer', 'screen', 'title', 'url', 'website']);
});

test('the owner leaves out a browser with ?count=off, and counts it again with ?count=on', () => {
  assert.equal(optOutChange('?count=off'), 'off');
  assert.equal(optOutChange('?utm_source=x&count=on'), 'on');
  assert.equal(optOutChange('?count=maybe'), null);
  assert.equal(optOutChange(''), null);
});
