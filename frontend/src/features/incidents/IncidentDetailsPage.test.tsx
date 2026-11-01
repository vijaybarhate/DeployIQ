import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentDetailsPage } from './IncidentDetailsPage';
import type { Incident, Investigation } from '../../types/api';

const incident: Incident = {
  id: 'inc-1',
  source: 'docker',
  project_id: 'demo',
  title: 'ZeroDivisionError: division by zero',
  status: 'open',
  severity: 'medium',
  error_signature: 'docker|demo|exception|zerodivisionerror',
  raw_logs: 'Traceback ... ZeroDivisionError',
  // Incident evidence carries NO investigation IDs by design.
  evidence: [{ kind: 'exception', summary: 'ZeroDivisionError', detail: '' }],
  first_seen: '2026-01-01T00:00:00',
  last_seen: '2026-01-01T00:00:01',
  observation_count: 1,
  matched_line_count: 2,
};

const investigation: Investigation = {
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
    recommendations: [
      { title: 'Fix it', steps: ['do the thing'], risk_level: 'medium', requires_approval: true },
    ],
    verification_steps: ['rerun'],
    limitations: '',
  },
  evidence_snapshot: [{ id: 'E-001', kind: 'exception', summary: 'ZeroDivisionError', detail: '' }],
  runbook_snapshot: [
    {
      runbook_id: 'RB-007',
      title: 'HTTP 500',
      relevance_score: 9.0,
      matched_sections: ['Symptoms'],
      source_urls: ['https://docs.docker.com/x'],
    },
  ],
  prompt_tokens: 1,
  completion_tokens: 1,
  total_tokens: 2,
  duration_ms: 100,
  error_code: '',
  error_message: '',
  created_at: '2026-01-01T00:00:02',
  started_at: '2026-01-01T00:00:02',
  completed_at: '2026-01-01T00:00:03',
};

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/incidents/inc-1')
        ? incident
        : url.includes('/investigations')
          ? [investigation]
          : [];
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/incidents/inc-1']}>
        <Routes>
          <Route path="/incidents/:incidentId" element={<IncidentDetailsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IncidentDetailsPage citation navigation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockFetch();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders incident evidence without invented investigation IDs', async () => {
    renderPage();
    const section = await screen.findByText('Incident evidence');
    expect(section).toBeInTheDocument();
    // The incident evidence block must not show E-001 style IDs.
    expect(screen.queryByText('E-001', { selector: 'span' })).toBeNull();
  });

  it('clicking a finding citation scrolls to that investigation snapshot entry', async () => {
    const user = userEvent.setup();
    renderPage();
    const citation = await screen.findByRole('button', { name: 'E-001' });
    await user.click(citation);
    const target = document.getElementById('evidence-inv-1-E-001');
    expect(target).not.toBeNull();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(target?.className).toMatch(/emerald/);
  });

  it('shows APPROVAL REQUIRED on recommendations and labels AI confidence', async () => {
    renderPage();
    expect(await screen.findByText('APPROVAL REQUIRED')).toBeInTheDocument();
    expect(await screen.findByText(/not a calibrated probability/)).toBeInTheDocument();
  });
});
