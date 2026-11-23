// Closing questions from the Assessment stage (package 16 of docs/next-plan.md, section 3g), on the sample
// case in an organisation set to "Assess": the line counts the open questions that could change the
// recommendation; its button opens Closing the gaps on those; several are answered from pasted notes,
// read by the browser tests' stand-in for the AI server (journey/store/standIns.ts); nothing is kept
// before Save; after it the result's figures match the saved process. Ask Avala's Questions tab and My
// work lead to the same screen. The rules are tested in domain/questions/result.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openSettings, shot, signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });

// What the person says, and what the AI server would read from it: the sample's three SAP interfaces and
// ServiceNow's one can be used. The questions are numbered as Closing the gaps lists them.
const NOTES = 'SAP: the supplier invoice API, the material document API and the attachment API can all be used by the automation user.\n\nServiceNow: we raise incidents through its REST API, and the automation may use it.';
const found = (questionId: string, iface: string, segmentId: string, excerpt: string) => ({ questionId, value: 'confirmed', interface: iface, certainty: 'stated', segmentId, excerpt });
const REPLY = { answers: [
  found('1', '2', 'n:1', 'can all be used by the automation user'),
  found('1', '4', 'n:1', 'can all be used by the automation user'),
  found('1', '6', 'n:1', 'can all be used by the automation user'),
  found('2', '0', 'n:2', 'the automation may use it'),
] };

type Call = { task: string; answered: boolean; why?: string };
const calls = (page: Page) => page.evaluate(() => ((window as unknown as { __avalaStandInLog?: Call[] }).__avalaStandInLog ?? []));
/** What is kept: the sources and the edits in History, and the working draft's model. */
const kept = (page: Page) => page.evaluate(KEY => {
  const state = JSON.parse(localStorage.getItem(KEY)!);
  const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
  return { sources: state.sources.length as number, edits: state.edits.length as number, model: draft.model };
}, KEY);

