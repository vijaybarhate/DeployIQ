import type { Investigation } from '../../types/api';

function investigationAnchor(investigationId: string, evidenceId: string): string {
  return `evidence-${investigationId}-${evidenceId}`;
}

const STATUS_STYLES: Record<Investigation['status'], string> = {
  completed: 'bg-emerald-900 text-emerald-200',
  insufficient_evidence: 'bg-amber-900 text-amber-200',
  failed: 'bg-red-900 text-red-200',
  validation_failed: 'bg-red-900 text-red-200',
  pending: 'bg-slate-700 text-slate-200',
  running: 'bg-blue-900 text-blue-200',
};

export function InvestigationStatusBadge({ status }: { status: Investigation['status'] }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

interface Props {
  investigation: Investigation;
  expanded: boolean;
  onToggle: () => void;
  onCiteEvidence: (anchorId: string) => void;
}

/** One investigation attempt: collapsible card with its own report + snapshot. */
export function InvestigationCard({ investigation: inv, expanded, onToggle, onCiteEvidence }: Props) {
  return (
    <li className="rounded border border-slate-800 bg-slate-950">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-900"
      >
        <InvestigationStatusBadge status={inv.status} />
        <span className="font-mono text-xs text-slate-400">{inv.id.slice(0, 8)}</span>
        <span className="text-xs text-slate-400">
          model: {inv.actual_model || inv.requested_model || '—'}
        </span>
        <span className="text-xs text-slate-400">tokens: {inv.total_tokens}</span>
        <span className="ml-auto text-xs text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <InvestigationBody inv={inv} onCiteEvidence={onCiteEvidence} />}
    </li>
  );
}

function InvestigationBody({
  inv,
  onCiteEvidence,
}: Pick<Props, 'onCiteEvidence'> & { inv: Investigation }) {
  return (
    <div className="space-y-3 border-t border-slate-800 px-3 py-3">
      <p className="text-xs text-slate-400">
        Duration: {(inv.duration_ms / 1000).toFixed(1)}s · Prompt {inv.prompt_version} · Created{' '}
        {inv.created_at}
        {inv.completed_at ? ` · Completed ${inv.completed_at}` : ''}
      </p>

      {inv.evidence_snapshot.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Evidence snapshot used by this investigation
          </p>
          <ul className="mt-1 space-y-1">
            {inv.evidence_snapshot.map((e) => {
              const anchor = investigationAnchor(inv.id, e.id);
              return (
                <li
                  key={e.id}
                  id={anchor}
                  data-testid={anchor}
                  className="rounded border border-slate-800 p-2 text-sm"
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
        <CompletedReport
          investigationId={inv.id}
          rca={inv.result}
          onCiteEvidence={onCiteEvidence}
        />
      ) : inv.status === 'insufficient_evidence' ? (
        <p className="text-sm text-amber-300">
          Investigation completed: the evidence was insufficient to establish a root cause.{' '}
          {inv.result?.limitations ?? ''}
        </p>
      ) : inv.status === 'failed' || inv.status === 'validation_failed' ? (
        <p className="text-sm text-red-300">
          Investigation {inv.status === 'failed' ? 'failed' : 'failed validation'}
          {inv.error_code ? ` (${inv.error_code})` : ''}.{inv.error_message ? ` ${inv.error_message}` : ''}{' '}
          Previous attempts remain available above.
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          Investigation {inv.status}… results will appear here when it completes.
        </p>
      )}
    </div>
  );
}

function CompletedReport({
  investigationId,
  rca,
  onCiteEvidence,
}: {
  investigationId: string;
  rca: NonNullable<Investigation['result']>;
  onCiteEvidence: (anchorId: string) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-100">{rca.root_cause ?? 'No root cause'}</p>
      <p className="mt-1 text-sm text-slate-300">{rca.explanation}</p>
      <p className="mt-1 text-xs text-slate-400">
        AI-estimated confidence:{' '}
        {rca.confidence_estimate === null
          ? 'not enough evidence to estimate'
          : `${Math.round(rca.confidence_estimate * 100)}% — not a calibrated probability`}
      </p>
      {rca.confidence_rationale && (
        <p className="mt-1 text-xs text-slate-400">Basis: {rca.confidence_rationale}</p>
      )}
      {rca.findings.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Findings</p>
          <ul className="mt-1 space-y-1">
            {rca.findings.map((f, idx) => (
              <li key={idx} className="text-sm text-slate-200">
                {f.description}{' '}
                {f.evidence_ids.map((eid) => (
                  <button
                    key={`${investigationId}-${eid}`}
                    type="button"
                    onClick={() => onCiteEvidence(investigationAnchor(investigationId, eid))}
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
      {rca.recommendations.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Recommendations</p>
          <ul className="mt-1 space-y-1">
            {rca.recommendations.map((r, idx) => (
              <li key={idx} className="rounded border border-amber-900 bg-amber-950/30 p-2 text-sm">
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
      {rca.verification_steps.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Verification</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
            {rca.verification_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {rca.limitations && (
        <p className="mt-2 text-xs text-slate-400">Limitations: {rca.limitations}</p>
      )}
    </div>
  );
}
