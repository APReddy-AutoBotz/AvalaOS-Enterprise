import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiSettingsError, chooseConnection, keyHint, responsesTarget, takesReasoningEffort, taskNeed, transcriptionTarget,
  unsupported, usesPlatformAllowance, validateAiChoice, validateApiKey, type AiConnection,
} from './providers.ts';

const platform = { apiKey: 'sk-platform-0000000000000000', model: 'gpt-5.5' };

test('an OpenAI choice needs a model id and takes no endpoint', () => {
  assert.deepEqual(validateAiChoice({ provider: 'openai', model: ' gpt-5.5 ', endpoint: 'https://evil.example' }), { provider: 'openai', model: 'gpt-5.5', endpoint: null });
  assert.throws(() => validateAiChoice({ provider: 'openai', model: '' }), AiSettingsError);
  assert.throws(() => validateAiChoice({ provider: 'openai', model: 'gpt 5' }), AiSettingsError);
  assert.throws(() => validateAiChoice({ provider: 'anthropic', model: 'x' }), AiSettingsError);
});

test('an Azure endpoint must be the resource\'s own Azure host, so a key is never sent anywhere else', () => {
  assert.deepEqual(validateAiChoice({ provider: 'azure_openai', model: 'prod-gpt5', endpoint: 'https://My-Resource.openai.azure.com/openai/v1/' }),
    { provider: 'azure_openai', model: 'prod-gpt5', endpoint: 'https://my-resource.openai.azure.com' });
  assert.equal(validateAiChoice({ provider: 'azure_openai', model: 'd', endpoint: 'https://acme.cognitiveservices.azure.com' }).endpoint, 'https://acme.cognitiveservices.azure.com');
  assert.equal(validateAiChoice({ provider: 'azure_openai', model: 'd', endpoint: 'https://acme.services.ai.azure.com/' }).endpoint, 'https://acme.services.ai.azure.com');
  for (const bad of ['http://acme.openai.azure.com', 'https://acme.openai.azure.com.evil.example', 'https://evil.example/acme.openai.azure.com',
    'https://user:pw@acme.openai.azure.com', 'https://acme.openai.azure.com:8443', 'https://169.254.169.254', 'acme.openai.azure.com', '']) {
    assert.throws(() => validateAiChoice({ provider: 'azure_openai', model: 'd', endpoint: bad }), AiSettingsError, bad);
  }
});

test('a key is checked for shape only, and only its last four characters may be shown', () => {
  assert.equal(validateApiKey('  sk-proj-abcdefghijklmnopqrstuvwxyz1234 '), 'sk-proj-abcdefghijklmnopqrstuvwxyz1234');
  assert.throws(() => validateApiKey('short'), AiSettingsError);
  assert.throws(() => validateApiKey('sk-proj abcdefghijklmnopqrstuvwxyz'), AiSettingsError);
  assert.equal(keyHint('sk-proj-abcdefghijklmnopqrstuvwxyz1234'), '1234');
});

test('a workspace with its own key uses it, with no allowance; otherwise the platform key within its allowance', () => {
  const own = chooseConnection({ provider: 'azure_openai', model: 'prod', endpoint: 'https://acme.openai.azure.com', apiKey: 'azure-key-0000000000000000' }, platform)!;
  assert.equal(own.source, 'workspace');
  assert.equal(own.apiKey, 'azure-key-0000000000000000');
  assert.equal(usesPlatformAllowance(own), false);
  const shared = chooseConnection(null, platform)!;
  assert.deepEqual({ source: shared.source, provider: shared.provider, model: shared.model }, { source: 'platform', provider: 'openai', model: 'gpt-5.5' });
  assert.equal(usesPlatformAllowance(shared), true);
  assert.equal(chooseConnection(null, { apiKey: '', model: 'gpt-5.5' }), null);
});

test('calls go to the provider\'s own address with its own way of passing the key', () => {
  const openai: AiConnection = { provider: 'openai', model: 'gpt-5.5', endpoint: null, apiKey: 'sk-x', source: 'workspace' };
  assert.deepEqual(responsesTarget(openai), { url: 'https://api.openai.com/v1/responses', headers: { Authorization: 'Bearer sk-x', 'Content-Type': 'application/json' } });
  assert.equal(transcriptionTarget(openai).url, 'https://api.openai.com/v1/audio/transcriptions');
  const azure: AiConnection = { provider: 'azure_openai', model: 'prod', endpoint: 'https://acme.openai.azure.com', apiKey: 'az-x', source: 'workspace' };
  assert.deepEqual(responsesTarget(azure), { url: 'https://acme.openai.azure.com/openai/v1/responses', headers: { 'api-key': 'az-x', 'Content-Type': 'application/json' } });
  assert.equal(responsesTarget(azure).headers.Authorization, undefined);
});

test('a task the provider cannot do is turned off with a plain message, never sent elsewhere', () => {
  const azure: AiConnection = { provider: 'azure_openai', model: 'prod', endpoint: 'https://acme.openai.azure.com', apiKey: 'k', source: 'workspace' };
  assert.equal(unsupported(azure, 'text'), null);
  assert.equal(unsupported(azure, taskNeed({ input: 'image' })), null);
  assert.match(unsupported(azure, 'transcription')!, /^Turning speech into text is not available with Azure OpenAI/);
  assert.equal(unsupported({ ...azure, provider: 'openai', endpoint: null }, 'transcription'), null);
  assert.equal(taskNeed({}), 'text');
  assert.equal(takesReasoningEffort('gpt-5.5'), true);
  assert.equal(takesReasoningEffort('o4-mini'), true);
  assert.equal(takesReasoningEffort('prod-deployment'), false);
});
