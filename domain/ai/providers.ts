// Bring your own key: which AI provider a workspace uses, and how a call reaches it. Pure: no I/O.
// The server functions (journey-ai, journey-extract) read the workspace's choice and key, and use these
// to build each call; the settings screen uses the validation.
//
// Rules (docs/product-plan.md, "Bring your own key"):
// - A workspace with no key of its own uses the platform key, within the platform's monthly allowance.
// - A workspace with its own key never falls back to the platform key: a call it cannot make fails with
//   a plain message, and a task its provider cannot do is turned off.
// - Keys are written by admins, kept encrypted on the server and never returned to the browser.
// - A provider is offered to workspaces only once the extraction eval has been run with it (`checked`);
//   until then only the platform owner sees it, to run that eval.

import { parseOpenAIResponse, type ParsedResponse } from './gateway.ts';
import { ANTHROPIC_MESSAGES_URL, anthropicHeaders, parseAnthropicResponse, toAnthropicRequest } from './anthropic.ts';

/** Claude on Amazon Bedrock: Anthropic's body with Bedrock's version marker; images up to 3.75 MB (AWS's limit). */
export const BEDROCK_ANTHROPIC_VERSION = 'bedrock-2023-05-31';
const BEDROCK_TARGET = { label: 'Amazon Bedrock', maxImageBytes: 3.75 * 1024 * 1024 };
import { EndpointError, parseChatResponse, toChatRequest, validateCompatibleEndpoint } from './compatible.ts';

export type AiProvider = 'openai' | 'azure_openai' | 'anthropic' | 'openai_compatible' | 'bedrock';
export type AiNeed = 'text' | 'vision' | 'transcription';

export interface ProviderInfo {
  label: string;
  /** What to call the model field: a model id, or an Azure deployment name. */
  modelLabel: string;
  modelHint: string;
  needsEndpoint: boolean;
  /** What to call the endpoint field (default "Endpoint"); for Bedrock it is the AWS Region. */
  endpointLabel?: string;
  endpointPlaceholder?: string;
  endpointHint?: string;
  can: Record<AiNeed, boolean>;
  /** The extraction eval (eval/README.md) has been run with this provider, so workspaces may choose it. */
  checked: boolean;
}

export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  openai: {
    label: 'OpenAI', modelLabel: 'Model', modelHint: 'The OpenAI model id, for example gpt-5.5.',
    needsEndpoint: false, can: { text: true, vision: true, transcription: true }, checked: true,
  },
  azure_openai: {
    label: 'Azure OpenAI', modelLabel: 'Deployment name', modelHint: 'The name of the deployment in your Azure OpenAI resource.',
    // Transcription needs its own deployment and is not offered for Azure yet.
    // The same OpenAI models and Responses API as OpenAI itself, so OpenAI's eval runs stand for it.
    needsEndpoint: true, endpointPlaceholder: 'https://my-resource.openai.azure.com', endpointHint: 'From Keys and Endpoint in the Azure portal.',
    can: { text: true, vision: true, transcription: false }, checked: true,
  },
  anthropic: {
    label: 'Anthropic', modelLabel: 'Model', modelHint: 'The Claude model id, for example claude-sonnet-5-5.',
    // Anthropic has no speech-to-text API. Not offered until the extraction eval has been run with it.
    needsEndpoint: false, can: { text: true, vision: true, transcription: false }, checked: false,
  },
  openai_compatible: {
    label: 'OpenAI-compatible endpoint', modelLabel: 'Model', modelHint: 'The model name your endpoint serves, for example meta-llama/Llama-3.3-70B-Instruct.',
    // A server the company runs (vLLM, LiteLLM, a gateway) with the Chat Completions API and JSON-schema output.
    // Whether it reads images depends on the model it serves; speech-to-text is not offered.
    needsEndpoint: true, endpointPlaceholder: 'https://llm.example-company.com/v1',
    endpointHint: 'The https address before /chat/completions, reachable on the internet on the standard port.',
    can: { text: true, vision: true, transcription: false }, checked: false,
  },
  bedrock: {
    label: 'Amazon Bedrock (Claude)', modelLabel: 'Model or inference profile',
    modelHint: 'The Bedrock id of a Claude model or inference profile, for example global.anthropic.claude-sonnet-5-5.',
    // Claude on Bedrock through InvokeModel with Anthropic's own request body; the key is a long-term Bedrock API key.
    needsEndpoint: true, endpointLabel: 'AWS Region', endpointPlaceholder: 'us-east-1',
    endpointHint: 'The Region where the model is enabled for your AWS account.',
    can: { text: true, vision: true, transcription: false }, checked: false,
  },
};

