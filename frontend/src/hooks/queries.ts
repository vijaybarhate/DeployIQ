import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { checkModel, containerLogs, listContainers, listModels } from '../lib/api/console';
import { getHealth, getIncident, listIncidents } from '../lib/api/incidents';
import { listInvestigations, triggerInvestigation } from '../lib/api/investigations';
import type { Investigation } from '../types/api';

export function useIncidents() {
  return useQuery({
    queryKey: ['incidents'],
    queryFn: listIncidents,
    refetchInterval: 15_000,
  });
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => getIncident(id ?? ''),
    enabled: Boolean(id),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useInvestigations(incidentId: string | undefined) {
  return useQuery({
    queryKey: ['investigations', incidentId],
    queryFn: () => listInvestigations(incidentId ?? ''),
    enabled: Boolean(incidentId),
  });
}

export function useContainers() {
  return useQuery({
    queryKey: ['containers'],
    queryFn: listContainers,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useContainerLogs(name: string | null, tail = 200) {
  return useQuery({
    queryKey: ['container-logs', name, tail],
    queryFn: () => containerLogs(name ?? '', tail),
    enabled: Boolean(name),
    // Live tail: poll every 10s and refresh immediately when the tab regains
    // focus, so the viewer never sits on a stale snapshot.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export type ModelStatus = 'idle' | 'checking' | 'live' | 'down';

export interface ModelHealth {
  status: ModelStatus;
  actualModel: string;
  latencyMs: number | null;
  error: string | null;
}

const IDLE_HEALTH: ModelHealth = { status: 'idle', actualModel: '', latencyMs: null, error: null };

/** Live health of one engine pick: pings the backend check on every change. */
export function useModelStatus(model: string): ModelHealth {
  const id = (model || '').trim();
  // Settled verdicts only; "checking" is derived during render, so the
  // effect never sets state synchronously (no cascading renders).
  const [settled, setSettled] = useState<{ forModel: string; health: ModelHealth } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    checkModel(id).then(
      (result) => {
        if (cancelled) return;
        if (!result || result.ok !== true) {
          setSettled({
            forModel: id,
            health: { status: 'down', actualModel: '', latencyMs: null, error: 'unexpected response' },
          });
          return;
        }
        setSettled({
          forModel: id,
          health: {
            status: 'live',
            actualModel: result.actual_model || '',
            latencyMs: typeof result.latency_ms === 'number' ? result.latency_ms : null,
            error: null,
          },
        });
      },
      (err: unknown) => {
        if (cancelled) return;
        setSettled({
          forModel: id,
          health: {
            status: 'down',
            actualModel: '',
            latencyMs: null,
            error: err instanceof Error ? err.message : 'check failed',
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (!id) return IDLE_HEALTH;
  if (settled?.forModel === id) return settled.health;
  return { status: 'checking', actualModel: '', latencyMs: null, error: null };
}

export function isInvestigationActive(status: Investigation['status']): boolean {
  return status === 'pending' || status === 'running';
}

export { triggerInvestigation };
