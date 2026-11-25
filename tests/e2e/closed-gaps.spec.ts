// A gap a person closed is not asked again (package B, pull request 5a; owner, 25 November 2026, option B). Closing
// the gaps says how many, shows them with their answers, and Reopen is the only way back.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const NA = 'Not applicable to this process.';
// "Not applicable" on "Who does "Three-way match"?", as Closing the gaps and Discovery record it.
const closed = { ...gold, openQuestions: [...gold.openQuestions, { id: 'q-90', target: { kind: 'step', id: 's-match', field: 'roleIds' }, question: 'Who does "Three-way match"?', whyItMatters: '', owner: null, status: 'answered', answer: NA }] };

test('Closing the gaps: a gap a person closed is listed as not asked again, with its answer, and Reopen brings it back', async ({ page }) => {
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ closed, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = closed;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { closed, KEY });
  await page.goto(`${processUrl}/assessment`);
  await page.getByTestId('questions-line').getByRole('button', { name: 'Answer them' }).click();
  const assistant = page.getByTestId('gaps-assistant');
  const section = assistant.getByTestId('closed-gaps');
  await expect(section).toContainText('1 question closed by a person is not asked again.');
  await section.getByRole('button', { name: 'Show them' }).click();
  const row = section.getByTestId('closed-gap');
  await expect(row).toContainText('Who does "Three-way match"?');
  await expect(row).toContainText(`Answer: ${NA}`);

  await row.getByRole('button', { name: 'Reopen' }).click();
  await expect(assistant.getByTestId('closed-gaps')).toHaveCount(0);
  const status = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).revisions.find((r: { state: string }) => r.state === 'working').model.openQuestions.find((q: { id: string }) => q.id === 'q-90').status, KEY);
  expect(status).toBe('open');
});
