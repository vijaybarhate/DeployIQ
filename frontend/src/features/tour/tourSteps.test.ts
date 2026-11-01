import { describe, expect, it } from 'vitest';

import {
  hasCompletedTour,
  markTourCompleted,
  presentSteps,
  stepsForRoute,
  type TourStep,
} from './tourSteps';

describe('stepsForRoute', () => {
  it('maps overview, center, and details routes', () => {
    expect(stepsForRoute('/overview').route).toBe('overview');
    expect(stepsForRoute('/incidents').route).toBe('incidents');
    expect(stepsForRoute('/incidents/abc').route).toBe('incident-details');
  });

  it('returns no tour for unknown routes', () => {
    expect(stepsForRoute('/nope')).toEqual({ route: null, steps: [] });
  });

  it('covers every tour hook used in the UI exactly once per route', () => {
    for (const path of ['/overview', '/incidents', '/incidents/x']) {
      const { steps } = stepsForRoute(path);
      expect(steps.length).toBeGreaterThan(0);
      const hooks = steps.map((s) => s.element);
      expect(new Set(hooks).size).toBe(hooks.length);
      for (const h of hooks) {
        expect(h.startsWith('[data-tour="')).toBe(true);
      }
    }
  });

  it('keeps workbench report copy honest about conditional display', () => {
    const { steps } = stepsForRoute('/incidents/x');
    const report = steps.find((s) => s.element.includes('workbench-report'));
    expect(report?.description).toMatch(/only when/i);
  });
});

describe('presentSteps', () => {
  const steps: TourStep[] = [
    { element: '[data-tour="a"]', title: 'A', description: 'a' },
    { element: '[data-tour="missing"]', title: 'M', description: 'm' },
  ];

  it('drops steps whose targets are absent', () => {
    document.body.innerHTML = '<div data-tour="a"></div>';
    expect(presentSteps(steps)).toHaveLength(1);
    expect(presentSteps(steps)[0].element).toBe('[data-tour="a"]');
    document.body.innerHTML = '';
  });
});

describe('tour completion flag', () => {
  it('round-trips per route without affecting other routes', () => {
    window.localStorage.clear();
    expect(hasCompletedTour('overview')).toBe(false);
    markTourCompleted('overview');
    expect(hasCompletedTour('overview')).toBe(true);
    expect(hasCompletedTour('incidents')).toBe(false);
    window.localStorage.clear();
  });
});
