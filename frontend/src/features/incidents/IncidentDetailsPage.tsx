import { useEffect } from 'react';
import { useParams } from 'react-router';

import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/states';
import { isInvestigationActive, useIncident, useInvestigations } from '../../hooks/queries';
import { prefersReducedMotion } from '../../hooks/useNow';
import { IncidentEvidence, IncidentHeader, RawLogs } from './components/IncidentSections';
import { InvestigationWorkbench } from '../investigations/InvestigationWorkbench';

export function IncidentDetailsPage() {
  const { incidentId } = useParams();
  const incident = useIncident(incidentId);
  const history = useInvestigations(incidentId);

  // Status-aware polling: refresh while any investigation is active so the UI
  // follows pending/running -> terminal transitions without manual refresh.
  // Depends on the stable refetch function, not the whole query object.
  const hasActive = (history.data ?? []).some((i) => isInvestigationActive(i.status));
  const { refetch: refetchHistory } = history;
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(() => {
      void refetchHistory();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasActive, refetchHistory]);

  function handleCiteEvidence(anchorId: string) {
    const el = document.getElementById(anchorId);
    if (!(el instanceof HTMLElement)) {
      // Referenced evidence is missing from this investigation's snapshot:
      // do not pretend to navigate anywhere.
      return;
    }
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    el.classList.add('ring-2', 'ring-emerald-500');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-500'), 1600);
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
      <IncidentHeader incident={inc} />
      <IncidentEvidence incident={inc} />
      <RawLogs logs={inc.raw_logs} />
      <section aria-label="Investigation workbench" className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <InvestigationWorkbench
          incidentId={inc.id}
          onInvestigated={() => incident.refetch()}
          onCiteEvidence={handleCiteEvidence}
        />
      </section>
    </div>
  );
}