/** The providers a person may choose: those checked by the eval, and the rest only for the platform owner. */
export const selectableProviders = (platformOwner: boolean): AiProvider[] =>
  (Object.keys(AI_PROVIDERS) as AiProvider[]).filter(p => AI_PROVIDERS[p].checked || platformOwner);

export const isAiProvider = (v: unknown): v is AiProvider => typeof v === 'string' && v in AI_PROVIDERS;

export class AiSettingsError extends Error {}

export interface AiChoice { provider: AiProvider; model: string; endpoint: string | null }

/** Model ids, deployment names and served model names (which may hold a slash, like org/model). */
const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const AZURE_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/;

/**
 * A provider, model and endpoint an admin entered, checked and normalised. Azure endpoints must be the
 * resource's own Azure host (so the server never sends a key anywhere else); OpenAI takes no endpoint.
 */
export function validateAiChoice(input: { provider: unknown; model: unknown; endpoint?: unknown }): AiChoice {
  if (!isAiProvider(input.provider)) throw new AiSettingsError('Choose a provider.');
  const info = AI_PROVIDERS[input.provider];
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!MODEL.test(model)) throw new AiSettingsError(`Enter the ${info.modelLabel.toLowerCase()}: letters, digits, dots, dashes, slashes or underscores.`);
  if (!info.needsEndpoint) return { provider: input.provider, model, endpoint: null };
  if (input.provider === 'bedrock') {
    const region = typeof input.endpoint === 'string' ? input.endpoint.trim().toLowerCase() : '';
    if (!AWS_REGION.test(region)) throw new AiSettingsError('Enter the AWS Region, like us-east-1 or eu-central-1.');
    return { provider: input.provider, model, endpoint: region };
  }
  if (input.provider === 'openai_compatible') {
    try { return { provider: input.provider, model, endpoint: validateCompatibleEndpoint(input.endpoint) }; } catch (e) {
      throw new AiSettingsError(e instanceof EndpointError ? e.message : 'Enter the https address of your endpoint.');
    }
  }
  const raw = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new AiSettingsError('Enter the endpoint of your Azure OpenAI resource, like https://my-resource.openai.azure.com.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !AZURE_HOST.test(url.hostname.toLowerCase())) {
    throw new AiSettingsError('The endpoint must be your Azure OpenAI resource, like https://my-resource.openai.azure.com.');
  }
  return { provider: input.provider, model, endpoint: `https://${url.hostname.toLowerCase()}` };
}

/** A pasted API key, trimmed and checked for shape only (the provider decides whether it works). */
export function validateApiKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) throw new AiSettingsError('Paste the whole API key.');
  return key;
}

/** What may be shown of a key: its last four characters. */
export const keyHint = (key: string) => key.slice(-4);

/** The connection a server function uses for one call. */
export interface AiConnection { provider: AiProvider; model: string; endpoint: string | null; apiKey: string; source: 'workspace' | 'platform' }

export interface PlatformAi { apiKey: string; model: string }

/** The workspace's own connection when it has one, otherwise the platform's, or null when neither exists. */
export function chooseConnection(workspace: (AiChoice & { apiKey: string }) | null, platform: PlatformAi): AiConnection | null {
  if (workspace) return { ...workspace, source: 'workspace' };
  if (!platform.apiKey) return null;
  return { provider: 'openai', model: platform.model, endpoint: null, apiKey: platform.apiKey, source: 'platform' };
}

/** Only calls on the platform key count against the platform's monthly allowance. */
export const usesPlatformAllowance = (c: AiConnection) => c.source === 'platform';

export interface HttpTarget { url: string; headers: Record<string, string> }

