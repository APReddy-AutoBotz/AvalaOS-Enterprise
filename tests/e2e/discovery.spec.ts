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
const me = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).me.id as string, KEY);
const workingModel = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).revisions.find((r: { state: string }) => r.state === 'working').model, KEY);
const setRole = (page: Page, role: string) => page.evaluate(({ KEY, role }) => {
  const s = JSON.parse(localStorage.getItem(KEY)!);
  s.workspaces[0].role = role;
  localStorage.setItem(KEY, JSON.stringify(s));
}, { KEY, role });
const withStandIns = (page: Page, replies: unknown) => page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);

test('the first choices are saved only with "Save and read it": picked and closed, the record is as it was', async ({ page }) => {
  await withStandIns(page, { extraction: [first] });
  await signInAndCreateProcess(page);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const describe = page.getByTestId('discovery-describe');
  await describe.getByLabel('Document it as it is').check();
  await describe.getByLabel('Not done today').check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ask-panel')).toHaveCount(0);
  expect(await stored(page)).toEqual({ sources: [], working: null, sessions: 0 });
});

test('a viewer gets no Discovery tab; on a process with no steps, a line says who can start it', async ({ page }) => {
  await withStandIns(page, { answerFromNotes: [] });
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  // A viewer, first on the process while it has no steps.
  await setRole(page, 'viewer');
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await expect(panel.getByTestId('discovery-viewer')).toHaveText('Someone who can edit this process can start Discovery.');
  await expect(panel.getByRole('tab')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Then with steps (put in as an admin): the tabs are the three of before.
  await setRole(page, 'admin');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY }) => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    s.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    s.workspaces[0].role = 'viewer';
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { gold, KEY });
  await page.goto(`${processUrl}/process`);
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  await expect(panel.getByRole('tab')).toHaveText([/^Ask$/, /^Questions/, /^Suggestions$/]);
  await expect(panel.getByTestId('discovery-viewer')).toHaveCount(0);
});

