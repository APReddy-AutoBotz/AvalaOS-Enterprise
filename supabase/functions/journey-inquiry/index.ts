// journey-inquiry: a walkthrough request from the homepage (docs/next-plan.md, section 3d, package 11).
//
// POST { name, email, company, process?, people?, website, elapsedMs } -> 200 { ok: true } | 4xx { ok: false, error }
//
// Public: no sign-in. The function trusts nothing the browser says: it checks the fields with the same rule
// the form uses (domain/site/inquiry.ts), refuses the hidden field filled in and a request sent sooner than
// INQUIRY_CAPS.minMs after the window opened (elapsed time measured in the browser), and stores the request
// through submit_walkthrough_request (service role only), which holds the hourly and daily limits and decides
// whether a notice goes out. The notice goes to the owner's own address only; it carries no details of the
// visitor and no reply-to (owner, 17 November 2026): it says a request is waiting in Settings. Nothing is ever
// sent to the visitor's address, so the form cannot be used to mail anyone. No IP address is kept.
//
// Secrets: RESEND_API_KEY (unset: the request is stored and no notice is sent). Optional: EMAIL_FROM (default
// "Avala OS <no-reply@avalaos.com>"), SITE_URL (default https://avalaos.com), ALLOWED_ORIGIN. Deployed with
// verify_jwt = false: anyone may send a request, and the limits are the database's.

import { checkInquiry, inquiryNotice, INQUIRY_CAPS } from '../../../domain/site/inquiry.ts';
import { CONTACT_EMAIL } from '../../../domain/site/trust.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');

function pickKey(jsonVar: string, legacyVar: string): string {
  try {
    const parsed = JSON.parse(env(jsonVar) || '{}');
    if (typeof parsed.default === 'string' && parsed.default) return parsed.default;
  } catch { /* fall through to the legacy key */ }
  return env(legacyVar);
}
const SECRET_KEY = pickKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const serviceHeaders = (): Record<string, string> =>
  SECRET_KEY.startsWith('sb_secret_')
    ? { apikey: SECRET_KEY, 'Content-Type': 'application/json' }
    : { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' };

const CORS = {
  'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => reply(status, { ok: false, error: { code, message } });

/** A request is a few hundred characters; anything far larger is not a person filling in the form. */
const MAX_BODY = 8_000;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !SECRET_KEY) return fail(500, 'NOT_CONFIGURED', 'Supabase environment is incomplete.');

  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return fail(400, 'REFUSED', 'Refused.');
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return fail(400, 'REFUSED', 'Refused.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'REFUSED', 'Refused.');

  const checked = checkInquiry(body);
  if (!checked.ok) {
    // What to fix is said for a field a person can fix; the hidden field and the wait are not explained.
    const said = checked.reason === 'trap' || checked.reason === 'too_fast' ? 'Refused.' : checked.message;
    return fail(400, checked.reason === 'trap' || checked.reason === 'too_fast' ? 'REFUSED' : 'INVALID', said);
  }
  const v = checked.value;

  const stored = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_walkthrough_request`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({
      p_name: v.name, p_email: v.email, p_company: v.company, p_process: v.process, p_people: v.people,
      per_email_hour: INQUIRY_CAPS.perEmailHour, per_hour: INQUIRY_CAPS.perHour, per_day: INQUIRY_CAPS.perDay, notices_per_day: INQUIRY_CAPS.noticesPerDay,
    }),
  }).catch(() => null);
  if (!stored?.ok) { console.error('submit_walkthrough_request failed', stored?.status ?? 'unreachable'); return fail(503, 'NOT_STORED', 'Not stored.'); }
  const result = await stored.json().catch(() => null) as { ok?: boolean; reason?: string; notice?: 'each' | 'more' | null } | null;
  if (!result?.ok) return fail(429, 'TOO_MANY', 'Too many requests.');

  // The notice: only that a request is waiting, to the owner's own address. A failed send loses nothing:
  // the request is stored and shows in Settings.
  const key = env('RESEND_API_KEY');
  if (result.notice && key) {
    const n = inquiryNotice(result.notice, env('SITE_URL') || 'https://avalaos.com');
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('EMAIL_FROM') || 'Avala OS <no-reply@avalaos.com>', to: [CONTACT_EMAIL], subject: n.subject, text: n.text, html: n.html }),
    }).catch(() => null);
    if (!sent?.ok) console.error('walkthrough notice not sent', sent?.status ?? 'unreachable');
  }
  return reply(200, { ok: true });
});
