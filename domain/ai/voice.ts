// Whether a person can speak an answer here (package B, pull request 4, plan `claude/package-b-pr4-plan-24-nov.md`,
// section 2; owner, 24 November 2026). The microphone shows where the workspace's AI can turn speech into text: on
// the platform key, or on a workspace's own key whose provider can (`can.transcription` in AI_PROVIDERS: OpenAI
// today). Elsewhere a plain line says why, and typing works; package 17 changes Azure OpenAI's line. Where the
// workspace has no AI at all (the demo, a store without the server) nothing is said. Used by every answer box
// with a microphone: Closing the gaps, "Tell us in your own words", Ask Avala's Questions tab and Discovery.
import { AI_PROVIDERS, type AiProvider } from './providers.ts';

export type Voice = 'speak' | 'line' | 'none';

export const NO_VOICE_LINE = "Voice input is not available with this workspace's AI provider. Type your answer instead.";

/**
 * `provider`: the workspace's own provider, or null on the platform key; undefined while it is not known yet
 * (nothing is offered until it is). `aiAvailable`: whether this store reaches the AI at all.
 */
export function voiceFor(provider: string | null | undefined, aiAvailable: boolean): Voice {
  if (!aiAvailable || provider === undefined) return 'none';
  if (provider === null) return 'speak';
  const info = Object.hasOwn(AI_PROVIDERS, provider) ? AI_PROVIDERS[provider as AiProvider] : null;
  return info?.can.transcription ? 'speak' : 'line';
}

/** Under the box when spoken words would take an answer past its limit: the rest is not added (review, 24 November 2026). */
export const cutLine = (max: number) => `Your answer is at its ${max.toLocaleString('en-GB')}-character limit; the rest was not added.`;
