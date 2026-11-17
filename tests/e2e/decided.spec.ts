// How it will be built is already decided (docs/next-plan.md, package 9), on the sample case: decided as
// RPA, the process has no Assessment page, the line at the top of Documents names the approach, who
// decided and the two counts, the documents name only RPA and people, a step that stays with people can be
// set by a person there; decided as API integration with no API confirmed, steps are "not known yet" with
// their questions; removing the decision brings the Assessment page back. Rules: domain/assess/decided.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers.ts';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });
const stage = (page: Page, name: string) => rail(page).getByRole('link', { name }).click();
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));

test('decided as RPA: no Assessment page, the line at the top of Documents, only RPA and people in the documents', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/processes');
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Processes', exact: true })).toBeVisible();

  // The third answer asks which approach and why; the reason is required.
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  const asked = page.getByTestId('new-purpose');
  await asked.getByLabel(/already decided/).check();
  await expect(page.getByRole('button', { name: 'Add process' })).toBeDisabled();
  // The list starts empty: Avala OS suggests no approach, and a reason alone is not enough.
  await expect(asked.getByLabel('Which approach')).toHaveValue('');
  await asked.getByLabel('Why this approach').fill('The client runs one RPA platform for every process');
  await expect(page.getByRole('button', { name: 'Add process' })).toBeDisabled();
  await asked.getByLabel('Which approach').selectOption('rpa');
  await shot(page, '75-new-process-decided');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
  await expect(rail(page).getByRole('link')).toHaveText(['Sources', 'Process', 'Documents', 'Flows', 'Work items'].map(s => new RegExp(s)));
  await expect(page.getByTestId('purpose-tag')).toHaveText('Approach decided: Rule-based RPA');

  // The sample's hand-checked model stands in for an extraction; the answer and the approach stay on it.
  await page.evaluate(gold => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
    draft.model = { ...gold, meta: { ...gold.meta, purpose: draft.model.meta.purpose, decidedApproach: draft.model.meta.decidedApproach } };
    localStorage.setItem(KEY, JSON.stringify(state));
  }, gold);
  await page.reload();

  // The line at the top of Documents: the approach, who decided, what it can do, what stays with people.
  await stage(page, 'Documents');
  const line = page.getByTestId('decided-line');
  await expect(line).toContainText('Rule-based RPA, decided by');
  await expect(line).toContainText('"The client runs one RPA platform for every process"');
  await expect(line).toContainText(/It can do \d+ steps?\./);
  await expect(line).toContainText(/stays? with people because it cannot do/);
  // RPA can do fewer than half the steps of the sample: the line is amber.
  await expect(page.getByTestId('decided')).toHaveAttribute('data-short', 'yes');
  // The label beside the name is on every page of the process.
  for (const s of ['Sources', 'Process', 'Flows', 'Documents']) { await stage(page, s); await expect(page.getByTestId('purpose-tag')).toHaveText('Approach decided: Rule-based RPA'); }
  // The facts that settle a step not known yet lead the first list.
  await expect(page.getByTestId('gaps-banner')).toContainText(/\d+ things? only your people can tell us/);
  await page.getByRole('button', { name: 'Which steps, and why' }).click();
  const cannot = page.getByTestId('decided-cannot');
  await expect(cannot).toContainText('Robots are not allowed on the screens of SAP');
  await expect(cannot.getByRole('button', { name: 'Set this step yourself' }).first()).toBeVisible();
  await shot(page, '76-decided-documents');

  // The documents name only RPA and people, and who decided instead of "recommended".
  const doc = page.getByTestId('document');
  await page.getByRole('tablist', { name: 'Documents' }).getByRole('tab').filter({ hasText: 'PDD' }).click();
  await expect(doc).toContainText('was decided for the whole process');
  for (const other of ['API integration', 'AI-assisted', 'Agentic AI', 'recommended']) await expect(doc).not.toContainText(other);

  // A person sets one step themselves; it comes first.
  await cannot.getByRole('button', { name: 'Set this step yourself' }).first().click();
  await cannot.getByLabel('Approach').selectOption('api');
  await cannot.getByLabel('Why').fill('An API exists for this step');
  await cannot.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('decided-person')).toContainText('API integration');
  await expect(line).toContainText('A person set 1 step themselves.');

  // Decided as API integration with no application's API confirmed: steps are not known yet, with their questions.
  await stage(page, 'Process');
  const purpose = page.getByTestId('brief-purpose');
  await expect(page.getByTestId('decided-approach')).toContainText('Rule-based RPA');
  await purpose.getByRole('button', { name: 'Change' }).click();
  await purpose.getByLabel('Which approach').selectOption('api');
  await purpose.getByLabel('Why this approach').fill('The client integrates through APIs only');
  await purpose.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('decided-approach')).toContainText('API integration');
  await page.evaluate(() => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
    for (const s of draft.model.systems) for (const a of s.access) if (a.method === 'api') a.access = 'unknown';
    localStorage.setItem(KEY, JSON.stringify(state));
  });
  await page.reload();
  await stage(page, 'Documents');
  await expect(line).toContainText('API integration, decided by');
  await expect(line).toContainText('it is not known yet');
  await page.getByRole('button', { name: 'Which steps, and why' }).click();
  await expect(page.getByTestId('decided-unknown')).toContainText('have an API that covers');
  await shot(page, '77-decided-not-known');

  // Documents was opened while decided: requirements of steps the approach cannot do are "source removed" in the stored list.
  // The stored list as code and state, in code order.
  const states = () => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('avala.journey.memory.v1')!);
    return (Object.values(state.requirements ?? {}).flat() as { code: string; state: string }[]).map(r => `${r.code}:${r.state}`).sort().join(' ');
  });
  const whileDecided = await states();
  expect(whileDecided).toContain(':source_removed');
  // Removing the decision while the answer is "decided" goes back to "Assess it and document it", and works the
  // requirements out again in the same action: none is left "source removed", before any other page opens.
  await stage(page, 'Process');
  await page.getByTestId('decided-approach').getByRole('button', { name: 'Remove the decided approach' }).click();
  await expect(purpose.getByTestId('purpose-value')).toHaveText('Assess it and document it');
  await expect(page.getByTestId('decided-approach')).toHaveCount(0);
  await expect(page.getByTestId('purpose-tag')).toHaveCount(0);
  await expect.poll(states).not.toBe(whileDecided);
  const afterSwitch = await states();
  await expect(rail(page).getByRole('link', { name: /Assessment/ })).toBeVisible();
  // Nothing has to be brought up to date any more: Work items opened first, then Documents, change nothing in the stored list.
  await stage(page, 'Work items');
  await expect(page.getByRole('heading', { name: 'Proposed work items' })).toBeVisible();
  await stage(page, 'Documents');
  await expect(page.getByTestId('document')).toBeVisible();
  expect(await states()).toBe(afterSwitch);
});
