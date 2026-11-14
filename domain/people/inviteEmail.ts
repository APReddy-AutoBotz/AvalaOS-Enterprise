// The invitation email an admin's invite sends. Pure: the server function `journey-invite` fills it from
// the workspace, the invitation and the inviter, and sends it. It says only what is true of the invite:
// who invited, to which workspace, as which role, and how to sign in with the invited address.
import { roleOf, validateEmail, type MemberFacts } from './roles.ts';

export interface InviteEmailInput {
  to: string;
  workspace: string;
  organization: string;
  /** The inviter's display name; blank when the profile has none. */
  inviter: string;
  invite: MemberFacts;
  /** The site the person signs in at, for example https://avalaos.com. */
  siteUrl: string;
}

export interface InviteEmail { to: string; subject: string; text: string; html: string }

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function inviteEmail(input: InviteEmailInput): InviteEmail {
  const to = validateEmail(input.to);
  const site = input.siteUrl.replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) throw new Error('siteUrl must be an https origin');
  const inviter = oneLine(input.inviter) || 'A workspace admin';
  const workspace = oneLine(input.workspace) || 'a workspace';
  const organization = oneLine(input.organization);
  const role = roleOf(input.invite).label;
  const where = organization ? `the ${workspace} workspace of ${organization}` : `the ${workspace} workspace`;
  const signIn = `${site}/signin`;

  const subject = oneLine(`${inviter} invited you to ${workspace} on Avala OS`).slice(0, 200);
  const lines = [
    `${inviter} has invited you to ${where} on Avala OS, as ${role}.`,
    '',
    `To accept, sign in at ${signIn} with this email address (${to}):`,
    '- choose Continue with Google or Continue with Microsoft if this address is your Google or Microsoft account, or',
    '- create an account with this address and a password.',
    '',
    'You join the workspace as soon as your address is confirmed.',
    "If you were not expecting this invitation, you can ignore this email; nothing happens unless you sign in.",
    '',
    `Avala OS · ${site} · Privacy: ${site}/privacy`,
  ];
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#002C4B">Avala O<span style="color:#E69F00">S</span></p>
<p style="margin:0 0 16px;font-size:16px;line-height:24px">${esc(inviter)} has invited you to ${esc(where)} on Avala OS, as <strong>${esc(role)}</strong>.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:22px">To accept, sign in with this email address (<strong>${esc(to)}</strong>): choose Continue with Google or Continue with Microsoft if it is your Google or Microsoft account, or create an account with it and a password.</p>
<p style="margin:0 0 24px"><a href="${esc(signIn)}" style="display:inline-block;background:#002C4B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Sign in to Avala OS</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#475569">You join the workspace as soon as your address is confirmed. If you were not expecting this invitation, you can ignore this email; nothing happens unless you sign in.</p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">Avala OS · <a href="${esc(site)}" style="color:#64748b">${esc(site.replace(/^https?:\/\//, ''))}</a> · <a href="${esc(site)}/privacy" style="color:#64748b">Privacy</a></td></tr>
</table></body></html>`;
  return { to, subject, text: lines.join('\n'), html };
}
