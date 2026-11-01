import type { Investigation } from '../../types/api';
import { api } from './client';

export function triggerInvestigation(incidentId: string, model?: string): Promise<Investigation> {
  const body = model ? { model } : undefined;
  return api.post<Investigation>(
    `/incidents/${encodeURIComponent(incidentId)}/investigations`,
    body,
  );
}

export function listInvestigations(incidentId: string): Promise<Investigation[]> {
  return api.get<Investigation[]>(`/incidents/${encodeURIComponent(incidentId)}/investigations`);
}
