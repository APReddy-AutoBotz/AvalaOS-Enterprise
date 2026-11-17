import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInquiry, inquiryNotice, INQUIRY_CAPS, oneLine, plainText, replyLink, TRAP_FIELD } from './inquiry.ts';

const good = { name: 'Asha Rao', email: 'Asha@Example.com', company: 'Kaveri Components', process: 'Supplier invoices', people: '6-20', elapsedMs: 5000 };

test('a complete request is accepted, tidied, with the optional parts kept or left empty', () => {
  const r = checkInquiry(good);
  assert.deepEqual(r, { ok: true, value: { name: 'Asha Rao', email: 'asha@example.com', company: 'Kaveri Components', process: 'Supplier invoices', people: '6-20' } });
  const bare = checkInquiry({ ...good, process: '  ', people: '' });
  assert.deepEqual(bare.ok && [bare.value.process, bare.value.people], [null, null]);
});

test('missing and malformed fields are refused, each with what to fix', () => {
  for (const field of ['name', 'email', 'company'] as const) {
    const r = checkInquiry({ ...good, [field]: '   ' });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'missing');
    assert.equal(!r.ok && r.field, field);
  }
  for (const email of ['asha', 'asha@', 'asha@example', 'a b@example.com', '@example.com']) {
    const r = checkInquiry({ ...good, email });
    assert.equal(!r.ok && r.reason, 'malformed', email);
  }
  const r = checkInquiry({ ...good, people: '7' });
  assert.equal(!r.ok && r.field, 'people');
  // Not a string at all: treated as missing, never trusted.
  assert.equal(!checkInquiry({ ...good, name: { toString: () => 'x' } }).ok, true);
});

test('too long is refused for every field', () => {
  for (const [field, n] of [['name', 101], ['company', 151], ['process', 501]] as const) {
    const r = checkInquiry({ ...good, [field]: 'x'.repeat(n) });
    assert.equal(!r.ok && r.reason, 'too_long', field);
  }
  const r = checkInquiry({ ...good, email: `${'a'.repeat(250)}@example.com` });
  assert.equal(!r.ok && r.reason, 'too_long');
});

test('the hidden field filled, or sent sooner than the browser-measured wait, is refused', () => {
  assert.equal((checkInquiry({ ...good, [TRAP_FIELD]: 'https://spam.example' }) as { reason?: string }).reason, 'trap');
  for (const elapsedMs of [0, INQUIRY_CAPS.minMs - 1, -5, Number.NaN, '5000', undefined]) {
    assert.equal((checkInquiry({ ...good, elapsedMs: elapsedMs as never }) as { reason?: string }).reason, 'too_fast', String(elapsedMs));
  }
  assert.equal(checkInquiry({ ...good, elapsedMs: INQUIRY_CAPS.minMs }).ok, true);
});

test('what a visitor typed loses line breaks and control characters before it can reach a subject or a header', () => {
  assert.equal(oneLine('Asha\r\nBcc: x@evil.test\u0000\u0007 Rao\u2028'), 'Asha Bcc: x@evil.test Rao');
  const r = checkInquiry({ ...good, name: 'Asha\nRao', company: 'Kaveri\r\nComponents\t' });
  assert.deepEqual(r.ok && [r.value.name, r.value.company], ['Asha Rao', 'Kaveri Components']);
  // The process keeps its own line breaks as plain text, nothing else.
  assert.equal(plainText('One\r\n\r\n\r\nTwo\u0000\tthree'), 'One\n\nTwo three');
});

test('the notice carries no detail of the visitor, and no reply-to; the link opens Settings', () => {
  for (const kind of ['each', 'more'] as const) {
    const n = inquiryNotice(kind, 'https://avalaos.com/');
    assert.match(n.text, /https:\/\/avalaos\.com\/settings\/requests/);
    assert.doesNotMatch(JSON.stringify(n), /asha|kaveri|@example/i);
    assert.equal('replyTo' in n, false);
  }
  assert.match(inquiryNotice('more', 'https://avalaos.com').subject, /More walkthrough requests/);
});

test('"Reply by email" is addressed to the visitor only, and never to a broken or injected address', () => {
  assert.equal(replyLink('Asha@Example.com'), 'mailto:asha@example.com?subject=Your%20walkthrough%20of%20Avala%20OS');
  assert.equal(replyLink('a@example.com?cc=x@evil.test'), null);
  assert.equal(replyLink('a@example.com\nBcc: x@evil.test'), null);
  assert.equal(replyLink('not an address'), null);
});
