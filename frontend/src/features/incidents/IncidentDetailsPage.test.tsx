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

const olderCompleted: Investigation = {
  ...investigation,
  id: 'inv-0',
  actual_model: 'other/model:free',
  prompt_version: 'rca-v1',
  created_at: '2026-01-01T00:00:01',
  completed_at: '2026-01-01T00:00:02',
};

function mockFetchTwo() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/incidents/inc-1')
        ? incident
        : url.includes('/investigations')
          ? [investigation, olderCompleted]
          : [];
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}

describe('Investigation history with multiple attempts', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockFetchTwo();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('expands the newest attempt and collapses older ones', async () => {
    renderPage();
    // Newest (inv-1) expanded: findings visible without interaction.
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getAllByText('completed').length).toBeGreaterThanOrEqual(1);
  });

  it('toggles cards independently without affecting each other', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // Older card starts collapsed: expand it via its toggle button.
    const toggle = screen.getByRole('button', { name: /expand investigation inv-0/i });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /collapse investigation inv-0/i })).toBeInTheDocument();
    // Newest card stays expanded.
    expect(await screen.findAllByText('boom')).toHaveLength(2);
  });

  it('scopes identical evidence IDs to their own investigation', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // Both attempts carry E-001; only the expanded card exposes its citation.
    const buttons = await screen.findAllByRole('button', { name: 'E-001' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(document.getElementById('evidence-inv-1-E-001')).not.toBeNull();
    // Expand the older card: its citation must target its own snapshot.
    await user.click(screen.getByRole('button', { name: /expand investigation inv-0/i }));
    const olderButtons = await screen.findAllByRole('button', { name: 'E-001' });
    expect(olderButtons).toHaveLength(2);
    await user.click(olderButtons[1]);
    expect(document.getElementById('evidence-inv-0-E-001')).not.toBeNull();
  });
});

describe('Investigation history states', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('distinguishes an empty history from a fetch error', async () => {
    mockFetchEmpty();
    renderPage();
    expect(await screen.findByText(/No investigations yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a distinct error state when history fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/investigations')) {
          return {
            ok: false,
            status: 500,
            statusText: 'Server Error',
            json: async () => ({ detail: 'boom' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => incident,
        } as Response;
      }),
    );
    renderPage();
    expect(await screen.findByText(/Could not load investigation history/)).toBeInTheDocument();
    expect(screen.queryByText(/No investigations yet/)).toBeNull();
  });
});

function mockFetchEmpty() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/incidents/inc-1') ? incident : [];
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}
