import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { FlaskConical, LayoutDashboard, Map, TerminalSquare } from 'lucide-react';

import { useHealth } from '../../hooks/queries';
import { stepsForRoute } from '../../features/tour/tourSteps';
import { useProductTour } from '../../features/tour/useProductTour';

/* Wispr nav: links cluster left as full pills; active page = lavender fill.
   16px Figtree semibold (navigation token), never uppercase. */
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-[15px] font-semibold leading-none transition-colors duration-200 ${
    isActive
      ? 'bg-lavender text-ink'
      : 'text-body hover:bg-raised hover:text-ink'
  }`;

/* DeployIQ mark: an ECG-style pulse (incident intelligence) in lavender over
   the teal-to-ink brand gradient. Drawn inline so no external asset ships. */
function BrandMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M2.5 14h3.1l2.3-6.5 3.5 12.5 2.7-9.5 1.5 3.5h6"
        stroke="#F0D7FF"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const { startTour, destroyTour } = useProductTour();
  const health = useHealth();

  // A tour belongs to one route: leaving the route ends it.
  useEffect(() => destroyTour, [pathname, destroyTour]);

  function onTakeTour(event: React.MouseEvent<HTMLButtonElement>) {
    const { route, steps } = stepsForRoute(pathname);
    if (!route) return;
    startTour(steps, { route, trigger: event.currentTarget });
  }

  function onBrandClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.location.href = '/';
  }

  const statusLabel = health.isLoading
    ? 'checking API…'
    : health.isError
      ? 'API offline'
      : health.data?.docker?.connected
        ? 'docker live'
        : 'API live · docker down';
  const statusDot = health.isLoading
    ? 'bg-slate-500'
    : health.isError
      ? 'bg-red-400'
      : health.data?.docker?.connected
        ? 'bg-teal'
        : 'bg-amber-400';

  return (
    <div className="min-h-screen bg-abyss font-sans text-ink">
      <header className="sticky top-3 z-30 px-4 sm:px-6">
        <div className="wispr-nav-card mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-2 border-hairline bg-panel py-2 pl-3 pr-2">
          <a
            href="/"
            onClick={onBrandClick}
            aria-label="DeployIQ home — reload the app"
            className="flex items-center gap-2.5 rounded-xl outline-offset-4"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal to-ink">
              <BrandMark />
            </span>
            <span className="font-display text-[20px] font-medium leading-[1.1] tracking-[-0.02em]">
              DeployIQ
            </span>
          </a>
          <span className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-hairline bg-canvas px-2.5 py-1 text-[11px] font-semibold text-body">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} aria-hidden />
            {statusLabel}
          </span>
          <button
            type="button"
            data-tour="take-tour"
            onClick={onTakeTour}
            className="ml-auto flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full bg-lavender px-4 py-2 text-[15px] font-semibold leading-none text-ink transition-colors duration-200 hover:bg-lavender-deep"
          >
            <Map className="h-4 w-4" aria-hidden />
            Take a tour
          </button>
        </div>
      </header>
      <nav className="mx-auto mt-4 max-w-7xl px-4 sm:px-6" data-tour="tour-nav" aria-label="Primary">
        <div className="mx-auto flex gap-1.5 overflow-x-auto px-1 py-1">
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
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-7">
        <Outlet />
      </main>
    </div>
  );
}
