import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Investigation } from '../../types/api';
import { InvestigationWorkbench } from './InvestigationWorkbench';
import { MAX_CREATED_MISSES } from './announcements';

function makeHist(): Investigation {
  return {
    id: 'hist-0001',
    incident_id: 'inc-1',
    status: 'completed',
    requested_model: 'm',
    actual_model: 'm:free',
    prompt_version: 'rca-v1',
    result: null,
    evidence_snapshot: [],
    runbook_snapshot: [],
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    duration_ms: 100,
    error_code: '',
    error_message: '',
    created_at: '2026-01-01T00:00:01',
    started_at: '2026-01-01T00:00:01',
    completed_at: '2026-01-01T00:00:02',
  };
}

function makeGhost(status: Investigation['status'] = 'pending'): Investigation {
  return {
    ...makeHist(),
    id: 'ghost-9999',
    status,
    created_at: '2026-01-01T00:00:05',
    started_at: null,
    completed_at: null,
  };
}

function renderWorkbench(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <InvestigationWorkbench incidentId="inc-1" onInvestigated={() => undefined} onCiteEvidence={() => undefined} nowMs={1_700_000_000_000} />
    </QueryClientProvider>,
  );
}

describe('InvestigationWorkbench pending-created cleanup', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('expires a ghost id across unchanged successful refreshes; late arrival stays silent', async () => {
    const hist = makeHist();
    const ghostPending = makeGhost('pending');
    let history: Investigation[] = [hist];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/investigations') && init?.method === 'POST') {
          return { ok: true, status: 201, statusText: 'Created', json: async () => ghostPending } as Response;
        }
        if (url.includes('/investigations')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => history } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    renderWorkbench(client);

    // Historical record hydrates silently — never announced as newly created.
    await screen.findByText('hist-000');
    expect(screen.getByRole('status')).toHaveTextContent('');

    await user.click(screen.getByRole('button', { name: 'Run AI investigation' }));
    await waitFor(() => expect(client.getQueryState(['investigations', 'inc-1'])?.dataUpdatedAt).toBeGreaterThan(0));

    // Repeated SUCCESSFUL refreshes return structurally identical data
    // without the ghost id. React Query keeps the same data reference, but
    // dataUpdatedAt bumps each time so cleanup still progresses.
    for (let i = 0; i < MAX_CREATED_MISSES; i += 1) {
      const before = client.getQueryState(['investigations', 'inc-1'])?.dataUpdatedAt ?? 0;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] });
      });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() =>
        expect(client.getQueryState(['investigations', 'inc-1'])?.dataUpdatedAt).not.toBe(before),
      );
    }

    // Ghost finally arrives after expiry: treated as historical, stays silent.
    history = [{ ...ghostPending, status: 'completed' }];
    await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] });
    await screen.findByText('ghost-99');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces a created id that appears promptly', async () => {
    const hist = makeHist();
    const ghostRunning = makeGhost('running');
    const history: Investigation[] = [hist];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/investigations') && init?.method === 'POST') {
          // Ghost is already in history on the next refresh.
          history.push({ ...ghostRunning });
          return { ok: true, status: 201, statusText: 'Created', json: async () => ghostRunning } as Response;
        }
        if (url.includes('/investigations')) {
          return { ok: true, status: 200, statusText: 'OK', json: async () => history } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    renderWorkbench(client);
    await screen.findByText('hist-000');

    await user.click(screen.getByRole('button', { name: 'Run AI investigation' }));
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent(''));
    expect(screen.getByRole('status').textContent).toMatch(/ghost-99.*started/);
  });

  it('does not count failed refreshes as misses', async () => {    const hist = makeHist();
    const ghostPending = makeGhost('pending');
    let shouldFail = false;
    const history: Investigation[] = [hist];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/investigations') && init?.method === 'POST') {
          return { ok: true, status: 201, statusText: 'Created', json: async () => ghostPending } as Response;
        }
        if (url.includes('/investigations')) {
          if (shouldFail) {
            return { ok: false, status: 500, statusText: 'Server Error', json: async () => ({ detail: 'boom' }) } as Response;
          }
          return { ok: true, status: 200, statusText: 'OK', json: async () => history } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    renderWorkbench(client);
    await screen.findByText('hist-000');
    await user.click(screen.getByRole('button', { name: 'Run AI investigation' }));
    await waitFor(() => expect(client.getQueryState(['investigations', 'inc-1'])?.dataUpdatedAt).toBeGreaterThan(0));

    // One failed refresh must not advance the miss counter.
    shouldFail = true;
    await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] }).catch(() => undefined);
    shouldFail = false;

    // Only (MAX - 1) successes so far including the post-trigger refetch would
    // leave the ghost pending; ghost arrival must still announce.
    for (let i = 0; i < MAX_CREATED_MISSES - 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] });
    }
    history.push({ ...ghostPending, status: 'running' });
    await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] });
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent(''));
    expect(screen.getByRole('status').textContent).toMatch(/ghost-99.*started/);
  });

  it('schedules its own refreshes while a created id is pending, then stops', async () => {
    const hist = makeHist();
    const ghostPending = makeGhost('pending');
    const history: Investigation[] = [hist];
    let getCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/investigations') && init?.method === 'POST') {
          return { ok: true, status: 201, statusText: 'Created', json: async () => ghostPending } as Response;
        }
        if (url.includes('/investigations')) {
          getCalls += 1;
          return { ok: true, status: 200, statusText: 'OK', json: async () => history } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWorkbench(client);
    await screen.findByText('hist-000');
    const baseline = getCalls;

    // Freeze the clock before triggering: the POST refetch and every later
    // tick run under fake timers, so only the workbench interval can drive
    // refreshes (no parent polling exists in this test).
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Run AI investigation' }));
      });
      expect(getCalls).toBeGreaterThan(baseline);
      const afterPost = getCalls;

      for (let i = 0; i < MAX_CREATED_MISSES + 2; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          vi.advanceTimersByTime(5000);
        });
      }
      const afterPolling = getCalls;
      expect(afterPolling).toBeGreaterThan(afterPost);

      // Ghost expired by now: late arrival stays silent and polling stopped.
      history.push({ ...ghostPending, status: 'completed' });
      await act(async () => {
        await client.refetchQueries({ queryKey: ['investigations', 'inc-1'] });
        vi.advanceTimersByTime(20000);
      });
      expect(getCalls).toBe(afterPolling + 1);
      // Flush the query update, then assert synchronously (no findBy:
      // the clock is frozen so waitFor polling would never resolve).
      await act(async () => {});
      expect(screen.getByText('ghost-99')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });
});
