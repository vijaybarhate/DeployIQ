import type { Investigation } from '../../types/api';
import { api } from './client';

export function triggerInvestigation(incidentId: string): Promise<Investigation> {
  return api.post<Investigation>(`/incidents/${encodeURIComponent(incidentId)}/investigations`);
}

export function listInvestigations(incidentId: string): Promise<Investigation[]> {
  return api.get<Investigation[]>(`/incidents/${encodeURIComponent(incidentId)}/investigations`);
}
