// The tidy-up of section 3d (docs/next-plan.md, package 10), the items a browser shows: "Changed … ago"
// follows the working draft's last edit; "Open my work" stays on one line in the homepage's bar on a phone;
// requirements a decided approach leaves behind are retired on their own, with the reason, and listed under
// "Retired". Links in the demo: tests/e2e/demo.spec.ts. Rules: domain/work/changed.test.ts,
// domain/requirements/retire.test.ts, domain/questions/matter.test.ts, domain/docs/evidence.test.ts,
// domain/assess/chosenBy.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { shot, signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });
const stage = (page: Page, name: string) => rail(page).getByRole('link', { name }).click();
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));

test('"Changed … ago" on a process card follows the last edit, though the process row itself is days old', async ({ page }) => {
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  await page.getByLabel('New role', { exact: true }).fill('AP Clerk');
  await page.getByRole('button', { name: 'Add role' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  // The process row was last changed four days ago (its name, its people); the edit above moved only the draft.
  await page.evaluate(KEY => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.processes[0].updatedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    localStorage.setItem(KEY, JSON.stringify(state));
  }, KEY);
  await page.goto('/processes');
  const changed = page.getByTestId('process-card').getByTestId('changed');
  await expect(changed).toHaveText(/^Changed (just now|\d+ min ago)$/);
});

for (const width of [390, 360]) {
  test(`the homepage's bar keeps "Open my work" on one line at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => localStorage.setItem('avala.journey.auth', '{}'));
    await page.goto('/');
    const go = page.getByTestId('site-go');
    await expect(go).toHaveText('Open my work');
    const box = (await go.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('decided as API integration, Documents opened, the decision removed: what it alone brought is retired with the reason; an edited one stays', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/processes');
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  const asked = page.getByTestId('new-purpose');
  await asked.getByLabel(/already decided/).check();
  await asked.getByLabel('Which approach').selectOption('api');
  await asked.getByLabel('Why this approach').fill('The client integrates through APIs only');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
  await page.evaluate(({ gold, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
    draft.model = { ...gold, meta: { ...gold.meta, purpose: draft.model.meta.purpose, decidedApproach: draft.model.meta.decidedApproach } };
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY });
  await page.reload();

  // Documents opened while decided: the requirements are worked out for API integration and stored.
  await stage(page, 'Documents');
  await expect(page.getByTestId('decided-line')).toContainText('API integration, decided by');
  type Row = { code: string; key: string; state: string; edited: boolean; statement: string; retiredReason?: string };
  const rows = () => page.evaluate(KEY => (Object.values(JSON.parse(localStorage.getItem(KEY)!).requirements ?? {}).flat() as Row[]), KEY);
  await expect.poll(async () => (await rows()).length).toBeGreaterThan(0);
  expect((await rows()).filter(r => r.state !== 'active')).toEqual([]);

  // No application's API turns out to be confirmed, and a person edited one requirement of an API step.
  // (Made on the Process stage: Documents, opened again, would bring the list up to date with the change itself.)
  await stage(page, 'Process');
  await expect(page.getByTestId('decided-approach')).toBeVisible();
  await page.evaluate(KEY => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
    for (const s of draft.model.systems) for (const a of s.access) if (a.method === 'api') a.access = 'unknown';
    const list = Object.values(state.requirements)[0] as Row[];
    const edited = list.find(r => r.key === 'step:s-vendor')!;
    edited.edited = true; edited.statement = 'The solution shall validate the vendor through the vendor service.';
    localStorage.setItem(KEY, JSON.stringify(state));
  }, KEY);
  await page.reload();

  // Removed from the brief, before Documents opens again.
  await page.getByTestId('decided-approach').getByRole('button', { name: 'Remove the decided approach' }).click();
  await expect(page.getByTestId('brief-purpose').getByTestId('purpose-value')).toHaveText('Assess it and document it');
  await expect.poll(async () => (await rows()).filter(r => r.state === 'retired').length).toBeGreaterThan(0);
  const after = await rows();
  for (const r of after.filter(x => x.state === 'retired')) expect(r.retiredReason).toBe('Applied only while API integration was the decided approach');
  expect(after.find(r => r.key === 'step:s-vendor')!.state).toBe('source_removed');

  // Documents keeps them retired and lists them under "Retired" with the reason.
  await stage(page, 'Documents');
  await page.getByRole('tablist', { name: 'Documents' }).getByRole('tab').filter({ hasText: 'FRD' }).click();
  await page.getByTestId('requirements-panel').getByRole('button', { name: /Requirements register/ }).click();
  const retired = page.getByTestId('requirements-retired');
  await expect(retired).toContainText('Applied only while API integration was the decided approach');
  await expect(retired.getByTestId('retired-requirement')).toHaveCount(after.filter(r => r.state === 'retired' && r.code.startsWith('FR')).length);
  await shot(page, '90-requirements-retired');
  expect((await rows()).filter(r => r.state === 'retired').map(r => r.code).sort()).toEqual(after.filter(r => r.state === 'retired').map(r => r.code).sort());
});
