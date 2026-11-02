import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Activity, FlaskConical, LayoutDashboard, Map, TerminalSquare } from 'lucide-react';

import { stepsForRoute } from '../../features/tour/tourSteps';
import { useProductTour } from '../../features/tour/useProductTour';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${
    isActive
      ? 'bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/30'
      : 'text-muted hover:bg-raised/60 hover:text-ink'
  }`;

export function AppLayout() {
  const { pathname } = useLocation();
  const { startTour, destroyTour } = useProductTour();

  // A tour belongs to one route: leaving the route ends it.
  useEffect(() => destroyTour, [pathname, destroyTour]);

  function onTakeTour(event: React.MouseEvent<HTMLButtonElement>) {
    const { route, steps } = stepsForRoute(pathname);
    if (!route) return;
    startTour(steps, { route, trigger: event.currentTarget });
  }

  return (
    <div className="min-h-screen bg-abyss font-sans text-ink">
      <header className="sticky top-0 z-30 border-b border-hairline/80 bg-abyss/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-7">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400 text-slate-950">
            <Activity className="h-4 w-4" aria-hidden strokeWidth={2.5} />
          </span>
          <span className="leading-none">
            <span className="block text-[15px] font-semibold tracking-tight">DeployIQ</span>
            <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Incident intelligence
            </span>
          </span>
          <span className="rounded-full border border-hairline/80 bg-panel px-2 py-0.5 font-mono text-[11px] text-muted">
            demo
          </span>
          <button
            type="button"
            data-tour="take-tour"
            onClick={onTakeTour}
            className="ml-auto flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-sm text-body transition-colors duration-200 hover:border-muted hover:bg-raised hover:text-ink"
          >
            <Map className="h-4 w-4" aria-hidden />
            Take a tour
          </button>
        </div>
      </header>
      <nav className="border-b border-hairline/80" data-tour="tour-nav" aria-label="Primary">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2">
          <NavLink to="/overview" className={linkClass}>
            <LayoutDashboard className="h-4 w-4" aria-hidden /> Overview
          </NavLink>
          <NavLink to="/console" className={linkClass}>
            <TerminalSquare className="h-4 w-4" aria-hidden /> Ops Console
          </NavLink>
          <NavLink to="/incidents" className={linkClass}>
            <FlaskConical className="h-4 w-4" aria-hidden /> Incidents
          </NavLink>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
