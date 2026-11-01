import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './client';

function mockFetchOnce(response: Partial<Response> & { jsonData?: unknown }) {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => response.jsonData,
    ...response,
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes same-origin /api/v1 and parses JSON', async () => {
    const mock = mockFetchOnce({ jsonData: { ok: true } });
    await expect(api.get('/incidents')).resolves.toEqual({ ok: true });
    expect(mock).toHaveBeenCalledWith('/api/v1/incidents', expect.objectContaining({}));
  });

  it('maps HTTP errors to ApiError with backend detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'incident not found' }),
      }),
    );
    await expect(api.get('/incidents/x')).rejects.toMatchObject({
      status: 404,
      message: 'incident not found',
    } satisfies Partial<ApiError>);
  });

  it('maps network failures to status-0 ApiError without leaking internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(api.get('/incidents')).rejects.toMatchObject({ status: 0 });
  });
});
