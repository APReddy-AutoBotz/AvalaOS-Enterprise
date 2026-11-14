// What an error report may carry when it leaves the browser for error monitoring (Sentry). Pure, so it is
// tested: no account, no email address, no name, and no token from a link (password reset, unsubscribe,
// a sign-in return). Addresses keep their path and lose their query and fragment; text loses anything
// shaped like an email address, a JSON Web Token or a long key.

export interface ReportBreadcrumb { category?: string; message?: string; data?: Record<string, unknown> }
export interface ReportEvent {
  message?: string;
  user?: unknown;
  extra?: unknown;
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: unknown; data?: unknown };
  exception?: { values?: { value?: string; type?: string }[] };
  breadcrumbs?: ReportBreadcrumb[];
  tags?: Record<string, unknown>;
}

/** An address without its query or fragment, where tokens travel. Relative paths stay relative. */
export function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/s, '');
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const KEY = /\b(?:sk|pk|sb|rk)[-_][A-Za-z0-9_-]{16,}\b|\b[A-Za-z0-9_-]{40,}\b/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>]+/g;

export function scrubText(text: string): string {
  return text.replace(URL_IN_TEXT, u => scrubUrl(u)).replace(JWT, '[token]').replace(EMAIL, '[email]').replace(KEY, '[key]');
}

export function scrubBreadcrumb(b: ReportBreadcrumb): ReportBreadcrumb | null {
  // What was logged to the console can hold anything a screen held: it is not sent.
  if (b.category === 'console') return null;
  const data = b.data ? Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, typeof v === 'string' ? (/url|from|to/i.test(k) ? scrubUrl(v) : scrubText(v)) : v])) : undefined;
  return { ...b, ...(b.message !== undefined ? { message: scrubText(b.message) } : {}), ...(data ? { data } : {}) };
}

export function scrubEvent<E extends ReportEvent>(event: E): E {
  const e: E = { ...event };
  delete e.user;
  delete e.extra;
  if (e.message) e.message = scrubText(e.message);
  if (e.request) e.request = e.request.url ? { url: scrubUrl(e.request.url) } : {};
  if (e.exception?.values) e.exception = { ...e.exception, values: e.exception.values.map(v => ({ ...v, ...(v.value ? { value: scrubText(v.value) } : {}) })) };
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb).filter((b): b is ReportBreadcrumb => b !== null);
  return e;
}
