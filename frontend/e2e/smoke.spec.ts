import { expect, test } from '@playwright/test';

/**
 * Critical workflow smoke test. The backend is typically absent in CI, so this
 * test asserts the app's honest empty/error states — never fabricated data.
 * A live-backend E2E (trigger boom → incident → investigation) runs manually
 * against the demo stack (see M3.3-E acceptance notes).
 */
test('app loads and incident center handles an unreachable backend', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/DeployIQ/);
  await page.getByRole('link', { name: /Incidents/ }).click();
  await expect(page).toHaveURL(/\/incidents/);
  // Backend down: either the error state with retry, or (backend up) incidents.
  const errorState = page.getByRole('alert');
  const listOrEmpty = page.locator('ul, div:has-text("No incidents")');
  await expect(errorState.or(listOrEmpty.first())).toBeVisible({ timeout: 15000 });
});

test('unknown route redirects to overview', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page).toHaveURL(/\/overview/);
});
