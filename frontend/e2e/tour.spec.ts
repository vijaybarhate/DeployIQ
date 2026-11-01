import { expect, test, type Page, type Route } from '@playwright/test';

const incident = {
  id: 'inc-1',
  source: 'docker',
  project_id: 'demo',
  title: 'ZeroDivisionError: division by zero',
  status: 'open',
  severity: 'high',
  error_signature: 'docker|demo|exception|zerodivisionerror',
  raw_logs: 'Traceback ... ZeroDivisionError',
  evidence: [],
  first_seen: '2026-01-01T00:00:00',
  last_seen: '2026-01-01T00:00:01',
  observation_count: 1,
  matched_line_count: 1,
};

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/healthz')) {
      return route.fulfill({ json: { ok: true, service: 'x', docker: { connected: true } } });
    }
    if (url.endsWith('/incidents')) {
      return route.fulfill({ json: [incident] });
    }
    if (url.includes('/investigations')) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: incident });
  });
}

async function startTour(page: Page) {
  const button = page.getByRole('button', { name: 'Take a tour' });
  await expect(button).toBeVisible();
  await button.click();
  const popover = page.locator('.driver-popover');
  await expect(popover).toBeVisible();
  return { button, popover };
}

test.describe('product tour (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('overview tour advances and Escape restores trigger focus', async ({ page }) => {
    await mockApi(page);
    await page.goto('/overview');
    const { button, popover } = await startTour(page);
    await expect(popover.getByText('Navigate DeployIQ')).toBeVisible();
    await popover.getByRole('button', { name: 'Next' }).click();
    await expect(popover.getByText('Collector status')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(button).toBeFocused();
  });
});

test.describe('product tour (mobile)', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  test('incident center tour runs keyboard-only at 360px', async ({ page }) => {
    await mockApi(page);
    await page.goto('/incidents');
    const tour = page.getByRole('button', { name: 'Take a tour' });
    await tour.focus();
    await page.keyboard.press('Enter');
    const popover = page.locator('.driver-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Search')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(tour).toBeFocused();
  });
});
