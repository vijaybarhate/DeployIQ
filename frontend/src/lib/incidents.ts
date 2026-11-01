import type { Incident } from '../types/api';

export type IncidentSort = 'newest' | 'oldest' | 'observations';

export interface IncidentFilter {
  query: string;
  source: 'all' | Incident['source'];
  status: 'all' | Incident['status'];
  sort: IncidentSort;
}

function matchesQuery(i: Incident, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    i.title.toLowerCase().includes(needle) ||
    i.error_signature.toLowerCase().includes(needle) ||
    i.project_id.toLowerCase().includes(needle)
  );
}

const bySort: Record<IncidentSort, (a: Incident, b: Incident) => number> = {
  newest: (a, b) => b.last_seen.localeCompare(a.last_seen),
  oldest: (a, b) => a.last_seen.localeCompare(b.last_seen),
  observations: (a, b) => b.observation_count - a.observation_count,
};

/** Pure, tested incident filtering + sorting for the Incident Center. */
export function filterAndSortIncidents(all: Incident[], filter: IncidentFilter): Incident[] {
  return all
    .filter((i) => matchesQuery(i, filter.query))
    .filter((i) => (filter.source === 'all' ? true : i.source === filter.source))
    .filter((i) => (filter.status === 'all' ? true : i.status === filter.status))
    .slice()
    .sort(bySort[filter.sort]);
}

export interface IncidentSummary {
  total: number;
  open: number;
  investigating: number;
  resolved: number;
  bySource: Record<string, number>;
  projects: string[];
  latestSeen: string | null;
}

/** Pure, tested aggregation over the loaded collection (never all-time claims). */
export function summarizeIncidents(all: Incident[]): IncidentSummary {
  const bySource: Record<string, number> = {};
  let open = 0;
  let investigating = 0;
  let resolved = 0;
  let latestSeen: string | null = null;
  const projects = new Set<string>();
  for (const i of all) {
    if (i.status === 'open') open += 1;
    else if (i.status === 'investigating') investigating += 1;
    else if (i.status === 'resolved') resolved += 1;
    bySource[i.source] = (bySource[i.source] ?? 0) + 1;
    projects.add(i.project_id);
    if (latestSeen === null || i.last_seen > latestSeen) latestSeen = i.last_seen;
  }
  return {
    total: all.length,
    open,
    investigating,
    resolved,
    bySource,
    projects: [...projects].sort(),
    latestSeen,
  };
}
