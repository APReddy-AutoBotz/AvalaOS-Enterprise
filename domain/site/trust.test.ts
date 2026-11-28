import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST, CONTACT_EMAIL, OPERATOR, UPDATED, inlineParts, pageText, updatedText } from './trust.ts';
import { COVERAGE_RULE } from '../assess/coverage.ts';
import { TRUST_PAGES } from './pages.ts';

const pages = TRUST_PAGES.map(p => TRUST[p.id]);

test('every trust page has a title, a summary and sections with unique ids', () => {
  for (const page of pages) {
    assert.ok(page.title && page.summary, page.id);
    assert.ok(page.sections.length >= 5, page.id);
    const ids = page.sections.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, `${page.id}: duplicate section id`);
    for (const s of page.sections) assert.ok(s.body.length > 0, `${page.id}#${s.id} is empty`);
  }
  for (const d of Object.values(UPDATED)) if (d !== null) assert.match(d, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
});

test('the pages name who runs the service and how to reach them', () => {
  for (const page of pages) assert.ok(pageText(page).includes(CONTACT_EMAIL), `${page.id} has no contact address`);
  assert.ok(pageText(TRUST.privacy).includes(OPERATOR));
  assert.ok(pageText(TRUST.terms).includes(OPERATOR));
});

test('nothing is left to fill in, and no certification or guarantee is claimed', () => {
  for (const page of pages) {
    const text = pageText(page);
    assert.doesNotMatch(text, /\b(TODO|TBD|lorem|placeholder|XX+)\b|\[[A-Z ]+\](?!\()/, page.id);
    assert.doesNotMatch(text, /\b(is|are|we are) (SOC ?2|ISO ?27001|GDPR|HIPAA)[- ]?(compliant|certified)/i, page.id);
    assert.doesNotMatch(text, /\b(99\.\d+%|guarantee[ds]? (uptime|availability)|military[- ]grade|bank[- ]grade|unhackable)\b/i, page.id);
  }
});

test('links are to the other trust pages, security.txt or the contact address', () => {
  const allowed = new Set([...TRUST_PAGES.map(p => p.path), '/.well-known/security.txt', `mailto:${CONTACT_EMAIL}`]);
  for (const page of pages) {
    for (const part of page.sections.flatMap(s => s.body.flatMap(b => (typeof b === 'string' ? [b] : b.list))).flatMap(inlineParts)) {
      if ('href' in part) assert.ok(allowed.has(part.href), `${page.id}: ${part.href}`);
    }
  }
});

test('inline links are split from the text around them', () => {
  assert.deepEqual(inlineParts('See [Security](/security) now.'), [{ text: 'See ' }, { text: 'Security', href: '/security' }, { text: ' now.' }]);
  assert.deepEqual(inlineParts('No links.'), [{ text: 'No links.' }]);
  assert.deepEqual(inlineParts('[a](/x)[b](/y)'), [{ text: 'a', href: '/x' }, { text: 'b', href: '/y' }]);
});

test('security.txt names the same contact and has not expired', async () => {
  const { readFile } = await import('node:fs/promises');
  const txt = await readFile(new URL('../../public/.well-known/security.txt', import.meta.url), 'utf8');
  assert.match(txt, new RegExp(`^Contact: mailto:${CONTACT_EMAIL.replace('.', '\\.')}$`, 'm'));
  assert.match(txt, /^Policy: https:\/\/avalaos\.com\/security$/m);
  const expires = Date.parse(/^Expires: (.+)$/m.exec(txt)?.[1] ?? '');
  assert.ok(expires > Date.now(), 'security.txt has expired: renew its Expires line (at most a year ahead)');
});

test('the privacy notice names every AI provider a workspace may connect, and says its requests go only there', () => {
  const text = pageText(TRUST.privacy);
  for (const p of ['Azure OpenAI', 'Anthropic', 'Amazon Bedrock', 'Mistral AI', 'OpenAI-compatible endpoint']) assert.ok(text.includes(p), p);
  assert.match(text, /only to that provider/);
});

test('the privacy and security pages carry a release date: the coverage notice\'s date or later', () => {
  // The security page changes again with package 14's second release (the line on approved versions, owner,
  // 24 November 2026): until that release's commit sets its date it shows "[release date]".
  if (UPDATED.security === null) assert.equal(updatedText('security'), '[release date]');
  else if (COVERAGE_RULE.since !== null) assert.ok(Date.parse(UPDATED.security) >= Date.parse(COVERAGE_RULE.since), UPDATED.security);
  if (COVERAGE_RULE.since === null) assert.equal(updatedText('privacy'), '[release date]');
  // The privacy page changes again with a later release (the teardowns' counting): until that release's commit
  // sets its date it shows "[release date]"; once set, it is never before the coverage notice's date.
  if (UPDATED.privacy === null) assert.equal(updatedText('privacy'), '[release date]');
  else if (COVERAGE_RULE.since !== null) assert.ok(Date.parse(UPDATED.privacy) >= Date.parse(COVERAGE_RULE.since), UPDATED.privacy);
});

test('the privacy notice lists what the browser keeps, what signing out removes, and the demo\'s copy', () => {
  const text = pageText(TRUST.privacy);
  for (const kept of ['sign-in session', 'last workspace you opened', 'lists and maps shown', 'what was found in their sources and what you set aside']) assert.ok(text.includes(kept), kept);
  assert.ok(!text.includes('keeps two things'));
  assert.match(text, /except how you like lists and maps shown in general; with a call's notes not saved yet, it asks first\. The demo has no sign-in/);
  assert.match(text, /title, the site you came from/);
  assert.match(text, /the kind of browser and device/);
});

test('the privacy notice says what is counted at a teardown, in the approved words (marketing package, 21 November 2026)', () => {
  const text = pageText(TRUST.privacy);
  assert.ok(text.includes('the opening of the demo and of each published-process teardown in it, without cookies'));
  assert.ok(text.includes('picked a stage of the tour, or opened a teardown\'s documents. Never anything you type. Nothing else is counted inside the demo or the product,'));
  assert.ok(text.includes('which is about the made-up sample or a published teardown only'));
});

// Package C, C4b (owner, 28 November 2026): the notes taken in a call, in three places, for the release with the call screens.
test('the privacy notice says what happens to the notes taken in a call: kept once saved, read to suggest the next question, kept in the browser until saved', () => {
  const text = pageText(TRUST.privacy);
  assert.ok(text.includes('and the notes you take in a call, once you save them.'), 'workspace content');
  assert.ok(text.includes('or read the notes you take in a call to suggest the next question, the text or image needed for that request is sent'), 'what goes to the AI provider');
  assert.ok(text.includes('and the notes of a call you have not saved yet.'), 'what the browser keeps');
  assert.equal(UPDATED.privacy, null, 'the date is the release\'s, set in its own commit');
});
