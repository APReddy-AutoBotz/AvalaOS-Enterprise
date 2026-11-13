// journey-invite: sends the invitation email for an open invitation.
//
// POST { workspaceId, email } -> { ok: true, sent: true, id }
//
// The caller's own token decides access: list_people returns invitations only to admins, and the caller
// must be an admin member of the workspace. The email is built by domain/people/inviteEmail.ts and sent
// through Resend. Secrets: RESEND_API_KEY (unset: 503 EMAIL_NOT_CONFIGURED, nothing is sent). Optional:
// EMAIL_FROM (default "Avala OS <no-reply@avalaos.com>"), SITE_URL (default https://avalaos.com),
// ALLOWED_ORIGIN. Deployed with verify_jwt = false because the function authenticates the caller itself.

import { inviteEmail } from '../../../domain/people/inviteEmail.ts';
import { validateEmail, type AccessLevel, type Job } from '../../../domain/people/roles.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');

function pickKey(jsonVar: string, legacyVar: string): string {
  try {
    const parsed = JSON.parse(env(jsonVar) || '{}');
    if (typeof parsed.default === 'string' && parsed.default) return parsed.default;
  } catch { /* fall through to the legacy key */ }
  return env(legacyVar);
}
const PUBLISHABLE_KEY = pickKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');

const CORS = {
  'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => reply(status, { ok: false, error: { code, message } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface People {
  members: { userId: string; name: string; role: AccessLevel }[];
  invites: { email: string; role: AccessLevel; job: Job | null; canApprove: boolean }[];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) return fail(500, 'NOT_CONFIGURED', 'Supabase environment is incomplete.');

  const body = await req.json().catch(() => null) as { workspaceId?: unknown; email?: unknown } | null;
  const workspaceId = typeof body?.workspaceId === 'string' && UUID.test(body.workspaceId) ? body.workspaceId : null;
  if (!workspaceId) return fail(400, 'BAD_REQUEST', 'workspaceId must be a workspace id.');
  let email: string;
  try { email = validateEmail(typeof body?.email === 'string' ? body.email : ''); } catch (e) { return fail(400, 'BAD_REQUEST', (e as Error).message); }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail(401, 'UNAUTHENTICATED', 'Sign in again.');
  const asCaller = { apikey: PUBLISHABLE_KEY, Authorization: auth, 'Content-Type': 'application/json' };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: asCaller });
  const user = userRes.ok ? await userRes.json() : null;
  if (typeof user?.id !== 'string') return fail(401, 'UNAUTHENTICATED', 'Sign in again.');

  const peopleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_people`, { method: 'POST', headers: asCaller, body: JSON.stringify({ target_workspace: workspaceId }) });
  if (!peopleRes.ok) return fail(peopleRes.status === 404 ? 404 : 403, 'FORBIDDEN', 'You are not a member of this workspace.');
  const people = await peopleRes.json() as People;
  const me = people.members.find(m => m.userId === user.id);
  if (me?.role !== 'admin') return fail(403, 'FORBIDDEN', 'Only an admin can send invitations.');
  const invite = people.invites.find(i => i.email === email);
  if (!invite) return fail(404, 'NO_INVITATION', 'There is no open invitation for that address in this workspace.');

  const key = env('RESEND_API_KEY');
  if (!key) return fail(503, 'EMAIL_NOT_CONFIGURED', 'Invitation emails are not set up yet. Tell the person to sign in at avalaos.com with this address.');

  const wsRes = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=name,organizations(name)`, { headers: asCaller });
  const ws = wsRes.ok ? (await wsRes.json())[0] : null;
  if (!ws) return fail(404, 'WORKSPACE_NOT_FOUND', 'No such workspace.');

  let message: ReturnType<typeof inviteEmail>;
  try {
    message = inviteEmail({
      to: email, workspace: ws.name ?? '', organization: ws.organizations?.name ?? '',
      inviter: me.name === 'Unnamed member' ? '' : me.name,
      invite: { access: invite.role, job: invite.job, canApprove: invite.canApprove },
      siteUrl: env('SITE_URL') || 'https://avalaos.com',
    });
  } catch (e) {
    return fail(500, 'NOT_CONFIGURED', (e as Error).message);
  }

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM') || 'Avala OS <no-reply@avalaos.com>', to: [message.to], subject: message.subject, text: message.text, html: message.html }),
  });
  const result = await sent.json().catch(() => ({}));
  if (!sent.ok) {
    console.error('resend failed', sent.status, result?.name ?? '');
    return fail(502, 'EMAIL_FAILED', sent.status === 429 ? 'Too many emails sent today. Try again later.' : 'The email could not be sent. Try again later.');
  }
  return reply(200, { ok: true, sent: true, id: result?.id ?? null });
});
