// What was looked up in the sources is shared (package 4 of docs/next-plan.md): two pages on one process
// show the same answer found in the sources, read from the store and not from the browser's own copy, and
// "Not right" on one page holds on the other. The in-browser store stands in for the server's table; the
// rules (merging two writers, the wait across pages, the hand-over) are tested in
// domain/assistant/sharedLook.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const KEY = 'avala.journey.memory.v1';
// A first-list question of the sample, and an answer a source states (as the look keeps one).
const itemKey = 'system:sys-servicenow';
const display = 'Its REST API can be used';
const found = {
  key: `answer:${itemKey}:${display}`, kind: 'answer', title: 'A source answers', why: 'The sources already say it.',
  quote: { text: 'We raise the incidents in ServiceNow through its REST API.', source: 'Call 3, line 12' }, willDo: `Record: ${display}`, needs: 'edit_process',
  target: { kind: 'answer', itemKey, source: 'Call 3, line 12', proposal: { itemKey, question: 'Which ServiceNow interfaces can the automation use? 1 is not confirmed.', display, quote: 'We raise the incidents in ServiceNow through its REST API.', certainty: 'stated', answer: { statuses: { 0: 'confirmed' } } } },
};

/** This browser's own copy of every look, removed, so what shows can only come from the store. */
const forgetOwnCopy = (page: Page) => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('avala:source-look:') || k.startsWith('avala:dismissed:')) localStorage.removeItem(k);
});
async function openQuestions(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: /^Questions/ }).click();
  await expect(panel.getByTestId('interview-plan')).toBeVisible();
  return panel;
}

test('two pages on one process show the same answer found in the sources, and "Not right" on one holds on the other', async ({ page, context }) => {
  await signInAndCreateProcess(page);
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  // The sample's model, and a look kept in the store (the server's table in the live product).
  await page.evaluate(({ gold, found, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const rev = state.revisions.find((r: { state: string }) => r.state === 'working');
    rev.model = gold;
    state.looks = { [rev.processId]: { look: { sources: '', looked: [found.target.itemKey], found: [found], questions: 1, passages: 1, tokens: 100, calls: 1 }, dismissed: [], version: 1 } };
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, found, KEY });
  await forgetOwnCopy(page);
  await page.reload();

  // Page A shows the answer found.
  const a = await openQuestions(page);
  await a.getByRole('button', { name: 'Confirm the answer found in your sources' }).click();
  await expect(a.getByTestId('found-answer')).toContainText(display);

  // Page B, opened beside it with no copy of its own, shows the same answer.
  const second = await context.newPage();
  await forgetOwnCopy(page);
  await second.goto(page.url());
  const b = await openQuestions(second);
  await expect(b.getByRole('button', { name: 'Confirm the answer found in your sources' })).toBeVisible();

  // "Not right" on page A is kept in the store for everyone.
  await a.getByTestId('found-answer').getByRole('button', { name: 'Not right' }).click();
  await expect(a.getByTestId('found-answer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(KEY => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    return Object.values(state.looks ?? {}).flatMap((l: any) => l.dismissed);
  }, KEY)).toEqual([found.key]);

  // Page B, reloaded with no copy of its own, no longer offers it.
  await forgetOwnCopy(second);
  await second.reload();
  const b2 = await openQuestions(second);
  await expect(b2.getByTestId('interview-plan')).toBeVisible();
  await expect(b2.getByRole('button', { name: /found in your sources/ })).toHaveCount(0);
});
