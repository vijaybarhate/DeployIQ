import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mockApiWithCheck(check: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/models/check')) {
        calls.push({ url, body: String(init?.body ?? '') });
        const { status, body } = check(url, init);
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? 'OK' : 'Bad Gateway',
          json: async () => body,
        } as Response;
      }
      let body: unknown = {};
      if (url.includes('/healthz')) body = { ok: true, service: 'x', docker: { connected: true } };
      else if (url.includes('/models'))
        body = [
          { id: 'a:free', name: 'A' },
          { id: 'b:free', name: 'B' },
        ];
      else if (url.includes('/docker/containers')) body = [];
      if (url.includes('/logs')) body = { name: 'c', lines: [], truncated: false };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }),
  );
  return calls;
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

  it('auto-verifies the picked engine and shows the live verdict', async () => {
    const calls = mockApiWithCheck(() => ({
      status: 200,
      body: { model: 'a:free', ok: true, actual_model: 'a:free', latency_ms: 420 },
    }));
    renderPage();
    await screen.findByText(/Autonomous SRE Agent/);
    // First model is pinged automatically on mount.
    expect(await screen.findByText('live · 420ms')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/models/check') && c.body.includes('a:free'))).toBe(true);
    // Picking another model pings that model instead.
    fireEvent.change(screen.getByLabelText('AI engine (free models only)'), {
      target: { value: 'b:free' },
    });
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/models/check') && c.body.includes('b:free'))).toBe(true);
    });
  });

  it('turns the engine pill red when the picked model is down', async () => {
    mockApiWithCheck(() => ({ status: 502, body: { detail: 'model check failed: timeout' } }));
    renderPage();
    await screen.findByText(/Autonomous SRE Agent/);
    expect(await screen.findByText('down')).toBeInTheDocument();
  });

  it('filters detected containers by search without hiding data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/models/check')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as Response;
        }
        if (url.includes('/models')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => [] } as Response;
        }
        if (url.includes('/docker/containers')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => [
              { name: 'crashme-boom-1', short_id: 'aaa', status: 'running', health: 'healthy', project: 'deployiq-demo' },
              { name: 'other-thing-1', short_id: 'bbb', status: 'exited', health: '', project: 'other-proj' },
            ],
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ ok: true, service: 'x', docker: { connected: true } }),
        } as Response;
      }),
    );
    renderPage();
    await screen.findByText('crashme-boom-1');
    expect(screen.getByText('other-thing-1')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search containers'), { target: { value: 'boom' } });
    expect(screen.getByText('crashme-boom-1')).toBeInTheDocument();
    expect(screen.queryByText('other-thing-1')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search containers'), { target: { value: 'zzz-nope' } });
    expect(screen.getByText(/No containers match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('other-thing-1')).toBeInTheDocument();
  });

  it('diagnoses with the container project and guides on clean logs', async () => {
    const posts: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/models/check')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as Response;
        }
        if (url.includes('/models')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => [] } as Response;
        }
        if (url.endsWith('/incidents/manual')) {
          const body = String(init?.body ?? '');
          posts.push({ url, body });
          if (body.includes('Traceback')) {
            return {
              ok: true, status: 201, statusText: 'Created',
              json: async () => ({ id: 'i1', title: 'boom incident' }),
            } as Response;
          }
          return {
            ok: false, status: 422, statusText: 'Unprocessable',
            json: async () => ({ detail: 'no analyzable evidence in the provided logs' }),
          } as Response;
        }
        if (url.includes('/logs')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ name: 'c1', lines: ['all quiet here'], truncated: false }),
          } as Response;
        }
        if (url.includes('/docker/containers')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => [
              { name: 'c1', short_id: 'abc', status: 'running', health: '', project: 'my-proj' },
            ],
          } as Response;
        }
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ ok: true, service: 'x', docker: { connected: true } }),
        } as Response;
      }),
    );
    renderPage();
    await screen.findByText('c1');
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    // Clean tail: honest guidance instead of the raw backend 422.
    expect(await screen.findByText(/no crash evidence/)).toBeInTheDocument();
    expect(posts.some((p) => p.body.includes('"project_id":"my-proj"'))).toBe(true);
  });

  it('shows the recorded incident in the right diagnostic panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/models/check')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as Response;
        }
        if (url.includes('/models')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => [] } as Response;
        }
        if (url.endsWith('/incidents/manual')) {
          return {
            ok: true, status: 201, statusText: 'Created',
            json: async () => ({ id: 'inc-9', title: 'boom incident' }),
          } as Response;
        }
        if (url.includes('/investigations')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => [] } as Response;
        }
        if (url.includes('/logs')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({
              name: 'c1',
              lines: ['Traceback (most recent call last):', 'ZeroDivisionError: x'],
              truncated: false,
            }),
          } as Response;
        }
        if (url.includes('/docker/containers')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => [
              { name: 'c1', short_id: 'abc', status: 'running', health: '', project: 'my-proj' },
            ],
          } as Response;
        }
        return {
          ok: true, status: 200, statusText: 'OK',
          json: async () => ({ ok: true, service: 'x', docker: { connected: true } }),
        } as Response;
      }),
    );
    renderPage();
    await screen.findByText('c1');
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(await screen.findByText(/recorded/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Investigate/ })).toBeInTheDocument();
  });
});
