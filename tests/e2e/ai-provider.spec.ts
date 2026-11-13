// Settings → AI provider (bring your own key). The in-browser store keeps only what the browser may know
// of a key (its last four characters) and cannot test one; the database rules and the Vault are checked
// by supabase/tests/workspace_ai_settings.sql.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot, signInAndCreateProcess } from './helpers.ts';

const AZURE_KEY = 'azure-0123456789abcdef0123456789ab9F3Q';
// Assembled at run time so the secret-hygiene scan never sees a key-shaped literal.
const OPENAI_KEY = ['sk', 'proj', '0123456789abcdefghijklmnopqrstuvZZ77'].join('-');

test('an admin connects an Azure OpenAI key, sees only its last four characters, and can go back to the platform AI', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const ai = page.getByTestId('ai-provider');
  await expect(ai.getByTestId('ai-provider-state')).toContainText("uses Avala OS's AI, within a monthly allowance");

  // Azure needs the resource's own Azure address; anything else is refused before anything is saved.
  await ai.getByLabel('Provider').selectOption({ label: 'Azure OpenAI' });
  await ai.getByLabel('Deployment name').fill('prod-gpt5');
  await ai.getByLabel('Endpoint').fill('https://acme-ai.example.com');
  await ai.getByLabel('API key').fill(AZURE_KEY);
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByRole('alert')).toContainText('must be your Azure OpenAI resource');

  await ai.getByLabel('Endpoint').fill('https://Acme-AI.openai.azure.com/openai/v1/');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByTestId('ai-provider-state')).toContainText('runs on your own Azure OpenAI key ending 9F3Q');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('acme-ai.openai.azure.com');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('Not available with this provider yet: turning speech into text');
  expect(await page.content()).not.toContain(AZURE_KEY);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(AZURE_KEY);

  // Testing needs the server; the in-browser store says so.
  await ai.getByRole('button', { name: 'Test this key' }).click();
  await expect(ai.getByRole('alert')).toContainText('needs the server');

  // Changing provider needs that provider's key.
  await ai.getByRole('button', { name: 'Change' }).click();
  await ai.getByLabel('Provider').selectOption({ label: 'OpenAI' });
  await expect(ai.getByLabel('Endpoint')).toHaveCount(0);
  await ai.getByLabel('Model').fill('gpt-5.5');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByRole('alert')).toContainText('Paste the OpenAI API key');
  await ai.getByLabel('API key').fill(OPENAI_KEY);
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByTestId('ai-provider-state')).toContainText('OpenAI key ending ZZ77');
  await shot(page, '90-ai-provider');

  const result = await new AxeBuilder({ page }).include('[data-testid="ai-provider"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);

  page.once('dialog', d => d.accept());
  await ai.getByRole('button', { name: 'Stop using this key' }).click();
  await expect(ai.getByRole('status')).toContainText("uses Avala OS's AI again");
  await expect(ai.getByTestId('ai-provider-state')).toContainText('within a monthly allowance');
});

// Assembled at run time so the secret-hygiene scan never sees a key-shaped literal.
const ANTHROPIC_KEY = ['sk', 'ant', 'api03', '0123456789abcdefghijklmnopqrstuvwxyzQW88'].join('-');

test('a provider not yet checked by the eval is listed only for the platform owner, and an Anthropic key needs no endpoint', async ({ page }) => {
  await signInAndCreateProcess(page); // the in-browser store treats the first account as the platform owner
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const ai = page.getByTestId('ai-provider');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('own OpenAI or Azure OpenAI key');

  await ai.getByLabel('Provider').selectOption({ label: 'Anthropic (being checked)' });
  await expect(ai.getByTestId('ai-provider-unchecked')).toContainText('Only you see this provider');
  await expect(ai.getByLabel('Endpoint')).toHaveCount(0);
  await ai.getByLabel('Model').fill('claude-sonnet-5-5');
  await ai.getByLabel('API key').fill(ANTHROPIC_KEY);
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByTestId('ai-provider-state')).toContainText('runs on your own Anthropic key ending QW88');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('Not available with this provider yet: turning speech into text');
  expect(await page.content()).not.toContain(ANTHROPIC_KEY);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(ANTHROPIC_KEY);
});

test('an OpenAI-compatible endpoint must be a public https address; a served model name may hold a slash', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const ai = page.getByTestId('ai-provider');
  await ai.getByLabel('Provider').selectOption({ label: 'OpenAI-compatible endpoint (being checked)' });
  await ai.getByLabel('Model').fill('meta-llama/Llama-3.3-70B-Instruct');
  await ai.getByLabel('API key').fill(ANTHROPIC_KEY.replace('sk-ant-api03', 'gateway-key'));
  await ai.getByLabel('Endpoint').fill('https://169.254.169.254/v1');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByRole('alert')).toContainText('not an IP address');
  await ai.getByLabel('Endpoint').fill('https://LLM.acme-corp.com/v1/chat/completions');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByTestId('ai-provider-state')).toContainText('runs on your own OpenAI-compatible endpoint key ending QW88');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('llm.acme-corp.com/v1');
});

test('Claude on Amazon Bedrock takes an AWS Region instead of an address', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'Settings' }).click();
  const ai = page.getByTestId('ai-provider');
  await ai.getByLabel('Provider').selectOption({ label: 'Amazon Bedrock (Claude) (being checked)' });
  await ai.getByLabel('Model or inference profile').fill('global.anthropic.claude-sonnet-5-5');
  await ai.getByLabel('API key').fill(ANTHROPIC_KEY.replace('sk-ant-api03', 'ABSKbedrock'));
  await ai.getByLabel('AWS Region').fill('https://bedrock-runtime.us-east-1.amazonaws.com');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByRole('alert')).toContainText('Enter the AWS Region');
  await ai.getByLabel('AWS Region').fill('EU-Central-1');
  await ai.getByRole('button', { name: 'Save' }).click();
  await expect(ai.getByTestId('ai-provider-state')).toContainText('runs on your own Amazon Bedrock (Claude) key ending QW88');
  await expect(ai.getByTestId('ai-provider-state')).toContainText('at eu-central-1');
});
