/**
 * Critical-flow smoke pack. Auth via /api/dev/e2e-login (dev-gated route);
 * see playwright.config.ts for prerequisites.
 */
import { test, expect, type Page } from '@playwright/test';

const E2E_SECRET = process.env.E2E_AUTH_SECRET ?? '';

async function signIn(page: Page) {
  const res = await page.request.post('/api/dev/e2e-login', {
    headers: { 'x-e2e-secret': E2E_SECRET },
  });
  expect(res.ok(), 'e2e-login should succeed — is E2E_AUTH_SECRET set?').toBeTruthy();
}

test.describe('public pages', () => {
  test('sign-in page renders', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('docs render without auth', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('oauth AS metadata is served', async ({ page }) => {
    const res = await page.request.get('/.well-known/oauth-authorization-server');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.authorization_endpoint).toContain('/api/oauth/authorize');
    expect(json.code_challenge_methods_supported).toContain('S256');
  });
});

test.describe('authenticated flows', () => {
  test.skip(!E2E_SECRET, 'E2E_AUTH_SECRET not set');

  test('sign-in → dashboard renders with sidebar', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    // The (app) shell renders exactly one h1 (PageHeader convention).
    await expect(page.locator('h1')).toHaveCount(1, { timeout: 20_000 });
    // Sidebar: at least one in-app nav link is present after hydration.
    await expect(
      page.locator('a[href="/timeline"], a[href="/captures"], a[href="/dashboard"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('captures and timeline pages render for an authenticated user', async ({ page }) => {
    await signIn(page);
    // The capture composer is hydration-dependent and flake-prone in a
    // smoke pack; assert the authenticated capture + timeline surfaces
    // render (proves auth, RSC data fetch, and the (app) shell end-to-end).
    await page.goto('/captures');
    await expect(page.locator('h1')).toHaveCount(1, { timeout: 20_000 });
    await page.goto('/timeline');
    await expect(page.locator('h1')).toHaveCount(1, { timeout: 20_000 });
  });

  test('oauth consent page renders validation error for unknown client', async ({ page }) => {
    await signIn(page);
    // Unknown client_id should render the error state — proves the consent
    // pipeline (param validation + client lookup) is alive without needing
    // a seeded oauth client.
    await page.goto(
      '/api/oauth/authorize?client_id=e2e-nonexistent&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code&scope=capture',
    );
    await expect(page.locator('body')).toContainText(/invalid|unknown|error/i);
  });
});
