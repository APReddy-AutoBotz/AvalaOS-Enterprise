// The release gate: one walk through the journey that must pass before anything goes to production.
// It follows the six behaviours that define "done" (AGENTS.md), and scans every screen it visits for
// accessibility problems that stop people using it (serious or critical, WCAG 2 A and AA).
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { INTERNAL, primaryText, signInAndCreateProcess } from './helpers.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();
const corpus = (name: string) => `eval/corpus/ap-invoice/sources/${name}`;

test('release gate: sources to documents to the board, accessible throughout', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  const scan = async (screen: string) => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of result.violations.filter(x => x.impact === 'serious' || x.impact === 'critical')) {
      problems.push(`${screen}: ${v.id} (${v.impact}) ${v.nodes.length} place(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
    }
  };

  // Behaviour 2: real source content is read, listed and kept.
  await signInAndCreateProcess(page);
  await page.getByLabel('Upload source files').setInputFiles([corpus('01-discovery-call-2026-10-06.vtt'), corpus('05-AP-Invoice-AsIs.drawio')]);
  await expect(page.getByTestId('source-row')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId('source-row').filter({ hasText: 'Flowchart (draw.io)' })).toContainText('passages');
  await scan('Sources');

  // The process model: edited by hand, saved.
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  await page.getByLabel('New system', { exact: true }).fill('SAP S/4HANA');
  await page.getByRole('button', { name: 'Add system' }).click();
  await page.getByRole('tab', { name: /^Steps/ }).click();
  for (const [name, type] of [['Check invoice totals', 'Automatic check'], ['Post invoice in SAP', 'Person using a system']]) {
    await page.getByLabel('New step', { exact: true }).fill(name);
    await page.getByLabel('Type of new step').selectOption({ label: type });
    await page.getByRole('button', { name: 'Add step' }).click();
    await expect(page.getByLabel(/^Name of step \d+$/).last()).toHaveValue(name);
  }
  await page.getByLabel('Add to systems for post invoice in sap').selectOption({ label: 'SAP S/4HANA' });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await scan('Process');

  // Behaviour 3: a recommendation per step and for the process, with reasons; AI is unnecessary where rules suffice.
  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toHaveText('RPA-led automation');
  const post = page.getByTestId('assessment-row').filter({ hasText: 'Post invoice in SAP' });
  await expect(post.getByTestId('recommendation')).toHaveText('Rule-based RPA');
  await page.getByRole('button', { name: 'Assessment of Check invoice totals' }).click();
  const panel = page.getByRole('dialog', { name: 'Check invoice totals' });
  await panel.getByLabel('Rules stated in full and stable for Check invoice totals').selectOption({ label: 'Yes' });
  await panel.getByLabel('Form of the input for Check invoice totals').selectOption({ label: 'Structured data' });
  await expect(panel.getByTestId('ai-badge')).toHaveText('AI unnecessary');
  await expect(panel.getByTestId('step-reason')).not.toBeEmpty();
  await scan('Assessment step panel');
  await page.keyboard.press('Escape');
  await scan('Assessment');

  // Behaviour 4: distinct documents from the one model; missing facts stay open items, never filled in.
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  const titles: string[] = [];
  for (const [tab, title] of [[/PDD/, 'Process Definition Document'], [/BRD/, 'Business Requirements Document'], [/FRD/, 'Functional Requirements Document']] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(doc).toContainText(title);
    await expect(doc).not.toContainText(/TBD|placeholder|lorem/i);
    titles.push((await doc.innerText()).slice(0, 4000));
    if (tab === /PDD/) { await expect(doc.getByTestId('open-item').first()).toBeVisible(); await scan('Documents'); }
  }
  expect(new Set(titles).size).toBe(3);
  await page.getByRole('tab', { name: /PDD/ }).click();
  await stage(page, 'Flows');
  await scan('Flows');

  // Approve, then change the process: what changed since approval is marked, the approved revision is kept.
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('revision-status')).toHaveText('Approved revision 1');
  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await page.getByLabel('Name of step 2').fill('Post invoice in SAP S/4HANA');
  await page.getByLabel('Name of step 2').blur();
  await expect(page.getByTestId('revision-status')).toContainText('unapproved changes');
  await stage(page, 'Documents');
  await expect(page.getByTestId('since-approved')).toBeVisible();

  // Behaviours 5 and 6: proposals with criteria and requirement links, reviewed, confirmed once, on the board.
  await stage(page, 'Work items');
  const items = page.getByTestId('work-items');
  await expect(items).toContainText('Nothing is assigned, estimated or dated for you.');
  const proposals = items.getByTestId('proposal');
  const count = await proposals.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < count; i++) await expect(proposals.nth(i)).toContainText(/[2-9]\d* acceptance criteria|1\d acceptance criteria/);
  await expect(items).not.toContainText('Detailed As-Is steps'); // a document heading is never a work item
  await scan('Work items');
  await items.getByRole('button', { name: 'Select all' }).click();
  const confirm = page.getByTestId('confirm-panel');
  await confirm.getByLabel('New project name').fill('Release gate');
  await confirm.getByRole('button', { name: `Confirm ${count} to the board` }).click();
  await expect(confirm.getByRole('status')).toContainText(`${count} items added to the board`);
  await confirm.getByRole('button', { name: 'Confirm 0 to the board' }).isDisabled();

  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.getByRole('link', { name: 'Delivery board' }).click();
  const epics = await page.getByTestId('epic-lane').count();
  await expect(page.getByTestId('column-todo').getByTestId('board-card')).toHaveCount(count - epics);
  await scan('Delivery board');
  await page.reload();
  await expect(page.getByTestId('column-todo').getByTestId('board-card')).toHaveCount(count - epics);
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // The people and home screens.
  await page.getByRole('link', { name: 'My work' }).click();
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
  await scan('My work');
  await page.getByRole('link', { name: 'Processes' }).first().click();
  await scan('Processes');
  await page.getByRole('tab', { name: 'People' }).click();
  await scan('People');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await scan('Settings');

  expect(problems, `Accessibility problems:\n${problems.join('\n')}`).toEqual([]);
});
