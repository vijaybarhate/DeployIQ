import { useMemo } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { useHealth, useIncidents } from '../../hooks/queries';

export function OverviewPage() {
  const incidents = useIncidents();
  const health = useHealth();

  const stats = useMemo(() => {
    const rows = incidents.data ?? [];
    return {
      total: rows.length,
      open: rows.filter((i) => i.status === 'open').length,
      investigating: rows.filter((i) => i.status === 'investigating').length,
      projects: [...new Set(rows.map((i) => i.project_id))],
      docker: rows.filter((i) => i.source === 'docker').length,
      github: rows.filter((i) => i.source === 'github_actions').length,
    };
  }, [incidents.data]);

  if (incidents.isLoading) return <LoadingState message="Loading incidents…" />;
  if (incidents.isError)
    return (
      <ErrorState
        message={incidents.error instanceof Error ? incidents.error.message : 'Failed to load incidents'}
        onRetry={() => incidents.refetch()}
      />
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Operational overview</h1>
        <p className="mt-1 text-sm text-slate-400">
          Latest {stats.total} incidents loaded from the backend — metrics are computed from
          visible data only.
        </p>
      </div>
      <section aria-label="Collector status" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-200">Collector status</h2>
        {health.data ? (
          <p className="mt-1 text-sm text-slate-300">
            Docker collector:{' '}
            <span className={health.data.docker.connected ? 'text-emerald-400' : 'text-amber-400'}>
              {health.data.docker.connected
                ? `connected${health.data.docker.version ? ` (Engine ${health.data.docker.version})` : ''}`
                : `disconnected${health.data.docker.error ? ` — ${health.data.docker.error}` : ''}`}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-400">Collector status unavailable.</p>
        )}
      </section>
      <section aria-label="Incident counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Total loaded', stats.total],
          ['Open', stats.open],
          ['Investigating', stats.investigating],
          ['Docker', stats.docker],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
      {stats.total === 0 && (
        <EmptyState
          title="No incidents yet"
          hint="Trigger a failure in a monitored project (e.g. GET /boom on the demo app) and it will appear here."
        />
      )}
      {stats.projects.length > 0 && (
        <section aria-label="Projects" className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-slate-200">Projects in view</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {stats.projects.map((p) => (
              <li key={p} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
