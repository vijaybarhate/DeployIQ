import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './useNow';

describe('useNow lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the clock while active', () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const { result } = renderHook(({ active }: { active: boolean }) => useNow(active, 1000), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(start);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(start + 3000);
  });

  it('stops ticking once the investigation reaches a terminal state', () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useNow(active, 1000),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const ticking = result.current;
    expect(ticking).toBe(start + 1000);
    rerender({ active: false });
    act(() => {
      vi.setSystemTime(start + 9000);
      vi.advanceTimersByTime(8000);
    });
    expect(result.current).toBe(ticking);
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(({ active }: { active: boolean }) => useNow(active, 1000), {
      initialProps: { active: true },
    });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
