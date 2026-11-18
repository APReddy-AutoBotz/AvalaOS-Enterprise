// Which websites may call the server functions from a browser (item 8 of package 13 B). A function
// answers with the caller's own address in Access-Control-Allow-Origin only when that address is on this
// list, and always says "Vary: Origin", so a cache never hands one site's answer to another. Before, the
// functions answered "*" (any site) unless ALLOWED_ORIGIN named one.
//
// The list: avalaos.com, www.avalaos.com, and the Netlify addresses of this site (its main address, a
// branch and a deploy preview: avala-os.netlify.app, next--avala-os.netlify.app,
// deploy-preview-196--avala-os.netlify.app). ALLOWED_ORIGIN may add exact addresses, separated by commas
// (for example http://localhost:5173 while developing); "*" in it is ignored.

export const SITE_ORIGINS = ['https://avalaos.com', 'https://www.avalaos.com'] as const;
const NETLIFY = /^https:\/\/([a-z0-9-]+--)?avala-os\.netlify\.app$/;

/** The extra addresses ALLOWED_ORIGIN names: exact http(s) origins only. */
export function extraOrigins(setting: string): string[] {
  return setting.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(s));
}

/** Whether a browser on this address may read the function's answers. */
export function originAllowed(origin: string | null, setting = ''): boolean {
  if (!origin) return false;
  return (SITE_ORIGINS as readonly string[]).includes(origin) || NETLIFY.test(origin) || extraOrigins(setting).includes(origin);
}

/** The cross-site headers of one answer: the caller's address only when it is allowed, and Vary: Origin always. */
export function corsHeaders(origin: string | null, setting: string, methods = 'POST, OPTIONS'): Record<string, string> {
  return {
    ...(originAllowed(origin, setting) ? { 'Access-Control-Allow-Origin': origin! } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
    Vary: 'Origin',
  };
}

/**
 * A server function's handler with these headers put on every answer it gives, the OPTIONS answer and
 * errors included. Worked out per request, so two callers at once never see each other's address.
 */
export function withCors(handler: (req: Request) => Response | Promise<Response>, setting: string, methods = 'POST, OPTIONS'): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const res = await handler(req);
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    for (const [k, v] of Object.entries(corsHeaders(req.headers.get('Origin'), setting, methods))) out.headers.set(k, v);
    return out;
  };
}
