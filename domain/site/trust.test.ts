import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST, CONTACT_EMAIL, OPERATOR, UPDATED, inlineParts, pageText } from './trust.ts';
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
  assert.match(UPDATED, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
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
