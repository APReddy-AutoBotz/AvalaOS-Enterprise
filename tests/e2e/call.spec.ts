// A call with the people who know (package C, C3b; plans `claude/package-c-plan-26-nov.md`, revision 2, section 8.3,
// and `claude/package-c-c3-plan-28-nov.md`, section 6). "Prepare a call" opens the briefing in a window of its own;
// the panel suggests what to ask next from the list and from the notes; End reads the notes once more; Save writes one
// "Call notes" source and one edit. The readings are recorded replies (journey/store/standIns.ts), and the call is
// kept on this device only: nothing is written to the store before Save.
import fs from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const NOTE = 'The AP Clerk does the three-way match every morning.';
const FOUND = { questionId: 'q:5', value: 'AP Clerk', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'The AP Clerk does the three-way match' };
// The first reading finds who does the match (question 5 of the first reading: the list in its order); later ones find nothing.
const replies = { answerFromNotes: [{ answers: [FOUND] }, { answers: [] }], discoveryQuestions: [{ questions: [], wanted: [] }] };
const FIRST = 'Which is right? Price tolerance: policy is 2% or INR 5,000 (whichever is lower); SAP is configured at 5% with no amount limit.';
const SECOND = 'Which is right? Monthly volume: about 9,000 to 10,000 in recent months versus about 8,500 as the FY 2025-26 average in the SOP.';
const THIRD = 'Is the work done today?';
const MATCH = 'Who does "Three-way match"?';

type Logged = { task: string; answered: boolean };
const standInLog = (page: Page) => page.evaluate(() => (window as unknown as { __avalaStandInLog?: Logged[] }).__avalaStandInLog ?? []);
const memory = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!), KEY);
/** What the store holds that a call could write: the sources, the revisions and the edits. */
const written = async (page: Page) => { const m = await memory(page); return JSON.stringify({ sources: m.sources, revisions: m.revisions, edits: m.edits }); };
const kept = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('avala:call:')));

async function withStandIns(context: BrowserContext, r: unknown) {
  // On the context, so the call's own window gets them too.
  await context.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, r);
}

/** A process holding the sample record, as an editor; Closing the gaps open on Assessment. */
async function processWithRecord(page: Page, role: 'admin' | 'viewer' = 'admin') {
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY, role }) => {
    const s = JSON.parse(localStorage.getItem(KEY)!);
    s.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    s.workspaces[0].role = role;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, { gold, KEY, role });
  return processUrl;
}

/** "Prepare a call" in Closing the gaps: the call's own window. */
async function prepareCall(page: Page, processUrl: string) {
  await page.goto(`${processUrl}/assessment`);
  await page.getByTestId('questions-line').getByRole('button', { name: 'Answer them' }).click();
  const prepare = page.getByTestId('gaps-assistant').getByTestId('prepare-call');
  const [call] = await Promise.all([page.waitForEvent('popup'), prepare.getByRole('button', { name: 'Prepare a call' }).click()]);
  await expect(call).toHaveURL(/\/process\/[0-9a-f-]{36}\/call$/);
  await expect(call.getByTestId('call-briefing')).toBeVisible();
  return call;
}

