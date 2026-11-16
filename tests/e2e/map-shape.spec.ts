// The shape of the maps (docs/next-plan.md, package 1) on the sample case: it opens in swimlanes, the
// switch on Flows changes the maps there and in the PDD, an editor's choice is still there after a
// reload, no document section turns "Changed since revision 1" because of it, the editor stays in
// swimlanes, and "Use the suggested shape" goes back. The rule itself is tested in
// domain/flowchart/shape.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { shot, signInAndCreateProcess } from './helpers.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));

test('the map shape: the switch changes the maps on Flows and in the PDD, is kept after a reload, and turns no section "Changed"', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAndCreateProcess(page);
  // The sample's hand-checked model stands in for an extraction, as in the tour.
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(gold => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, gold);
  await page.reload();

  // An approved revision, then a working draft with the same content (a name changed and changed back).
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('revision-status')).toHaveText('Approved revision 1');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  const name = page.getByLabel('Name of step 1', { exact: true });
  const was = await name.inputValue();
  await name.fill(`${was} today`);
  await name.blur();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await name.fill(was);
  await name.blur();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');

  // The sample (five roles) opens in swimlanes, with the reason.
  await stage(page, 'Flows');
  const map = page.getByTestId('flow-map');
  const reason = page.getByTestId('map-shape-reason');
  await expect(map).toHaveAttribute('data-shape', 'swimlanes');
  await expect(reason).toHaveText('Drawn in swimlanes: the work passes between five roles, one column each, and a column for steps with no role recorded.');
  await expect(map.locator('svg [data-role]')).toHaveCount(0);
  await expect(page.getByTestId('map-direction')).toHaveCount(0);
  await shot(page, '60-map-swimlanes');

  // The switch: one column, each step with its role, kept for everyone.
  await page.getByTestId('map-shape').getByRole('button', { name: 'Simple flow' }).click();
  await expect(map).toHaveAttribute('data-shape', 'simple');
  await expect(map.locator('svg [data-role]')).toHaveCount(gold.steps.length);
  await expect(map.locator('svg')).toContainText('AP Clerk');
  await expect(reason).toContainText('A person chose this shape for everyone who opens the process. Avala OS suggests swimlanes.');
  await expect(reason.getByRole('button', { name: 'Use the suggested shape' })).toBeVisible();
  await shot(page, '61-map-simple');
  await page.getByRole('tab', { name: 'To-Be map' }).click();
  await expect(map.locator('svg [data-role]')).toHaveCount(gold.steps.length);
  await expect(map.locator('svg')).toContainText('Rule-based RPA');

  // Across the page, on screen only.
  await page.getByTestId('map-direction').getByRole('button', { name: 'Across the page' }).click();
  await expect(reason).toContainText('Documents always run down the page.');
  const [w, h] = await map.locator('svg').evaluate(el => [Number(el.getAttribute('width')), Number(el.getAttribute('height'))]);
  expect(w).toBeGreaterThan(h);
  await page.screenshot({ path: 'test-results/screens/62-map-across.jpg', type: 'jpeg', quality: 70 });

  // Still there after a reload.
  await page.reload();
  await expect(map).toHaveAttribute('data-shape', 'simple');
  await expect(page.getByTestId('map-direction').getByRole('button', { name: 'Across the page' })).toHaveAttribute('aria-pressed', 'true');

  // The flow editor stays in swimlanes.
  await page.getByRole('tab', { name: 'Edit the As-Is flow' }).click();
  await expect(page.getByTestId('flows-stage')).toContainText('The editor always shows one column per role');
  await expect(page.getByTestId('bpmn-canvas').locator('.djs-element[data-element-id]').first()).toBeVisible();
  const lanes = await page.evaluate(() => (window as any).__bpmnModeler.get('elementRegistry').filter((e: any) => e.type === 'bpmn:Lane').length);
  expect(lanes).toBeGreaterThan(1);

  // The PDD draws both maps in the same shape, down the page, and no section is "Changed".
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /^PDD/ }).click();
  const doc = page.getByTestId('document');
  const figures = doc.getByTestId('flow-figure');
  await expect(figures).toHaveCount(2);
  for (const i of [0, 1]) {
    await expect(figures.nth(i).locator('svg [data-role]')).toHaveCount(gold.steps.length);
    const [fw, fh] = await figures.nth(i).locator('svg').evaluate(el => [Number(el.getAttribute('width')), Number(el.getAttribute('height'))]);
    expect(fh).toBeGreaterThan(fw);
  }
  await expect(doc.getByTestId('chip-changed')).toHaveCount(0);
  await figures.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/screens/63-pdd-simple.jpg', type: 'jpeg', quality: 70 });

  // Back to the suggested shape, for everyone.
  await stage(page, 'Flows');
  await page.getByTestId('map-direction').getByRole('button', { name: 'Down the page' }).click();
  await reason.getByRole('button', { name: 'Use the suggested shape' }).click();
  await expect(map).toHaveAttribute('data-shape', 'swimlanes');
  await page.reload();
  await expect(map).toHaveAttribute('data-shape', 'swimlanes');
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /^PDD/ }).click();
  await expect(page.getByTestId('document').getByTestId('flow-figure').first().locator('svg [data-role]')).toHaveCount(0);
  await expect(page.getByTestId('document').getByTestId('chip-changed')).toHaveCount(0);
});
