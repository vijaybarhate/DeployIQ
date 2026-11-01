/** Backend API contract mirror. Keep in sync with backend/schemas/*.py */

export type IncidentSource = 'docker' | 'github_actions';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type InvestigationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'insufficient_evidence'
  | 'failed'
  | 'validation_failed';

export interface IncidentEvidenceItem {
  kind: string;
  summary: string;
  detail: string;
}

export interface EvidenceRef extends IncidentEvidenceItem {
  id: string;
}

export interface RunbookReference {
  runbook_id: string;
  title: string;
  relevance_score: number;
  matched_sections: string[];
  source_urls: string[];
}

export interface Incident {
  id: string;
  source: IncidentSource;
  project_id: string;
  title: string;
  status: IncidentStatus;
  severity: string | null;
  error_signature: string;
  raw_logs: string;
  evidence: IncidentEvidenceItem[];
  first_seen: string;
  last_seen: string;
  observation_count: number;
  matched_line_count: number;
}

export interface InvestigationResult {
  diagnosis_status: 'diagnosed' | 'insufficient_evidence';
  root_cause: string | null;
  explanation: string;
  severity_assessment: string;
  confidence_estimate: number | null;
  confidence_rationale: string;
  findings: Array<{
    description: string;
    evidence_ids: string[];
    runbook_ids: string[];
  }>;
  recommendations: Array<{
    title: string;
    steps: string[];
    risk_level: string;
    requires_approval: boolean;
  }>;
  verification_steps: string[];
  limitations: string;
}

export interface Investigation {
  id: string;
  incident_id: string;
  status: InvestigationStatus;
  requested_model: string;
  actual_model: string;
  prompt_version: string;
  result: InvestigationResult | null;
  evidence_snapshot: EvidenceRef[];
  runbook_snapshot: RunbookReference[];
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms: number;
  error_code: string;
  error_message: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  docker: { connected: boolean; version?: string; error?: string };
}
