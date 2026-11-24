// Whether this workspace can take a spoken answer (domain/ai/voice.ts), read once per workspace and page, and
// what an answer box gets from it: the microphone (`transcribe`), or the plain line instead. When an admin saves
// or removes the workspace's AI provider (Settings → AI provider), `forgetVoice` clears what was read and every
// answer box on the page reads it again, so the microphone follows without a reload (review, 24 November 2026).
import React from 'react';
import { NO_VOICE_LINE, voiceFor, type Voice } from '../../domain/ai/voice.ts';
import type { JourneyStore } from '../store/types.ts';

const known = new Map<string, Promise<string | null>>();
const CHANGED = 'avala:voice-changed';

/** The workspace's AI provider changed: read it again wherever an answer box is shown. */
export function forgetVoice(workspaceId: string): void {
  known.delete(workspaceId);
  dispatchEvent(new CustomEvent(CHANGED, { detail: { workspaceId } }));
}

/**
 * The workspace's voice: 'none' until its provider is read. When it cannot be read, the microphone shows, as it
 * did before this rule (review, 24 November 2026): the server still refuses a provider that cannot take speech,
 * with its plain message.
 */
export function useVoice(store: JourneyStore | undefined, workspaceId: string | null | undefined): Voice {
  const [provider, setProvider] = React.useState<string | null | undefined>(undefined);
  const [reads, setReads] = React.useState(0);
  React.useEffect(() => {
    if (!workspaceId) return;
    const listen = (e: Event) => { if ((e as CustomEvent<{ workspaceId: string }>).detail?.workspaceId === workspaceId) setReads(n => n + 1); };
    addEventListener(CHANGED, listen);
    return () => removeEventListener(CHANGED, listen);
  }, [workspaceId]);
  React.useEffect(() => {
    if (!store || !workspaceId || !store.aiAvailable) return;
    let live = true;
    const key = workspaceId;
    if (!known.has(key)) known.set(key, store.getWorkspaceAi(workspaceId).then(ai => ai?.provider ?? null));
    known.get(key)!.then(p => { if (live) setProvider(p); }, () => { known.delete(key); if (live) setProvider(null); });
    return () => { live = false; };
  }, [store, workspaceId, reads]);
  return voiceFor(provider, Boolean(store?.aiAvailable && workspaceId));
}

/** What an AnswerBox takes for this voice. */
export function voiceProps(voice: Voice, store: JourneyStore | undefined, workspaceId: string | null | undefined): { transcribe?: (audio: string) => Promise<string>; voiceLine?: string } {
  if (voice === 'speak' && store && workspaceId) return { transcribe: audio => store.transcribe(workspaceId, audio) };
  if (voice === 'line') return { voiceLine: NO_VOICE_LINE };
  return {};
}
