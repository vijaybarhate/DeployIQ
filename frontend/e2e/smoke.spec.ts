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
  await page.getByRole('link', { name: 'Incidents', exact: true }).click();
  await expect(page).toHaveURL(/\/incidents/);
  // Backend down: error state with retry. Backend up: incidents table or
  // the honest empty state. Scoped to <main> so nav/overview content
  // cannot satisfy the assertion before navigation completes.
  const main = page.getByRole('main');
  await expect(
    main.getByRole('alert').or(main.getByRole('table')).or(main.getByText(/No incidents/)),
  ).toBeVisible({ timeout: 15000 });
});

test('unknown route redirects to overview', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page).toHaveURL(/\/overview/);
});