/** OpenAI-style providers only: an Anthropic key must never be sent to an OpenAI address. */
function openAiStyle(c: AiConnection) {
  if (c.provider !== 'openai' && c.provider !== 'azure_openai') throw new Error(`${c.provider} does not take OpenAI-style requests`);
}
const auth = (c: AiConnection): Record<string, string> => (c.provider === 'azure_openai' ? { 'api-key': c.apiKey } : { Authorization: `Bearer ${c.apiKey}` });
const base = (c: AiConnection) => (c.provider === 'azure_openai' ? `${c.endpoint}/openai/v1` : 'https://api.openai.com/v1');

/** The Responses API call (the same request body for OpenAI and Azure; Azure takes the deployment as the model). */
export function responsesTarget(c: AiConnection): HttpTarget {
  openAiStyle(c);
  return { url: `${base(c)}/responses`, headers: { ...auth(c), 'Content-Type': 'application/json' } };
}

/** The transcription call (multipart; the caller sets the body). */
export function transcriptionTarget(c: AiConnection): HttpTarget {
  openAiStyle(c);
  return { url: `${base(c)}/audio/transcriptions`, headers: auth(c) };
}

/**
 * One call to the connection's provider. Every task builds a Responses API body; for Anthropic it is
 * translated into a Messages API request (domain/ai/anthropic.ts). Throws ProviderRequestError when the
 * provider cannot take the input (an image over Anthropic's size limit).
 */
export function providerRequest(c: AiConnection, body: Record<string, unknown>): HttpTarget & { body: Record<string, unknown> } {
  if (c.provider === 'anthropic') return { url: ANTHROPIC_MESSAGES_URL, headers: anthropicHeaders(c.apiKey), body: toAnthropicRequest(body) };
  if (c.provider === 'bedrock') {
    const region = String(c.endpoint ?? '');
    if (!AWS_REGION.test(region)) throw new AiSettingsError('The AWS Region is not valid.');
    const { model: _model, ...rest } = toAnthropicRequest(body, BEDROCK_TARGET);
    return {
      url: `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(c.model)}/invoke`,
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: { anthropic_version: BEDROCK_ANTHROPIC_VERSION, ...rest },
    };
  }
  if (c.provider === 'openai_compatible') {
    // validateCompatibleEndpoint again: the stored address is checked on every use, not only when saved.
    return { url: `${validateCompatibleEndpoint(c.endpoint)}/chat/completions`, headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' }, body: toChatRequest(body) };
  }
  return { ...responsesTarget(c), body };
}

/** The provider's reply in the gateway's shape. */
export const parseProviderReply = (c: AiConnection, json: unknown): ParsedResponse =>
  (c.provider === 'anthropic' || c.provider === 'bedrock' ? parseAnthropicResponse(json) : c.provider === 'openai_compatible' ? parseChatResponse(json) : parseOpenAIResponse(json));

/** The host to check against private addresses before a call (assertPublicHost), for addresses an admin typed. */
export const hostToCheck = (c: AiConnection): string | null =>
  (c.provider === 'openai_compatible' && c.endpoint ? new URL(c.endpoint).hostname : null);

/** Reasoning effort applies to reasoning models; for Azure the deployment name may hide the model, so it is sent only when the name shows it. */
export const takesReasoningEffort = (model: string) => /^(gpt-5|o\d)/.test(model);

/** What a task needs from the provider. */
export const taskNeed = (task: { input?: 'segments' | 'image' }): AiNeed => (task.input === 'image' ? 'vision' : 'text');

const NEED_WORDS: Record<AiNeed, string> = { text: 'Reading sources', vision: 'Reading images', transcription: 'Turning speech into text' };

/** Null when the connection can do it; otherwise the plain message to show (never a fallback to another key). */
export function unsupported(c: AiConnection, need: AiNeed): string | null {
  if (AI_PROVIDERS[c.provider].can[need]) return null;
  return `${NEED_WORDS[need]} is not available with ${AI_PROVIDERS[c.provider].label} in this workspace yet. Type the answer instead, or ask an admin to change the AI provider in Settings.`;
}

/** A tiny request that proves the key, endpoint and model work ("Test this key"). */
export function testRequestBody(c: AiConnection): Record<string, unknown> {
  return { model: c.model, input: 'Reply with the word ready.', max_output_tokens: 64, store: false };
}
