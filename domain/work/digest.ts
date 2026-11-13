// The weekday "Needs you" email. Pure: the server function journey-notify gathers the facts, sends the
// email through Resend and records what each person was told.
//
// Agreed rules (November 2026):
// - Only work a person is named for on a process (an analyst, architect or approver named on it). A duty
//   nobody is named for is shown in My work to everyone holding that role, but is not emailed.
// - One email per person and workspace on weekdays, and only when something new needs them since the last
//   run. The email lists everything still waiting, with the new things marked.
// - Every email says why it came and has a link that stops these emails (and a one-click header).
import { needsFor, type Need, type Person, type ProcessFacts } from './home.ts';
import type { StageId } from '../workspace/route.ts';

/** A need's identity across runs: the process and the kind of work (each kind has its own stage). */
export const needKey = (n: Pick<Need, 'processId' | 'duty' | 'stage'>) => `${n.processId}:${n.duty}:${n.stage}`;

/** What is waiting on this person by name; duties nobody is named for are left out of email. */
export const namedNeeds = (me: Person, processes: ProcessFacts[]): Need[] => needsFor(me, processes).filter(n => !n.unassigned);

export interface DigestInput {
  to: string;
  /** The person's display name; blank when the profile has none. */
  name: string;
  workspace: string;
  organization: string;
  needs: Need[];
  /** The need keys this person had at the last run, for this workspace. */
  seen: string[];
  emailOn: boolean;
  /** The site people sign in at, for example https://avalaos.com. */
  siteUrl: string;
  /** The page that stops these emails (carries the person's own token). */
  unsubscribeUrl: string;
}

export interface DigestEmail { to: string; subject: string; text: string; html: string }
export interface Digest {
  /** Record these as seen after this run (when the email was sent, or there was none to send). */
  keys: string[];
  fresh: string[];
  email: DigestEmail | null;
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const stagePath = (site: string, processId: string, stage: StageId) => `${site}/process/${processId}/${stage}`;

export function needsDigest(input: DigestInput): Digest {
  const keys = [...new Set(input.needs.map(needKey))].sort();
  const seen = new Set(input.seen);
  const fresh = keys.filter(k => !seen.has(k));
  if (!input.emailOn || fresh.length === 0 || input.needs.length === 0) return { keys, fresh, email: null };

  const to = input.to.trim().toLowerCase();
  if (!EMAIL.test(to)) return { keys: input.seen, fresh, email: null }; // nothing sent: keep what was seen
  const site = input.siteUrl.replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) throw new Error('siteUrl must be an https origin');
  if (!/^https?:\/\//.test(input.unsubscribeUrl)) throw new Error('unsubscribeUrl must be an address');

  const workspace = oneLine(input.workspace) || 'your workspace';
  const where = oneLine(input.organization) ? `${workspace} (${oneLine(input.organization)})` : workspace;
  const hello = oneLine(input.name) ? `Hello ${oneLine(input.name)},` : 'Hello,';
  const isFresh = (n: Need) => fresh.includes(needKey(n));

  // Group by process, keeping the order needsFor gives (most pressing first within each process).
  const groups = new Map<string, { name: string; needs: Need[] }>();
  for (const n of input.needs) {
    const g = groups.get(n.processId) ?? { name: oneLine(n.processName) || 'A process', needs: [] };
    g.needs.push(n);
    groups.set(n.processId, g);
  }

  const count = input.needs.length;
  const subject = oneLine(fresh.length === count
    ? `${count === 1 ? 'Something needs' : `${count} things need`} you in ${workspace}`
    : `${fresh.length} new, ${count} in all, need you in ${workspace}`).slice(0, 200);
  const myWork = `${site}/work`;
  const why = 'You get this email on weekdays when something new needs you on a process you are named on.';

  const text = [
    hello, '',
    `Here is what needs you in ${where} on Avala OS.${fresh.length < count ? ' New since the last email is marked "New".' : ''}`, '',
    ...[...groups.values()].flatMap(g => [
      g.name,
      ...g.needs.flatMap(n => [`- ${isFresh(n) && fresh.length < count ? 'New: ' : ''}${n.text}`, `  ${stagePath(site, n.processId, n.stage)}`]),
      '',
    ]),
    `Open My work: ${myWork}`, '',
    why,
    `Stop these emails: ${input.unsubscribeUrl}`,
    '',
    `Avala OS · ${site} · Privacy: ${site}/privacy`,
  ].join('\n');

  const items = [...groups.values()].map(g => `
<p style="margin:16px 0 6px;font-size:15px;font-weight:bold;color:#0f172a">${esc(g.name)}</p>
<ul style="margin:0;padding-left:20px;font-size:15px;line-height:22px">${g.needs.map(n => `
<li style="margin:0 0 6px">${isFresh(n) && fresh.length < count ? '<span style="display:inline-block;margin-right:6px;padding:0 6px;border-radius:6px;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:bold">New</span>' : ''}<a href="${esc(stagePath(site, n.processId, n.stage))}" style="color:#002C4B">${esc(n.text)}</a></li>`).join('')}
</ul>`).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#002C4B">Avala O<span style="color:#E69F00">S</span></p>
<p style="margin:0 0 8px;font-size:16px;line-height:24px">${esc(hello)}</p>
<p style="margin:0 0 8px;font-size:16px;line-height:24px">Here is what needs you in ${esc(where)}.</p>${items}
<p style="margin:24px 0 0"><a href="${esc(myWork)}" style="display:inline-block;background:#002C4B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Open My work</a></p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:18px;color:#64748b">${esc(why)} <a href="${esc(input.unsubscribeUrl)}" style="color:#64748b">Stop these emails</a>.<br>Avala OS · <a href="${esc(site)}" style="color:#64748b">${esc(site.replace(/^https?:\/\//, ''))}</a> · <a href="${esc(site)}/privacy" style="color:#64748b">Privacy</a></td></tr>
</table></body></html>`;

  return { keys, fresh, email: { to, subject, text, html } };
}
