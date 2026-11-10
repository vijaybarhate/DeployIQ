import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { useIncidents } from '../../hooks/queries';
import { filterAndSortIncidents, type IncidentFilter, type IncidentSort } from '../../lib/incidents';
import { formatDateTime } from '../../lib/time';

const EMPTY_FILTER: IncidentFilter = { query: '', source: 'all', status: 'all', sort: 'newest' };

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-slate-500',
};

function sourceLabel(value: string): string {
  if (value === 'github_actions') return 'GitHub Actions';
  if (value === 'docker') return 'Docker';
  return value;
}

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
        <h1 className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.02em] text-ink">Incident Center</h1>
        <p className="mt-1 text-sm text-muted">
          Latest {incidents.data?.length ?? 0} incidents. Search and filters apply to the loaded
          collection.
        </p>
        <p className="mt-1 text-xs text-muted">
          Each row is one crash fingerprint: every repeat sighting raises its observation count
          instead of opening a duplicate.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={filter.query}
          name="incident-search"
          onChange={(e) => set('query', e.target.value)}
          placeholder="Search title, signature, or project…"
          aria-label="Search incidents"
          data-tour="center-search"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-hairline bg-panel px-3 py-2 text-sm placeholder:text-muted focus:shadow-[inset_rgba(26,26,26,0.06)_0_2px_10px]"
        />
        <select
          value={filter.source}
          name="incident-source"
          onChange={(e) => set('source', e.target.value as IncidentFilter['source'])}
          aria-label="Filter by source"
          data-tour="center-source"
          className="min-h-[44px] cursor-pointer rounded-xl border border-hairline bg-panel px-3 py-2 text-sm text-ink hover:border-[#C9C9AE]"
        >
          <option value="all">All sources</option>
          <option value="docker">Docker</option>
          <option value="github_actions">GitHub Actions</option>
        </select>
        <select
          value={filter.status}
          name="incident-status"
          onChange={(e) => set('status', e.target.value as IncidentFilter['status'])}
          aria-label="Filter by status"
          data-tour="center-status"
          className="min-h-[44px] cursor-pointer rounded-xl border border-hairline bg-panel px-3 py-2 text-sm text-ink hover:border-[#C9C9AE]"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={filter.sort}
          name="incident-sort"
          onChange={(e) => set('sort', e.target.value as IncidentSort)}
          aria-label="Sort incidents"
          data-tour="center-sort"
          className="min-h-[44px] cursor-pointer rounded-xl border border-hairline bg-panel px-3 py-2 text-sm text-ink hover:border-[#C9C9AE]"
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
        <div data-tour="center-table" className="overflow-x-auto rounded-xl border border-hairline bg-panel">
          <table className="w-full min-w-[720px] divide-y divide-hairline/80 text-left text-[13px]">
            <thead>
              <tr className="text-xs font-medium text-muted">
                <th scope="col" className="px-3 py-2 font-medium">Incident</th>
                <th scope="col" className="px-3 py-2 font-medium">Project</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Severity</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Obs.</th>
                <th scope="col" className="px-3 py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-faint">
              {rows.map((i) => (
                <tr key={i.id} className="transition-colors duration-150 hover:bg-raised/30">
                  <td className="max-w-[320px] px-3 py-2">
                    <Link to={`/incidents/${i.id}`} className="font-medium tracking-tight text-ink underline-offset-4 hover:underline">
                      {i.title}
                    </Link>
                    <p className="truncate font-mono text-[11px] text-muted">{i.error_signature}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-body">{i.project_id}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{sourceLabel(i.source)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs text-body">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[i.severity?.toLowerCase() ?? ''] ?? 'bg-slate-500'}`}
                      />
                      {i.severity ?? 'unclassified'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-body">{i.status}</td>
                  <td className="px-3 py-2 tabular-nums text-body">{i.observation_count}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-muted">{formatDateTime(i.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
