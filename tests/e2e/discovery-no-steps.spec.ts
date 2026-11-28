// Discovery: a first reading with no steps (plan `claude/discovery-no-steps-plan-27-nov.md`, approved by the owner on
// 27 November 2026 with the limits on reading again). The reading found no step: Discovery says so in plain words,
// with "Read it again" and "Add to what I said", in place of "0 steps" beside a disabled button. Everything it found
// is held back as wanted in future: it says so, and the process can be started once a step is added back. "Read it
// again" keeps to the session's three readings and to the reading limit (one at a time per process, six an hour per
// person), and says so. A reading that failed shows its sentence with "Try again". Readings are recorded replies.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const ends = new Set(gold.events.filter((e: { kind: string }) => e.kind === 'end').map((e: { id: string }) => e.id));
const first = { ...gold, events: gold.events.filter((e: { id: string }) => !ends.has(e.id)), flows: gold.flows.filter((f: { from: string; to: string }) => !ends.has(f.from) && !ends.has(f.to)) };
// The reading found no step (roles and applications only, as on the owner's walk of 27 November 2026).
// A valid model, so that a step held back can be taken out of it (removeStep checks the model).
const noSteps = { ...emptyModel('Supplier invoices'), roles: gold.roles.slice(0, 2), systems: gold.systems.slice(0, 2) };
const WORDS = 'Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields, then matches each invoice against the purchase order and the goods receipt in SAP.';
const NO_STEPS = 'I did not find any steps in what you said. Your words are kept. Read them again, or add who does what, one step after another.';
const FAILED = 'Putting the process together: the sources gave steps, but they could not be put together into a process, twice. Nothing in the process was changed. Read the sources again; if it happens again, add another source or let us know. Reference: abcdef12.';

type Log = { task: string; answered: boolean; sources?: { key: string }[] }[];
const readings = (page: Page) => page.evaluate(() => ((window as unknown as { __avalaStandInLog?: Log }).__avalaStandInLog ?? []).filter(c => c.task === 'extraction'));
const working = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).revisions.find((r: { state: string }) => r.state === 'working')?.model ?? null, KEY);

async function describe(page: Page, replies: unknown, words = WORDS) {
  await page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);
  await signInAndCreateProcess(page);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const discovery = page.getByTestId('ask-panel').getByTestId('discovery');
  await discovery.getByLabel('Assess it and document it').check();
  await discovery.getByLabel('In your own words').fill(words);
  await discovery.getByRole('button', { name: 'Save and read it' }).click();
  return discovery;
}

test('no steps: said in plain words, with "Read it again" and "Add to what I said"; reading again gives the steps', async ({ page }) => {
  test.setTimeout(120_000);
  const discovery = await describe(page, { extraction: [noSteps, first] });
  const none = discovery.getByTestId('discovery-no-steps');
  await expect(none).toHaveText(NO_STEPS, { timeout: 20_000 });
  await expect(discovery.getByTestId('discovery-steps')).toHaveCount(0);
  await expect(discovery).not.toContainText('0 steps');
  await expect(discovery.getByRole('button', { name: 'Start the process from this' })).toHaveCount(0);
  await expect(discovery.getByRole('button', { name: 'Add to what I said' })).toBeVisible();
  expect((await working(page))?.steps ?? []).toEqual([]);

  await discovery.getByRole('button', { name: 'Read it again' }).click();
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(first.steps.length, { timeout: 20_000 });
  await expect(discovery.getByTestId('discovery-no-steps')).toHaveCount(0);
  await expect(discovery.getByRole('button', { name: 'Start the process from this' })).toBeEnabled({ timeout: 20_000 });
  // The same words read again: one source, twice.
  expect((await readings(page)).map(r => r.sources!.map(s => s.key))).toEqual([['own-1'], ['own-1']]);
});

