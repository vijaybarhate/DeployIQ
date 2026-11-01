import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TourStep } from './tourSteps';
import { useProductTour } from './useProductTour';

const drive = vi.fn();
const destroy = vi.fn();
const isActive = vi.fn(() => true);

vi.mock('driver.js', () => ({
  driver: vi.fn(() => ({ drive, destroy, isActive })),
}));

const STEPS: TourStep[] = [
  { element: '[data-tour="a"]', title: 'A', description: 'a' },
  { element: '[data-tour="missing"]', title: 'M', description: 'm' },
];

describe('useProductTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isActive.mockReturnValue(true);
    window.localStorage.clear();
    document.body.innerHTML = '<button data-tour="take-tour"></button><div data-tour="a"></div>';
  });

  it('never starts on its own', () => {
    renderHook(() => useProductTour());
    expect(drive).not.toHaveBeenCalled();
  });

  it('drives only present targets and reports nothing to drive when empty', () => {
    const { result } = renderHook(() => useProductTour());
    let started = false;
    act(() => {
      started = result.current.startTour(STEPS, { route: 'overview' }) ?? false;
    });
    expect(started).toBe(true);
    expect(drive).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';
    act(() => {
      started = result.current.startTour(STEPS, { route: 'overview' }) ?? false;
    });
    expect(started).toBe(false);
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it('destroys the driver on unmount', () => {
    const { result, unmount } = renderHook(() => useProductTour());
    act(() => {
      result.current.startTour(STEPS, { route: 'overview' });
    });
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('restores trigger focus when the popover leaves while inactive', async () => {
    const { result } = renderHook(() => useProductTour());
    const trigger = document.querySelector('[data-tour="take-tour"]') as HTMLElement;
    const focusSpy = vi.spyOn(trigger, 'focus');
    act(() => {
      result.current.startTour(STEPS, { route: 'overview', trigger });
    });
    // Simulate driver teardown: popover gone, driver inactive.
    isActive.mockReturnValue(false);
    const popover = document.createElement('div');
    popover.className = 'driver-popover';
    await act(async () => {
      document.body.appendChild(popover);
    });
    expect(focusSpy).not.toHaveBeenCalled();
    await act(async () => {
      popover.remove();
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores popover removals while the driver is still active', async () => {
    const { result } = renderHook(() => useProductTour());
    const trigger = document.querySelector('[data-tour="take-tour"]') as HTMLElement;
    const focusSpy = vi.spyOn(trigger, 'focus');
    act(() => {
      result.current.startTour(STEPS, { route: 'overview', trigger });
    });
    isActive.mockReturnValue(true);
    const popover = document.createElement('div');
    popover.className = 'driver-popover';
    await act(async () => {
      document.body.appendChild(popover);
    });
    await act(async () => {
      popover.remove();
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('marks completion on Done without coupling to teardown', async () => {
    const { result } = renderHook(() => useProductTour());
    act(() => {
      result.current.startTour(STEPS, { route: 'overview' });
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { driver: driverFactory } = await import('driver.js');
    const config = vi.mocked(driverFactory).mock.calls[0][0] as {
      onDoneClick?: () => void;
    };
    expect(typeof config.onDoneClick).toBe('function');
    await act(async () => {
      config.onDoneClick?.();
    });
    expect(window.localStorage.getItem('deployiq.tour.completed.overview')).toBe('1');
    expect(destroy).toHaveBeenCalled();
  });
});
