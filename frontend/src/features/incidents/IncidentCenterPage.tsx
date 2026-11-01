import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { useIncidents } from '../../hooks/queries';
import type { Incident } from '../../types/api';

function matches(i: Incident, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    i.title.toLowerCase().includes(needle) || i.error_signature.toLowerCase().includes(needle)
  );
}

export function IncidentCenterPage() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | Incident['source']>('all');
  const [status, setStatus] = useState<'all' | Incident['status']>('all');
  const incidents = useIncidents();

  const rows = useMemo(() => {
    const all = incidents.data ?? [];
    return all
      .filter((i) => matches(i, query))
      .filter((i) => (source === 'all' ? true : i.source === source))
      .filter((i) => (status === 'all' ? true : i.status === status))
      .slice()
      .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  }, [incidents.data, query, source, status]);

  if (incidents.isLoading) return <LoadingState message="Loading incidents…" />;
  if (incidents.isError)
    return (
      <ErrorState
        message={incidents.error instanceof Error ? incidents.error.message : 'Failed to load incidents'}
        onRetry={() => incidents.refetch()}
      />
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Incident Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          Latest {incidents.data?.length ?? 0} incidents. Search and filters apply to the
          loaded collection.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or error signature…"
          aria-label="Search incidents"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          aria-label="Filter by source"
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm"
        >
          <option value="all">All sources</option>
          <option value="docker">Docker</option>
          <option value="github_actions">GitHub Actions</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No incidents match" hint="Adjust the search or filters." />
      ) : (
        <ul className="divide-y divide-slate-800 rounded-md border border-slate-800 bg-slate-900">
          {rows.map((i) => (
            <li key={i.id}>
              <Link to={`/incidents/${i.id}`} className="block px-4 py-3 hover:bg-slate-800/50">
                <p className="text-sm font-medium text-slate-100">{i.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {i.project_id} · {i.source} · {i.status} · obs {i.observation_count}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
