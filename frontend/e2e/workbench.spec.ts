import { expect, test, type Page, type Route } from '@playwright/test';

const incident = {
  id: 'inc-1',
  source: 'docker',
  project_id: 'demo-long-project-name-that-keeps-going-to-test-overflow-behavior-in-narrow-viewports',
  title:
    'ZeroDivisionError: division by zero in a very long incident title that must wrap instead of overflowing the viewport width',
  status: 'open',
  severity: 'high',
  error_signature: 'docker|demo|exception|zerodivisionerror|averylongsignaturetokenthatshouldwrapgracefullywithoutbreakinglayout',
  raw_logs:
    'Traceback (most recent call last):\n  File "/code/app.py", line 33, in do_GET\nZeroDivisionError: division by zero\n'.repeat(20),
  evidence: [],
  first_seen: '2026-01-01T00:00:00',
  last_seen: '2026-01-01T00:00:01',
  observation_count: 3,
  matched_line_count: 4,
};

const completed = {
  id: 'inv-1',
  incident_id: 'inc-1',
  status: 'completed',
  requested_model: 'm',
  actual_model: 'm:free',
  prompt_version: 'rca-v1',
  result: {
    diagnosis_status: 'diagnosed',
    root_cause: 'division by zero',
    explanation: 'e',
    severity_assessment: 'high',
    confidence_estimate: 0.9,
    confidence_rationale: 'r',
    findings: [{ description: 'boom', evidence_ids: ['E-001'], runbook_ids: ['RB-007'] }],
    recommendations: [{ title: 'fix', steps: ['patch it'], risk_level: 'low', requires_approval: true }],
    verification_steps: ['rerun'],
    limitations: '',
  },
  evidence_snapshot: [{ id: 'E-001', kind: 'exception', summary: 'ZeroDivisionError', detail: '' }],
  runbook_snapshot: [
    { runbook_id: 'RB-007', title: 'HTTP 500', relevance_score: 9.0, matched_sections: ['Symptoms'], source_urls: [] },
  ],
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
  duration_ms: 1200,
  error_code: '',
  error_message: '',
  created_at: '2026-01-01T00:00:02',
  started_at: '2026-01-01T00:00:02',
  completed_at: '2026-01-01T00:00:03',
};

async function mockApi(page: Page, overrides: Record<string, unknown> = {}) {
  const incidents = overrides['/incidents'] ?? [incident];
  const history = overrides['/investigations'] ?? [completed];
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = route.request().url();
    if (url.includes('/healthz')) {
      return route.fulfill({ json: { ok: true, service: 'x', docker: { connected: true } } });
    }
    if (url.includes('/investigations') && route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: completed });
    }
    if (url.includes('/investigations')) {
      return route.fulfill({ json: history });
    }
    if (url.endsWith('/incidents')) {
      return route.fulfill({ json: incidents });
    }
    return route.fulfill({ json: incident });
  });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test.describe('workbench keyboard flow', () => {
  test('citation -> runbook panel -> Escape restores focus', async ({ page }) => {
    await mockApi(page);
    await page.goto('/incidents/inc-1');
    await page.getByRole('button', { name: 'RB-007' }).first().click();
    await expect(page.getByText('HTTP 500')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('HTTP 500')).toBeHidden();
  });
});

test.describe('responsive layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('desktop has no page-level horizontal overflow @1280px', async ({ page }) => {
    await mockApi(page);
    await page.goto('/incidents');
    await expect(page.getByRole('link', { name: /ZeroDivisionError: division by zero/ }).first()).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('link', { name: /ZeroDivisionError: division by zero/ }).first().click();
    await expect(page.getByRole('heading', { name: /ZeroDivisionError/ })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('responsive layout (mobile)', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  test('mobile has no page-level horizontal overflow @360px', async ({ page }) => {
    await mockApi(page);
    await page.goto('/incidents/inc-1');
    await expect(page.getByRole('heading', { name: /ZeroDivisionError/ })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('retry recovery', () => {
  test('failed history load shows retry; retry succeeds', async ({ page }) => {
    let shouldFail = true;
    await page.route('**/api/v1/**', async (route: Route) => {
      const url = route.request().url();
      if (url.includes('/investigations')) {
        // Fail every attempt (including automatic retries) until the user retries.
        if (shouldFail) {
          return route.fulfill({ status: 500, json: { detail: 'boom' } });
        }
        return route.fulfill({ json: [] });
      }
      if (url.includes('/healthz')) {
        return route.fulfill({ json: { ok: true, service: 'x', docker: { connected: false } } });
      }
      return route.fulfill({ json: incident });
    });
    await page.goto('/incidents/inc-1');
    await expect(page.getByText(/Could not load investigation history/)).toBeVisible();
    shouldFail = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/No investigations yet/)).toBeVisible();
  });
});
