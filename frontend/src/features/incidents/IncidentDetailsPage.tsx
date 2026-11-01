import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { isInvestigationActive, useIncident, useInvestigations, triggerInvestigation } from '../../hooks/queries';
import { ApiError } from '../../lib/api/client';
import type { Investigation } from '../../types/api';

function StatusBadge({ status }: { status: Investigation['status'] }) {
  const color: Record<Investigation['status'], string> = {
    completed: 'bg-emerald-900 text-emerald-200',
    insufficient_evidence: 'bg-amber-900 text-amber-200',
    failed: 'bg-red-900 text-red-200',
    validation_failed: 'bg-red-900 text-red-200',
    pending: 'bg-slate-700 text-slate-200',
    running: 'bg-blue-900 text-blue-200',
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color[status]}`}>{status}</span>;
}

function evidenceAnchor(investigationId: string, evidenceId: string): string {
  return `evidence-${investigationId}-${evidenceId}`;
}

export function IncidentDetailsPage() {
  const { incidentId } = useParams();
  const incident = useIncident(incidentId);
  const historyQuery = useInvestigations(incidentId);
  const { data: history, refetch: refetchHistory } = historyQuery;
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  // Status-aware polling: refresh while any investigation is active so the UI
  // follows pending/running -> terminal transitions without manual refresh.
  // Depends on the stable refetch function, not the whole query object.
  const hasActive = (history ?? []).some((i) => isInvestigationActive(i.status));
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(() => {
      void refetchHistory();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasActive, refetchHistory]);

  async function onInvestigate() {
    if (!incidentId) return;
    setTriggerError(null);
    setTriggering(true);
    try {
      await triggerInvestigation(incidentId);
      await refetchHistory();
      await incident.refetch();
    } catch (err) {
      // The request may have timed out after the backend accepted it:
      // refresh history first so a created investigation is not hidden.
      await refetchHistory().catch(() => undefined);
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setTriggerError('An investigation is already active for this incident. History refreshed.');
        } else if (err.status === 502) {
          setTriggerError(`Investigation failed on the backend: ${err.message}`);
        } else {
          setTriggerError(err.message);
        }
      } else {
        setTriggerError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setTriggering(false);
    }
  }

  if (incident.isLoading) return <LoadingState message="Loading incident…" />;
  if (incident.isError)
    return (
      <ErrorState
        message={incident.error instanceof Error ? incident.error.message : 'Failed to load incident'}
        onRetry={() => incident.refetch()}
      />
    );
  const inc = incident.data;
  if (!inc) return <EmptyState title="Incident not found" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{inc.title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {inc.project_id} · {inc.source} · {inc.status} · severity {inc.severity ?? 'unclassified'} · observations{' '}
          {inc.observation_count} · matched lines {inc.matched_line_count}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {inc.id} · first seen {inc.first_seen} · last seen {inc.last_seen}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500">signature: {inc.error_signature}</p>
      </div>

      <section aria-label="Incident evidence" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-200">Incident evidence</h2>
        <p className="mt-1 text-xs text-slate-500">
          Original evidence from incident collection (no investigation IDs attached here).
        </p>
        {inc.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No structured evidence recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {inc.evidence.map((e, idx) => (
              <li key={`${e.kind}-${idx}`} className="rounded border border-slate-800 p-2 text-sm">
                <p className="font-mono text-xs text-sky-300">{e.kind}</p>
                <p className="mt-1 text-slate-200">{e.summary}</p>
                {e.detail && <p className="mt-1 text-xs text-slate-400">{e.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Raw logs" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-200">Raw logs</h2>
        {inc.raw_logs ? (
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-xs text-slate-300">
            {inc.raw_logs}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-slate-400">No raw logs captured.</p>
        )}
      </section>

      <section aria-label="Investigation workbench" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-200">Investigation workbench</h2>
          <button
            type="button"
            onClick={onInvestigate}
            disabled={triggering}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {triggering ? 'Investigating…' : 'Run AI investigation'}
          </button>
        </div>
        {triggerError && (
          <p role="alert" className="mt-2 text-sm text-amber-300">
            {triggerError}
          </p>
        )}
        <div className="mt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Investigation history
          </h3>
          {historyQuery.isLoading ? (
            <p className="mt-2 text-sm text-slate-400">Loading history…</p>
          ) : historyQuery.isError ? (
            <p role="alert" className="mt-2 text-sm text-red-300">
              Could not load investigation history:{' '}
              {historyQuery.error instanceof Error ? historyQuery.error.message : 'unknown error'}{' '}
              <button type="button" onClick={() => historyQuery.refetch()} className="underline">
                Retry
              </button>
            </p>
          ) : !history || history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              No investigations yet. Trigger one to generate an evidence-grounded RCA report.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {history.map((inv) => (
                <li key={inv.id} className="rounded border border-slate-800 bg-slate-950 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <StatusBadge status={inv.status} />
                    <span className="font-mono">{inv.id.slice(0, 8)}</span>
                    <span>model: {inv.actual_model || inv.requested_model || '—'}</span>
                    <span>tokens: {inv.total_tokens}</span>
                    <span>duration: {(inv.duration_ms / 1000).toFixed(1)}s</span>
                  </div>
                  {inv.evidence_snapshot.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Evidence snapshot used by this investigation
                      </p>
                      <ul className="mt-1 space-y-1">
                        {inv.evidence_snapshot.map((e) => {
                          const anchor = evidenceAnchor(inv.id, e.id);
                          const highlighted = highlightKey === anchor;
                          return (
                            <li
                              key={e.id}
                              id={anchor}
                              className={`rounded border p-2 text-sm ${
                                highlighted
                                  ? 'border-emerald-500 bg-emerald-950/30'
                                  : 'border-slate-800'
                              }`}
                            >
                              <p className="font-mono text-xs text-emerald-300">
                                {e.id} · {e.kind}
                              </p>
                              <p className="mt-1 text-slate-200">{e.summary}</p>
                              {e.detail && <p className="mt-1 text-xs text-slate-400">{e.detail}</p>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {inv.status === 'completed' && inv.result ? (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-slate-100">
                        {inv.result.root_cause ?? 'No root cause'}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">{inv.result.explanation}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        AI-estimated confidence:{' '}
                        {inv.result.confidence_estimate === null
                          ? 'not enough evidence to estimate'
                          : `${Math.round(inv.result.confidence_estimate * 100)}% — not a calibrated probability`}
                      </p>
                      {inv.result.findings.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Findings
                          </p>
                          <ul className="mt-1 space-y-1">
                            {inv.result.findings.map((f, idx) => (
                              <li key={idx} className="text-sm text-slate-200">
                                {f.description}{' '}
                                {f.evidence_ids.map((eid) => (
                                  <button
                                    key={`${inv.id}-${eid}`}
                                    type="button"
                                    onClick={() => {
                                      const anchor = evidenceAnchor(inv.id, eid);
                                      setHighlightKey(anchor);
                                      document
                                        .getElementById(anchor)
                                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }}
                                    className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-emerald-300 hover:bg-slate-700"
                                    title={`Show cited evidence ${eid} from this investigation`}
                                  >
                                    {eid}
                                  </button>
                                ))}
                                {f.runbook_ids.map((rid) => (
                                  <span
                                    key={rid}
                                    className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-sky-300"
                                    title="Retrieved runbook"
                                  >
                                    {rid}
                                  </span>
                                ))}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {inv.result.recommendations.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Recommendations
                          </p>
                          <ul className="mt-1 space-y-1">
                            {inv.result.recommendations.map((r, idx) => (
                              <li
                                key={idx}
                                className="rounded border border-amber-900 bg-amber-950/30 p-2 text-sm"
                              >
                                <p className="font-medium text-amber-200">
                                  {r.title}{' '}
                                  <span className="ml-1 rounded bg-amber-900 px-1.5 py-0.5 text-[11px]">
                                    APPROVAL REQUIRED
                                  </span>
                                </p>
                                <ul className="mt-1 list-disc pl-5 text-slate-300">
                                  {r.steps.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {inv.result.verification_steps.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Verification
                          </p>
                          <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
                            {inv.result.verification_steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {inv.result.limitations && (
                        <p className="mt-2 text-xs text-slate-400">
                          Limitations: {inv.result.limitations}
                        </p>
                      )}
                    </div>
                  ) : inv.status === 'insufficient_evidence' ? (
                    <p className="mt-2 text-sm text-amber-300">
                      Investigation completed: the evidence was insufficient to establish a root
                      cause. {inv.result?.limitations ?? ''}
                    </p>
                  ) : inv.status === 'failed' || inv.status === 'validation_failed' ? (
                    <p className="mt-2 text-sm text-red-300">
                      Investigation {inv.status === 'failed' ? 'failed' : 'failed validation'}
                      {inv.error_code ? ` (${inv.error_code})` : ''}.
                      {inv.error_message ? ` ${inv.error_message}` : ''} Previous attempts remain
                      available above.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">
                      Investigation {inv.status}… results will appear here when it completes.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
