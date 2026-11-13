import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EndpointError, assertPublicHost, isPrivateAddress, parseChatResponse, toChatRequest, validateCompatibleEndpoint } from './compatible.ts';
import { buildImageRequest, buildOpenAIRequest, type TaskDefinition } from './gateway.ts';
import { AiSettingsError, hostToCheck, parseProviderReply, providerRequest, responsesTarget, selectableProviders, testRequestBody, unsupported, validateAiChoice, type AiConnection } from './providers.ts';

const task: TaskDefinition = {
  id: 't', instructions: 'List the roles.', schemaName: 'roles', maxOutputTokens: 4000, verifyArrays: ['roles'],
  schema: { type: 'object', additionalProperties: false, required: ['roles'], properties: { roles: { type: 'array', items: { type: 'string' } } } },
};
const KEY = ['gw', 'key', 'x'.repeat(30)].join('-');
const conn: AiConnection = { provider: 'openai_compatible', model: 'meta-llama/Llama-3.3-70B-Instruct', endpoint: 'https://llm.acme-corp.com/v1', apiKey: KEY, source: 'workspace' };

test('an endpoint is a public https host name, normalised; a pasted /chat/completions is removed', () => {
  assert.equal(validateCompatibleEndpoint(' https://LLM.Acme-Corp.com/v1/ '), 'https://llm.acme-corp.com/v1');
  assert.equal(validateCompatibleEndpoint('https://llm.acme-corp.com/v1/chat/completions'), 'https://llm.acme-corp.com/v1');
  assert.equal(validateCompatibleEndpoint('https://gateway.acme-corp.co.uk'), 'https://gateway.acme-corp.co.uk');
  assert.equal(validateCompatibleEndpoint('https://ai.acme-corp.com/openai/Deployments-v2'), 'https://ai.acme-corp.com/openai/Deployments-v2');
});

test('an endpoint that could reach the server itself or a private network is refused', () => {
  for (const bad of [
    'http://llm.acme-corp.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/latest', 'https://[::1]/v1',
    'https://10.0.0.5/v1', 'https://2130706433/v1', 'https://0x7f000001/v1', 'https://llm.internal/v1', 'https://gpu.corp/v1',
    'https://box.local', 'https://intranet', 'https://user:pw@llm.acme-corp.com', 'https://llm.acme-corp.com:8443/v1',
    'https://llm.acme-corp.com/v1?x=1', 'https://llm.acme-corp.com/v1#a', 'https://llm.acme-corp.com/v1/%41', 'ftp://llm.acme-corp.com', '', 'llm.acme-corp.com',
  ]) assert.throws(() => validateCompatibleEndpoint(bad), EndpointError, bad);
});

test('private, loopback, link-local and reserved addresses are recognised; public ones are not', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'not-an-ip']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '52.94.1.1', '2606:4700:4700::1111', '2a00:1450:4009::200e']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('before a call the host must resolve, and only to public addresses', async () => {
  const dns = (table: Record<string, string[]>) => async (host: string, type: 'A' | 'AAAA') => {
    const v = table[`${host} ${type}`];
    if (!v) throw new Error('NXDOMAIN');
    return v;
  };
  await assertPublicHost('llm.acme-corp.com', dns({ 'llm.acme-corp.com A': ['52.94.1.1'], 'llm.acme-corp.com AAAA': ['2606:4700::1'] }));
  await assert.rejects(assertPublicHost('llm.acme-corp.com', dns({ 'llm.acme-corp.com A': ['52.94.1.1', '169.254.169.254'] })), /private address/);
  await assert.rejects(assertPublicHost('llm.acme-corp.com', dns({ 'llm.acme-corp.com AAAA': ['::1'] })), /private address/);
  await assert.rejects(assertPublicHost('llm.acme-corp.com', dns({})), /could not be found/);
  assert.equal(hostToCheck(conn), 'llm.acme-corp.com');
  assert.equal(hostToCheck({ ...conn, provider: 'openai', endpoint: null }), null);
});

test('a task becomes a Chat Completions request with the strict schema as response_format', () => {
  const body = toChatRequest(buildOpenAIRequest(task, [{ id: 's1', text: 'The clerk checks.' }], 'm'));
  assert.equal((body.messages as any[])[0].role, 'system');
  assert.match((body.messages as any[])[0].content, /List the roles\./);
  assert.deepEqual((body.messages as any[])[1], { role: 'user', content: '<<<SEGMENT id="s1">>>\nThe clerk checks.\n<<<END SEGMENT s1>>>' });
  assert.equal(body.max_tokens, 4000);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'roles', strict: true, schema: task.schema } });
  for (const k of ['input', 'instructions', 'text', 'store', 'reasoning']) assert.ok(!(k in body), k);

  const image = toChatRequest(buildImageRequest(task, 'data:image/png;base64,AAAA', 'm'));
  assert.deepEqual((image.messages as any[])[1].content, [{ type: 'text', text: 'Read this diagram.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
});

test('a Chat Completions reply is read: JSON, refusal, filter, truncation, error and bad output', () => {
  assert.deepEqual(parseChatResponse({ choices: [{ message: { content: '{"roles":["Clerk"]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } }),
    { ok: true, data: { roles: ['Clerk'] }, usage: { input: 50, output: 5 } });
  assert.equal(parseChatResponse({ choices: [{ message: { content: null, refusal: 'No.' }, finish_reason: 'stop' }] }).code, 'REFUSED');
  assert.equal(parseChatResponse({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }).code, 'REFUSED');
  assert.equal(parseChatResponse({ choices: [{ message: { content: '{"ro' }, finish_reason: 'length' }] }).code, 'TRUNCATED');
  assert.equal(parseChatResponse({ error: { message: 'model not found' } }).message, 'model not found');
  assert.equal(parseChatResponse({ choices: [{ message: { content: 'roles: Clerk' }, finish_reason: 'stop' }] }).code, 'INVALID_OUTPUT');
  assert.equal(parseChatResponse({}).code, 'INVALID_OUTPUT');
});

test('the key goes only to the endpoint\'s own /chat/completions, which is checked again on every use', () => {
  const req = providerRequest(conn, testRequestBody(conn));
  assert.equal(req.url, 'https://llm.acme-corp.com/v1/chat/completions');
  assert.deepEqual(req.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
  assert.deepEqual(req.body, { model: conn.model, messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 64 });
  assert.throws(() => responsesTarget(conn));
  assert.throws(() => providerRequest({ ...conn, endpoint: 'https://169.254.169.254' }, testRequestBody(conn)), EndpointError);
  assert.equal(parseProviderReply(conn, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }).ok, true);
});

test('the choice takes a served model name with a slash and the endpoint; no transcription; owner only until checked', () => {
  assert.deepEqual(validateAiChoice({ provider: 'openai_compatible', model: 'meta-llama/Llama-3.3-70B-Instruct', endpoint: 'https://LLM.acme-corp.com/v1/chat/completions' }),
    { provider: 'openai_compatible', model: 'meta-llama/Llama-3.3-70B-Instruct', endpoint: 'https://llm.acme-corp.com/v1' });
  assert.throws(() => validateAiChoice({ provider: 'openai_compatible', model: 'm', endpoint: 'https://10.0.0.1' }), AiSettingsError);
  assert.throws(() => validateAiChoice({ provider: 'openai_compatible', model: 'm' }), AiSettingsError);
  assert.match(unsupported(conn, 'transcription') ?? '', /OpenAI-compatible endpoint/);
  assert.ok(!selectableProviders(false).includes('openai_compatible'));
  assert.ok(selectableProviders(true).includes('openai_compatible'));
});