async function startPanel(call: Page) {
  await call.getByRole('checkbox', { name: 'Process owner or SME', exact: true }).check();
  await call.getByTestId('start-panel').click();
  const panel = call.getByTestId('call-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function addNote(call: Page, text: string) {
  const box = call.getByRole('textbox', { name: 'Your notes' });
  await box.fill(text);
  await box.press('Enter');
  await expect(call.getByTestId('notes')).toContainText(text);
}

test('the briefing: for each kind of person and length, in order, with the agenda holding the questions only', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);

  await expect(call.getByRole('heading', { level: 1 })).toHaveText(/^Prepare a call about /);
  await expect(call.getByTestId('briefing-standing')).toContainText('steps,');
  await expect(call.getByTestId('briefing-open')).toContainText('where the sources disagree');
  // Nothing to start until someone is on the call.
  await expect(call.getByTestId('start-panel')).toBeDisabled();

  await call.getByRole('checkbox', { name: 'Process owner or SME', exact: true }).check();
  await expect(call.getByRole('button', { name: '30 minutes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(call.getByRole('heading', { name: 'For this call (8)' })).toBeVisible();
  await expect(call.getByRole('heading', { name: 'If there is time (6)' })).toBeVisible();
  await expect(call.getByTestId('briefing-item').first()).toContainText(FIRST);
  await call.getByRole('button', { name: '45 minutes' }).click();
  await expect(call.getByRole('heading', { name: 'For this call (13)' })).toBeVisible();
  // The sample's figure question Discovery gives no card ("How long does a non-PO invoice take to handle?") is on the list too.
  await expect(call.getByRole('heading', { name: 'If there is time (1)' })).toBeVisible();
  await expect(call.getByTestId('briefing-item').last()).toContainText('How long does a non-PO invoice take to handle?');
  await call.getByRole('button', { name: '30 minutes' }).click();

  // Copy the agenda: the questions, numbered, and nothing of why or where from.
  await call.getByRole('button', { name: 'Copy the agenda' }).click();
  await expect(call.getByRole('status').filter({ hasText: 'Copied: 14 questions' })).toBeVisible();
  const agenda = await call.evaluate(() => navigator.clipboard.readText());
  expect(agenda.split('\n')[0]).toBe(`1. ${FIRST}`);
  expect(agenda).toContain(`5. ${MATCH}`);
  expect(agenda).toContain('If there is time:');
  expect(agenda).not.toMatch(/Why it matters|From the record|Who can answer/);

  // The other kinds of person.
  await call.getByRole('checkbox', { name: 'Process owner or SME', exact: true }).uncheck();
  await call.getByRole('checkbox', { name: 'IT or application owner', exact: true }).check();
  await expect(call.getByRole('heading', { name: 'For this call (4)' })).toBeVisible();
  await call.getByRole('checkbox', { name: 'IT or application owner', exact: true }).uncheck();
  await call.getByRole('checkbox', { name: 'Finance or controls', exact: true }).check();
  await expect(call.getByRole('heading', { name: 'For this call (1)' })).toBeVisible();
  // Nothing was sent to the AI, and nothing kept.
  expect(await standInLog(call)).toEqual([]);
  expect(await kept(call)).toEqual([]);
});

test('a whole call: notes, a reading, Ask next, the end reading and the review; Save writes one source and one edit', async ({ page, context }) => {
  test.setTimeout(150_000);
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  const before = await written(call);
  const sourcesBefore = (await memory(call)).sources.length;
  const panel = await startPanel(call);

  await expect(panel.getByTestId('private-line')).toBeVisible();
  await panel.getByTestId('private-line').getByRole('button', { name: 'Got it' }).click();
  await expect(panel.getByTestId('private-line')).toHaveCount(0);
  await expect(panel.getByTestId('ask-next-question')).toHaveText(FIRST);

  // A note is read within the minute: who does the match is found in it.
  await addNote(call, NOTE);
  await expect.poll(async () => (await standInLog(call)).filter(c => c.task === 'answerFromNotes').length, { timeout: 20_000 }).toBeGreaterThan(0);
  const found = panel.getByTestId('found');
  await expect(found).toContainText(`May answer: ${MATCH}`);
  await expect(found).toContainText('Stated in your notes');
  await expect(panel.getByTestId('read-status')).toContainText('Read at');

  // Asked, Skip, Someone else knows.
  await panel.getByTestId('asked').click();
  await expect(panel.getByTestId('asked-list')).toContainText(FIRST);
  await expect(panel.getByTestId('ask-next-question')).toHaveText(SECOND);
  await panel.getByRole('button', { name: 'Skip' }).click();
  await expect(panel.getByTestId('ask-next-question')).toHaveText(THIRD);
  await panel.getByRole('button', { name: 'Someone else knows' }).click();
  await panel.getByLabel('Who knows?').fill('Meera');
  await panel.getByRole('button', { name: 'Leave it with them' }).click();
  await expect(panel.getByTestId('ask-next-question')).not.toHaveText(THIRD);

  // Nothing is written to the store during the call; the call is kept on this device.
  expect(await written(call)).toBe(before);
  expect(await kept(call)).toHaveLength(1);

  // A reload keeps the call: Continue opens it where it was. The window's own question, if the browser asks it, is accepted.
  call.once('dialog', d => void d.accept());
  await call.reload();
  await expect(call.getByTestId('call-unfinished')).toContainText('was not finished');
  await call.getByRole('button', { name: 'Continue' }).click();
  await expect(call.getByTestId('notes')).toContainText(NOTE);
  await expect(call.getByTestId('asked-list')).toContainText(FIRST);

  // End: the notes are read once more, then the review.
  const reads = (await standInLog(call)).filter(c => c.task === 'answerFromNotes').length;
  await call.getByTestId('end-call').click();
  await call.getByTestId('end-and-review').click();
  const review = call.getByTestId('call-review');
  await expect(review).toBeVisible({ timeout: 20_000 });
  expect((await standInLog(call)).filter(c => c.task === 'answerFromNotes').length).toBeGreaterThan(reads);
  await expect(review.getByTestId('review-answers')).toContainText(MATCH);
  await expect(review.getByTestId('review-answers').getByRole('checkbox').first()).toBeChecked();
  await expect(review.getByTestId('review-left')).toContainText('Meera');
  await expect(review.getByTestId('notes-kept')).toContainText('Call notes');
  expect(await written(call)).toBe(before);

  await review.getByTestId('save-call').click();
  await expect(call.getByTestId('call-saved')).toContainText('Saved: 1 answer recorded, 1 left with someone.');

  // One source, the call's notes; one edit, with History's line; the role recorded on the match; the call forgotten.
  const after = await memory(call);
  expect(after.sources.length).toBe(sourcesBefore + 1);
  const source = after.sources.at(-1);
  expect(source.title).toMatch(/^Call notes/);
  expect(source.segments.map((s: { text: string }) => s.text)).toEqual([NOTE]);
  const editsBefore = JSON.parse(before).edits.length;
  expect(after.edits.length).toBe(editsBefore + 1);
  expect(after.edits.at(-1).summary.length).toBeGreaterThan(0);
  const model = after.revisions.find((r: { state: string }) => r.state === 'working').model;
  const clerk = model.roles.find((r: { name: string }) => r.name === 'AP Clerk').id;
  expect(model.steps.find((s: { id: string }) => s.id === 's-match').roleIds).toContain(clerk);
  expect(await kept(call)).toEqual([]);
});

test('the review: a time with its unit, the change expected picked with its own field, and Save says what it recorded', async ({ page, context }) => {
  test.setTimeout(150_000);
  // Preview walk, 28 November 2026: "Do you expect the process to change …?" came with nothing to pick, and "40" with no unit.
  const said = 'We expect a minor change to approvals next quarter, and each case takes about 40 minutes.';
  await withStandIns(context, {
    answerFromNotes: [{ answers: [
      { questionId: 'q:8', value: '40', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'each case takes about 40 minutes' },
      { questionId: 'q:9', value: 'A minor change to approvals', interface: '', certainty: 'stated', segmentId: 'n:1', excerpt: 'We expect a minor change to approvals next quarter' },
    ] }, { answers: [] }],
    discoveryQuestions: [{ questions: [], wanted: [] }],
  });
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  const panel = await startPanel(call);
  await addNote(call, said);
  await expect(panel.getByTestId('found')).toContainText('This would record: 40 minutes', { timeout: 20_000 });

  await call.getByTestId('end-call').click();
  await call.getByTestId('end-and-review').click();
  const review = call.getByTestId('call-review');
  await expect(review).toBeVisible({ timeout: 20_000 });
  const answers = review.getByTestId('review-answers');
  await expect(answers).toContainText('This will record: 40 minutes');
  await expect(answers).toContainText("Recorded in the assessment's inputs, which keep no quote");
  const choose = review.getByTestId('review-choose');
  await expect(choose).toContainText('Do you expect the process to change in the next six months?');
  await choose.getByTestId('review-field').getByLabel('Minor changes').check();
  await expect(review.getByTestId('notes-kept')).toContainText('recorded without a quote');

  await review.getByTestId('save-call').click();
  await expect(call.getByTestId('call-saved')).toContainText('Saved: 2 answers recorded.');
  const model = (await memory(call)).revisions.find((r: { state: string }) => r.state === 'working').model;
  expect(model.meta.profile.processChange.value).toBe('minor');
  const time = model.meta.metrics.find((x: { kind: string; appliesTo: string }) => x.kind === 'handling_time' && x.appliesTo === 'process');
  expect([time.value, time.unit]).toEqual([40, 'minutes']);
});

test('What you want to change: noticed in the notes, listed in the review not ticked, kept on Save in The brief only', async ({ page, context }) => {
  test.setTimeout(150_000);
  const wish = 'In future the system should match the invoices on its own';
  await withStandIns(context, {
    answerFromNotes: [{ answers: [] }],
    discoveryQuestions: [{ questions: [], wanted: [{ segmentId: 'n:1', excerpt: wish }] }, { questions: [], wanted: [] }],
  });
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  await startPanel(call);
  await addNote(call, `${wish}, without the clerk.`);
  await expect.poll(async () => (await standInLog(call)).filter(c => c.task === 'discoveryQuestions').length, { timeout: 20_000 }).toBeGreaterThan(0);
  const before = (await memory(call)).revisions.find((r: { state: string }) => r.state === 'working').model;

  await call.getByTestId('end-call').click();
  await call.getByTestId('end-and-review').click();
  const review = call.getByTestId('call-review');
  await expect(review).toBeVisible({ timeout: 20_000 });
  const wanted = review.getByTestId('review-wanted');
  await expect(wanted).toContainText('What you want to change (1)');
  await expect(wanted).toContainText(wish);
  const box = wanted.getByRole('checkbox');
  await expect(box).not.toBeChecked();
  await box.check();
  await review.getByTestId('save-call').click();
  await expect(call.getByTestId('call-saved')).toContainText('Saved: 1 change you want kept.');

  const after = (await memory(call)).revisions.find((r: { state: string }) => r.state === 'working').model;
  expect(after.meta.wanted.at(-1).statement).toBe(wish);
  // Never the work done today: the steps, rules and flows are as they were.
  expect([after.steps, after.rules, after.flows]).toEqual([before.steps, before.rules, before.flows]);
});

test('"Prepare a call" in Discovery\'s "Where discovery stands" opens the same call window', async ({ page, context }) => {
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  await page.goto(`${processUrl}/process`);
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  const panel = page.getByTestId('ask-panel');
  await panel.getByRole('tab', { name: 'Discovery' }).click();
  const discovery = panel.getByTestId('discovery');
  await discovery.getByRole('button', { name: 'Where discovery stands' }).click();
  const summary = discovery.getByTestId('discovery-summary');
  await expect(summary.getByTestId('discovery-prepare-call')).toContainText('Ask the people who know in a call');
  const [call] = await Promise.all([page.waitForEvent('popup'), summary.getByRole('button', { name: 'Prepare a call' }).click()]);
  await expect(call).toHaveURL(/\/process\/[0-9a-f-]{36}\/call$/);
  await expect(call.getByTestId('call-briefing')).toBeVisible();
});

test('Discard writes nothing and forgets the call', async ({ page, context }) => {
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  const before = await written(call);
  await startPanel(call);
  await addNote(call, NOTE);
  await call.getByTestId('end-call').click();
  await call.getByTestId('end-and-review').click();
  await expect(call.getByTestId('call-review')).toBeVisible({ timeout: 20_000 });
  call.once('dialog', d => d.accept());
  await call.getByRole('button', { name: 'Discard the call' }).click();
  await expect(call.getByTestId('call-briefing')).toBeVisible();
  expect(await written(call)).toBe(before);
  expect(await kept(call)).toEqual([]);
});

test('a viewer gets the briefing and no "Start the call panel"', async ({ page, context }) => {
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  // The call page opened by someone who is a viewer in this workspace (Closing the gaps offers no Answer them to a viewer).
  await call.evaluate(KEY => { const s = JSON.parse(localStorage.getItem(KEY)!); s.workspaces[0].role = 'viewer'; localStorage.setItem(KEY, JSON.stringify(s)); }, KEY);
  await call.reload();
  await expect(call.getByTestId('call-briefing')).toBeVisible();
  await call.getByRole('checkbox', { name: 'Process owner or SME', exact: true }).check();
  await expect(call.getByRole('heading', { name: 'For this call (8)' })).toBeVisible();
  await expect(call.getByTestId('start-panel')).toHaveCount(0);
  await expect(call.getByTestId('viewer-line')).toHaveText('Someone who can edit this process can run the call panel.');
});

test('the fallback lines: a failed reading, the minute limit and the month\'s allowance, with the list still followed', async ({ page, context }) => {
  test.setTimeout(150_000);
  const minute = 'Too many AI requests in the last minute. Try again in a moment.';
  await withStandIns(context, {
    // The first reading fails (noticing has no reply), the second meets the minute limit, the third the allowance.
    answerFromNotes: [{ answers: [] }, { standInError: { status: 429, code: 'RATE_LIMITED', message: minute } }, { standInError: { status: 402, code: 'BUDGET_EXCEEDED', message: 'The allowance is used.' } }],
    discoveryQuestions: [],
  });
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  const panel = await startPanel(call);

  await addNote(call, 'Invoices arrive by email.');
  await expect(panel.getByTestId('read-status')).toContainText('Your last notes could not be read. They are kept, and Avala OS tries again with your next note.', { timeout: 20_000 });
  await expect(panel.getByTestId('ask-next-question')).toHaveText(FIRST);

  await addNote(call, 'The clerk checks the mandatory fields.');
  await panel.getByRole('button', { name: 'Read now' }).click();
  await expect(panel.getByTestId('read-status')).toContainText(minute, { timeout: 20_000 });

  await addNote(call, 'Exceptions go to the team lead.');
  await panel.getByRole('button', { name: 'Read now' }).click();
  await expect(panel.getByTestId('panel-line')).toContainText('This workspace has used its AI allowance for the month', { timeout: 20_000 });
  await expect(panel.getByRole('button', { name: 'Read now' })).toHaveCount(0);
  await expect(panel.getByTestId('ask-next-question')).toHaveText(FIRST);
});

test('signing out with a call not finished asks first; the window warns before it closes with notes not saved', async ({ page, context }) => {
  await withStandIns(context, replies);
  const processUrl = await processWithRecord(page);
  const call = await prepareCall(page, processUrl);
  await startPanel(call);
  await addNote(call, NOTE);

  // The window's own question before it closes.
  const asked = new Promise<string>(resolve => call.once('dialog', d => { resolve(d.type()); void d.dismiss(); }));
  await call.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');

  // Signing out in the main window: asked first; Cancel keeps the call, Sign out anyway removes it.
  await page.reload();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  const ask = page.getByTestId('sign-out-call');
  await expect(ask).toContainText('You have a call that is not finished.');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  expect(await kept(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByTestId('sign-out-call').getByRole('button', { name: 'Sign out anyway' }).click();
  await expect(page).toHaveURL(/\/signin/);
  expect(await kept(page)).toEqual([]);
});

test('in the demo, the call opens under /demo with the briefing, and says the notes cannot be read', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).first().click();
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/sources$/);
  await page.goto(page.url().replace(/\/sources$/, '/call'));
  await expect(page.getByTestId('call-briefing')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Process owner or SME', exact: true }).check();
  await expect(page.getByTestId('no-ai-line')).toBeVisible();
});