test('the Assessment stage counts the questions that could change the recommendation, and several are answered from notes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(reply => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { answerFromNotes: [reply] }; }, REPLY);
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');

  // The organisation is set to "Assess": no Documents stage.
  await openSettings(page, 'Parts of Avala OS');
  const parts = page.getByTestId('organization-parts');
  await parts.getByRole('radio', { name: /^Assess Sources/ }).check();
  await parts.getByRole('button', { name: 'Save' }).click();
  await expect(parts.getByRole('status')).toContainText('Saved');

  // The sample's hand-checked model stands in for an extraction.
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY });
  await page.goto(`${processUrl}/assessment`);
  await expect(rail(page).getByRole('link')).toHaveText([/Sources/, /Process/, /Assessment/]);

  // The line: 3 on the bare sample, under what would sharpen the assessment most.
  const line = page.getByTestId('questions-line');
  await expect(line).toContainText('3 open questions could change the recommendation');
  await line.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot(page, '160-assessment-questions-line');
  await line.getByRole('button', { name: 'Answer them' }).click();

  // Closing the gaps on the same 3, and back to the assessment.
  const assistant = page.getByTestId('gaps-assistant');
  await expect(assistant.getByTestId('gaps-focused')).toContainText('Showing the 3 that could change the recommendation');
  await expect(assistant.getByRole('list', { name: 'Questions' }).getByRole('listitem')).toHaveCount(3);
  await expect(assistant.getByRole('button', { name: 'Back to the assessment' })).toBeVisible();
  await expect(assistant).not.toContainText('Back to the document');
  await expect(assistant.getByTestId('gaps-summary')).toContainText('updates the model and the assessment at once');
  await expect(assistant.getByTestId('gaps-summary')).not.toContainText('documents');

  // Several at once, from pasted notes.
  const before = await kept(page);
  await assistant.getByRole('tab', { name: 'Several at once (3)' }).click();
  await assistant.getByLabel('Your answers').fill(NOTES);
  await assistant.getByRole('button', { name: 'Find the answers' }).click();
  const proposals = assistant.getByTestId('proposals');
  await expect(proposals.getByRole('listitem')).toHaveCount(2);
  await expect(proposals).toContainText('Which SAP S/4HANA interfaces can the automation use?');
  await expect(proposals).toContainText('the automation may use it');
  await shot(page, '161-gaps-several-proposals');

  // Nothing is kept before Save: no new source, no new edit in History, the model as it was.
  expect(await kept(page)).toEqual(before);

  await proposals.getByRole('button', { name: 'Save 2 answers' }).click();
  const result = assistant.getByTestId('meeting-result');
  await expect(result.getByTestId('meeting-result-count')).toHaveText('2 of 12 open questions closed');
  await expect(result.getByTestId('meeting-result-group').first()).toContainText('Process owner or SME');
  await expect(result).toContainText('How can Office scanner (Pune) be accessed by the automation');
  await expect(result).not.toContainText('Which SAP S/4HANA interfaces');
  await expect(result.getByRole('button', { name: 'Send questions to the people who know' })).toBeVisible();
  await shot(page, '162-gaps-meeting-result');

  // The figures match the saved process: the answers and the notes as a source, the interfaces settled.
  const after = await kept(page);
  expect(after.sources).toBe(before.sources + 1);
  expect(after.edits).toBeGreaterThan(before.edits);
  const access = (id: string) => after.model.systems.find((s: { id: string }) => s.id === id).access.map((a: { access: string }) => a.access);
  expect(access('sys-servicenow')).toEqual(['confirmed']);
  expect([2, 4, 6].map(i => access('sys-sap')[i])).toEqual(['confirmed', 'confirmed', 'confirmed']);
  expect(after.model.openQuestions.filter((q: { id: string; status: string }) => ['q-gr-api', 'q-invoice-api', 'q-attach-api', 'q-servicenow'].includes(q.id) && q.status === 'open')).toEqual([]);
  await expect(assistant.getByTestId('gaps-focused')).toContainText('Showing the 1 that could change the recommendation');
  await assistant.getByRole('button', { name: 'Back to the assessment' }).click();
  await expect(page.getByTestId('questions-line')).toContainText('1 open question could change the recommendation');

  // Ask Avala's Questions tab leads to the same screen, on "Several at once".
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: /^Questions/ }).click();
  await panel.getByRole('button', { name: 'Answer several from notes or a transcript' }).click();
  await expect(page.getByTestId('ask-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/assessment$/);
  await expect(assistant.getByRole('tab', { name: /^Several at once/ })).toHaveAttribute('aria-selected', 'true');
  await assistant.getByRole('button', { name: 'Back to the assessment' }).click();

  // My work's "Answer them" opens the Assessment stage with Closing the gaps.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My work' }).click();
  const needs = page.getByTestId('needs-you');
  await expect(needs).toContainText('only your people can answer');
  await needs.getByRole('button', { name: /only your people can answer/ }).click();
  await expect(page).toHaveURL(/\/assessment$/);
  await expect(page.getByTestId('gaps-assistant')).toBeVisible();

  // The stand-in answered one call, the reading of the notes; the line and the result add none. A call
  // carrying source passages (the look in the sources, once the notes are a source) is refused.
  const log = await calls(page);
  expect(log.filter(c => c.answered)).toEqual([{ task: 'answerFromNotes', answered: true }]);
  for (const c of log.filter(c => !c.answered)) expect(c.why).toMatch(/only what a person said, not passages of ans-1/);
});

// Found in review (23 November 2026): with both stages in use, the link pressed while on Documents opened
// the Assessment stage without Closing the gaps, because Documents (still on screen when the request was
// made) took it. A request now names its stage, and a stage takes only its own.
test('with the full journey, Ask Avala\'s link pressed on Documents opens Closing the gaps on the Assessment stage', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(reply => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { answerFromNotes: [reply] }; }, REPLY);
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY });
  await page.goto(`${processUrl}/documents`);
  await expect(rail(page).getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('document')).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: /^Questions/ }).click();
  await panel.getByRole('button', { name: 'Answer several from notes or a transcript' }).click();
  await expect(page).toHaveURL(/\/assessment$/);
  const assistant = page.getByTestId('gaps-assistant');
  await expect(assistant).toBeVisible();
  await expect(assistant.getByRole('tab', { name: /^Several at once/ })).toHaveAttribute('aria-selected', 'true');
  await expect(assistant.getByRole('button', { name: 'Back to the assessment' })).toBeVisible();
  // The words follow the set-up: this organisation has the documents.
  await expect(assistant.getByTestId('gaps-summary')).toContainText('the assessment and the documents at once');
});
