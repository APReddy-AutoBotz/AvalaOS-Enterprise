// Discovery asks the reading's own open questions (owner's preview walk, 28 November 2026; plan
// `claude/discovery-plain-questions-plan-28-nov.md`, approved): a question about the process as a whole (target meta,
// no field) has no card of its own, so it was asked only in Closing the gaps. It is now a plain question in its
// group's place, answered in words, and Save records the answer on the stored question. The reading and the reading
// of the answer are recorded replies (journey/store/standIns.ts).
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const QUESTION = 'Which system holds the vendor master today?';
const ANSWER = 'The vendor master is kept in SAP.';
// The first reading: the sample, with one question about the process as a whole that could change the recommendation.
const first = { ...gold, openQuestions: [...gold.openQuestions, { id: 'q-whole', target: { kind: 'meta' }, question: QUESTION, whyItMatters: '', owner: null, status: 'open' }] };
const WORDS = 'Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields, then matches each invoice against the purchase order and the goods receipt in SAP.';

type Q = { id: string; question: string; status: string; answer?: string };
const questions = (page: Page): Promise<Q[]> => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).revisions.find((r: { state: string }) => r.state === 'working').model.openQuestions, KEY);
const withStandIns = (page: Page, replies: unknown) => page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);

test('a question about the process as a whole is a card: counted in "Question 1 of N", answered in words, recorded on the stored question', async ({ page }) => {
  test.setTimeout(150_000);
  await withStandIns(page, {
    extraction: [first],
    answerFromNotes: [{ answers: [{ questionId: 'q:1', value: 'SAP', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: ANSWER }] }],
    discoveryQuestions: [{ questions: [], wanted: [] }, { questions: [], wanted: [] }],
  });
  await signInAndCreateProcess(page);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const discovery = page.getByTestId('ask-panel').getByTestId('discovery');
  await discovery.getByLabel('Assess it and document it').check();
  await discovery.getByLabel('In your own words').fill(WORDS);
  await discovery.getByRole('button', { name: 'Save and read it' }).click();
  await expect(discovery.getByTestId('discovery-steps')).toBeVisible({ timeout: 20_000 });
  await discovery.getByRole('button', { name: 'Start the process from this' }).click();
  const card = discovery.getByTestId('discovery-card');
  const question = card.getByTestId('discovery-question');
  const heading = card.locator('p').first();
  await expect(question).toBeVisible({ timeout: 20_000 });

  // Skip round the whole queue once: the question is on a card, and N counts every card, it included.
  const n = Number((await heading.textContent())!.match(/^Question 1 of (\d+)/)![1]);
  const seen: string[] = [];
  for (let i = 0; i < 80; i++) {
    const q = (await question.textContent())!;
    if (seen.includes(q)) break;
    seen.push(q);
    await card.getByRole('button', { name: 'Skip' }).click();
    await expect(question).not.toHaveText(q);
  }
  expect(seen).toContain(QUESTION);
  expect(seen).toHaveLength(n);
  // On its card, under the group that could change the recommendation.
  for (let i = 0; i < n && (await question.textContent()) !== QUESTION; i++) await card.getByRole('button', { name: 'Skip' }).click();
  await expect(question).toHaveText(QUESTION);
  await expect(heading).toHaveText(`Question 1 of ${n} · Changes the recommendation`);
  await expect(card.getByTestId('discovery-waits')).toHaveCount(0);

  // Answered in words: read, shown as what Save will record, and recorded on the stored question, with no copy added.
  const before = await questions(page);
  await card.getByLabel('Or answer in your own words').fill(ANSWER);
  await card.getByRole('button', { name: 'Read my answer' }).click();
  await expect(card).toContainText('This will record');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(discovery.getByTestId('discovery-notice')).toContainText('Recorded:');
  await expect(question).not.toHaveText(QUESTION);
  const after = await questions(page);
  expect(after).toHaveLength(before.length);
  expect(after.find(q => q.id === 'q-whole')).toMatchObject({ status: 'answered' });
  expect(after.find(q => q.id === 'q-whole')!.answer).toContain(ANSWER);
  await expect(heading).toHaveText(new RegExp(`^Question 1 of ${n - 1} · `));
});
