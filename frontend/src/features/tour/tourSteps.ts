/** Guided product-tour step catalog. Route-aware, data only — no DOM side effects. */

export interface TourStep {
  /** Stable hook; elements carry matching `data-tour` attributes. */
  element: string;
  title: string;
  description: string;
}

export type TourRoute = 'overview' | 'incidents' | 'incident-details';

const OVERVIEW_STEPS: TourStep[] = [
  {
    element: '[data-tour="tour-nav"]',
    title: 'Navigate DeployIQ',
    description: 'Move between the operational overview and the Incident Center.',
  },
  {
    element: '[data-tour="overview-collector"]',
    title: 'Collector status',
    description: 'Docker collector connectivity reported by the backend health endpoint.',
  },
  {
    element: '[data-tour="overview-counts"]',
    title: 'Live incident counts',
    description: 'Counts computed from the currently loaded incidents only.',
  },
  {
    element: '[data-tour="overview-recent"]',
    title: 'Recent incidents',
    description: 'Jump straight to an incident to inspect it and run an investigation.',
  },
];

const INCIDENTS_STEPS: TourStep[] = [
  {
    element: '[data-tour="center-search"]',
    title: 'Search',
    description: 'Filter by title, error signature, or project. Runs locally on loaded data.',
  },
  {
    element: '[data-tour="center-source"]',
    title: 'Source filter',
    description: 'Narrow the table to a single event source, such as Docker.',
  },
  {
    element: '[data-tour="center-status"]',
    title: 'Status filter',
    description: 'Show open, investigating, or resolved incidents.',
  },
  {
    element: '[data-tour="center-sort"]',
    title: 'Sorting',
    description: 'Order by newest, oldest, or most observations.',
  },
  {
    element: '[data-tour="center-table"]',
    title: 'Incident table',
    description: 'One row per incident. Open a row for evidence, logs, and the workbench.',
  },
];

const DETAILS_STEPS: TourStep[] = [
  {
    element: '[data-tour="details-header"]',
    title: 'Incident identity',
    description: 'Project, severity, observation counts, and the error signature.',
  },
  {
    element: '[data-tour="details-evidence"]',
    title: 'Collected evidence',
    description: 'Original structured evidence from incident collection.',
  },
  {
    element: '[data-tour="details-logs"]',
    title: 'Raw logs',
    description: 'The captured container log tail behind this incident.',
  },
  {
    element: '[data-tour="details-workbench"]',
    title: 'Investigation workbench',
    description: 'Trigger and review AI investigations below. Skipped automatically while loading.',
  },
  {
    element: '[data-tour="workbench-trigger"]',
    title: 'Run investigation',
    description: 'Starts one investigation attempt. Only one can be active at a time.',
  },
  {
    element: '[data-tour="workbench-history"]',
    title: 'Attempt history',
    description: 'Every attempt keeps its model, token usage, timing, and snapshots.',
  },
  {
    element: '[data-tour="workbench-report"]',
    title: 'Grounded report',
    description:
      'Completed reports link each finding to evidence and runbook references. ' +
      'Recommendations that need approval are labeled. Shown only when a completed report exists.',
  },
];

/** Picks the step list for a pathname. Unknown routes get no tour. */
export function stepsForRoute(pathname: string): { route: TourRoute | null; steps: TourStep[] } {
  if (pathname === '/overview') return { route: 'overview', steps: OVERVIEW_STEPS };
  if (pathname === '/incidents') return { route: 'incidents', steps: INCIDENTS_STEPS };
  if (pathname.startsWith('/incidents/')) return { route: 'incident-details', steps: DETAILS_STEPS };
  return { route: null, steps: [] };
}

/** Drops steps whose targets are absent (loading states, empty lists, no report yet). */
export function presentSteps(
  steps: readonly TourStep[],
  root: ParentNode = document,
): TourStep[] {
  return steps.filter((s) => root.querySelector(s.element) !== null);
}

const COMPLETED_PREFIX = 'deployiq.tour.completed.';

/** Records explicit completion per route (done button, not dismissal). */
export function markTourCompleted(route: TourRoute): void {
  try {
    window.localStorage.setItem(COMPLETED_PREFIX + route, '1');
  } catch {
    /* storage unavailable (private mode): tour still works, just not remembered */
  }
}

/** Whether this route's tour was previously completed. */
export function hasCompletedTour(route: TourRoute): boolean {
  try {
    return window.localStorage.getItem(COMPLETED_PREFIX + route) === '1';
  } catch {
    return false;
  }
}
