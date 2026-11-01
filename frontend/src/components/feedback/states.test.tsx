import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState, ErrorState, LoadingState } from './states';

describe('feedback states', () => {
  it('loading state announces politely', () => {
    render(<LoadingState message="Loading incidents…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading incidents…');
  });

  it('error state shows message and retry', () => {
    let clicked = 0;
    render(<ErrorState message="Backend unreachable" onRetry={() => (clicked += 1)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Backend unreachable');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(clicked).toBe(1);
  });

  it('empty state shows title and hint', () => {
    render(<EmptyState title="No incidents yet" hint="Trigger a failure to begin." />);
    expect(screen.getByText('No incidents yet')).toBeInTheDocument();
    expect(screen.getByText('Trigger a failure to begin.')).toBeInTheDocument();
  });
});
