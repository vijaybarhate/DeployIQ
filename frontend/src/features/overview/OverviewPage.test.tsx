import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './OverviewPage';

function mockApi(incidents: unknown[], health: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/healthz')
        ? health
        : url.includes('/incidents')
          ? incidents
          : { ok: true };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const HEALTHY = { ok: true, service: 'x', docker: { connected: true, version: '29.8.2' } };

describe('OverviewPage empty state keeps collector status visible', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows all-clear with connected collector and zero incidents', async () => {
    mockApi([], HEALTHY);
    renderPage();
    expect(await screen.findByText('No incidents yet')).toBeInTheDocument();
    expect(await screen.findByText(/All clear/)).toBeInTheDocument();
    expect(await screen.findByText(/Docker connected/)).toBeInTheDocument();
  });

  it('shows disconnected collector with zero incidents', async () => {
    mockApi([], { ok: true, service: 'x', docker: { connected: false, error: 'daemon down' } });
    renderPage();
    expect(await screen.findByText('No incidents yet')).toBeInTheDocument();
    expect(await screen.findByText(/disconnected/)).toBeInTheDocument();
    expect(await screen.findByText(/daemon down/)).toBeInTheDocument();
  });

  it('links the open count to the incident center', async () => {
    mockApi(
      [
        {
          id: 'a',
          title: 'ZeroDivisionError: division by zero',
          status: 'open',
          project_id: 'demo',
          source: 'docker',
          severity: 'high',
          last_seen: '2026-01-03T00:00:00',
          observation_count: 2,
        },
      ],
      HEALTHY,
    );
    renderPage();
    const link = await screen.findByRole('link', { name: '1 open' });
    expect(link).toHaveAttribute('href', '/incidents');
  });
});
