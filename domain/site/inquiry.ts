// A walkthrough request from the homepage (docs/next-plan.md, section 3d, package 11). The same rules run in
// the visitor's browser (to say what is missing before sending) and in the server function journey-inquiry
// (which trusts nothing the browser says). No database, no network here.
//
// Agreed with the owner, 17 November 2026: name, work email and company are required; the process in mind and
// how many people work on it are optional; no phone number. The notice email carries no details of the visitor
// and no reply-to: it says a request is waiting in Settings. Anything a visitor typed is cleaned of control
// characters, and of line breaks where it is one line, and is only ever shown as plain text.

export const INQUIRY_LIMITS = { name: 100, email: 254, company: 150, process: 500 } as const;

/** How many people work on the process, as a choice, so nobody types a number they do not know. */
export const PEOPLE_CHOICES = [['1-5', '1 to 5'], ['6-20', '6 to 20'], ['21-100', '21 to 100'], ['100+', 'More than 100']] as const;
export type PeopleChoice = (typeof PEOPLE_CHOICES)[number][0];

/**
 * Against misuse, with no outside service (working defaults the owner may change): a request is sent at
 * least `minMs` after the window opened, measured in the browser as elapsed time; per email address and in
 * total, hourly and over any 24 hours; and at most `noticesPerDay` notice emails in any 24 hours, then one
 * that says more are waiting. The database applies the counts (migration walkthrough_requests).
 */
export const INQUIRY_CAPS = { minMs: 3000, perEmailHour: 3, perHour: 20, perDay: 50, noticesPerDay: 10 } as const;

/** The name of the hidden field people never see or fill. */
export const TRAP_FIELD = 'website';

export interface InquiryInput { name?: unknown; email?: unknown; company?: unknown; process?: unknown; people?: unknown; [TRAP_FIELD]?: unknown; elapsedMs?: unknown }
export interface Inquiry { name: string; email: string; company: string; process: string | null; people: PeopleChoice | null }

export type Refusal = 'missing' | 'malformed' | 'too_long' | 'trap' | 'too_fast' | 'too_many';
// Every member names every key, so a caller can read `reason` or `value` without narrowing first.
export type InquiryCheck =
  | { ok: true; value: Inquiry; reason?: undefined; field?: undefined; message?: undefined }
  | { ok: false; value?: undefined; reason: Refusal; field?: keyof Inquiry; message: string };

// Control characters (C0 and C1, DEL), and line and paragraph separators, which some mail software treats as breaks.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u2028\\u2029]', 'g');
const BREAKS = /[\r\n\t]+/g;

/** One line: no line breaks and no control characters, spaces collapsed. Safe in an email subject or header. */
export const oneLine = (raw: string) => raw.replace(BREAKS, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
/** Free text: line breaks kept (as \n, at most two in a row), other control characters removed. */
export const plainText = (raw: string) => raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL, '').replace(/[  ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the browser says beside a field, and what the server refuses. */
export const FIELD_LABEL: Record<keyof Inquiry, string> = { name: 'Your name', email: 'Work email', company: 'Company', process: 'A process you have in mind', people: 'How many people work on it' };

/**
 * Checks a request as it arrives. `elapsedMs` is the time between opening the window and pressing Send,
 * measured in the browser (never two clocks compared). The hidden field must be empty.
 */
export function checkInquiry(input: InquiryInput, opts: { requireTiming?: boolean } = {}): InquiryCheck {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (str(input[TRAP_FIELD]).trim()) return { ok: false, reason: 'trap', message: 'Refused.' };
  if (opts.requireTiming !== false) {
    const ms = typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) ? input.elapsedMs : -1;
    if (ms < INQUIRY_CAPS.minMs) return { ok: false, reason: 'too_fast', message: 'Sent too quickly.' };
  }
  const name = oneLine(str(input.name));
  const email = oneLine(str(input.email)).toLowerCase();
  const company = oneLine(str(input.company));
  const process = plainText(str(input.process));
  const people = str(input.people);
  for (const [field, value] of [['name', name], ['email', email], ['company', company]] as const) {
    if (!value) return { ok: false, reason: 'missing', field, message: `${FIELD_LABEL[field]} is needed.` };
  }
  for (const [field, value] of [['name', name], ['email', email], ['company', company], ['process', process]] as const) {
    if (value.length > INQUIRY_LIMITS[field]) return { ok: false, reason: 'too_long', field, message: `${FIELD_LABEL[field]} can be at most ${INQUIRY_LIMITS[field]} characters.` };
  }
  if (!EMAIL.test(email)) return { ok: false, reason: 'malformed', field: 'email', message: 'Enter a work email address, like name@company.com.' };
  if (people && !PEOPLE_CHOICES.some(([v]) => v === people)) return { ok: false, reason: 'malformed', field: 'people', message: 'Choose how many people work on it, or leave it empty.' };
  return { ok: true, value: { name, email, company, process: process || null, people: (people || null) as PeopleChoice | null } };
}

/** What a visitor sees when a request is refused or cannot be sent, whatever the reason. */
export const REFUSED = 'We could not send this. Please write to hello@avalaos.com.';
export const THANKS = 'Thank you. We will write to you within two working days.';
/** The one sentence under the form. */
export const PROMISE = 'We use these details only to arrange your walkthrough and reply to you, and delete them twelve months after we last write to each other';

/**
 * The notice to the owner: no details of the visitor, no reply-to, only that a request is waiting and where.
 * `kind` "more" is the one email sent once the day's notices are used up.
 */
export function inquiryNotice(kind: 'each' | 'more', siteUrl: string): { subject: string; text: string; html: string } {
  const link = `${siteUrl.replace(/\/+$/, '')}/settings/requests`;
  const subject = kind === 'each' ? 'A new walkthrough request is waiting' : 'More walkthrough requests are waiting';
  const line = kind === 'each'
    ? 'Someone asked for a walkthrough on the homepage.'
    : `More people asked for a walkthrough today than the ${INQUIRY_CAPS.noticesPerDay} notices sent in a day. No further notice is sent until tomorrow.`;
  const text = `${line}\n\nRead it in Settings, Walkthrough requests:\n${link}\n\nThis email carries no details of the visitor; they are kept in the Avala OS database only.\n`;
  const html = `<p>${line}</p><p><a href="${link}">Open Walkthrough requests in Settings</a></p><p style="color:#64748b">This email carries no details of the visitor; they are kept in the Avala OS database only.</p>`;
  return { subject, text, html };
}

/** "Reply by email" in Settings: opens the owner's email program addressed to the visitor, nothing else filled in but the subject. */
export function replyLink(email: string): string | null {
  const to = oneLine(email).toLowerCase();
  if (!EMAIL.test(to) || to.length > INQUIRY_LIMITS.email) return null;
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent('Your walkthrough of Avala OS')}`;
}

export const STATUS_LABEL = { new: 'New', answered: 'Answered', closed: 'Closed' } as const;
export type InquiryStatus = keyof typeof STATUS_LABEL;
export const PEOPLE_LABEL: Record<PeopleChoice, string> = Object.fromEntries(PEOPLE_CHOICES) as Record<PeopleChoice, string>;

/** A stored request, as the owner reads it in Settings. */
export interface WalkthroughRequest { id: string; name: string; email: string; company: string; process: string | null; people: PeopleChoice | null; status: InquiryStatus; createdAt: string; lastContactAt: string }
