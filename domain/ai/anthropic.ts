// Anthropic (Claude) for bring your own key. Pure: no I/O.
//
// Every task builds one request shape, the OpenAI Responses API body (domain/ai/gateway.ts). For a
// workspace on Anthropic, that body is translated here into a Messages API request, and the reply is
// read back into the same ParsedResponse, so the tasks, the excerpt checks and the call sites stay one.
//
// - instructions -> system; a string input -> one user message; input_text / input_image parts -> text /
//   base64 image blocks.
// - text.format (strict JSON schema) -> output_config.format (Anthropic's structured outputs). Anthropic
//   accepts a narrower JSON Schema than OpenAI; schemaProblems lists what it would refuse, and a test
//   keeps every registered task inside it.
// - max_output_tokens -> max_tokens. reasoning and store have no counterpart and are left out.

import type { ParsedResponse } from './gateway.ts';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic's limit for one image sent in a request (decoded bytes). */
export const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ProviderRequestError extends Error {
  code: 'TOO_LARGE' | 'INVALID_REQUEST';
  constructor(code: 'TOO_LARGE' | 'INVALID_REQUEST', message: string) { super(message); this.code = code; }
}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The decoded size of base64 data, without decoding it. */
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

/** Where the Messages request goes: Anthropic itself, or Claude on Amazon Bedrock (a smaller image limit). */
export interface AnthropicTarget { label: string; maxImageBytes: number }
const ANTHROPIC: AnthropicTarget = { label: 'Anthropic', maxImageBytes: ANTHROPIC_MAX_IMAGE_BYTES };
const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;

function imageBlock(url: unknown, target: AnthropicTarget) {
  const m = typeof url === 'string' ? IMAGE_DATA_URL.exec(url) : null;
  if (!m) throw new ProviderRequestError('INVALID_REQUEST', 'The image must be a PNG, JPEG, WebP or GIF.');
  if (base64Bytes(m[2]) > target.maxImageBytes) throw new ProviderRequestError('TOO_LARGE', `The image is too large for ${target.label}; use one under ${mb(target.maxImageBytes)}.`);
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

function contentBlocks(content: unknown, target: AnthropicTarget): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) throw new ProviderRequestError('INVALID_REQUEST', 'Unsupported message content.');
  return content.map((part: any) => {
    if (part?.type === 'input_text') return { type: 'text', text: String(part.text ?? '') };
    if (part?.type === 'input_image') return imageBlock(part.image_url, target);
    throw new ProviderRequestError('INVALID_REQUEST', `Unsupported content part ${String(part?.type)}.`);
  });
}

/** A Responses API body as a Messages API body. */
export function toAnthropicRequest(body: Record<string, any>, target: AnthropicTarget = ANTHROPIC): Record<string, unknown> {
  const input = body.input;
  const messages = typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : Array.isArray(input)
      ? input.map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: contentBlocks(m?.content, target) }))
      : null;
  if (!messages || messages.length === 0) throw new ProviderRequestError('INVALID_REQUEST', 'The request has no input.');
  const out: Record<string, unknown> = { model: body.model, max_tokens: Number(body.max_output_tokens) || 1024, messages };
  if (typeof body.instructions === 'string' && body.instructions) out.system = body.instructions;
  const format = body.text?.format;
  if (format?.type === 'json_schema') out.output_config = { format: { type: 'json_schema', schema: format.schema } };
  return out;
}

/** The request headers (the key goes only to Anthropic's own address). */
export const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json',
});

/** Reads a Messages API result into the gateway's shape. */
export function parseAnthropicResponse(json: unknown): ParsedResponse {
  const r = (json ?? {}) as Record<string, any>;
  const u = r.usage ?? {};
  const usage = {
    input: Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
  };
  if (r.type === 'error' || r.error) return { ok: false, code: 'PROVIDER_ERROR', message: String(r.error?.message ?? 'Provider error'), usage };
  const text = (Array.isArray(r.content) ? r.content : []).filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('');
  if (r.stop_reason === 'refusal') return { ok: false, code: 'REFUSED', message: text.slice(0, 300) || 'The model refused.', usage };
  if (r.stop_reason === 'max_tokens') return { ok: false, code: 'TRUNCATED', message: 'Response incomplete: max_tokens.', usage };
  if (!text) return { ok: false, code: 'INVALID_OUTPUT', message: 'No output text.', usage };
  try {
    return { ok: true, data: JSON.parse(text), usage };
  } catch {
    return { ok: false, code: 'INVALID_OUTPUT', message: 'Output was not valid JSON.', usage };
  }
}

// Anthropic's structured outputs: keywords it refuses and its per-request limits.
const REFUSED_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'oneOf', 'not', 'patternProperties'];
export const ANTHROPIC_SCHEMA_LIMITS = { optionalProperties: 24, unionProperties: 16 } as const;

/** What Anthropic's structured outputs would refuse in a schema; empty when it is accepted. */
export function schemaProblems(schema: unknown): string[] {
  const problems: string[] = [];
  let optional = 0;
  let unions = 0;
  const walk = (s: any, path: string) => {
    if (!s || typeof s !== 'object') return;
    for (const k of REFUSED_KEYWORDS) if (k in s) problems.push(`${path || '/'}: ${k} is not supported`);
    if ('minItems' in s && s.minItems > 1) problems.push(`${path || '/'}: minItems above 1 is not supported`);
    if (Array.isArray(s.type) || Array.isArray(s.anyOf)) unions++;
    if (s.type === 'object' || s.properties) {
      if (s.additionalProperties !== false) problems.push(`${path || '/'}: additionalProperties must be false`);
      const required = new Set<string>(s.required ?? []);
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        if (!required.has(k)) optional++;
        walk(v, `${path}/${k}`);
      }
    }
    if (s.items) walk(s.items, `${path}[]`);
    for (const [i, a] of (s.anyOf ?? []).entries()) walk(a, `${path}|${i}`);
    for (const [k, v] of Object.entries(s.$defs ?? s.definitions ?? {})) walk(v, `#${k}`);
  };
  walk(schema, '');
  if (optional > ANTHROPIC_SCHEMA_LIMITS.optionalProperties) problems.push(`${optional} optional properties (at most ${ANTHROPIC_SCHEMA_LIMITS.optionalProperties})`);
  if (unions > ANTHROPIC_SCHEMA_LIMITS.unionProperties) problems.push(`${unions} properties with union types (at most ${ANTHROPIC_SCHEMA_LIMITS.unionProperties})`);
  return problems;
}
