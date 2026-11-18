// The demo's own words (journey/demo/DemoApp.tsx), from the marketing review of 18 November 2026: the demo
// opens on the sample's assessment with one line saying what to look at next, and where the demo cannot do
// a thing because it has no server it says so in plain words, never "local mode".

/** Where the demo opens: the sample's assessment. */
export const DEMO_START_STAGE = 'assessment' as const;

/** The line on the page the demo opens on; `Documents` is the link's text. */
export const DEMO_POINTER = {
  before: "You are looking at the sample's assessment: what each step would be done with, and why. Next, open ",
  link: 'Documents',
  after: ' to see the process document written from it.',
} as const;

/** Under "Read the process from your sources" and when an image is added, in the demo. */
export const DEMO_FILES_NOTE = "In the demo the sample's files are already read. Reading your own files happens in a workspace of your own.";

/** The whole pointer line as text, for tests and for a screen reader's single read. */
export const demoPointerText = (): string => `${DEMO_POINTER.before}${DEMO_POINTER.link}${DEMO_POINTER.after}`;
