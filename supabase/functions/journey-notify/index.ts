// journey-notify: the weekday "Needs you" email, and the link that stops it.
//
// POST { action: 'digest' } with header x-digest-secret   -> runs the digest (the schedule calls this; see
//      migration needs_email). For each person and workspace: what needs them by name and the board work someone
//      else gave them (domain/work/digest.ts, migration assigned_email);
//      an email only when something is new since the last run; what they have now is recorded.
// POST { action: 'unsubscribe', token }                     -> stops these emails for the person whose link it is
//      (the /unsubscribe page). Also POST ?unsubscribe=<token>: the one-click header mail apps use (RFC 8058).
//
// Secrets: RESEND_API_KEY (unset: the digest sends and records nothing, 503 EMAIL_NOT_CONFIGURED). Optional:
// EMAIL_FROM (default "Avala OS <no-reply@avalaos.com>"), SITE_URL (default https://avalaos.com), ALLOWED_ORIGIN.
// The service key is used only for the needs_digest_* and unsubscribe_needs_email functions, which only the
// service role may call. Deployed with verify_jwt = false: the digest checks the schedule's secret, and an
// unsubscribe needs only the person's own token.

import { namedNeeds, needsDigest, type AssignedItem } from '../../../domain/work/digest.ts';
import type { ProcessFacts } from '../../../domain/work/home.ts';
import type { AccessLevel, Job } from '../../../domain/people/roles.ts';

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

async function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${name} failed (${res.status})`);
  return res.json();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function unsubscribe(token: unknown): Promise<Response> {
  if (typeof token !== 'string' || !UUID.test(token)) return fail(400, 'INVALID_REQUEST', 'This link is not complete. Copy the whole link from the email.');
  const done = await rpc('unsubscribe_needs_email', { token });
  // The same answer whether or not the token matched, so a link cannot be used to probe for people.
  if (!done) console.warn('unsubscribe: no person for token');
  return reply(200, { ok: true });
}

interface PersonRow { workspaceId: string; workspace: string; organization: string; userId: string; email: string; name: string; access: AccessLevel; job: Job | null; canApprove: boolean; emailOn: boolean; token: string }
interface ProcessRow extends ProcessFacts { workspaceId: string }
interface AssignedRow extends AssignedItem { workspaceId: string; ownerId: string }

async function digest(): Promise<Response> {
  const resendKey = env('RESEND_API_KEY');
  if (!resendKey) return fail(503, 'EMAIL_NOT_CONFIGURED', 'Email is not set up yet; nothing was sent or recorded.');
  const site = (env('SITE_URL') || 'https://avalaos.com').replace(/\/+$/, '');
  const from = env('EMAIL_FROM') || 'Avala OS <no-reply@avalaos.com>';

  const input = await rpc('needs_digest_input', {});
  const people: PersonRow[] = input.people ?? [];
  const processes: ProcessRow[] = input.processes ?? [];
  const assignedRows: AssignedRow[] = input.assigned ?? [];
  const seen = new Map<string, string[]>((input.seen ?? []).map((s: any) => [`${s.userId}:${s.workspaceId}`, s.keys ?? []]));

  const record: { userId: string; workspaceId: string; keys: string[]; sent: boolean }[] = [];
  let sent = 0, failed = 0;
  for (const p of people) {
    const mine = processes.filter(x => x.workspaceId === p.workspaceId);
    const needs = namedNeeds({ userId: p.userId, access: p.access, job: p.job, canApprove: p.canApprove }, mine);
    const assigned = assignedRows.filter(a => a.workspaceId === p.workspaceId && a.ownerId === p.userId);
    const unsubscribeUrl = `${site}/unsubscribe?token=${p.token}`;
    const d = needsDigest({
      to: p.email, name: p.name, workspace: p.workspace, organization: p.organization, needs, assigned,
      seen: seen.get(`${p.userId}:${p.workspaceId}`) ?? [], emailOn: p.emailOn, siteUrl: site, unsubscribeUrl,
    });
    if (!d.email) { record.push({ userId: p.userId, workspaceId: p.workspaceId, keys: d.keys, sent: false }); continue; }
    const oneClick = `${SUPABASE_URL}/functions/v1/journey-notify?unsubscribe=${p.token}`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [d.email.to], subject: d.email.subject, text: d.email.text, html: d.email.html,
        headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    }).catch(() => null);
    if (res?.ok) {
      sent++;
      record.push({ userId: p.userId, workspaceId: p.workspaceId, keys: d.keys, sent: true });
    } else {
      // Not recorded, so the same things count as new at the next run.
      failed++;
      console.error('digest email failed', res?.status ?? 'unreachable');
      await res?.body?.cancel();
    }
    await sleep(600); // within Resend's rate limit
  }
  const recorded = await rpc('needs_digest_record', { entries: record });
  return reply(200, { ok: true, people: people.length, sent, failed, recorded });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !SECRET_KEY) return fail(500, 'NOT_CONFIGURED', 'Supabase environment is incomplete.');

  // One-click unsubscribe from a mail app: POST to the link in the List-Unsubscribe header.
  const oneClick = new URL(req.url).searchParams.get('unsubscribe');
  if (oneClick !== null) { await req.body?.cancel(); return unsubscribe(oneClick); }

  const body = await req.json().catch(() => null);
  try {
    if (body?.action === 'unsubscribe') return await unsubscribe(body.token);
    if (body?.action === 'digest') {
      const secret = req.headers.get('x-digest-secret') ?? '';
      if (!/^[0-9a-f]{64}$/.test(secret) || !(await rpc('needs_digest_secret_ok', { candidate: secret }))) return fail(401, 'UNAUTHENTICATED', 'Not the schedule.');
      return await digest();
    }
    return fail(400, 'INVALID_REQUEST', 'Unknown action.');
  } catch (e) {
    console.error('journey-notify', (e as Error).message);
    return fail(500, 'FAILED', 'Something went wrong. Try again in a minute.');
  }
});
