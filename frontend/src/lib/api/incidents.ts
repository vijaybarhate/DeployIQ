import type { HealthStatus, Incident } from '../../types/api';
import { api } from './client';

export function listIncidents(): Promise<Incident[]> {
  return api.get<Incident[]>('/incidents');
}

export function getIncident(id: string): Promise<Incident> {
  return api.get<Incident>(`/incidents/${encodeURIComponent(id)}`);
}

export function getHealth(): Promise<HealthStatus> {
  return api.get<HealthStatus>('/healthz');
}
