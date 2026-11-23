// An application with no way in recorded (plan `claude/no-way-in-answer-plan-23-nov.md`, approved 23 November 2026):
// on the sample in an organisation set to "Assess", the office scanner is asked as a choice of ways in. Words that
// name no way in show a plain line and save nothing; "No way in" says what it will record before Save, and closes
// the question, so the line goes from 3 to 2. The rules are tested in domain/questions/ways.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openSettings, shot, signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const kept = (page: Page) => page.evaluate(KEY => {
  const state = JSON.parse(localStorage.getItem(KEY)!);
  return { sources: state.sources.length as number, edits: state.edits.length as number, model: state.revisions.find((r: { state: string }) => r.state === 'working').model };
}, KEY);

test('the scanner: words that name no way in save nothing; "No way in" says what it records and closes the question', async ({ page }) => {
  test.setTimeout(120_000);
  // The reading of the words finds no way in.
  await page.addInitScript(() => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { answerFromNotes: [{ answers: [] }] }; });
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await openSettings(page, 'Parts of Avala OS');
  const parts = page.getByTestId('organization-parts');
  await parts.getByRole('radio', { name: /^Assess Sources/ }).check();
  await parts.getByRole('button', { name: 'Save' }).click();
  await expect(parts.getByRole('status')).toContainText('Saved');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY });
  await page.goto(`${processUrl}/assessment`);
  await expect(page.getByTestId('questions-line')).toContainText('3 open questions could change the recommendation');
  await page.getByTestId('questions-line').getByRole('button', { name: 'Answer them' }).click();

  const assistant = page.getByTestId('gaps-assistant');
  await assistant.getByRole('list', { name: 'Questions' }).getByRole('button', { name: /Office scanner/ }).click();
  const card = assistant.getByTestId('gap-question');
  await expect(card.getByRole('list', { name: 'Ways in' }).getByRole('listitem')).toHaveCount(6);

  // Words that name no way in: a plain line, and nothing to save.
  const before = await kept(page);
  await card.getByLabel('Or say it').fill('Somebody scans them every morning.');
  await card.getByRole('button', { name: 'Fill in from my answer' }).click();
  await expect(card.getByRole('status').filter({ hasText: 'do not say how the automation reaches' })).toContainText('Your words do not say how the automation reaches Office scanner (Pune), so nothing is recorded yet.');
  await expect(card.getByRole('button', { name: 'Save answer' })).toBeDisabled();
  expect(await kept(page)).toEqual(before);

  // "No way in": what it records, and what happens to the step done in the scanner, before Save.
  await card.getByRole('button', { name: 'No way in: a person does this' }).click();
  await expect(card.getByTestId('ways-record')).toContainText('This will record: no way in to Office scanner (Pune); a person does the work in it.');
  await expect(card.getByTestId('ways-record')).toContainText('"Scan paper invoice" is still recommended for');
  await shot(page, '165-gaps-no-way-in');
  await card.getByRole('button', { name: 'Save answer' }).click();
  await expect(assistant.getByTestId('gaps-focused')).toContainText('Showing the 2 that could change the recommendation');
  const after = await kept(page);
  const scanner = after.model.systems.find((s: { id: string }) => s.id === 'sys-scanner');
  expect(scanner.access.map((a: { method: string; access: string }) => [a.method, a.access])).toEqual([['api', 'confirmed_absent'], ['ui', 'confirmed_absent']]);
  // The words said are kept with the choice, as with any answer.
  expect(after.model.openQuestions.at(-1)).toMatchObject({ status: 'answered', answer: 'No way in: a person does this. Somebody scans them every morning.' });

  await assistant.getByRole('button', { name: 'Back to the assessment' }).click();
  await expect(page.getByTestId('questions-line')).toContainText('2 open questions could change the recommendation');
});
