import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpsConsolePage } from './OpsConsolePage';

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let body: unknown = {};
      if (url.includes('/healthz')) body = { ok: true, service: 'x', docker: { connected: true, version: '29.8.2' } };
      else if (url.includes('/models')) body = [{ id: 'openrouter/free', name: 'OpenRouter Free Router' }];
      else if (url.includes('/docker/containers')) body = [];
      if (url.includes('/logs')) body = { name: 'c', lines: [], truncated: false };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OpsConsolePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpsConsolePage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows header pills, tabs, and attach controls', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText(/Autonomous SRE Agent/)).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Console input' })).toBeInTheDocument();
    expect(screen.getByLabelText('Target Container:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach & Stream' })).toBeInTheDocument();
  });

  it('exposes manual and copilot tabs without fake actions', async () => {
    mockApi();
    renderPage();
    await screen.findByText(/Autonomous SRE Agent/);
    fireEvent.click(screen.getByRole('button', { name: 'Manual Logs' }));
    expect(await screen.findByLabelText('Raw logs to analyze')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SRE Copilot' }));
    expect(await screen.findByLabelText('Question for copilot')).toBeInTheDocument();
  });
});
