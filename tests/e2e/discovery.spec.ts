// Discovery, Ask Avala's fourth tab (package B, pull request 4b, plan `claude/package-b-pr4-plan-24-nov.md`,
// section 4; approved 24 November 2026). A person describes the work in their own words; the words are kept as a
// source and read; the steps it understood show with the words they came from; "Start the process from this" makes
// the working draft; then one question at a time. Nothing joins the process until Save. An answer about the shape
// of the process is kept with the session and changes the draft only at "Update the draft from your answers", which
// reads the person's words as a "Discovery answers" source. The reading and the AI tasks are stand-ins
// (journey/store/standIns.ts): the reading reads every source it is given and the log keeps what it was given.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
// The first reading: the sample's process without its end, so Discovery asks when a case is finished.
const ends = new Set(gold.events.filter((e: { kind: string }) => e.kind === 'end').map((e: { id: string }) => e.id));
const first = { ...gold, events: gold.events.filter((e: { id: string }) => !ends.has(e.id)), flows: gold.flows.filter((f: { from: string; to: string }) => !ends.has(f.from) && !ends.has(f.to)) };
const WORDS = 'Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields, then matches each invoice against the purchase order and the goods receipt in SAP.';
const END = 'The invoice is posted in SAP and the case is closed.';

type Log = { task: string; answered: boolean; sources?: { key: string; passages: { text: string; place: string | null }[] }[] }[];
const standInLog = (page: Page) => page.evaluate(() => (window as unknown as { __avalaStandInLog: Log }).__avalaStandInLog);
const stored = (page: Page) => page.evaluate(KEY => {
  const s = JSON.parse(localStorage.getItem(KEY)!);
  const working = s.revisions.find((r: { state: string }) => r.state === 'working');
  return { sources: s.sources.map((x: { key: string }) => x.key) as string[], working: working ? JSON.stringify(working.model) : null, sessions: (s.discovery ?? []).length as number };
}, KEY);

test('Discovery: own words read into steps, one question at a time, a shape answer kept until the update reads it as a source', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(({ first, gold }) => {
    (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { extraction: [first, gold], answerFromNotes: [{ answers: [] }] };
  }, { first, gold });
  await signInAndCreateProcess(page);

  // The Sources stage's start in own words offers Ask Avala; the panel opens on Discovery, the only view with no steps.
  const own = page.getByTestId('own-words-discovery');
  await expect(own).toContainText('Or let Ask Avala ask you: it reads what you say and asks about it, one question at a time.');
  await own.getByRole('button', { name: 'Start with Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  const discovery = panel.getByTestId('discovery');
  await expect(discovery.getByTestId('discovery-describe')).toContainText('Nothing joins the process until you press Save.');

  // Typed, nothing kept yet.
  await discovery.getByLabel('In your own words').fill(WORDS);
  expect(await stored(page)).toEqual({ sources: [], working: null, sessions: 0 });
  await discovery.getByRole('button', { name: 'Save and read it' }).click();

  // The words are a source before anything is read from them, and the reading was given them alone.
  await expect(discovery.getByTestId('discovery-first')).toBeVisible({ timeout: 20_000 });
  expect((await stored(page)).sources).toEqual(['own-1']);
  const reads = (await standInLog(page)).filter(c => c.task === 'extraction');
  expect(reads).toHaveLength(1);
  expect(reads[0]!.sources!.map(s => s.key)).toEqual(['own-1']);
  expect(reads[0]!.sources![0]!.passages.map(p => p.text).join(' ')).toBe(WORDS);

  // What it understood, each step with the words it came from; still nothing in the draft.
  await expect(discovery.getByTestId('discovery-first')).toContainText('What I understand so far');
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(first.steps.length);
  await expect(discovery.getByTestId('discovery-steps')).toContainText('From your words:');
  expect((await stored(page)).working).toBeNull();
  await discovery.getByRole('button', { name: 'Start the process from this' }).click();

  // One question at a time, with where it came from; Skip moves on and records nothing.
  const card = discovery.getByTestId('discovery-card');
  await expect(card.getByTestId('discovery-question')).toHaveText('What do you want from this process?', { timeout: 20_000 });
  await expect(card).toContainText('Nothing is recorded until you press Save.');
  await expect(discovery.getByTestId('discovery-session')).toContainText('Started');
  const afterStart = (await stored(page)).working;
  expect(afterStart).not.toBeNull();
  await card.getByRole('button', { name: 'Skip' }).click();
  await expect(card.getByTestId('discovery-question')).toHaveText('Is the work done today?');
  await card.getByRole('button', { name: 'Skip' }).click();

  // Not known: left with a named person, in the question file.
  await expect(card.getByTestId('discovery-question')).toHaveText('Which system is used for "Check mandatory fields"?');
  await card.getByRole('button', { name: 'Not known, ask someone' }).click();
  await card.getByLabel('Who would know?').fill('Rahul in AP');
  await card.getByRole('button', { name: 'Leave it with them' }).click();
  await expect(discovery.getByTestId('discovery-notice')).toContainText('Left with Rahul in AP. It is in the question file for');
  const afterLeave = (await stored(page)).working;
  expect(afterLeave).not.toEqual(afterStart);

  // Skip to the end of the process: an answer about the shape is kept with the session, the draft unchanged.
  for (const q of ['Who does "Three-way match"?', 'Which system is used for "Review high-value invoice"?', 'Which system is used for "Investigate variance"?']) {
    await expect(card.getByTestId('discovery-question')).toHaveText(q);
    await card.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(card.getByTestId('discovery-question')).toHaveText('When is a case finished: what is the last thing that happens?');
  await expect(card.getByTestId('discovery-waits')).toBeVisible();
  await card.getByLabel('Or answer in your own words').fill(END);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(discovery.getByTestId('discovery-notice')).toHaveText('Kept. The draft is unchanged until you update it (1 answer waiting).');
  expect((await stored(page)).working).toEqual(afterLeave);
  expect((await stored(page)).sources).toEqual(['own-1']);

  // The update: the answers become a "Discovery answers" source, read with the own words; each passage is the
  // person's words alone, with the question as its place.
  const waiting = discovery.getByTestId('discovery-waiting');
  await expect(waiting).toContainText('1 answer is not in the draft yet.');
  await waiting.getByRole('button', { name: 'Update the draft from your answers (1)' }).click();
  await expect(discovery.getByTestId('discovery-review')).toBeVisible({ timeout: 20_000 });
  expect((await stored(page)).sources).toEqual(['own-1', 'ans-1']);
  const update = (await standInLog(page)).filter(c => c.task === 'extraction')[1]!;
  expect(update.sources!.map(s => s.key)).toEqual(['own-1', 'ans-1']);
  expect(update.sources![1]!.passages).toEqual([{ text: END, place: 'Answer to: When is a case finished: what is the last thing that happens?' }]);
  await expect(discovery.getByTestId('discovery-waiting')).toHaveCount(0);
  // Nothing from the update joins the draft until the person applies it.
  expect((await stored(page)).working).toEqual(afterLeave);
});

test('the demo shows what Discovery is, with nothing to press', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByLabel('Asking about').selectOption({ label: 'Vendor invoice processing' });
  await panel.getByRole('tab', { name: 'Discovery' }).click();
  await expect(panel.getByTestId('discovery-demo')).toContainText('Discovery asks about a process in conversation.');
  await expect(panel.getByTestId('discovery-demo').getByRole('button')).toHaveCount(0);
});
