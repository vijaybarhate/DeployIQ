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

  it('moves DOM focus to the evidence target on citation click', async () => {
    const user = userEvent.setup();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    renderPage();
    const citation = await screen.findByRole('button', { name: 'E-001' });
    await user.click(citation);
    const target = document.getElementById('evidence-inv-1-E-001');
    expect(target).not.toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it('uses instant scrolling when the user prefers reduced motion', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    renderPage();
    const citation = await screen.findByRole('button', { name: 'E-001' });
    await user.click(citation);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    expect(document.activeElement?.id).toBe('evidence-inv-1-E-001');
  });

  it('uses smooth scrolling when the user has no motion preference', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    renderPage();
    const citation = await screen.findByRole('button', { name: 'E-001' });
    await user.click(citation);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(document.activeElement?.id).toBe('evidence-inv-1-E-001');
  });

  it('explains frozen evidence versus live tail under raw logs', async () => {
    const user = userEvent.setup();
    renderPage();
    const citation = await screen.findByRole('button', { name: 'E-001' });
    await user.click(citation);
    expect(await screen.findByText(/frozen evidence, not a live tail/)).toBeInTheDocument();
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
  evidence_snapshot: [
    { id: 'E-001', kind: 'exception', summary: 'older traceback', detail: 'older frame' },
  ],
  runbook_snapshot: [
    {
      runbook_id: 'RB-007',
      title: 'HTTP 500',
      relevance_score: 5.5,
      matched_sections: ['Application exception'],
      source_urls: ['https://docs.docker.com/x'],
    },
  ],
};

const staleCompleted: Investigation = {
  ...investigation,
  id: 'inv-9',
  actual_model: 'third/model:free',
  created_at: '2026-01-01T00:00:00',
  completed_at: '2026-01-01T00:00:00',
  result: {
    diagnosis_status: 'diagnosed',
    root_cause: 'stale cause',
    explanation: 'old',
    severity_assessment: 'low',
    confidence_estimate: 0.5,
    confidence_rationale: 'r',
    findings: [{ description: 'stale finding', evidence_ids: ['E-999'], runbook_ids: ['RB-999'] }],
    recommendations: [],
    verification_steps: [],
    limitations: '',
  },
  evidence_snapshot: [{ id: 'E-001', kind: 'exception', summary: 'old', detail: '' }],
  runbook_snapshot: [],
};

function mockFetchThree() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/incidents/inc-1')
        ? incident
        : url.includes('/investigations')
          ? [investigation, olderCompleted, staleCompleted]
          : [];
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}

describe('Investigation history with multiple attempts', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockFetchThree();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('expands the newest attempt and collapses older ones', async () => {
    renderPage();
    // Newest (inv-1) expanded: findings visible without interaction.
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
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

  it('routes runbook citations to the owning investigation snapshot data', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // Newest card cites RB-007 with relevance 9.0; open its runbook panel.
    const chips = await screen.findAllByRole('button', { name: 'RB-007' });
    expect(chips).toHaveLength(1);
    await user.click(chips[0]);
    expect(await screen.findByText(/9\.00/)).toBeInTheDocument();
    expect(screen.getByText('Symptoms')).toBeInTheDocument();
  });

  it('keeps runbook selection per investigation when both cite the same ID', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // Select RB-007 in the newest card (relevance 9.0).
    await user.click((await screen.findAllByRole('button', { name: 'RB-007' }))[0]);
    expect(await screen.findByText(/9\.00/)).toBeInTheDocument();
    // Expand the older card and select its RB-007 (relevance 5.5) instead.
    await user.click(screen.getByRole('button', { name: /expand investigation inv-0/i }));
    const chips = await screen.findAllByRole('button', { name: 'RB-007' });
    await user.click(chips[1]);
    expect(await screen.findByText(/5\.50/)).toBeInTheDocument();
    expect(screen.getByText('Application exception')).toBeInTheDocument();
  });

  it('activates runbook selection with the keyboard and exposes expanded state', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // All runbook chips start unselected.
    const chip = (await screen.findAllByRole('button', { name: 'RB-007' }))[0];
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    // Enter on the focused chip selects it and moves focus into the panel.
    chip.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/9\.00/)).toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement?.textContent).toContain('HTTP 500');
  });

  it('closes the runbook panel with Escape and restores chip focus', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    const chip = (await screen.findAllByRole('button', { name: 'RB-007' }))[0];
    chip.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/9\.00/)).toBeInTheDocument();
    // Escape closes the panel and returns focus to the originating chip.
    await user.keyboard('{Escape}');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(chip);
    expect(screen.queryByText(/9\.00/)).toBeNull();
  });

  it('shows unavailable notes for cited-but-missing evidence and runbooks', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('boom');
    // Expand the stale attempt whose finding cites IDs absent from its snapshot.
    await user.click(screen.getByRole('button', { name: /expand investigation inv-9/i }));
    expect(await screen.findByText('stale finding')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'E-999' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'RB-999' })).toBeNull();
    expect(screen.getByText(/Evidence unavailable: E-999/)).toBeInTheDocument();
    expect(screen.getByText(/Runbook unavailable: RB-999/)).toBeInTheDocument();
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
