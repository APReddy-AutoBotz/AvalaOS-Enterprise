import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageRequest, buildOpenAIRequest, type TaskDefinition } from './gateway.ts';
import { toChatRequest } from './compatible.ts';
import {
  AI_PROVIDERS, MISTRAL_CHAT_URL, hostToCheck, parseProviderReply, providerRequest, responsesTarget, selectableProviders, testRequestBody,
  transcriptionTarget, unsupported, validateAiChoice, type AiConnection,
} from './providers.ts';

const task: TaskDefinition = {
  id: 't', instructions: 'List the roles.', schemaName: 'roles', maxOutputTokens: 4000, verifyArrays: ['roles'],
  schema: { type: 'object', additionalProperties: false, required: ['roles'], properties: { roles: { type: 'array', items: { type: 'string' } } } },
};
// Assembled at run time so the secret-hygiene scan never sees a key-shaped literal.
const KEY = ['mistral', 'k'.repeat(32)].join('');
const conn: AiConnection = { provider: 'mistral', model: 'ministral-8b-latest', endpoint: null, apiKey: KEY, source: 'workspace' };

test('Mistral takes a model id and no endpoint, and its key goes only to api.mistral.ai', () => {
  assert.deepEqual(validateAiChoice({ provider: 'mistral', model: ' ministral-3b-latest ', endpoint: 'https://evil.example' }), { provider: 'mistral', model: 'ministral-3b-latest', endpoint: null });
  const req = providerRequest(conn, testRequestBody(conn));
  assert.equal(req.url, MISTRAL_CHAT_URL);
  assert.equal(MISTRAL_CHAT_URL, 'https://api.mistral.ai/v1/chat/completions');
  assert.deepEqual(req.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
  assert.deepEqual(req.body, { model: 'ministral-8b-latest', messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 64 });
  assert.throws(() => responsesTarget(conn));
  assert.throws(() => transcriptionTarget(conn));
  assert.equal(hostToCheck(conn), null, 'a fixed address needs no lookup');
});

test('a task becomes Mistral\'s structured output request; an image goes as a data URL string, as Mistral takes it', () => {
  const body = providerRequest(conn, buildOpenAIRequest(task, [{ id: 's1', text: 'The clerk checks.' }], conn.model)).body;
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'roles', strict: true, schema: task.schema } });
  assert.equal((body.messages as any[])[0].role, 'system');

  const image = providerRequest(conn, buildImageRequest(task, 'data:image/png;base64,AAAA', conn.model)).body;
  assert.deepEqual((image.messages as any[])[1].content[1], { type: 'image_url', image_url: 'data:image/png;base64,AAAA' });
  // OpenAI-style servers keep the object form.
  assert.deepEqual((toChatRequest(buildImageRequest(task, 'data:image/png;base64,AAAA', 'm')).messages as any[])[1].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });

  assert.deepEqual(parseProviderReply(conn, { choices: [{ message: { content: '{"roles":["Clerk"]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } }),
    { ok: true, data: { roles: ['Clerk'] }, usage: { input: 20, output: 4 } });
  assert.equal(parseProviderReply(conn, { choices: [{ message: { content: '{"ro' }, finish_reason: 'length' }] }).code, 'TRUNCATED');
});

test('light models are suggested, transcription is not offered, and Mistral waits for the eval before workspaces see it', () => {
  assert.deepEqual(AI_PROVIDERS.mistral.suggestedModels?.map(m => m.id), ['mistral-small-latest', 'ministral-14b-latest', 'ministral-8b-latest', 'ministral-3b-latest']);
  for (const m of AI_PROVIDERS.mistral.suggestedModels ?? []) assert.doesNotThrow(() => validateAiChoice({ provider: 'mistral', model: m.id }), m.id);
  assert.match(unsupported(conn, 'transcription') ?? '', /Mistral AI/);
  assert.equal(unsupported(conn, 'vision'), null);
  assert.equal(AI_PROVIDERS.mistral.checked, false);
  assert.ok(!selectableProviders(false).includes('mistral'));
  assert.ok(selectableProviders(true).includes('mistral'));
});
