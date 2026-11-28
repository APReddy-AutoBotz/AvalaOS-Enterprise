// "Who does it?" and "Which application?" with someone not in the process yet (owner's walk, 28 November 2026; plan
// `claude/someone-else-plan-28-nov.md`, approved): when the person's words name no role or application of the process,
// the card offers the ones in the process and "Someone else" (or "Another application") with a name to type; it says
// what Save will record; Save adds it and records the answer in one edit. In Discovery, the Questions tab and Closing
// the gaps. The reading of the words is a recorded reply that finds nothing (journey/store/standIns.ts).
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const ends = new Set(gold.events.filter((e: { kind: string }) => e.kind === 'end').map((e: { id: string }) => e.id));
const first = { ...gold, events: gold.events.filter((e: { id: string }) => !ends.has(e.id)), flows: gold.flows.filter((f: { from: string; to: string }) => !ends.has(f.from) && !ends.has(f.to)) };
const WORDS = 'Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields, then matches each invoice against the purchase order and the goods receipt in SAP.';

type Model = { roles: { id: string; name: string; kind: string }[]; systems: { id: string; name: string; kind: string; access: unknown[] }[]; steps: { id: string; roleIds: string[]; systemIds: string[] }[]; openQuestions: { question: string; status: string; answer?: string }[] };
const working = (page: Page): Promise<Model> => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).revisions.find((r: { state: string }) => r.state === 'working').model, KEY);
const withStandIns = (page: Page, replies: unknown) => page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);

async function withSample(page: Page) {
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
  return processUrl;
}

test('Discovery: words that name nobody in the process give the choice; "Another application" and "Someone else" add it in one save', async ({ page }) => {
  test.setTimeout(150_000);
  await withStandIns(page, { extraction: [first], answerFromNotes: [{ answers: [] }] });
  await signInAndCreateProcess(page);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const discovery = page.getByTestId('ask-panel').getByTestId('discovery');
  await discovery.getByLabel('Assess it and document it').check();
  await discovery.getByLabel('In your own words').fill(WORDS);
  await discovery.getByRole('button', { name: 'Save and read it' }).click();
  await expect(discovery.getByTestId('discovery-steps')).toBeVisible({ timeout: 20_000 });
  await discovery.getByRole('button', { name: 'Start the process from this' }).click();
  const card = discovery.getByTestId('discovery-card');
  await expect(card.getByTestId('discovery-question')).toHaveText('Is the work done today?', { timeout: 20_000 });
  await card.getByRole('button', { name: 'Skip' }).click();

  // An application not in the process.
  await expect(card.getByTestId('discovery-question')).toHaveText('Which system is used for "Check mandatory fields"?');
  await expect(card.getByTestId('named-choice')).toHaveCount(0);
  await card.getByLabel('Or answer in your own words').fill('We check them in the Coupa portal.');
  await card.getByRole('button', { name: 'Read my answer' }).click();
  await expect(card.getByTestId('discovery-follow-up')).toHaveText('I could not tell which application from that. Choose one below, or "Another application" and type its name.');
  const choice = card.getByTestId('named-choice');
  await expect(choice.getByRole('combobox', { name: 'Choose the application' }).getByRole('option')).toHaveCount(first.systems.length + 2);
  await choice.getByRole('combobox', { name: 'Choose the application' }).selectOption({ label: 'Another application…' });
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await choice.getByLabel('The application’s name').fill('Coupa');
  await expect(choice.getByTestId('named-record')).toHaveText('This will record: “Check mandatory fields” is done in Coupa. Coupa is added to the applications. How the automation reaches it is not recorded yet, so that is asked about.');
  const before = await working(page);
  expect(before.systems.some(s => s.name === 'Coupa')).toBe(false);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(discovery.getByTestId('discovery-notice')).toContainText('Recorded: Coupa');
  let m = await working(page);
  const coupa = m.systems.find(s => s.name === 'Coupa')!;
  expect([coupa.kind, coupa.access]).toEqual(['other', []]);
  expect(m.steps.find(s => s.id === 's-check')!.systemIds).toEqual([coupa.id]);
  expect(m.openQuestions.find(q => q.question === 'Which system is used for "Check mandatory fields"?')).toMatchObject({ status: 'answered', answer: 'Coupa (in their words: "We check them in the Coupa portal.")' });

  // A role not in the process, as a team.
  await expect(card.getByTestId('discovery-question')).toHaveText('Who does "Three-way match"?');
  await card.getByLabel('Or answer in your own words').fill('The matching desk does that.');
  await card.getByRole('button', { name: 'Read my answer' }).click();
  await expect(card.getByTestId('discovery-follow-up')).toHaveText('I could not tell which role from that. Choose one below, or "Someone else" and type their role.');
  await card.getByTestId('named-choice').getByRole('combobox', { name: 'Choose the role' }).selectOption({ label: 'Someone else…' });
  await card.getByTestId('named-choice').getByLabel('Their role').fill('Matching desk');
  await card.getByTestId('named-choice').getByLabel('Kind of role').selectOption({ label: 'a team' });
  await expect(card.getByTestId('named-record')).toHaveText('This will record: Matching desk does “Three-way match”. Matching desk is added to the roles, as a team.');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(discovery.getByTestId('discovery-notice')).toContainText('Recorded: Matching desk');
  m = await working(page);
  const desk = m.roles.find(r => r.name === 'Matching desk')!;
  expect(desk.kind).toBe('team');
  expect(m.steps.find(s => s.id === 's-match')!.roleIds).toEqual([desk.id]);
});

