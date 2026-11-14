import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail } from './inviteEmail.ts';

const base = {
  to: ' Meera.Iyer@Kaveri-IC.example ',
  workspace: 'Finance Operations',
  organization: 'Kaveri Industrial Components',
  inviter: 'Rahul Deshpande',
  invite: { access: 'viewer' as const, canApprove: true, job: 'approver' as const },
  siteUrl: 'https://avalaos.com/',
};

test('the invitation says who invited whom, to which workspace, as which role, and how to sign in', () => {
  const m = inviteEmail(base);
  assert.equal(m.to, 'meera.iyer@kaveri-ic.example');
  assert.equal(m.subject, 'Rahul Deshpande invited you to Finance Operations on Avala OS');
  assert.match(m.text, /Rahul Deshpande has invited you to the Finance Operations workspace of Kaveri Industrial Components on Avala OS, as Approver\./);
  assert.match(m.text, /https:\/\/avalaos\.com\/signin with this email address \(meera\.iyer@kaveri-ic\.example\)/);
  assert.match(m.text, /Continue with Google or Continue with Microsoft/);
  assert.match(m.html, /href="https:\/\/avalaos\.com\/signin"/);
  assert.match(m.html, /<strong>Approver<\/strong>/);
});

test('names from the workspace are escaped in the HTML and kept on one line in the subject', () => {
  const m = inviteEmail({ ...base, inviter: 'Eve <script>alert(1)</script>\r\nBcc: x@y.z', workspace: 'R&D "Ops"' });
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /Eve &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(m.html, /R&amp;D &quot;Ops&quot;/);
  assert.doesNotMatch(m.subject, /[\r\n]/);
});

test('a missing inviter name or organization is left out, never invented', () => {
  const m = inviteEmail({ ...base, inviter: '  ', organization: '' });
  assert.match(m.subject, /^A workspace admin invited you/);
  assert.match(m.text, /to the Finance Operations workspace on Avala OS, as Approver\./);
  assert.doesNotMatch(m.text, / of  on /);
});

test('a bad address or a non-https site is refused', () => {
  assert.throws(() => inviteEmail({ ...base, to: 'not-an-email' }));
  assert.throws(() => inviteEmail({ ...base, siteUrl: 'http://avalaos.com' }));
  assert.throws(() => inviteEmail({ ...base, siteUrl: 'javascript:alert(1)' }));
  assert.doesNotThrow(() => inviteEmail({ ...base, siteUrl: 'http://localhost:3000' }));
});
