// A person's own name, as they set it in Settings → "Your name" (plan claude/your-name-plan-28-nov.md in the owner's
// project). The database holds the same rule for a name a signed-in person writes (migration own_display_name,
// app_private.check_display_name): trimmed, 1 to 80 characters, never the shape of an email address. Keep the two in
// step: name.test.ts and supabase/tests/own_display_name.sql use the same cases.

export const NAME_MAX = 80;

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

export const NAME_WORDS = {
  empty: 'Type your name.',
  long: `At most ${NAME_MAX} characters.`,
  email: 'Your name, not your email address.',
  refused: 'That name could not be saved: a name has 1 to 80 characters and is not an email address.',
  why: 'Shown to the people in your workspaces, on what you do in Avala OS. Your email address is never shown in its place.',
  saved: 'Saved.',
  demo: 'The demo does not save your name.',
} as const;

/** The name to save, trimmed at both ends, or why it cannot be. Counts characters as the database does. */
export function checkName(raw: string): NameCheck {
  const name = raw.trim();
  if (!name) return { ok: false, reason: NAME_WORDS.empty };
  if ([...name].length > NAME_MAX) return { ok: false, reason: NAME_WORDS.long };
  if (name.includes('@')) return { ok: false, reason: NAME_WORDS.email };
  return { ok: true, name };
}

/** The part of an email address before the "@", which sign-up gives as a name when the sign-in gave none. */
export const addressName = (email: string): string => email.split('@')[0]!.trim();

/**
 * True while a person's name is still the one sign-up made from their address, so My work asks them once to set
 * it. An empty name counts too (the screens show "Unnamed member").
 */
export function nameFromAddress(name: string | null | undefined, email: string): boolean {
  const n = (name ?? '').trim();
  return !n || n === addressName(email);
}
