import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Investigation } from '../../types/api';
import { InvestigationCard } from './InvestigationCard';

const base: Investigation = {
  id: 'inv-9',
  incident_id: 'inc-1',
  status: 'running',
  requested_model: 'm',
  actual_model: 'm:free',
  prompt_version: 'rca-v1',
  result: null,
  evidence_snapshot: [{ id: 'E-001', kind: 'exception', summary: 'boom', detail: '' }],
  runbook_snapshot: [
    {
      runbook_id: 'RB-007',
      title: 'HTTP 500',
      relevance_score: 9.0,
      matched_sections: ['Symptoms'],
      source_urls: ['https://docs.docker.com/x'],
    },
  ],
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  duration_ms: 1000,
  error_code: '',
  error_message: '',
  created_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:30Z',
  completed_at: null,
};

function renderCard(overrides: Partial<Investigation> = {}, nowMs = Date.parse('2026-01-01T00:01:00Z')) {
  const noop = vi.fn();
  return render(
    <ul>
      <InvestigationCard
        investigation={{ ...base, ...overrides }}
        expanded
        nowMs={nowMs}
        onToggle={noop}
        onCiteEvidence={noop}
      />
    </ul>,
  );
}

describe('InvestigationCard status presentation', () => {
  it.each([
    ['pending', 'Queued'],
    ['running', 'Running'],
    ['completed', 'Completed'],
    ['insufficient_evidence', 'Insufficient evidence'],
    ['failed', 'Failed'],
    ['validation_failed', 'Validation failed'],
  ] as const)('labels %s as "%s" with an accessible name', (status, label) => {
    renderCard({ status, result: null });
    const badge = screen.getByText(label, { exact: true });
    expect(badge).toHaveAttribute('aria-label', `Investigation status: ${label}`);
  });

  it('shows elapsed time for running investigations without fake progress', () => {
    renderCard({ status: 'running' });
    expect(screen.getByText(/Actively investigating/)).toBeInTheDocument();
    // 30s elapsed between started_at and now.
    expect(screen.getByText('· 30s', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('shows a static queued label for pending investigations', () => {
    const { container } = renderCard({ status: 'pending' });
    expect(screen.getByText('Queued — waiting to start')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('hides elapsed time for invalid timestamps instead of fabricating one', () => {
    renderCard({ status: 'running', started_at: 'not-a-date', created_at: 'also-bad' });
    expect(screen.queryByText(/elapsed/)).toBeNull();
  });
});

describe('Runbook panel keyboard interaction', () => {
  it('opens on Enter, focuses the panel heading, and closes on Escape restoring focus', async () => {
    const user = userEvent.setup();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    renderCard({ status: 'completed', result: {
      diagnosis_status: 'diagnosed',
      root_cause: 'x',
      explanation: 'e',
      severity_assessment: 'high',
      confidence_estimate: 0.9,
      confidence_rationale: 'r',
      findings: [{ description: 'd', evidence_ids: [], runbook_ids: ['RB-007'] }],
      recommendations: [],
      verification_steps: [],
      limitations: '',
    } });
    const chip = screen.getByRole('button', { name: 'RB-007' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    chip.focus();
    await user.keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain('HTTP 500');
    await user.keyboard('{Escape}');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(chip);
  });
});
