// What the browser keeps that belongs to the person signed in, and so goes when they sign out (finding F10
// of the outside review, 17 November 2026). The look in the sources and its "Not right" set-asides copy what
// was found in a process's sources, and the visit's map shape and the last workspace chosen say which
// processes and workspaces the person opened. Preferences that hold nothing about a process (cards or list,
// a map across the page) stay. The sign-in itself is cleared by the sign-in library.

/**
 * "Set your name" closed on My work (journey/pages/YourName.tsx). It holds no account's id, and it goes at sign-out,
 * so the next person signed in on this browser is asked afresh.
 */
export const NAME_LINE_CLOSED = 'avala:name-line-closed';

/** Keys whose name starts with one of these are removed at sign-out. */
// A call kept on the device (package C, `avala:call:{process}`) is removed too: the person is asked first when one is not finished.
export const SIGN_OUT_FORGETS = ['avala:source-look:', 'avala:dismissed:', 'avala:map-shape:', 'avala.journey.workspace', 'avala:call:', NAME_LINE_CLOSED] as const;

/** The keys among those the browser holds that sign-out removes. */
export function keysToForget(keys: readonly string[]): string[] {
  return keys.filter(k => SIGN_OUT_FORGETS.some(p => k === p || k.startsWith(p)));
}
