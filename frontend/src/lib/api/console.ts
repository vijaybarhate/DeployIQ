import type {
  ContainerLogs,
  CopilotAnswer,
  DockerContainer,
  FreeModel,
  Incident,
} from '../../types/api';
import { api } from './client';

export function listContainers(): Promise<DockerContainer[]> {
  return api.get<DockerContainer[]>('/docker/containers');
}

export function containerLogs(name: string, tail = 200): Promise<ContainerLogs> {
  return api.get<ContainerLogs>(
    `/docker/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,
  );
}

export function listModels(): Promise<FreeModel[]> {
  return api.get<FreeModel[]>('/models');
}

export interface ManualIngest {
  project_id: string;
  raw_logs: string;
  container_name?: string;
}

export function manualIngest(payload: ManualIngest): Promise<Incident> {
  return api.post<Incident>('/incidents/manual', payload);
}

export interface CopilotAsk {
  question: string;
  incident_id?: string;
  model?: string;
}

export function askCopilot(payload: CopilotAsk): Promise<CopilotAnswer> {
  return api.post<CopilotAnswer>('/copilot/ask', payload);
}

export function reportDownloadUrl(incidentId: string, investigationId: string): string {
  const base = import.meta.env.VITE_API_URL ?? '/api/v1';
  return (
    `${base}/incidents/${encodeURIComponent(incidentId)}` +
    `/investigations/${encodeURIComponent(investigationId)}/report`
  );
}
