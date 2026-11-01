import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissingReferenceNote, RunbookCard } from './RunbookCard';
import type { RunbookReference } from '../../types/api';

const base: RunbookReference = {
  runbook_id: 'RB-007',
  title: 'HTTP 500',
  relevance_score: 9.25,
  matched_sections: ['Symptoms', 'Diagnostics'],
  source_urls: ['https://docs.docker.com/x', 'javascript:alert(1)', '/relative/path'],
};

describe('RunbookCard', () => {
  it('renders title, matched sections and BM25 score label', () => {
    render(<RunbookCard runbook={base} />);
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('Symptoms')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(screen.getByText(/BM25 relevance score/)).toBeInTheDocument();
  });

  it('renders only safe links and flags omitted sources', () => {
    render(<RunbookCard runbook={base} />);
    const link = screen.getByRole('link', { name: 'https://docs.docker.com/x' });
    expect(link).toHaveAttribute('href', 'https://docs.docker.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: /javascript:/ })).toBeNull();
    expect(screen.getByText(/omitted unsafe or malformed/)).toBeInTheDocument();
  });

  it('shows an empty state when no sources are recorded', () => {
    render(<RunbookCard runbook={{ ...base, source_urls: [] }} />);
    expect(screen.getByText(/No sources recorded/)).toBeInTheDocument();
  });
});

describe('MissingReferenceNote', () => {
  it('labels missing citations without acting as a link or button', () => {
    const { container } = render(<MissingReferenceNote kind="Runbook" id="RB-999" />);
    expect(screen.getByText(/Runbook unavailable: RB-999/)).toBeInTheDocument();
    expect(container.querySelector('a, button')).toBeNull();
  });
});
