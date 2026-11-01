import { useMemo } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { SeverityBadge, SourceBadge, StatusBadge } from '../../components/ui/Badges';
import { useHealth, useIncidents } from '../../hooks/queries';
import { filterAndSortIncidents, summarizeIncidents } from '../../lib/incidents';

export function OverviewPage() {
  const incidents = useIncidents();
  const summary = useMemo(() => summarizeIncidents(incidents.data ?? []), [incidents.data]);
  const recent = useMemo(
    () => filterAndSortIncidents(incidents.data ?? [], { query: '', source: 'all', status: 'all', sort: 'newest' }).slice(0, 5),
    [incidents.data],
  );

  if (incidents.isLoading) return <LoadingState message="Loading incidents…" />;
  if (incidents.isError)
    return (
      <ErrorState
        message={incidents.error instanceof Error ? incidents.error.message : 'Failed to load incidents'}
        onRetry={() => incidents.refetch()}
      />
    );

  const statCards: Array<[string, number | string]> = [
    ['Loaded incidents', summary.total],
    ['Open', summary.open],
    ['Investigating', summary.investigating],
    ['Docker', summary.bySource['docker'] ?? 0],
    ['GitHub Actions', summary.bySource['github_actions'] ?? 0],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Operational overview</h1>
        <p className="mt-1 text-sm text-slate-400">
          Latest {summary.total} incidents loaded from the backend
          {summary.latestSeen ? ` · most recent activity ${summary.latestSeen}` : ''}. Metrics are
          computed from visible data only — not all-time statistics.
        </p>
      </div>
      <section aria-label="Collector status" data-tour="overview-collector" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-200">Collector status</h2>
        <CollectorStatus />
      </section>
      <section aria-label="Incident counts" data-tour="overview-counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Projects" className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-slate-200">Projects and sources in view</h2>
          {summary.projects.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No projects yet.</p>
          ) : (
            <>
              <ul className="mt-2 flex flex-wrap gap-2">
                {summary.projects.map((p) => (
                  <li key={p} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">
                    {p}
                  </li>
                ))}
              </ul>
              <ul className="mt-2 flex flex-wrap gap-2">
                {Object.entries(summary.bySource).map(([src, count]) => (
                  <li key={src} className="flex items-center gap-1 text-xs text-slate-300">
                    <SourceBadge value={src} />
                    <span>× {count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section aria-label="Recent incidents" data-tour="overview-recent" className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-slate-200">Recent incidents</h2>
          {recent.length === 0 ? (
            <EmptyState
              title="No incidents yet"
              hint="Trigger a failure in a monitored project (e.g. GET /boom on the demo app) and it will appear here."
            />
          ) : (
            <ul className="mt-2 space-y-2">
              {recent.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/incidents/${i.id}`} className="min-w-0 flex-1 truncate text-slate-100 hover:underline">
                    {i.title}
                  </Link>
                  <SeverityBadge value={i.severity} />
                  <StatusBadge value={i.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CollectorStatus() {
  const health = useHealth();
  if (health.isLoading) return <p className="mt-1 text-sm text-slate-400">Checking…</p>;
  if (health.isError || !health.data)
    return <p className="mt-1 text-sm text-slate-400">Collector status unavailable.</p>;
  const docker = health.data.docker;
  return (
    <p className="mt-1 text-sm text-slate-300">
      Docker collector:{' '}
      <span className={docker.connected ? 'text-emerald-400' : 'text-amber-400'}>
        {docker.connected
          ? `connected${docker.version ? ` (Engine ${docker.version})` : ''}`
          : `disconnected${docker.error ? ` — ${docker.error}` : ''}`}
      </span>
    </p>
  );
}
