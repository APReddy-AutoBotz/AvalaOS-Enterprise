import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProviderReply, type AiConnection } from './providers.ts';
import { parseChatResponse } from './compatible.ts';

// The cut-off replies kept in domain/ai/fixtures/, as each provider sent them (recorded with the extraction
// check's record-cutoff option; until then a stand-in written from the provider's documented reply, which
// says so in `standIn`). Every provider family must read a cut-off answer as TRUNCATED, which is what lets
// the facts merge split it (domain/extract/factsParts.ts).
const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const KEY = ['k', 'x'.repeat(40)].join('-');
const conn = (provider: AiConnection['provider'], model: string): AiConnection => ({ provider, model, endpoint: provider === 'azure_openai' ? 'https://r.openai.azure.com' : null, apiKey: KEY, source: 'platform' });

test('a recorded cut-off reply from the Responses API (OpenAI, and Azure OpenAI, which sends the same) reads as TRUNCATED with its tokens', () => {
  const f = fixture('cutoff-openai.json');
  for (const c of [conn('openai', f.model), conn('azure_openai', 'my-deployment')]) {
    const r = parseProviderReply(c, f.reply);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'TRUNCATED');
    assert.equal(r.usage.output, f.reply.usage.output_tokens, 'the cut-off answer\'s tokens are read, so they are counted');
  }
});

test('a recorded cut-off reply from the Messages API (Anthropic, and Claude on Bedrock, read the same way) reads as TRUNCATED with its tokens', () => {
  const f = fixture('cutoff-anthropic.json');
  for (const c of [conn('anthropic', f.model), conn('bedrock', 'anthropic.claude')]) {
    const r = parseProviderReply(c, f.reply);
    assert.equal(!r.ok && r.code, 'TRUNCATED');
    assert.equal(r.usage.output, f.reply.usage.output_tokens);
  }
});

test('a cut-off chat completion (OpenAI-compatible endpoints, Mistral AI) reads as TRUNCATED', () => {
  const reply = { choices: [{ message: { content: '{"passage":"The AP Clerk' }, finish_reason: 'length' }], usage: { prompt_tokens: 90, completion_tokens: 16 } };
  assert.equal(parseChatResponse(reply).code, 'TRUNCATED');
  assert.equal(parseProviderReply(conn('mistral', 'mistral-small-latest'), reply).code, 'TRUNCATED');
});

test('the fixtures say whether they are recorded or stand-ins', () => {
  for (const name of ['cutoff-openai.json', 'cutoff-anthropic.json']) {
    const f = fixture(name);
    assert.equal(f.read, 'TRUNCATED', `${name}: the reply as read when it was recorded`);
    assert.ok(f.reply && typeof f.reply === 'object', name);
  }
});
