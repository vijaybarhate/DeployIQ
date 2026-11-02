import { useMemo } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { SeverityBadge, StatusBadge } from '../../components/ui/Badges';
import { useHealth, useIncidents } from '../../hooks/queries';
import { filterAndSortIncidents, summarizeIncidents } from '../../lib/incidents';
import { formatDateTime } from '../../lib/time';

export function OverviewPage() {
  const incidents = useIncidents();
  const health = useHealth();
  const summary = useMemo(() => summarizeIncidents(incidents.data ?? []), [incidents.data]);
  const dockerConnected = health.data?.docker.connected ?? null;
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

  const needsAttention = summary.open > 0 || summary.investigating > 0;

  return (
    <div className="space-y-5">
      <div data-tour="overview-intro">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
          Operational overview
        </h1>
        <p className="mt-1 text-sm text-muted">
          Watch tails your containers, Group merges repeat crashes, Explain runs the AI
          investigation. Open the console or take the tour to see it live.
        </p>
      </div>
      <section aria-label="System status" data-tour="overview-counts" className="rounded-xl border border-hairline bg-panel px-4 py-3">
        <p className="text-sm tabular-nums text-body">
          {needsAttention ? (
            <>
              <span className="relative mr-1 inline-flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <Link to="/incidents" className="font-semibold text-ink underline-offset-4 hover:underline">
                {summary.open} open
              </Link>
              {' · '}
              {summary.investigating} investigating
            </>
          ) : (
            <>All clear — no open incidents.</>
          )}
          {' · Docker '}
          {dockerConnected === null ? '…' : dockerConnected ? 'connected' : 'down'}
          {summary.latestSeen ? ` · latest activity ${formatDateTime(summary.latestSeen)}` : ''}
        </p>
      </section>
      <section aria-label="Collector status" data-tour="overview-collector" className="rounded-xl border border-hairline bg-panel p-4">
        <h2 className="text-sm font-medium text-ink">Collector status</h2>
        <CollectorStatus />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Projects" className="rounded-xl border border-hairline bg-panel p-4">
          <h2 className="text-sm font-medium text-ink">Projects and sources in view</h2>
          {summary.projects.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No projects yet.</p>
          ) : (
            <>
              <p className="mt-2 font-mono text-xs text-body">
                {summary.projects.join(' · ')}
              </p>
              <p className="mt-1 font-mono text-xs text-muted">
                {Object.entries(summary.bySource).map(([src, count]) => `${src} × ${count}`).join(' · ')}
              </p>
            </>
          )}
        </section>
        <section aria-label="Recent incidents" data-tour="overview-recent" className="rounded-xl border border-hairline bg-panel p-4">
          <h2 className="text-sm font-medium text-ink">Recent incidents</h2>
          {recent.length === 0 ? (
            <EmptyState
              title="No incidents yet"
              hint="Trigger a failure in a monitored project (e.g. GET /boom on the demo app) and it will appear here."
            />
          ) : (
            <ul className="mt-2 divide-y divide-faint">
              {recent.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
                  <Link to={`/incidents/${i.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
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
  if (health.isLoading) return <p className="mt-1 text-sm text-muted">Checking…</p>;
  if (health.isError || !health.data)
    return <p className="mt-1 text-sm text-muted">Collector status unavailable.</p>;
  const docker = health.data.docker;
  return (
    <p className="mt-1 text-sm text-body">
      Docker collector:{' '}
      <span className={docker.connected ? 'text-emerald-400' : 'text-amber-400'}>
        {docker.connected
          ? `connected${docker.version ? ` (Engine ${docker.version})` : ''}`
          : `disconnected${docker.error ? ` — ${docker.error}` : ''}`}
      </span>
    </p>
  );
}
