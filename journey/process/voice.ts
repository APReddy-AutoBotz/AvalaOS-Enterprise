// Whether this workspace can take a spoken answer (domain/ai/voice.ts), read once per workspace and page, and
// what an answer box gets from it: the microphone (`transcribe`), or the plain line instead.
import React from 'react';
import { NO_VOICE_LINE, voiceFor, type Voice } from '../../domain/ai/voice.ts';
import type { JourneyStore } from '../store/types.ts';

const known = new Map<string, Promise<string | null>>();

/** The workspace's voice: 'none' until its provider is read, and when it cannot be read. */
export function useVoice(store: JourneyStore | undefined, workspaceId: string | null | undefined): Voice {
  const [provider, setProvider] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!store || !workspaceId || !store.aiAvailable) return;
    let live = true;
    const key = workspaceId;
    if (!known.has(key)) known.set(key, store.getWorkspaceAi(workspaceId).then(ai => ai?.provider ?? null));
    known.get(key)!.then(p => { if (live) setProvider(p); }, () => { known.delete(key); });
    return () => { live = false; };
  }, [store, workspaceId]);
  return voiceFor(provider, Boolean(store?.aiAvailable && workspaceId));
}

/** What an AnswerBox takes for this voice. */
export function voiceProps(voice: Voice, store: JourneyStore | undefined, workspaceId: string | null | undefined): { transcribe?: (audio: string) => Promise<string>; voiceLine?: string } {
  if (voice === 'speak' && store && workspaceId) return { transcribe: audio => store.transcribe(workspaceId, audio) };
  if (voice === 'line') return { voiceLine: NO_VOICE_LINE };
  return {};
}
