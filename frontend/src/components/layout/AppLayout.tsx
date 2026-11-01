import { NavLink, Outlet } from 'react-router';
import { Activity, FlaskConical, LayoutDashboard } from 'lucide-react';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
  }`;

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Activity className="h-5 w-5 text-emerald-400" aria-hidden />
          <span className="text-base font-semibold tracking-tight">DeployIQ</span>
          <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
            DevOps Copilot
          </span>
        </div>
      </header>
      <nav className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl gap-1 px-4 py-2">
          <NavLink to="/overview" className={linkClass}>
            <LayoutDashboard className="h-4 w-4" aria-hidden /> Overview
          </NavLink>
          <NavLink to="/incidents" className={linkClass}>
            <FlaskConical className="h-4 w-4" aria-hidden /> Incidents
          </NavLink>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
