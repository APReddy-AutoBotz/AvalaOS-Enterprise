// Spoken answers (package B, pull request 4a, plan `claude/package-b-pr4-plan-24-nov.md`, section 2; owner, 24
// November 2026). Ask Avala's Questions tab answers with the same box as Closing the gaps: typed, or spoken, the words
// written into the box to check, nothing read or saved until the person does it. The microphone shows where the
// workspace's AI turns speech into text; elsewhere a plain line says why and typing works. The browser's own
// microphone is a fake one here, and the stand-in hears the recording as the words the test gave.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const HEARD = 'Through its screens, with a service account.';
const kept = (page: Page) => page.evaluate(KEY => {
  const state = JSON.parse(localStorage.getItem(KEY)!);
  return { sources: state.sources.length as number, edits: state.edits.length as number };
}, KEY);

async function openQuestions(page: Page, provider?: string) {
  await page.addInitScript(heard => {
    (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { transcribe: [heard], answerFromNotes: [{ answers: [] }] };
  }, HEARD);
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY, provider }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    // A workspace on its own key with this provider (Settings → AI provider keeps it so).
    if (provider) state.ai = { [state.workspaces[0].id]: { provider, model: 'a-model', endpoint: null, keyHint: '1234', updatedAt: new Date().toISOString() } };
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY, provider });
  await page.goto(`${processUrl}/process`);
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: /^Questions/ }).click();
  return panel.getByTestId('interview');
}

test('the Questions tab takes a spoken answer into the box; nothing is read or saved until the person does it', async ({ page }) => {
  test.setTimeout(90_000);
  const interview = await openQuestions(page);
  const box = interview.getByLabel('Your answer, in your own words');
  await expect(interview.getByRole('button', { name: 'Speak your answer' })).toBeVisible();
  const before = await kept(page);

  // Typed words first, then spoken ones after them.
  await box.fill('The robot uses SAP.');
  await interview.getByRole('button', { name: 'Speak your answer' }).click();
  await expect(interview.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await expect(interview).toContainText('Listening');
  await page.waitForTimeout(1200);
  await interview.getByRole('button', { name: 'Stop recording' }).click();
  await expect(box).toHaveValue(`The robot uses SAP.\n${HEARD}`);

  // Heard, not read: no reading was asked for, and nothing was kept.
  const log = await page.evaluate(() => (window as unknown as { __avalaStandInLog: { task: string; answered: boolean }[] }).__avalaStandInLog);
  expect(log.filter(c => c.task === 'transcribe')).toEqual([{ task: 'transcribe', answered: true }]);
  expect(log.filter(c => c.task === 'answerFromNotes' && c.answered)).toEqual([]);
  await expect(interview.getByTestId('interview-record')).toHaveCount(0);
  expect(await kept(page)).toEqual(before);

  // The typed limit holds as before.
  await box.fill('x'.repeat(2100));
  await expect(box).toHaveValue('x'.repeat(2000));
});

test('on a provider that cannot turn speech into text, a plain line takes the microphone\'s place and typing works', async ({ page }) => {
  test.setTimeout(90_000);
  const interview = await openQuestions(page, 'anthropic');
  await expect(interview.getByTestId('no-voice')).toHaveText("Voice input is not available with this workspace's AI provider. Type your answer instead.");
  await expect(interview.getByRole('button', { name: 'Speak your answer' })).toHaveCount(0);
  await interview.getByLabel('Your answer, in your own words').fill(HEARD);
  await expect(interview.getByLabel('Your answer, in your own words')).toHaveValue(HEARD);
  await expect(interview.getByRole('button', { name: 'Read my answer' })).toBeEnabled();

  // The same rule in Closing the gaps (owner, 24 November 2026): "Several at once" says so too.
  await page.getByTestId('ask-panel').getByRole('button', { name: 'Answer several from notes or a transcript' }).click();
  const assistant = page.getByTestId('gaps-assistant');
  await expect(assistant.getByLabel('Your answers')).toBeVisible();
  await expect(assistant.getByTestId('no-voice')).toHaveText("Voice input is not available with this workspace's AI provider. Type your answer instead.");
  await expect(assistant.getByRole('button', { name: 'Speak your answer' })).toHaveCount(0);
});
