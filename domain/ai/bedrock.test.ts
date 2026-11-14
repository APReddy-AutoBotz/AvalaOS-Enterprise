import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRequestError } from './anthropic.ts';
import { buildImageRequest, buildOpenAIRequest, type TaskDefinition } from './gateway.ts';
import {
  AI_PROVIDERS, AiSettingsError, hostToCheck, parseProviderReply, providerRequest, responsesTarget, selectableProviders, testRequestBody, transcriptionTarget,
  unsupported, validateAiChoice, type AiConnection,
} from './providers.ts';

const task: TaskDefinition = {
  id: 't', instructions: 'List the roles.', schemaName: 'roles', maxOutputTokens: 4000, verifyArrays: ['roles'],
  schema: { type: 'object', additionalProperties: false, required: ['roles'], properties: { roles: { type: 'array', items: { type: 'string' } } } },
};
// Assembled at run time so the secret-hygiene scan never sees a key-shaped literal.
const KEY = ['ABSK', 'Q'.repeat(60)].join('');
const conn: AiConnection = { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-5-5', endpoint: 'eu-central-1', apiKey: KEY, source: 'workspace' };

test('a Bedrock choice takes a Claude model or inference profile id and an AWS Region', () => {
  assert.deepEqual(validateAiChoice({ provider: 'bedrock', model: ' global.anthropic.claude-sonnet-5-5 ', endpoint: ' EU-Central-1 ' }),
    { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-5-5', endpoint: 'eu-central-1' });
  assert.equal(validateAiChoice({ provider: 'bedrock', model: 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123', endpoint: 'us-east-1' }).model,
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123');
  assert.equal(validateAiChoice({ provider: 'bedrock', model: 'm', endpoint: 'us-gov-west-1' }).endpoint, 'us-gov-west-1');
  for (const bad of ['', 'us-east', 'https://bedrock-runtime.us-east-1.amazonaws.com', 'us-east-1.evil.example', 'us_east_1', 'us-east-1/x']) {
    assert.throws(() => validateAiChoice({ provider: 'bedrock', model: 'm', endpoint: bad }), AiSettingsError, bad);
  }
});

test('the request goes to Bedrock\'s runtime in that Region with the key as a bearer token and Anthropic\'s body', () => {
  const req = providerRequest(conn, buildOpenAIRequest(task, [{ id: 's1', text: 'The clerk checks.' }], conn.model));
  assert.equal(req.url, 'https://bedrock-runtime.eu-central-1.amazonaws.com/model/global.anthropic.claude-sonnet-5-5/invoke');
  assert.deepEqual(req.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.equal(req.body.anthropic_version, 'bedrock-2023-05-31');
  assert.equal(req.body.max_tokens, 4000);
  assert.ok(!('model' in req.body), 'the model is in the address, not the body');
  assert.deepEqual(req.body.output_config, { format: { type: 'json_schema', schema: task.schema } });
  assert.match(String(req.body.system), /List the roles\./);

  const arn = providerRequest({ ...conn, model: 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc' }, testRequestBody(conn));
  assert.equal(arn.url, 'https://bedrock-runtime.eu-central-1.amazonaws.com/model/arn%3Aaws%3Abedrock%3Aus-east-1%3A123456789012%3Aapplication-inference-profile%2Fabc/invoke');
  assert.throws(() => providerRequest({ ...conn, endpoint: 'evil.example/x' }, testRequestBody(conn)), AiSettingsError);
  assert.throws(() => responsesTarget(conn));
  assert.throws(() => transcriptionTarget(conn));
  assert.equal(hostToCheck(conn), null);
});

test('images over Bedrock\'s 3.75 MB limit are refused before sending; the reply is read like Anthropic\'s', () => {
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil((3.75 * 1024 * 1024 + 3) / 3) * 4)}`;
  assert.throws(() => providerRequest(conn, buildImageRequest(task, big, conn.model)),
    (e: unknown) => e instanceof ProviderRequestError && e.code === 'TOO_LARGE' && /Amazon Bedrock; use one under 3.75 MB/.test(e.message));
  assert.ok(providerRequest(conn, buildImageRequest(task, 'data:image/png;base64,iVBORw0KGgo=', conn.model)));
  assert.deepEqual(parseProviderReply(conn, { content: [{ type: 'text', text: '{"roles":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 3 } }),
    { ok: true, data: { roles: [] }, usage: { input: 9, output: 3 } });
  assert.equal(parseProviderReply(conn, { error: { message: 'The security token included in the request is invalid.' } }).code, 'PROVIDER_ERROR');
});

test('Bedrock cannot transcribe and is offered only to the platform owner until the eval has run with it', () => {
  assert.match(unsupported(conn, 'transcription') ?? '', /Amazon Bedrock \(Claude\)/);
  assert.equal(unsupported(conn, 'vision'), null);
  assert.equal(AI_PROVIDERS.bedrock.checked, false);
  assert.ok(!selectableProviders(false).includes('bedrock'));
  assert.ok(selectableProviders(true).includes('bedrock'));
});
