// Discovery notices what a person said (package B, pull request 5b, plan `claude/package-b-pr5b-plan-26-nov.md`,
// approved 26 November 2026). After the description is read, `discoveryQuestions` is given the person's words alone;
// the questions it raises join the cards with the words that raised it, and what the person wants in future is kept
// apart from the work done today: held back from the first reading's steps, kept under "What you want to change" on
// Keep, and made a requirement (origin user) from The brief. The reading and the AI task are recorded replies
// (journey/store/standIns.ts); nothing is saved before a person presses Save, Keep or Make it a requirement.
import fs from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const ends = new Set(gold.events.filter((e: { kind: string }) => e.kind === 'end').map((e: { id: string }) => e.id));
const first = { ...gold, events: gold.events.filter((e: { id: string }) => !ends.has(e.id)), flows: gold.flows.filter((f: { from: string; to: string }) => !ends.has(f.from) && !ends.has(f.to)) };
const TODAY = 'Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields, then matches each invoice against the purchase order and the goods receipt in SAP. Invoices from new suppliers are sent back.';
const WANTED = 'The system should block entries over the limit.';
// The reading proposes a step from the wanted sentence alone: it must be held back, not a step of today's work.
const reading = {
  ...first,
  steps: [...first.steps, { id: 's-block', name: 'Block entries over the limit', description: '', roleIds: [], systemIds: [], taskType: 'service', inputs: [], outputs: [], ruleIds: [], exceptionIds: [], aliases: [], status: 'stated', sources: [{ sourceId: 'own-1', locator: { lineStart: 2 }, excerpt: 'The system should block entries over the limit' }] }],
};
const noticed = {
  questions: [
    { segmentId: 'n:1', excerpt: 'matches each invoice against the purchase order', pattern: 'who_handles', about: 'Three-way match', question: 'Who matches an invoice that does not agree with its purchase order?', whyItMatters: 'It decides who the step is with.' },
    { segmentId: 'n:1', excerpt: 'Invoices from new suppliers are sent back', pattern: 'who_handles', about: '', question: 'Who sends an invoice from a new supplier back, and to whom?', whyItMatters: 'It names who handles the exception.' },
  ],
  wanted: [{ segmentId: 'n:2', excerpt: WANTED }],
};
const replies = { extraction: [reading], discoveryQuestions: [noticed, { questions: [], wanted: [] }], answerFromNotes: [{ answers: [] }] };

type Call = { task: string; answered: boolean; said?: string[] };
const standInLog = (page: Page) => page.evaluate(() => (window as unknown as { __avalaStandInLog: Call[] }).__avalaStandInLog);
const memory = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!), KEY);
const working = async (page: Page) => (await memory(page)).revisions.find((r: { state: string }) => r.state === 'working')?.model ?? null;

/** A person describes the work and reads it; the first reading's screen, after noticing. */
async function describe(page: Page) {
  await page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);
  await signInAndCreateProcess(page);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const discovery = page.getByTestId('discovery');
  await discovery.getByLabel('In your own words').fill(`${TODAY}\n\n${WANTED}`);
  await discovery.getByRole('button', { name: 'Save and read it' }).click();
  await expect(discovery.getByTestId('discovery-steps')).toBeVisible({ timeout: 20_000 });
  // Noticing runs once the reading is done; the process cannot be started from it until it has.
  await expect.poll(async () => (await standInLog(page)).filter(c => c.task === 'discoveryQuestions').length, { timeout: 20_000 }).toBe(1);
  await expect(discovery.getByTestId('discovery-noticing')).toHaveCount(0, { timeout: 20_000 });
  return discovery;
}

/** The cards in the order shown, each with where it came from, skipping each (Skip records nothing in the draft). */
async function cardsInOrder(page: Page, at_most = 40) {
  const card = page.getByTestId('discovery').getByTestId('discovery-card');
  const seen: { question: string; origin: string }[] = [];
  for (let i = 0; i < at_most; i++) {
    if (!(await card.count())) break;
    const question = (await card.getByTestId('discovery-question').textContent())!.trim();
    if (seen.some(s => s.question === question)) break;
    seen.push({ question, origin: ((await card.getByTestId('discovery-origin').textContent()) ?? '').trim() });
    const skip = card.getByRole('button', { name: 'Skip' });
    if (!(await skip.count())) break;
    await skip.click();
    await expect(card.getByTestId('discovery-question')).not.toHaveText(question);
  }
  return seen;
}

