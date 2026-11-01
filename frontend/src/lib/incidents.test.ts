import { describe, expect, it } from 'vitest';

import type { Incident } from '../types/api';
import { filterAndSortIncidents, summarizeIncidents } from './incidents';

function make(overrides: Partial<Incident> & { id: string }): Incident {
  return {
    source: 'docker',
    project_id: 'demo',
    title: 'boom',
    status: 'open',
    severity: 'high',
    error_signature: 'sig',
    raw_logs: '',
    evidence: [],
    first_seen: '2026-01-01T00:00:00',
    last_seen: '2026-01-01T00:00:00',
    observation_count: 1,
    matched_line_count: 0,
    ...overrides,
  };
}

describe('filterAndSortIncidents', () => {
  const rows = [
    make({ id: 'a', title: 'ZeroDivisionError crash', status: 'open', last_seen: '2026-01-03T00:00:00', observation_count: 2 }),
    make({ id: 'b', title: 'OOMKilled worker', project_id: 'api', source: 'docker', status: 'resolved', severity: 'critical', last_seen: '2026-01-01T00:00:00', observation_count: 9 }),
    make({ id: 'c', title: 'Health check failed', status: 'investigating', last_seen: '2026-01-02T00:00:00', observation_count: 4 }),
  ];

  it('searches title, signature and project', () => {
    expect(filterAndSortIncidents(rows, { query: 'oomkilled', source: 'all', status: 'all', sort: 'newest' }).map((i) => i.id)).toEqual(['b']);
    expect(filterAndSortIncidents(rows, { query: 'api', source: 'all', status: 'all', sort: 'newest' }).map((i) => i.id)).toEqual(['b']);
    expect(filterAndSortIncidents(rows, { query: '', source: 'all', status: 'all', sort: 'newest' })).toHaveLength(3);
  });

  it('filters by source and status', () => {
    expect(
      filterAndSortIncidents(rows, { query: '', source: 'github_actions', status: 'all', sort: 'newest' }),
    ).toEqual([]);
    expect(
      filterAndSortIncidents(rows, { query: '', source: 'all', status: 'resolved', sort: 'newest' }).map((i) => i.id),
    ).toEqual(['b']);
  });

  it('sorts newest, oldest and by observations', () => {
    const base = { query: '', source: 'all' as const, status: 'all' as const };
    expect(filterAndSortIncidents(rows, { ...base, sort: 'newest' }).map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(filterAndSortIncidents(rows, { ...base, sort: 'oldest' }).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(filterAndSortIncidents(rows, { ...base, sort: 'observations' }).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('summarizeIncidents', () => {
  it('aggregates only the loaded collection', () => {
    const rows = [
      make({ id: 'a', status: 'open', project_id: 'demo', source: 'docker', last_seen: '2026-01-02T00:00:00' }),
      make({ id: 'b', status: 'investigating', project_id: 'api', source: 'github_actions', last_seen: '2026-01-05T00:00:00' }),
      make({ id: 'c', status: 'resolved', project_id: 'demo', source: 'docker', last_seen: '2026-01-01T00:00:00' }),
    ];
    const s = summarizeIncidents(rows);
    expect(s).toMatchObject({
      total: 3,
      open: 1,
      investigating: 1,
      resolved: 1,
      latestSeen: '2026-01-05T00:00:00',
    });
    expect(s.projects).toEqual(['api', 'demo']);
    expect(s.bySource).toEqual({ docker: 2, github_actions: 1 });
  });

  it('handles the empty collection', () => {
    expect(summarizeIncidents([])).toMatchObject({ total: 0, latestSeen: null, projects: [] });
  });
});
