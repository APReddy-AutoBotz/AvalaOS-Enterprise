// Error monitoring (Sentry, free Developer plan). Off unless the build has VITE_SENTRY_DSN: then the SDK is
// loaded on demand, errors only (no session replay, no performance tracing, no console logs), and every
// report goes through scrubEvent (domain/site/errors.ts) first: no account, email address or link token.
import { scrubBreadcrumb, scrubEvent, type ReportBreadcrumb, type ReportEvent } from '../domain/site/errors.ts';

type SentryModule = typeof import('@sentry/react');
let sentry: SentryModule | null = null;
const early: unknown[] = [];

export async function startMonitoring(dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN): Promise<void> {
  if (!dsn || sentry) return;
  try {
    const S = await import('@sentry/react');
    S.init({
      dsn,
      environment: location.hostname === 'avalaos.com' ? 'production' : location.hostname.endsWith('.netlify.app') ? 'preview' : 'local',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: event => scrubEvent(event as ReportEvent) as typeof event,
      beforeBreadcrumb: crumb => scrubBreadcrumb(crumb as ReportBreadcrumb) as typeof crumb | null,
    });
    sentry = S;
    for (const e of early.splice(0)) S.captureException(e);
  } catch { /* monitoring must never stop the product */ }
}

/** An error the product caught (a screen that failed to draw). Kept until monitoring has started. */
export function report(error: unknown): void {
  if (sentry) sentry.captureException(error);
  else if (import.meta.env.VITE_SENTRY_DSN && early.length < 20) early.push(error);
}