test('noticing: the person\'s words alone are read; what they want is held back, kept on Keep, and made a requirement', async ({ page }) => {
  test.setTimeout(150_000);
  const discovery = await describe(page);

  // Noticing was given the person's words only, once: the two paragraphs, nothing of a file or of the draft.
  const notices = (await standInLog(page)).filter(c => c.task === 'discoveryQuestions');
  expect(notices).toEqual([{ task: 'discoveryQuestions', answered: true, said: [TODAY, WANTED] }]);

  // The step read from the wanted sentence alone is held back, not a step of today's work.
  const held = discovery.getByTestId('discovery-held-back');
  await expect(held).toContainText('Held back: what you want to change');
  await expect(held).toContainText('Block entries over the limit');
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(first.steps.length);
  await expect(discovery.getByTestId('discovery-steps')).not.toContainText('Block entries over the limit');

  // Nothing joined the record before Save: no steps, nothing wanted, no requirement.
  const before = await working(page);
  expect(before?.steps ?? []).toEqual([]);
  expect(before?.meta.wanted ?? []).toEqual([]);
  expect(Object.values((await memory(page)).requirements ?? {}).flat()).toEqual([]);

  // The session keeps what was raised and what was marked, each with its quote and a target.
  const state = (await memory(page)).discovery[0].state;
  expect(state.wanted.map((w: { excerpt: string; sourceId: string }) => [w.excerpt, w.sourceId])).toEqual([[WANTED, 'own-1']]);
  expect(state.raised.length).toBe(2);
  for (const r of state.raised) {
    expect(r.origin.kind).toBe('quote');
    expect(TODAY).toContain(r.origin.quote.excerpt);
    expect(r.target.kind).toEqual(expect.any(String));
  }

  await discovery.getByRole('button', { name: 'Start the process from this' }).click();
  const card = discovery.getByTestId('discovery-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  // The As-Is steps are the reading's, without the held-back one.
  expect((await working(page)).steps.map((s: { id: string }) => s.id).sort()).toEqual(first.steps.map((s: { id: string }) => s.id).sort());

  // What you want to change, in Discovery: Keep puts it in the record, with its quote; the steps are unchanged.
  const wanted = discovery.getByTestId('discovery-wanted');
  await expect(wanted.getByTestId('discovery-wanted-item')).toHaveText([new RegExp(`“${WANTED.replace('.', '\\.')}”`)]);
  const steps = JSON.stringify((await working(page)).steps);
  await wanted.getByRole('button', { name: 'Keep' }).click();
  await expect(wanted).toHaveCount(0);
  const kept = (await working(page)).meta.wanted;
  expect(kept).toEqual([expect.objectContaining({ statement: WANTED, sources: [expect.objectContaining({ sourceId: 'own-1', excerpt: WANTED })] })]);
  expect(JSON.stringify((await working(page)).steps)).toBe(steps);

  // Every card shown has a quote or a gap; the question on "Three-way match" is the gap's one card, with the quote.
  const shown = await cardsInOrder(page);
  expect(shown.length).toBeGreaterThan(3);
  for (const c of shown) expect(c.origin).toMatch(/^(You said: “|Missing: |\S.*: “)/);
  const match = shown.filter(c => c.question === 'Who does "Three-way match"?');
  expect(match).toEqual([{ question: 'Who does "Three-way match"?', origin: expect.stringMatching(/^You said: “matches each invoice against the purchase order”/) }]);
  expect(shown.filter(c => /^Who (matches|sends)/.test(c.question)).map(c => c.question)).toEqual(['Who sends an invoice from a new supplier back, and to whom?']);

  // An answer that says no more than its value is not noticed; one call in all so far.
  expect((await standInLog(page)).filter(c => c.task === 'discoveryQuestions')).toHaveLength(1);

  // The brief on the Process stage: Make it a requirement gives one business requirement with origin user.
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  const item = page.getByTestId('wanted').getByTestId('wanted-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(WANTED);
  await item.getByRole('button', { name: 'Make it a requirement' }).click();
  await expect(item).toContainText(/A requirement: BR-\d+/);
  const rows = Object.values((await memory(page)).requirements ?? {}).flat() as { kind: string; origin: string; statement: string; key: string; category: string }[];
  expect(rows).toEqual([expect.objectContaining({ kind: 'BR', origin: 'user', category: 'user', statement: WANTED, key: `wanted:${kept[0].id}` })]);
  await expect(item.getByRole('button', { name: 'Make it a requirement' })).toHaveCount(0);
  // The As-Is steps are still the reading's.
  expect(JSON.stringify((await working(page)).steps)).toBe(steps);
});

test('with the same words and the same replies, the cards come in the same order', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(150_000);
  const order = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const discovery = await describe(page);
    await discovery.getByRole('button', { name: 'Start the process from this' }).click();
    await expect(discovery.getByTestId('discovery-card')).toBeVisible({ timeout: 20_000 });
    const seen = await cardsInOrder(page, 10);
    await context.close();
    return seen;
  };
  const a = await order();
  const b = await order();
  expect(a.length).toBeGreaterThan(3);
  expect(b).toEqual(a);
});
