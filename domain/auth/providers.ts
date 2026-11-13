// Sign-in with Google and Microsoft. Pure: which providers the server has turned on, and what to tell
// the person when a provider sends them back with an error. The store and the sign-in page use these.
// Sign-up stays by invitation: the database refuses an account for an email nobody invited, whichever
// way it is created, and an invitation is claimed only once the email address is confirmed.

export const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'azure', label: 'Microsoft' },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

export const providerLabel = (id: string): string => PROVIDERS.find(p => p.id === id)?.label ?? id;

/** The providers turned on in the auth server's public settings (GET /auth/v1/settings), in display order. */
export function enabledProviders(settings: unknown): ProviderId[] {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== 'object') return [];
  return PROVIDERS.filter(p => external[p.id] === true).map(p => p.id);
}

/** Microsoft must be asked for the email address; Supabase needs it to match the invitation. */
export const providerScopes = (id: ProviderId): string | undefined => (id === 'azure' ? 'email' : undefined);

const INVITE_ONLY = 'Sign-up is by invitation. Ask a workspace admin to invite the email address you sign in with, then try again.';

/**
 * The message for a sign-in that came back with an error (in the query or the fragment), or null when
 * the address carries none. The raw text from the server is shown only when nothing better is known.
 */
export function redirectError(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('error') ?? fragment.get('error');
  if (!code) return null;
  const text = (params.get('error_description') ?? fragment.get('error_description') ?? '').replace(/\+/g, ' ').trim();
  if (/database error saving new user|invitation/i.test(text)) return INVITE_ONLY;
  if (/unverified email/i.test(text)) {
    return 'The provider did not confirm this email address, so we have sent a confirmation email to it. Open the link in that email, then sign in again.';
  }
  if (code === 'access_denied' && !/provider is not enabled/i.test(text)) return 'Sign-in was cancelled.';
  if (/provider is not enabled/i.test(text)) return 'That sign-in option is not available yet. Sign in with your email and password.';
  return `Sign-in did not complete${text ? `: ${text}` : '.'}`;
}

/** The same address without the error parameters, so a reload does not show the message again. */
export function withoutRedirectError(pathname: string, search: string, hash: string): string {
  const drop = ['error', 'error_code', 'error_description'];
  const params = new URLSearchParams(search);
  drop.forEach(k => params.delete(k));
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const hadErrorInHash = drop.some(k => fragment.has(k));
  drop.forEach(k => fragment.delete(k));
  const q = params.toString();
  const h = hadErrorInHash ? fragment.toString() : hash.replace(/^#/, '');
  return `${pathname}${q ? `?${q}` : ''}${h ? `#${h}` : ''}`;
}
