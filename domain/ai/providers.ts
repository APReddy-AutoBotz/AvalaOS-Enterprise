// Bring your own key: which AI provider a workspace uses, and how a call reaches it. Pure: no I/O.
// The server functions (journey-ai, journey-extract) read the workspace's choice and key, and use these
// to build each call; the settings screen uses the validation.
//
// Rules (docs/product-plan.md, "Bring your own key"):
// - A workspace with no key of its own uses the platform key, within the platform's monthly allowance.
// - A workspace with its own key never falls back to the platform key: a call it cannot make fails with
//   a plain message, and a task its provider cannot do is turned off.
// - Keys are written by admins, kept encrypted on the server and never returned to the browser.

export type AiProvider = 'openai' | 'azure_openai';
export type AiNeed = 'text' | 'vision' | 'transcription';

export interface ProviderInfo {
  label: string;
  /** What to call the model field: a model id, or an Azure deployment name. */
  modelLabel: string;
  modelHint: string;
  needsEndpoint: boolean;
  can: Record<AiNeed, boolean>;
}

export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  openai: {
    label: 'OpenAI', modelLabel: 'Model', modelHint: 'The OpenAI model id, for example gpt-5.5.',
    needsEndpoint: false, can: { text: true, vision: true, transcription: true },
  },
  azure_openai: {
    label: 'Azure OpenAI', modelLabel: 'Deployment name', modelHint: 'The name of the deployment in your Azure OpenAI resource.',
    // Transcription needs its own deployment and is not offered for Azure yet.
    needsEndpoint: true, can: { text: true, vision: true, transcription: false },
  },
};

export const isAiProvider = (v: unknown): v is AiProvider => typeof v === 'string' && v in AI_PROVIDERS;

export class AiSettingsError extends Error {}

export interface AiChoice { provider: AiProvider; model: string; endpoint: string | null }

const AZURE_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/;

/**
 * A provider, model and endpoint an admin entered, checked and normalised. Azure endpoints must be the
 * resource's own Azure host (so the server never sends a key anywhere else); OpenAI takes no endpoint.
 */
export function validateAiChoice(input: { provider: unknown; model: unknown; endpoint?: unknown }): AiChoice {
  if (!isAiProvider(input.provider)) throw new AiSettingsError('Choose a provider.');
  const info = AI_PROVIDERS[input.provider];
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) throw new AiSettingsError(`Enter the ${info.modelLabel.toLowerCase()}: letters, digits, dots, dashes or underscores.`);
  if (!info.needsEndpoint) return { provider: input.provider, model, endpoint: null };
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

const auth = (c: AiConnection): Record<string, string> => (c.provider === 'azure_openai' ? { 'api-key': c.apiKey } : { Authorization: `Bearer ${c.apiKey}` });
const base = (c: AiConnection) => (c.provider === 'azure_openai' ? `${c.endpoint}/openai/v1` : 'https://api.openai.com/v1');

/** The Responses API call (the same request body for both providers; Azure takes the deployment as the model). */
export function responsesTarget(c: AiConnection): HttpTarget {
  return { url: `${base(c)}/responses`, headers: { ...auth(c), 'Content-Type': 'application/json' } };
}

/** The transcription call (multipart; the caller sets the body). */
export function transcriptionTarget(c: AiConnection): HttpTarget {
  return { url: `${base(c)}/audio/transcriptions`, headers: auth(c) };
}

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
