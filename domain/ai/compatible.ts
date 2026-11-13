// An OpenAI-compatible endpoint a company runs itself (vLLM, LiteLLM, Ollama behind a gateway, a hosted
// inference service) for bring your own key. Pure: no I/O; the DNS lookup is passed in.
//
// - Requests go to the endpoint's Chat Completions API, the one such servers have in common: every task's
//   Responses API body is translated here, the strict schema as response_format json_schema.
// - The endpoint is an address an admin typed, so the server must never be turned against itself or a
//   private network: https only, a public host name (no IP address, no local or internal name), no port,
//   no credentials, query or fragment; and before each use the host must resolve only to public addresses
//   (assertPublicHost). Provider calls do not follow redirects.

import type { ParsedResponse } from './gateway.ts';

export class EndpointError extends Error {}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/;
const NOT_PUBLIC_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'home.arpa', 'localdomain', 'test', 'invalid', 'example'];

const HINT = 'Enter the https address of your endpoint, like https://llm.example-company.com/v1.';

/**
 * The endpoint's base address, normalised: https://host[/path], lower-case host, no trailing slash, and
 * a pasted .../chat/completions removed. Throws EndpointError with a plain message otherwise.
 */
export function validateCompatibleEndpoint(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  let url: URL;
  try { url = new URL(text); } catch { throw new EndpointError(HINT); }
  if (url.protocol !== 'https:') throw new EndpointError('The endpoint must use https.');
  if (url.username || url.password) throw new EndpointError('Leave the user name and password out of the address; paste the key below instead.');
  if (url.port) throw new EndpointError('The endpoint must be on the standard https port (443).');
  if (url.search || url.hash) throw new EndpointError('Leave any ? or # part out of the address.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^[0-9.]+$/.test(host) || /^0x/i.test(host)) throw new EndpointError('Use the endpoint\'s host name, not an IP address.');
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every(l => LABEL.test(l)) || /^[0-9]+$/.test(labels[labels.length - 1])) throw new EndpointError(HINT);
  if (NOT_PUBLIC_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`))) throw new EndpointError('The endpoint must be reachable on the internet, not a local or internal name.');
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.every(s => PATH_SEGMENT.test(s))) throw new EndpointError(HINT);
  if (segments.slice(-2).join('/') === 'chat/completions') segments.splice(-2);
  const out = `https://${host}${segments.length ? `/${segments.join('/')}` : ''}`;
  if (out.length > 200) throw new EndpointError('The endpoint address is too long.');
  return out;
}

/** True for an address that is not on the public internet (loopback, private, link-local, carrier, reserved). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast and reserved
      || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
      || (a === 169 && b === 254) // link-local, including cloud metadata
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) // private
      || (a === 192 && b === 0 && (c === 0 || c === 2)) // protocol assignments, documentation
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113); // benchmarking, documentation
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return true; // not an address we can read: treat as not public
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (s === '::' || s === '::1') return true;
  const first = parseInt(s.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
    || (first & 0xff00) === 0xff00 // multicast
    || s.startsWith('64:ff9b:') || s.startsWith('2001:db8:') || s.startsWith('::ffff:');
}

export type Resolve = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

/**
 * Checks, just before a call, that the endpoint's host resolves to public addresses only (so a name that
 * points at a private or cloud metadata address is refused). Throws EndpointError otherwise.
 */
export async function assertPublicHost(host: string, resolve: Resolve): Promise<void> {
  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { found.push(...await resolve(host, type)); } catch { /* no record of this type */ }
  }
  if (found.length === 0) throw new EndpointError(`The endpoint ${host} could not be found.`);
  if (found.some(isPrivateAddress)) throw new EndpointError(`The endpoint ${host} points to a private address; use an address reachable on the internet.`);
}

// ---- Chat Completions ---------------------------------------------------------------------------

/** A Responses API body as a Chat Completions body. */
export function toChatRequest(body: Record<string, any>): Record<string, unknown> {
  const messages: unknown[] = [];
  if (typeof body.instructions === 'string' && body.instructions) messages.push({ role: 'system', content: body.instructions });
  if (typeof body.input === 'string') messages.push({ role: 'user', content: body.input });
  else if (Array.isArray(body.input)) {
    for (const m of body.input) {
      const content = typeof m?.content === 'string' ? m.content : (Array.isArray(m?.content) ? m.content : []).map((p: any) => {
        if (p?.type === 'input_text') return { type: 'text', text: String(p.text ?? '') };
        if (p?.type === 'input_image') return { type: 'image_url', image_url: { url: String(p.image_url ?? '') } };
        throw new EndpointError(`Unsupported content part ${String(p?.type)}.`);
      });
      messages.push({ role: m?.role === 'assistant' ? 'assistant' : 'user', content });
    }
  }
  const out: Record<string, unknown> = { model: body.model, messages, max_tokens: Number(body.max_output_tokens) || 1024 };
  const format = body.text?.format;
  if (format?.type === 'json_schema') out.response_format = { type: 'json_schema', json_schema: { name: format.name ?? 'output', strict: true, schema: format.schema } };
  return out;
}

/** Reads a Chat Completions result into the gateway's shape. */
export function parseChatResponse(json: unknown): ParsedResponse {
  const r = (json ?? {}) as Record<string, any>;
  const usage = { input: Number(r.usage?.prompt_tokens ?? 0) || 0, output: Number(r.usage?.completion_tokens ?? 0) || 0 };
  if (r.error) return { ok: false, code: 'PROVIDER_ERROR', message: String(r.error.message ?? r.error ?? 'Provider error').slice(0, 300), usage };
  const choice = Array.isArray(r.choices) ? r.choices[0] : null;
  if (!choice) return { ok: false, code: 'INVALID_OUTPUT', message: 'No output.', usage };
  const msg = choice.message ?? {};
  if (msg.refusal) return { ok: false, code: 'REFUSED', message: String(msg.refusal).slice(0, 300), usage };
  if (choice.finish_reason === 'content_filter') return { ok: false, code: 'REFUSED', message: 'The model refused.', usage };
  if (choice.finish_reason === 'length') return { ok: false, code: 'TRUNCATED', message: 'Response incomplete: max_tokens.', usage };
  const text = typeof msg.content === 'string' ? msg.content
    : Array.isArray(msg.content) ? msg.content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('') : '';
  if (!text) return { ok: false, code: 'INVALID_OUTPUT', message: 'No output text.', usage };
  try {
    return { ok: true, data: JSON.parse(text), usage };
  } catch {
    return { ok: false, code: 'INVALID_OUTPUT', message: 'Output was not valid JSON.', usage };
  }
}
