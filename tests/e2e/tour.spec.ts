// The product tour on the homepage uses real screens. This walk runs the sample case in the repository
// (eval/corpus/ap-invoice: a made-up company, its call transcripts, procedure and flowchart, and the
// hand-checked process model for them) through the product and captures each stage. The captured
// screens are committed to public/marketing/tour/ when the tour is refreshed.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const corpus = (name: string) => `eval/corpus/ap-invoice/sources/${name}`;
const snap = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/tour-${name}.jpg`, type: 'jpeg', quality: 80 });
const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();
const settle = (page: Page) => page.waitForTimeout(700);

test('tour: the sample case through every stage', async ({ page }) => {
  test.setTimeout(240_000);
  // The local-mode note belongs to the test build, not to the product a visitor will use.
  await page.addInitScript(() => {
    const css = document.createElement('style');
    css.textContent = '[data-testid="local-mode"]{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
  });

  await page.goto('/processes');
  await page.getByLabel('Email').fill('rahul.deshpande@kaveri-ic.example');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);

  const files = ['01-discovery-call-2026-10-06.vtt', '02-exceptions-deep-dive-2026-10-09.srt', '03-sap-integration-call-2026-10-14.txt', '04-SOP-FIN-AP-004-vendor-invoice-processing.docx', '05-AP-Invoice-AsIs.drawio'];
  await page.getByLabel('Upload source files').setInputFiles(files.map(corpus));
  await expect(page.getByTestId('source-row')).toHaveCount(files.length, { timeout: 40_000 });
  await settle(page);
  await snap(page, 'sources');

  // The model the sources lead to. Extraction needs the server, so the hand-checked model for this
  // case stands in for it; everything after this is the product working on that model.
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
  const keys = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/sources.json', 'utf8')) as Record<string, string>;
  await page.evaluate(({ gold, keys }) => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    for (const s of state.sources) for (const [key, file] of Object.entries(keys)) if (s.fileName === file) s.key = key;
    // The team of the sample company, and who is named on this process.
    const ws = state.workspaces[0].id, since = new Date().toISOString();
    const member = (name: string, role: string, job: string | null, canApprove: boolean) => ({ userId: crypto.randomUUID(), name, email: `${name.toLowerCase().replace(' ', '.')}@kaveri-ic.example`, role, job, canApprove, since });
    const meera = member('Meera Iyer', 'viewer', 'approver', true), vikram = member('Vikram Shah', 'editor', 'solution_architect', false);
    state.people = { [ws]: { members: [{ ...member('Rahul Deshpande', 'admin', null, true), userId: state.me.id }, meera, vikram], invites: [], audit: [] } };
    Object.assign(state.processes[0], { analystId: state.me.id, architectId: vikram.userId, approverId: meera.userId });
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, keys });
  await page.reload();

  // Facts for the sample that only its people could give, entered in the product's own Inputs view:
  // SAP is worked through its screens here (no API for this work, robots allowed), the rules are
  // written down, and only reading the incoming invoices is not rule-based work.
  await stage(page, 'Assessment');
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  const choose = async (label: string, option: string) => {
    await page.getByLabel(label, { exact: true }).selectOption({ label: option });
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  };
  const type = async (label: string, value: string) => {
    const box = page.getByLabel(label, { exact: true });
    await box.fill(value);
    await box.blur();
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  };
  await choose('Volume period', 'per month');
  await type('Volume', '9500');
  await type('Handling time', '11');
  await type('People', '8');
  await choose('Process change expected', 'No change expected');
  await choose('Application change expected', 'No change expected');
  await choose('API of SAP S/4HANA', 'No API');
  await choose('Robots allowed on the screens of SAP S/4HANA', 'Yes');
  await choose('Screens of SAP S/4HANA stable', 'Yes');
  await choose('SAP S/4HANA through a remote desktop', 'No');
  const whole = (title: string) => `${title} for the process as a whole`;
  await choose(whole('Rules stated in full and stable'), 'Yes');
  await choose(whole('Form of the input'), 'Structured');
  await choose(whole('Needs a judgment or accountable decision'), 'No');
  await choose(whole('Needs a physical action'), 'No');
  await choose(whole('Drafts, summarises or classifies free text'), 'No');
  await choose(whole('What it changes'), 'A record');
  await choose('Form of the input for Log invoice', 'Documents');
  await choose('Form of the input for Scan paper invoice', 'Paper');
  await choose('Needs a physical action for Scan paper invoice', 'Yes');
  for (const step of ['Approve non-PO invoice', 'Review high-value invoice', 'Investigate variance']) await choose(`Needs a judgment or accountable decision for ${step}`, 'Yes');
  await settle(page);
  await snap(page, 'inputs');

  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await settle(page);
  await snap(page, 'process');

  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toBeVisible();
  console.log(`TOUR_VERDICT ${await page.getByTestId('verdict').innerText()} | ${(await page.locator('section[aria-label="Recommended approach"]').innerText()).replace(/\s+/g, ' ')}`);
  await settle(page);
  await snap(page, 'assessment');
  await page.locator('[data-testid="step-split"]').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await snap(page, 'assessment-why');
  for (const [label, name] of [['Priority', 'assessment-priority'], ['Benefit', 'assessment-benefit'], ['Steps', 'assessment-steps']] as const) {
    await page.locator(`section[aria-label="${label}"]`).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.mouse.wheel(0, -24);
    await settle(page);
    await snap(page, name);
  }

  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Process Definition Document');
  await settle(page);
  await snap(page, 'document');
  await page.mouse.wheel(0, 1500);
  await settle(page);
  await snap(page, 'document-2');
  await page.getByRole('tab', { name: /BRD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Business Requirements Document');
  await page.mouse.wheel(0, -5000);
  await settle(page);
  await snap(page, 'document-brd');

  await stage(page, 'Flows');
  await page.getByRole('tab', { name: 'To-Be map' }).click();
  await settle(page);
  await snap(page, 'flows');
  await page.mouse.wheel(0, 520);
  await settle(page);
  await snap(page, 'flows-2');

  await page.mouse.wheel(0, -5000);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('revision-status')).toHaveText('Approved revision 1');

  await stage(page, 'Work items');
  const items = page.getByTestId('work-items');
  await expect(items.getByTestId('proposal').first()).toBeVisible();
  await settle(page);
  await snap(page, 'work-items');
  await items.getByRole('button', { name: 'Select all' }).click();
  const confirm = page.getByTestId('confirm-panel');
  await confirm.getByLabel('New project name').fill('Invoice automation');
  await confirm.getByRole('button', { name: /^Confirm \d+ to the board$/ }).click();
  await expect(confirm.getByRole('status')).toContainText('items added to the board');

  // A board part-way through delivery: statuses, owners and estimates as a team would have set them.
  await page.evaluate(() => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const flow = ['done', 'done', 'ready_for_release', 'testing', 'in_review', 'in_progress', 'in_progress', 'todo', 'todo', 'todo'];
    let n = 0;
    for (const item of state.workItems) {
      if (item.type === 'epic') continue;
      item.status = flow[n % flow.length];
      if (n % 3 !== 2) item.ownerId = state.me.id;
      if (n % 2 === 0) item.estimateHours = [6, 12, 16, 24][n % 4];
      if (n % 5 === 0) item.priority = 'high';
      n += 1;
    }
    localStorage.setItem(KEY, JSON.stringify(state));
  });
  await page.reload();
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.getByRole('link', { name: 'Delivery board' }).click();
  await expect(page.getByTestId('board-card').first()).toBeVisible();
  await settle(page);
  await snap(page, 'board');
  await page.getByTestId('board-card').filter({ hasText: 'Story' }).first().click();
  await settle(page);
  await snap(page, 'board-item');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'People' }).click();
  const people = page.getByTestId('people');
  for (const [email, role] of [['karthik.raman@kaveri-ic.example', 'Developer'], ['sunita.rao@kaveri-ic.example', 'Viewer']] as const) {
    await people.getByLabel('Work email').fill(email);
    await people.getByLabel('Role for the new person').selectOption({ label: role });
    await people.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByTestId('invites')).toContainText(email);
  }
  await people.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByTestId('audit')).toBeVisible();
  await settle(page);
  await snap(page, 'people');
  await page.getByTestId('audit').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await snap(page, 'audit');

  await page.getByRole('tab', { name: 'Portfolio' }).click();
  await settle(page);
  await snap(page, 'portfolio');
  await page.getByRole('link', { name: 'My work' }).click();
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
  await settle(page);
  await snap(page, 'my-work');
});
