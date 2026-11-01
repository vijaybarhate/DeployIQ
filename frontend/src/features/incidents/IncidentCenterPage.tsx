import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { SeverityBadge, SourceBadge, StatusBadge } from '../../components/ui/Badges';
import { useIncidents } from '../../hooks/queries';
import { filterAndSortIncidents, type IncidentFilter, type IncidentSort } from '../../lib/incidents';

const EMPTY_FILTER: IncidentFilter = { query: '', source: 'all', status: 'all', sort: 'newest' };

const SORT_LABELS: Record<IncidentSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  observations: 'Most observations',
};

export function IncidentCenterPage() {
  const [filter, setFilter] = useState<IncidentFilter>(EMPTY_FILTER);
  const incidents = useIncidents();
  const rows = useMemo(
    () => filterAndSortIncidents(incidents.data ?? [], filter),
    [incidents.data, filter],
  );

  if (incidents.isLoading) return <LoadingState message="Loading incidents…" />;
  if (incidents.isError)
    return (
      <ErrorState
        message={incidents.error instanceof Error ? incidents.error.message : 'Failed to load incidents'}
        onRetry={() => incidents.refetch()}
      />
    );

  const set = <K extends keyof IncidentFilter>(key: K, value: IncidentFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Incident Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          Latest {incidents.data?.length ?? 0} incidents. Search and filters apply to the loaded
          collection.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={filter.query}
          onChange={(e) => set('query', e.target.value)}
          placeholder="Search title, signature, or project…"
          aria-label="Search incidents"
          data-tour="center-search"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500"
        />
        <select
          value={filter.source}
          onChange={(e) => set('source', e.target.value as IncidentFilter['source'])}
          aria-label="Filter by source"
          data-tour="center-source"
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm"
        >
          <option value="all">All sources</option>
          <option value="docker">Docker</option>
          <option value="github_actions">GitHub Actions</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => set('status', e.target.value as IncidentFilter['status'])}
          aria-label="Filter by status"
          data-tour="center-status"
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={filter.sort}
          onChange={(e) => set('sort', e.target.value as IncidentSort)}
          aria-label="Sort incidents"
          data-tour="center-sort"
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm"
        >
          {(Object.keys(SORT_LABELS) as IncidentSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No incidents match" hint="Adjust the search, filters, or sorting." />
      ) : (
        <div data-tour="center-table" className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full min-w-[720px] divide-y divide-slate-800 bg-slate-900 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th scope="col" className="px-4 py-2">Incident</th>
                <th scope="col" className="px-4 py-2">Project</th>
                <th scope="col" className="px-4 py-2">Source</th>
                <th scope="col" className="px-4 py-2">Severity</th>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2">Obs.</th>
                <th scope="col" className="px-4 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-800/40">
                  <td className="max-w-[320px] px-4 py-2">
                    <Link to={`/incidents/${i.id}`} className="font-medium text-slate-100 hover:underline">
                      {i.title}
                    </Link>
                    <p className="truncate font-mono text-[11px] text-slate-500">{i.error_signature}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-300">{i.project_id}</td>
                  <td className="whitespace-nowrap px-4 py-2"><SourceBadge value={i.source} /></td>
                  <td className="whitespace-nowrap px-4 py-2"><SeverityBadge value={i.severity} /></td>
                  <td className="whitespace-nowrap px-4 py-2"><StatusBadge value={i.status} /></td>
                  <td className="px-4 py-2 text-slate-300">{i.observation_count}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-400">{i.last_seen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
