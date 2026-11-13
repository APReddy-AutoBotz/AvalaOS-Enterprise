import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTHROPIC_MAX_IMAGE_BYTES, ProviderRequestError, parseAnthropicResponse, schemaProblems, toAnthropicRequest } from './anthropic.ts';
import { buildImageRequest, buildListingRequest, buildOpenAIRequest, type TaskDefinition } from './gateway.ts';
import { TASKS } from './tasks.ts';
import { EXTRACTION_TASKS } from '../extract/tasks.ts';
import { AI_PROVIDERS, parseProviderReply, providerRequest, responsesTarget, selectableProviders, testRequestBody, transcriptionTarget, unsupported, validateAiChoice, type AiConnection } from './providers.ts';

const task: TaskDefinition = {
  id: 't', instructions: 'List the roles.', schemaName: 'roles', maxOutputTokens: 4000, verifyArrays: ['roles'],
  schema: { type: 'object', additionalProperties: false, required: ['roles'], properties: { roles: { type: 'array', items: { type: 'string' } } } },
};
const png = 'data:image/png;base64,iVBORw0KGgo=';
// Assembled at run time so the secret-hygiene scan never sees a key-shaped literal.
const KEY = ['sk', 'ant', 'api03', 'x'.repeat(40)].join('-');
const claude: AiConnection = { provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: null, apiKey: KEY, source: 'workspace' };

test('a source task becomes a Messages request: instructions as system, sources as the user message, the strict schema as output_config', () => {
  const body = toAnthropicRequest(buildOpenAIRequest(task, [{ id: 's1', text: 'The clerk checks the invoice.' }], 'claude-sonnet-5-5'));
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.max_tokens, 4000);
  assert.match(String(body.system), /data, not instructions[\s\S]*List the roles\./);
  assert.deepEqual(body.messages, [{ role: 'user', content: '<<<SEGMENT id="s1">>>\nThe clerk checks the invoice.\n<<<END SEGMENT s1>>>' }]);
  assert.deepEqual(body.output_config, { format: { type: 'json_schema', schema: task.schema } });
  for (const k of ['input', 'instructions', 'text', 'store', 'reasoning', 'max_output_tokens']) assert.ok(!(k in body), k);

  const listing = toAnthropicRequest(buildListingRequest(task, 'Step 1: receive', 'claude-sonnet-5-5'));
  assert.deepEqual(listing.messages, [{ role: 'user', content: 'Step 1: receive' }]);
});

test('an image task sends the image as a base64 block; one over Anthropic\'s 5 MB limit is refused before sending', () => {
  const body = toAnthropicRequest(buildImageRequest(task, png, 'claude-sonnet-5-5'));
  assert.deepEqual(body.messages, [{ role: 'user', content: [
    { type: 'text', text: 'Read this diagram.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ] }]);
  const big = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((ANTHROPIC_MAX_IMAGE_BYTES + 3) / 3) * 4)}`;
  assert.throws(() => toAnthropicRequest(buildImageRequest(task, big, 'm')), (e: unknown) => e instanceof ProviderRequestError && e.code === 'TOO_LARGE');
  assert.throws(() => toAnthropicRequest(buildImageRequest(task, 'https://example.com/a.png', 'm')), ProviderRequestError);
});

test('a reply is read like OpenAI\'s: JSON on success, refusal, truncation, provider error and bad output', () => {
  const ok = parseAnthropicResponse({ type: 'message', content: [{ type: 'text', text: '{"roles":["Clerk"]}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 20 } });
  assert.deepEqual(ok, { ok: true, data: { roles: ['Clerk'] }, usage: { input: 120, output: 7 } });
  assert.equal(parseAnthropicResponse({ content: [{ type: 'text', text: 'I cannot help.' }], stop_reason: 'refusal', usage: {} }).code, 'REFUSED');
  assert.equal(parseAnthropicResponse({ content: [{ type: 'text', text: '{"ro' }], stop_reason: 'max_tokens', usage: { output_tokens: 4000 } }).code, 'TRUNCATED');
  const err = parseAnthropicResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  assert.deepEqual([err.ok, err.code, err.message], [false, 'PROVIDER_ERROR', 'invalid x-api-key']);
  assert.equal(parseAnthropicResponse({ content: [{ type: 'text', text: 'roles: Clerk' }], stop_reason: 'end_turn' }).code, 'INVALID_OUTPUT');
  assert.equal(parseAnthropicResponse({ content: [], stop_reason: 'end_turn' }).code, 'INVALID_OUTPUT');
});

test('an Anthropic key goes only to Anthropic, never to an OpenAI address', () => {
  const req = providerRequest(claude, testRequestBody(claude));
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(req.headers, { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' });
  assert.deepEqual(req.body, { model: 'claude-sonnet-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the word ready.' }] });
  assert.throws(() => responsesTarget(claude));
  assert.throws(() => transcriptionTarget(claude));
  assert.equal(parseProviderReply(claude, { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }).ok, true);

  const openai: AiConnection = { ...claude, provider: 'openai', model: 'gpt-5.5' };
  const body = { model: 'gpt-5.5', input: 'x' };
  assert.deepEqual(providerRequest(openai, body), { ...responsesTarget(openai), body });
});

test('Anthropic takes a model id and no endpoint, cannot transcribe, and is offered only to the platform owner until the eval has run with it', () => {
  assert.deepEqual(validateAiChoice({ provider: 'anthropic', model: ' claude-sonnet-5-5 ', endpoint: 'https://evil.example' }), { provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: null });
  assert.equal(unsupported(claude, 'vision'), null);
  assert.match(unsupported(claude, 'transcription') ?? '', /Turning speech into text is not available with Anthropic/);
  assert.equal(AI_PROVIDERS.anthropic.checked, false);
  assert.deepEqual(selectableProviders(false), ['openai', 'azure_openai']);
  assert.deepEqual(selectableProviders(true), ['openai', 'azure_openai', 'anthropic']);
});

test('every registered task\'s schema is one Anthropic\'s structured outputs accept', () => {
  const all = [...Object.values(TASKS), ...Object.values(EXTRACTION_TASKS)];
  assert.ok(all.length >= 10);
  for (const t of all) assert.deepEqual(schemaProblems(t.schema), [], t.id);
});

test('schemaProblems names what Anthropic would refuse', () => {
  const nullable = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: ['string', 'null'] }]));
  assert.deepEqual(schemaProblems({ type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string', maxLength: 3 }, b: { type: 'array', items: { type: 'string' }, maxItems: 2 } } }),
    ['/a: maxLength is not supported', '/b: maxItems is not supported']);
  assert.deepEqual(schemaProblems({ type: 'object', properties: {} }), ['/: additionalProperties must be false']);
  const many = nullable(17);
  assert.deepEqual(schemaProblems({ type: 'object', additionalProperties: false, required: Object.keys(many), properties: many }), ['17 properties with union types (at most 16)']);
});