test('the session\'s three readings: after them "Read it again" is gone, it says so, and the words added are kept', async ({ page }) => {
  test.setTimeout(150_000);
  const discovery = await describe(page, { extraction: [noSteps] });
  const box = discovery.getByTestId('discovery-no-steps');
  await expect(box).toContainText(NO_STEPS, { timeout: 20_000 });
  await expect(discovery.getByTestId('discovery-no-steps-again')).toHaveCount(0);
  await discovery.getByRole('button', { name: 'Read it again' }).click();
  // None a second time: one more line.
  await expect(discovery.getByTestId('discovery-no-steps-again')).toHaveText('If it still finds none, adding a few steps in your own words usually helps.', { timeout: 20_000 });
  await discovery.getByRole('button', { name: 'Read it again' }).click();
  await expect(discovery.getByTestId('discovery-readings-used')).toHaveText('This session has used its three readings. Add to what I said is still open; the words you add are kept for the next reading.', { timeout: 20_000 });
  await expect(discovery.getByRole('button', { name: 'Read it again' })).toHaveCount(0);
  expect(await readings(page)).toHaveLength(3);

  // Add to what I said is still offered: the words are kept as a source, and nothing more is read.
  await discovery.getByRole('button', { name: 'Add to what I said' }).click();
  await discovery.getByLabel('What to add').fill('Then the AP clerk posts the invoice in SAP.');
  await discovery.getByRole('button', { name: 'Save my words' }).click();
  await expect(discovery.getByTestId('discovery-notice')).toHaveText('Your words are kept as a source. This session cannot read them now; they are read at the next reading.');
  const sources = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).sources.map((s: { key: string }) => s.key), KEY);
  expect(sources).toEqual(['own-1', 'own-2']);
  expect(await readings(page)).toHaveLength(3);
});

test('the reading limit: six in the hour, "Read it again" says when the next can start; Add to what I said stays', async ({ page }) => {
  test.setTimeout(120_000);
  const discovery = await describe(page, { extraction: [noSteps, first] });
  await expect(discovery.getByTestId('discovery-no-steps')).toContainText(NO_STEPS, { timeout: 20_000 });
  // Five more readings by the same person in the last hour, on other processes: six with this one.
  await page.evaluate(({ KEY, gold }) => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    const now = Date.now();
    s.extractions = [...s.extractions, ...[50, 40, 30, 20, 10].map((m, i) => ({ id: `00000000-0000-4000-8000-00000000020${i}`, processId: `other-${i}`, createdBy: s.me.id, status: 'done', error: null,
      model: gold, tokens: 0, sourceIds: [], done: gold, createdAt: new Date(now - m * 60_000).toISOString(), updatedAt: new Date(now - m * 60_000 + 60_000).toISOString() }))];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, gold });
  await discovery.getByRole('button', { name: 'Read it again' }).click();
  await expect(discovery.getByTestId('discovery-read-limit')).toHaveText(/^You have started 6 readings in the last hour\. You can start the next one in \d+ minutes?\.$/);
  await expect(discovery.getByRole('button', { name: 'Add to what I said' })).toBeVisible();
  await expect(discovery.getByTestId('discovery-no-steps')).toContainText(NO_STEPS);
  expect(await readings(page)).toHaveLength(1);
});

test('everything found is wanted in future: said so, with the held-back step; the process starts once it is added back', async ({ page }) => {
  test.setTimeout(120_000);
  const wish = 'The system should block entries over the limit.';
  const onlyWish = { ...noSteps, steps: [{ id: 's-block', name: 'Block entries over the limit', description: '', roleIds: [], systemIds: [], taskType: 'service', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], aliases: [], status: 'stated', sources: [{ sourceId: 'own-1', locator: { lineStart: 1 }, excerpt: 'The system should block entries over the limit' }] }] };
  const noticed = { questions: [], wanted: [{ segmentId: 'n:1', excerpt: wish }] };
  const discovery = await describe(page, { extraction: [onlyWish], discoveryQuestions: [noticed] }, wish);
  await expect(discovery.getByTestId('discovery-no-steps')).toHaveText('Everything I found is something you want in future, so there is no step of the work done today yet. Add one of them as a step below, or add what is done today.', { timeout: 20_000 });
  await expect(discovery.getByTestId('discovery-held-back')).toContainText('Block entries over the limit');
  await expect(discovery.getByRole('button', { name: 'Start the process from this' })).toHaveCount(0);
  await expect(discovery.getByRole('button', { name: 'Read it again' })).toHaveCount(0);
  await discovery.getByTestId('discovery-held-back').getByRole('button', { name: 'Add it as a step instead' }).click();
  await expect(discovery.getByTestId('discovery-no-steps')).toHaveCount(0);
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(1);
  await expect(discovery.getByRole('button', { name: 'Start the process from this' })).toBeEnabled();
});

test('a failed reading on a first reading shows its sentence with "Try again"', async ({ page }) => {
  test.setTimeout(120_000);
  const discovery = await describe(page, { extraction: [{ failedWith: FAILED }, first] });
  await expect(discovery.getByTestId('discovery-first').getByRole('alert')).toHaveText(`The last reading stopped. ${FAILED}`, { timeout: 20_000 });
  await discovery.getByRole('button', { name: 'Try again' }).click();
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(first.steps.length, { timeout: 20_000 });
});
