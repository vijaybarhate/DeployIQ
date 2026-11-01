import { useQuery } from '@tanstack/react-query';

import { containerLogs, listContainers, listModels } from '../lib/api/console';
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
    refetchInterval: 10_000,
    retry: false,
  });
}

export function isInvestigationActive(status: Investigation['status']): boolean {
  return status === 'pending' || status === 'running';
}

export { triggerInvestigation };