test('Discovery: own words read into steps, one question at a time, a shape answer kept until the update reads it as a source', async ({ page }) => {
  test.setTimeout(150_000);
  await withStandIns(page, { extraction: [first, gold, gold], answerFromNotes: [{ answers: [] }] });
  await signInAndCreateProcess(page);

  // The Sources stage's start in own words offers Ask Avala; the panel opens on Discovery, the only view with no steps.
  const own = page.getByTestId('own-words-discovery');
  await expect(own).toContainText('Or let Ask Avala ask you: it reads what you say and asks about it, one question at a time.');
  await own.getByRole('button', { name: 'Start with Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  const discovery = panel.getByTestId('discovery');
  await expect(discovery.getByTestId('discovery-describe')).toContainText('Nothing joins the process until you press Save.');

  // A choice and typed words, nothing kept yet.
  await discovery.getByLabel('Assess it and document it').check();
  await discovery.getByLabel('In your own words').fill(WORDS);
  expect(await stored(page)).toEqual({ sources: [], working: null, sessions: 0 });
  await discovery.getByRole('button', { name: 'Save and read it' }).click();

  // The words are a source before anything is read from them, and the reading was given them alone.
  await expect(discovery.getByTestId('discovery-first')).toBeVisible({ timeout: 20_000 });
  expect((await stored(page)).sources).toEqual(['own-1']);
  // The choice was saved with it, with who chose.
  expect((await workingModel(page)).meta.purpose).toMatchObject({ value: 'assess', by: await me(page) });
  const reads = (await standInLog(page)).filter(c => c.task === 'extraction');
  expect(reads).toHaveLength(1);
  expect(reads[0]!.sources!.map(s => s.key)).toEqual(['own-1']);
  expect(reads[0]!.sources![0]!.passages.map(p => p.text).join(' ')).toBe(WORDS);

  // What it understood, each step with the words it came from; still no step in the draft.
  await expect(discovery.getByTestId('discovery-first')).toContainText('What I understand so far');
  await expect(discovery.getByTestId('discovery-steps').getByRole('listitem')).toHaveCount(first.steps.length);
  await expect(discovery.getByTestId('discovery-steps')).toContainText('From your words:');
  expect((await workingModel(page)).steps).toEqual([]);
  await discovery.getByRole('button', { name: 'Start the process from this' }).click();

  // One question at a time, with where it came from; Skip moves on and records nothing.
  const card = discovery.getByTestId('discovery-card');
  await expect(card.getByTestId('discovery-question')).toHaveText('Is the work done today?', { timeout: 20_000 });
  await expect(card).toContainText('Nothing is recorded until you press Save.');
  await expect(discovery.getByTestId('discovery-session')).toContainText('Started by analyst on');
  const afterStart = (await stored(page)).working;
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

  // A conflict chosen on a card keeps who chose, as the Process stage does.
  await expect(card.getByTestId('discovery-question')).toContainText('Which is right? Price tolerance');
  await card.getByRole('radio').first().check();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByTestId('discovery-question')).toContainText('Which is right? Monthly volume');
  const resolved = (await workingModel(page)).conflicts.find((c: { id: string }) => c.id === 'k-01').resolution;
  expect(resolved).toMatchObject({ by: 'analyst', byId: await me(page) });
  const afterConflict = (await stored(page)).working;

  // The update: the answers become a "Discovery answers" source, read with the own words; each passage is the
  // person's words alone, with the question as its place.
  // As if an earlier update was cut off before its source was saved: the answer is still waiting, marked for a source
  // that does not exist. The update writes it once.
  await page.evaluate(KEY => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    s.discovery[0].state.waiting[0].into = 'ans-1';
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
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
  expect((await stored(page)).working).toEqual(afterConflict);

  // Words kept to read later show again on their card, are counted, and can be cleared.
  await page.evaluate(KEY => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    const st = s.discovery[0].state;
    const key = 'gap:step_without_role:step:s-match:roleIds';
    st.later = [{ key, question: 'Who does "Three-way match"?', words: 'The AP clerk does the match.', at: '2026-11-24T09:00:00.000Z' }];
    st.skipped = st.skipped.filter((k: string) => k !== key);
    localStorage.setItem(KEY, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  await panel.getByRole('tab', { name: 'Discovery' }).click();
  await expect(card.getByTestId('discovery-question')).toHaveText('Who does "Three-way match"?', { timeout: 20_000 });
  await expect(card.getByLabel('Or answer in your own words')).toHaveValue('The AP clerk does the match.');
  await expect(card.getByTestId('discovery-later')).toContainText('Your words, kept on 24 November to read later.');
  await discovery.getByRole('button', { name: 'Where discovery stands' }).click();
  await expect(discovery.getByTestId('discovery-summary')).toContainText('Kept to read later: 1.');
  await discovery.getByRole('button', { name: 'Back to the questions' }).click();
  await card.getByRole('button', { name: 'Clear my kept words' }).click();
  await expect(card.getByTestId('discovery-later')).toHaveCount(0);
  await expect(card.getByLabel('Or answer in your own words')).toHaveValue('');
  await discovery.getByRole('button', { name: 'Where discovery stands' }).click();
  await expect(discovery.getByTestId('discovery-summary')).not.toContainText('Kept to read later');

  // As if the tab closed after the answers source was saved and before the answers left the session: the answer is
  // waiting, marked for the source that exists. The next update takes it out and reads that source; it is not written again.
  await page.evaluate(({ KEY, END }) => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    s.discovery[0].state.waiting = [{ key: 'shape:end', words: END, question: 'When is a case finished: what is the last thing that happens?', at: '2026-11-24T09:00:00.000Z', into: 'ans-1' }];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, END });
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  await panel.getByRole('tab', { name: 'Discovery' }).click();
  await discovery.getByRole('button', { name: 'Close this review' }).click();
  await discovery.getByTestId('discovery-waiting').getByRole('button', { name: 'Update the draft from your answers (1)' }).click();
  await expect(discovery.getByTestId('discovery-review')).toBeVisible({ timeout: 20_000 });
  expect((await stored(page)).sources).toEqual(['own-1', 'ans-1']);
  const again = (await standInLog(page)).filter(c => c.task === 'extraction');
  expect(again.at(-1)!.sources!.map(x => x.key)).toEqual(['own-1', 'ans-1']);
  expect(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).discovery[0].state.waiting, KEY)).toEqual([]);
});

test('a Discovery that cannot be opened says so, and opens on "Try again"', async ({ page }) => {
  await withStandIns(page, { extraction: [first] });
  await signInAndCreateProcess(page);
  const breakSessions = (broken: boolean) => page.evaluate(({ KEY, broken }) => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    s.discovery = broken ? { broken: true } : [];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { KEY, broken });
  await breakSessions(true);
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const failed = page.getByTestId('discovery-load-failed');
  await expect(failed).toContainText('Discovery could not be opened:');
  await breakSessions(false);
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('discovery-describe')).toBeVisible();
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