test('the Questions tab: the follow-up offers the roles in the process and "Someone else"; a name already there is that one', async ({ page }) => {
  test.setTimeout(120_000);
  await withStandIns(page, { answerFromNotes: [{ answers: [] }] });
  const processUrl = await withSample(page);
  await page.goto(`${processUrl}/process`);
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: /^Questions/ }).click();
  const interview = panel.getByTestId('interview');
  // Skip to who does "Three-way match", going on with what can wait if it is not in the first list.
  const goOn = panel.getByTestId('interview-go-on');
  for (let i = 0; i < 60; i++) {
    await expect(interview.getByTestId('interview-question').or(goOn)).toBeVisible();
    if (await goOn.count()) { await goOn.click(); continue; }
    const q = (await interview.getByTestId('interview-question').textContent()) ?? '';
    if (q === 'Who does "Three-way match"?') break;
    await interview.getByRole('button', { name: 'Skip' }).first().click();
    await expect(interview.getByTestId('interview-question').filter({ hasText: q })).toHaveCount(0);
  }
  await expect(interview.getByTestId('interview-question')).toHaveText('Who does "Three-way match"?');
  await interview.getByLabel('Your answer, in your own words').fill('Our team lead.');
  await interview.getByRole('button', { name: 'Read my answer' }).click();
  await expect(interview.getByTestId('interview-follow-up')).toHaveText('I could not tell which role from that. Choose one below, or "Someone else" and type their role.');
  const named = interview.getByTestId('interview-named');
  await named.getByRole('combobox', { name: 'Choose the role' }).selectOption({ label: 'Someone else…' });
  await named.getByLabel('Their role').fill('ap team lead');
  // Already in the process, ignoring case: that one, nothing added.
  await expect(named.getByTestId('named-record')).toHaveText('This will record: AP Team Lead does “Three-way match”.');
  await named.getByRole('button', { name: 'Save' }).click();
  await expect(interview.getByTestId('interview-saved')).toHaveText('Recorded: AP Team Lead');
  const m = await working(page);
  expect(m.roles.length).toBe(gold.roles.length);
  expect(m.steps.find(s => s.id === 's-match')!.roleIds).toEqual([gold.roles.find((r: { name: string }) => r.name === 'AP Team Lead').id]);
});

test('Closing the gaps: "Someone else…" in the list with a name to type; nothing is saved before Save', async ({ page }) => {
  test.setTimeout(120_000);
  const processUrl = await withSample(page);
  await page.goto(`${processUrl}/assessment`);
  await page.getByTestId('questions-line').getByRole('button', { name: 'Answer them' }).click();
  const assistant = page.getByTestId('gaps-assistant');
  const showAll = assistant.getByRole('button', { name: 'Show all' });
  if (await showAll.count()) await showAll.click();
  const list = assistant.getByRole('list', { name: 'Questions' });
  for (const view of ['now', 'wait']) {
    if (await list.getByRole('button', { name: /Three-way match/ }).count()) break;
    await assistant.getByTestId(`gaps-view-${view}`).click();
  }
  await list.getByRole('button', { name: /Who does "Three-way match"/ }).click();
  const card = assistant.getByTestId('gap-question');
  await card.getByRole('combobox', { name: 'Choose the role' }).selectOption({ label: 'Someone else…' });
  await card.getByLabel('Their role').fill('Shared services clerk');
  await expect(card.getByTestId('named-record')).toHaveText('This will record: Shared services clerk does “Three-way match”. Shared services clerk is added to the roles, as a role.');
  expect((await working(page)).roles.length).toBe(gold.roles.length);
  await card.getByRole('button', { name: 'Save answer' }).click();
  await expect.poll(async () => (await working(page)).roles.some(r => r.name === 'Shared services clerk')).toBe(true);
  const m = await working(page);
  const added = m.roles.find(r => r.name === 'Shared services clerk')!;
  expect(added.kind).toBe('person_role');
  expect(m.steps.find(s => s.id === 's-match')!.roleIds).toEqual([added.id]);
});
