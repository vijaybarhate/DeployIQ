import { useState } from 'react';

import { ApiError } from '../../lib/api/client';
import { triggerInvestigation, useInvestigations } from '../../hooks/queries';
import type { Investigation } from '../../types/api';
import { InvestigationCard } from './InvestigationCard';

interface Props {
  incidentId: string;
  onInvestigated: () => void;
  onCiteEvidence: (anchorId: string) => void;
}

/** Trigger + collapsible per-attempt history. Latest attempt expanded by default. */
export function InvestigationWorkbench({ incidentId, onInvestigated, onCiteEvidence }: Props) {
  const history = useInvestigations(incidentId);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  async function onInvestigate() {
    setTriggerError(null);
    setTriggering(true);
    try {
      await triggerInvestigation(incidentId);
      await history.refetch();
      onInvestigated();
    } catch (err) {
      // The request may have timed out after the backend accepted it:
      // refresh history first so a created investigation is not hidden.
      await history.refetch().catch(() => undefined);
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

  const items = history.data ?? [];
  const isCollapsed = (inv: Investigation, index: number) =>
    collapsed[inv.id] ?? index !== 0;

  return (
    <div>
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
        {history.isLoading ? (
          <p className="mt-2 text-sm text-slate-400">Loading history…</p>
        ) : history.isError ? (
          <p role="alert" className="mt-2 text-sm text-red-300">
            Could not load investigation history:{' '}
            {history.error instanceof Error ? history.error.message : 'unknown error'}{' '}
            <button type="button" onClick={() => history.refetch()} className="underline">
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No investigations yet. Trigger one to generate an evidence-grounded RCA report.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {items.map((inv, index) => (
              <InvestigationCard
                key={inv.id}
                investigation={inv}
                expanded={!isCollapsed(inv, index)}
                onToggle={() =>
                  setCollapsed((prev) => ({ ...prev, [inv.id]: !isCollapsed(inv, index) }))
                }
                onCiteEvidence={onCiteEvidence}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
