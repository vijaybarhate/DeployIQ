import { useEffect, useRef, useState } from 'react';

import type { Investigation, RunbookReference } from '../../types/api';
import { reportDownloadUrl } from '../../lib/api/console';
import { MissingReferenceNote, RunbookCard } from './RunbookCard';

function investigationAnchor(investigationId: string, evidenceId: string): string {
  return `evidence-${investigationId}-${evidenceId}`;
}

/* Status chips live on the teal report panel: soft light fills, cream text.
   Completed gets lavender (the signature accent), failures get muted red. */
const STATUS_STYLES: Record<Investigation['status'], string> = {
  completed: 'bg-lavender text-ink',
  insufficient_evidence: 'bg-[rgba(255,169,70,0.20)] text-[#FFCF8C]',
  failed: 'bg-[rgba(255,113,133,0.22)] text-[#FFB3BC]',
  validation_failed: 'bg-[rgba(255,113,133,0.22)] text-[#FFB3BC]',
  pending: 'bg-white/10 text-canvas/80',
  running: 'bg-white/10 text-canvas',
};

const STATUS_LABELS: Record<Investigation['status'], string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  insufficient_evidence: 'Insufficient evidence',
  failed: 'Failed',
  validation_failed: 'Validation failed',
};

export function InvestigationStatusBadge({ status }: { status: Investigation['status'] }) {
  // Static badge: the workbench owns the single live announcement region.
  // Exposing text (not color alone) keeps status perceivable without AT.
  return (
    <span
      data-testid="investigation-status-badge"
      title={`Status: ${STATUS_LABELS[status]}`}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] leading-none ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

interface Props {
  investigation: Investigation;
  expanded: boolean;
  nowMs: number;
  onToggle: () => void;
  onCiteEvidence: (anchorId: string) => void;
}

/**
 * One investigation attempt: collapsible teal report panel with its own
 * report + snapshot. Runbook selection lives here (not in the collapsible
 * body) so collapsing and reopening never resets it while the card stays
 * mounted.
 */
export function InvestigationCard({ investigation: inv, expanded, nowMs, onToggle, onCiteEvidence }: Props) {
  const [selectedRunbookId, setSelectedRunbookId] = useState<string | null>(null);

  return (
    <li className="rounded-[28px] bg-teal text-canvas">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} investigation ${inv.id.slice(0, 8)}, status ${STATUS_LABELS[inv.status]}`}
        className="flex w-full flex-wrap items-center gap-2 rounded-t-[28px] px-5 py-4 text-left hover:bg-white/[0.04]"
      >
        <InvestigationStatusBadge status={inv.status} />
        <span className="font-mono text-xs text-canvas/60">{inv.id.slice(0, 8)}</span>
        {inv.status === 'pending' ? (
          <span className="text-xs text-canvas/60">
            Queued — waiting to start · model: {inv.requested_model || '—'}
          </span>
        ) : inv.status === 'running' ? (
          <span className="flex items-center gap-1 text-xs text-lavender">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border-2 border-lavender border-t-transparent motion-safe:animate-spin motion-reduce:animate-none"
            />
            Actively investigating
            <ElapsedSince startIso={inv.started_at} nowMs={nowMs} />
            <span className="text-canvas/60">· model: {inv.actual_model || inv.requested_model || '—'}</span>
          </span>
        ) : (
          <span className="text-xs text-canvas/60">
            model: {inv.actual_model || inv.requested_model || '—'}
          </span>
        )}
        <span className="text-xs text-canvas/60">tokens: {inv.total_tokens}</span>
        <span className="text-xs text-canvas/60">duration: {(inv.duration_ms / 1000).toFixed(1)}s</span>
        <span className="ml-auto text-xs text-canvas/50">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <InvestigationBody
          inv={inv}
          selectedRunbookId={selectedRunbookId}
          onSelectRunbook={setSelectedRunbookId}
          onCiteEvidence={onCiteEvidence}
        />
      )}
    </li>
  );
}

import { elapsedSeconds, formatDateTime, formatElapsed, parseInstant } from '../../lib/time';

function ElapsedSince({ startIso, nowMs }: { startIso: string | null; nowMs: number }) {
  const secs = elapsedSeconds(startIso ? parseInstant(startIso) : null, nowMs);
  if (secs === null) return null;
  const text = formatElapsed(secs);
  return <span aria-label={`elapsed ${text}`}>· {text}</span>;
}

interface BodyProps {
  inv: Investigation;
  selectedRunbookId: string | null;
  onSelectRunbook: (id: string | null) => void;
  onCiteEvidence: (anchorId: string) => void;
}

function InvestigationBody({ inv, selectedRunbookId, onSelectRunbook, onCiteEvidence }: BodyProps) {
  const knownEvidence = new Set((inv.evidence_snapshot ?? []).map((e) => e.id));
  const knownRunbooks = new Map((inv.runbook_snapshot ?? []).map((r) => [r.runbook_id, r]));
  const selectedRunbook: RunbookReference | undefined = selectedRunbookId
    ? knownRunbooks.get(selectedRunbookId)
    : undefined;
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // Move focus to the panel heading when a runbook is selected.
  useEffect(() => {
    if (selectedRunbookId) panelHeadingRef.current?.focus({ preventScroll: true });
  }, [selectedRunbookId]);

  function handlePanelKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'Escape') return;
    // Close the panel and restore focus to the originating chip, which stays mounted.
    const id = selectedRunbookId;
    onSelectRunbook(null);
    if (id) {
      document.getElementById(`runbook-chip-${inv.id}-${id}`)?.focus();
    }
  }

  return (
    <div className="space-y-4 border-t border-white/10 px-5 py-5">
      <p className="text-xs text-canvas/60">
        Prompt {inv.prompt_version} · Created {formatDateTime(inv.created_at)}
        {inv.completed_at ? ` · Completed ${formatDateTime(inv.completed_at)}` : ''}
        {(inv.status === 'completed' || inv.status === 'insufficient_evidence') && (
          <>
            {' · '}
            <a
              href={reportDownloadUrl(inv.incident_id, inv.id)}
              data-tour="workbench-download"
              className="font-semibold text-lavender underline decoration-white/30 underline-offset-4 hover:decoration-lavender"
            >
              Download report (.docx)
            </a>
          </>
        )}
      </p>

      {inv.evidence_snapshot.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/55">
            Evidence snapshot used by this investigation
          </p>
          <ul className="mt-2 space-y-2">
            {inv.evidence_snapshot.map((e) => {
              const anchor = investigationAnchor(inv.id, e.id);
              return (
                <li
                  key={e.id}
                  id={anchor}
                  data-testid={anchor}
                  tabIndex={-1}
                  className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-lavender"
                >
                  <p className="font-mono text-xs text-lavender">
                    {e.id} · {e.kind}
                  </p>
                  <p className="mt-1 text-canvas">{e.summary}</p>
                  {e.detail && <p className="mt-1 text-xs text-canvas/60">{e.detail}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {inv.status === 'completed' && inv.result ? (
        <CompletedReport
          investigationId={inv.id}
          rca={inv.result}
          knownEvidence={knownEvidence}
          knownRunbooks={knownRunbooks}
          selectedRunbookId={selectedRunbookId}
          onSelectRunbook={onSelectRunbook}
          onCiteEvidence={onCiteEvidence}
        />
      ) : inv.status === 'insufficient_evidence' ? (
        <p className="text-sm text-[#FFCF8C]">
          Investigation completed: the evidence was insufficient to establish a root cause.{' '}
          {inv.result?.limitations ?? ''}
        </p>
      ) : inv.status === 'failed' || inv.status === 'validation_failed' ? (
        <p className="text-sm text-[#FFB3BC]">
          Investigation {inv.status === 'failed' ? 'failed' : 'failed validation'}
          {inv.error_code ? ` (${inv.error_code})` : ''}.{inv.error_message ? ` ${inv.error_message}` : ''}{' '}
          Previous attempts remain available above.
        </p>
      ) : (
        <p className="text-sm text-canvas/60">
          Investigation {inv.status}… results will appear here when it completes.
        </p>
      )}

      <div id={`runbook-${inv.id}`} hidden={!selectedRunbookId} onKeyDown={handlePanelKeyDown}>
        {selectedRunbookId && (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/55">
              Referenced runbook
            </p>
            <div className="mt-2">
              {selectedRunbook ? (
                <RunbookCard
                  runbook={selectedRunbook}
                  headingRef={panelHeadingRef}
                  panelId={`runbook-panel-${inv.id}`}
                />
              ) : (
                <MissingReferenceNote kind="Runbook" id={selectedRunbookId} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface CompletedProps {
  investigationId: string;
  rca: NonNullable<Investigation['result']>;
  knownEvidence: Set<string>;
  knownRunbooks: Map<string, RunbookReference>;
  selectedRunbookId: string | null;
  onCiteEvidence: (anchorId: string) => void;
  onSelectRunbook: (id: string | null) => void;
}

function CompletedReport({
  investigationId: invId,
  rca,
  knownEvidence,
  knownRunbooks,
  selectedRunbookId,
  onCiteEvidence,
  onSelectRunbook,
}: CompletedProps) {
  return (
    <div data-tour="workbench-report">
      <p className="font-display text-[24px] leading-[1.2] font-medium tracking-[-0.02em] text-canvas">
        {rca.root_cause ?? 'No root cause'}
      </p>
      <p className="mt-1.5 text-sm text-canvas/80">{rca.explanation}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-canvas">
          {rca.severity_assessment}
        </span>
        <span className="text-canvas/60">
          AI-estimated confidence:{' '}
          {rca.confidence_estimate === null
            ? 'not enough evidence to estimate'
            : `${Math.round(rca.confidence_estimate * 100)}% — not a calibrated probability`}
        </span>
      </div>
      {rca.confidence_rationale && (
        <p className="mt-1 text-xs text-canvas/55">Basis: {rca.confidence_rationale}</p>
      )}
      {rca.findings.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/55">Findings</p>
          <ul className="mt-2 space-y-2">
            {rca.findings.map((f, idx) => (
              <li key={idx} className="text-sm text-canvas">
                {f.description}{' '}
                {f.evidence_ids.map((eid) =>
                  knownEvidence.has(eid) ? (
                    <button
                      key={`${invId}-${eid}`}
                      type="button"
                      onClick={() => onCiteEvidence(investigationAnchor(invId, eid))}
                      className="ml-1 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-xs text-lavender hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
                      title={`Show cited evidence ${eid} from this investigation`}
                    >
                      {eid}
                    </button>
                  ) : (
                    <MissingReferenceNote key={`${invId}-${eid}`} kind="Evidence" id={eid} />
                  ),
                )}
                {f.runbook_ids.map((rid) =>
                  knownRunbooks.has(rid) ? (
                    <button
                      key={`${invId}-${rid}`}
                      id={`runbook-chip-${invId}-${rid}`}
                      type="button"
                      aria-expanded={selectedRunbookId === rid}
                      aria-controls={`runbook-${invId}`}
                      onClick={() => onSelectRunbook(selectedRunbookId === rid ? null : rid)}
                      className="ml-1 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-xs text-lavender hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender"
                      title={`Show retrieved runbook ${rid} from this investigation`}
                    >
                      {rid}
                    </button>
                  ) : (
                    <MissingReferenceNote key={`${invId}-${rid}`} kind="Runbook" id={rid} />
                  ),
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rca.recommendations.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/55">Recommendations</p>
          <ul className="mt-2 space-y-2">
            {rca.recommendations.map((r, idx) => (
              <li key={idx} className="rounded-2xl border border-[rgba(255,169,70,0.35)] bg-[rgba(255,169,70,0.10)] p-3 text-sm">
                <p className="font-semibold text-[#FFCF8C]">
                  {r.title}{' '}
                  {r.requires_approval ? (
                    <span className="ml-1 rounded-full bg-[#FFA946] px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] text-ink">
                      APPROVAL REQUIRED
                    </span>
                  ) : (
                    <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-canvas/75">
                      no approval recorded — treat as requiring approval
                    </span>
                  )}
                  <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-canvas/75">
                    risk: {r.risk_level}
                  </span>
                </p>
                <ul className="mt-1.5 list-disc pl-5 text-canvas/80">
                  {r.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rca.verification_steps.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-canvas/55">Verification</p>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-canvas/80">
            {rca.verification_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {rca.limitations && (
        <p className="mt-3 text-xs text-canvas/55">Limitations: {rca.limitations}</p>
      )}
    </div>
  );
}
