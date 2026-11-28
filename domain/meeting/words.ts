// Every line the call's screens say (package C, plan `claude/package-c-plan-26-nov.md`, sections 4 and 5, revision
// 2). Working drafts: the owner's final word on them comes on the preview, before the screens merge. The rules in
// this folder build their lines from these, so a word is changed in one place.
import { OWNER_LABEL, type QOwner } from '../questions/triage.ts';

/** A call's time on the clock of the analyst's device ("14:09"); `timeZone` only in tests. */
export const clock = (iso: string, timeZone?: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });

/** A call's day as the product writes it ("26 November 2026"). */
export const day = (iso: string, timeZone?: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...(timeZone ? { timeZone } : {}) });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const CALL_WORDS = {
  // Where it starts (section 3)
  prepare: 'Prepare a call',
  prepareLine: 'A briefing for a requirements call: what is open, in what order, and who on the call can answer it.',
  blockedWindow: 'Opened here because the browser blocked a new window.',
  viewerLine: 'Someone who can edit this process can run the call panel.',

  // The briefing (section 4.1)
  briefingHeading: (process: string) => `Prepare a call about ${process}`,
  briefingLine: 'Avala OS puts the open questions in order from the record. Nothing is sent to the AI and nothing is saved.',
  who: 'Who will be on the call?',
  nameOptional: 'Name (optional)',
  namesStay: 'Names stay on this device, unless you leave a question with someone at the end of the call.',
  howLong: 'How long is the call?',
  forThisCall: (k: number) => `For this call (${k})`,
  ifTime: (m: number) => `If there is time (${m})`,
  addOwn: 'Add a question of your own',
  ownLine: 'Your own questions join the record only if you keep them at the end of the call.',
  ownHeading: 'Your own question',
  ownGap: 'Your own question for this call.',
  elsewhere: 'Not for this call: ask someone else',
  openFiles: 'Open the question files',
  start: 'Start the call panel',
  noAiThisMonth: 'Avala OS cannot read your notes this month. The panel still keeps your notes and follows this order.',
  copyAgenda: 'Copy the agenda',
  copied: (k: number) => `Copied: ${plural(k, 'question')}, ready to paste into the invitation.`,
  print: 'Print',
  whyItMatters: (why: string) => `Why it matters: ${why}`,
  whoCanAnswer: (kind: QOwner, name?: string) => `Who can answer: ${name ? `${name}, ${OWNER_LABEL[kind]}` : OWNER_LABEL[kind]}`,
  leftWithAttendee: (name: string) => `Left with ${name}, who is on this call`,

  // Where the process stands
  standingCounts: (steps: number, roles: number, apps: number, sources: number) =>
    `${plural(steps, 'step')}, ${plural(roles, 'role')} and ${plural(apps, 'application')}, from ${plural(sources, 'source')}.`,
  noSteps: 'No steps yet: the call starts with the shape of the process.',
  assessed: (verdict: string) => `Assessed: ${verdict}.`,
  asIs: 'Documented as it is: no assessment.',
  decided: (approach: string) => `How it will be built is decided: ${approach}.`,
  waitingFromDiscovery: (k: number) => `${plural(k, 'answer')} from Discovery ${k === 1 ? 'is' : 'are'} waiting for the draft.`,

  // The panel (section 4.2)
  panelHeading: (process: string) => `Call about ${process}`,
  started: (time: string, minutes: number) => `Started ${time} · ${plural(minutes, 'minute')}`,
  privateLine: 'Private to you. In the meeting, share another window, not this one. Nothing is saved until you end the call and confirm.',
  gotIt: 'Got it',
  askNext: (heading: string) => `Ask next · ${heading}`,
  /** C3 (owner, 28 November 2026): a question suggested only to confirm an answer the notes give by inference. */
  toConfirm: 'To confirm',
  toConfirmLine: (value: string, quote: string, time: string) => `Your notes suggest "${value}", but do not say it outright: "${quote}" · your note at ${time}.`,
  toConfirmAsk: 'Ask to confirm it.',
  fromNote: (time: string, excerpt: string) => `From your note at ${time}: '${excerpt}'`,
  fromRecord: (excerpt: string, title?: string) => `From the record: '${excerpt}'${title ? ` (${title})` : ''}`,
  missing: (gap: string) => `Missing: ${gap.replace(/^Missing:\s*/, '')}`,
  disagree: (a: string, b: string) => `The sources disagree: '${a}' · '${b}'`,
  asked: 'Asked',
  skip: 'Skip',
  someoneElse: 'Someone else knows',
  whoKnows: 'Who knows?',
  leaveWithThem: 'Leave it with them',
  leftAtEnd: (name: string) => `Left with ${name} when you confirm at the end.`,
  nothingLeft: 'Nothing left on the list for the people on this call. Keep taking notes, or end the call.',
  notePlaceholder: 'What was said. Press Enter to add it.',
  whoSaid: 'Who said it:',
  me: 'Me',
  listening: (s: number, max: number) => `Listening ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} of ${Math.floor(max / 60)}:${String(max % 60).padStart(2, '0')}. Press the square to stop.`,
  beforeRecording: 'Mute yourself in the meeting before you speak a note: the meeting hears your microphone. Record other people only with their agreement. Avala OS keeps the text you add, not the recording.',
  spoken: '(spoken)',
  reading: 'Reading your last notes…',
  readAt: (time: string) => `Read at ${time}.`,
  readFailed: 'Your last notes could not be read. They are kept, and Avala OS tries again with your next note.',
  /** Measure 1's fix (F2): no question has been read against every note yet; a reading starts at once. */
  checking: 'Checking your notes for the next question.',
  readNow: 'Read now',
  foundHeading: (n: number) => `Found in your notes (${n})`,
  mayAnswer: (q: string) => `May answer: ${q}`,
  wouldRecord: (v: string) => `This would record: ${v}`,
  /** Revision 2: an answer stated in the notes; "You said it" was wrong for a note of what someone else said. */
  stated: 'Stated in your notes',
  inferred: 'Inferred: check it',
  quoteAt: (excerpt: string, time: string) => `'${excerpt}' · your note at ${time}`,
  notRight: 'Not right',
  raisedHeading: (n: number) => `Raised from your notes (${n})`,
  askItNow: 'Ask it now',
  holding: 'Waiting a minute: your notes may answer it.',
  askedHeading: (n: number) => `Asked (${n})`,
  answeredInNotes: 'Answered in your notes',
  noAnswerYet: 'No answer found yet',
  aiUsed: (used: number, cap: number) => `AI used on this call: ${used.toLocaleString('en-GB')} of ${cap.toLocaleString('en-GB')} tokens.`,
  capReached: 'This call has used its share of AI for reading during the call. The order still works, and your notes are read once when you end the call.',
  allowanceUsed: (month: string) => `This workspace has used its AI allowance for the month, so Avala OS cannot read your notes until it starts again on 1 ${month}. Your notes are kept for the end of the call.`,
  notesFull: "This call's notes are full. End the call to keep them.",
  cannotStore: 'This browser cannot keep your notes on this device. Download your notes before you close this tab.',
  otherTab: 'This call is open in another tab. Notes typed here are kept; Avala OS reads them in the other tab.',
  download: 'Download my notes',

  // An unfinished call (section 5, revision 2)
  unfinished: (when: string) => `A call from ${when} was not finished.`,
  unfinishedOld: (when: string, days: number) => `A call from ${when} was not finished, ${plural(days, 'day')} ago. Its notes are still on this device.`,
  continue: 'Continue',
  discard: 'Discard',
  rebuilt: 'This call is more than 7 days old. Avala OS built its list again from the process as it is now.',
  signOutAsk: 'You have a call that is not finished. Signing out removes its notes from this device.',
  signOutAnyway: 'Sign out anyway',
  cancel: 'Cancel',

  // The end and the review (section 4.3)
  endCall: 'End the call',
  endAsk: 'End the call? Avala OS reads all your notes once more against every open question, then shows what to keep.',
  endAndReview: 'End and review',
  backToCall: 'Back to the call',
  endReadingLimited: (n: number) => `Read against the ${n} questions that matter most. The rest can be answered from these notes in Closing the gaps.`,
  reviewHeading: 'What the call settled',
  reviewLine: 'Tick what to keep. Nothing is saved until you press Save.',
  answersHeading: (n: number) => `Answers (${n})`,
  willRecord: (v: string) => `This will record: ${v}`,
  needsPeriod: 'Say the period this figure is for before you keep it.',
  chooseHeading: (n: number) => `Your notes seem to answer these: pick the answer (${n})`,
  chooseLine: 'Pick the answer the notes give. Nothing is picked for you, and nothing is kept until you pick.',
  keepOpenHeading: (n: number) => `Questions to keep open (${n})`,
  askedNotAnswered: 'Asked in the call, not answered.',
  leftWithHeading: (n: number) => `Left with someone (${n})`,
  leftWithLine: (q: string, name: string) => `${q} · left with ${name}`,
  ownHeadingReview: (n: number) => `Your own questions (${n})`,
  shapeHeading: 'About the shape of the process',
  shapeLine: 'Your notes say things about the steps, people or applications that the draft does not hold yet. They come into the draft when the notes are read as a source, after you save.',
  /**
   * Preview walk, 28 November 2026: an answer to one of the assessment's inputs is written by the Inputs view's own
   * operation, which keeps no quote, so the line no longer says every answer quotes the notes.
   */
  notesKept: (title: string) => `Your notes are kept as a source, "${title}". An answer to an open question quotes the note it came from; a figure or another input of the assessment is recorded without a quote.`,
  inputNoQuote: 'Recorded in the assessment\'s inputs, which keep no quote: this answer will not cite your note.',
  needsUnit: 'Say whether this time is in minutes or hours before you keep it.',
  save: 'Save',
  discardCall: 'Discard the call',
  discardAsk: 'Discard the call? Your notes and everything found in them are removed from this device. Nothing was saved.',
  notSaved: (message: string, key: string) => `Not saved: ${message.trim().replace(/\.?$/, '.')} Your notes are kept as source ${key}; nothing else changed. Try again.`,
  notSavedNothing: (message: string) => `Not saved: ${message.trim().replace(/\.?$/, '.')} Nothing changed, and your notes are still on this device. Try again.`,
  /** Preview walk, 28 November 2026: what Save recorded comes first, so an answer to an input never reads as nothing saved. */
  saved: (counts: { answers: number; kept: number; left: number }, result: string) => {
    const parts = [
      counts.answers && plural(counts.answers, 'answer') + ' recorded',
      counts.kept && `${plural(counts.kept, 'question')} kept open`,
      counts.left && `${counts.left} left with someone`,
    ].filter(Boolean);
    return `Saved: ${parts.length ? parts.join(', ') : 'your notes are kept as a source'}. ${result}.`;
  },
  stillOpen: 'Still open, by who to ask:',
  sendFiles: 'Send questions to the people who know',
  readIntoDraft: 'Read the notes into the draft',
  closeWindow: 'Close this window',
} as const;

/** History's line for the call's one edit of the record. */
export function callSummary(date: string, c: { answers: number; kept: number; left: number }): string {
  return `Call of ${date}: ${plural(c.answers, 'answer')}, ${plural(c.kept, 'question')} kept open, ${c.left} left with someone`;
}
