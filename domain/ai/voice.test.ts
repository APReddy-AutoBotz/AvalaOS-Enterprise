import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_VOICE_LINE, voiceFor } from './voice.ts';
import { AI_PROVIDERS } from './providers.ts';

test('the microphone shows on the platform key and on a provider that turns speech into text; elsewhere a plain line', () => {
  assert.equal(voiceFor(null, true), 'speak');
  assert.equal(voiceFor('openai', true), 'speak');
  for (const p of ['azure_openai', 'anthropic', 'openai_compatible', 'bedrock', 'mistral']) assert.equal(voiceFor(p, true), 'line', p);
  // Every provider follows its own entry, so a provider that gains speech gains the microphone.
  for (const [p, info] of Object.entries(AI_PROVIDERS)) assert.equal(voiceFor(p, true), info.can.transcription ? 'speak' : 'line');
  // A name that is not ours never gets the microphone.
  assert.equal(voiceFor('hasOwnProperty', true), 'line');
  assert.equal(voiceFor('someone-else', true), 'line');
});

test('nothing is offered without AI (the demo) or while the provider is not known yet', () => {
  assert.equal(voiceFor(null, false), 'none');
  assert.equal(voiceFor('openai', false), 'none');
  assert.equal(voiceFor(undefined, true), 'none');
  assert.equal(NO_VOICE_LINE, "Voice input is not available with this workspace's AI provider. Type your answer instead.");
});
