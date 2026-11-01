import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api/client';
import { triggerInvestigation, useInvestigations, isInvestigationActive } from '../../hooks/queries';
import { useNow } from '../../hooks/useNow';
import type { Investigation } from '../../types/api';
import { InvestigationCard } from './InvestigationCard';

interface Props {
  incidentId: string;
  onInvestigated: () => void;
  onCiteEvidence: (anchorId: string) => void;
}

const STATUS_ANNOUNCEMENTS: Record<Investigation['status'], string | null> = {
  pending: 'Investigation queued.',
  running: 'Investigation started.',
  completed: 'Investigation completed.',
  insufficient_evidence: 'Investigation completed with insufficient evidence.',
  failed: 'Investigation failed.',
  validation_failed: 'Investigation failed validation.',
};

function announceFor(status: Investigation['status']): string | null {
  return STATUS_ANNOUNCEMENTS[status] ?? null;
}

/** Trigger + collapsible per-attempt history. Latest attempt expanded by default. */
export function InvestigationWorkbench({ incidentId, onInvestigated, onCiteEvidence }: Props) {
  const history = useInvestigations(incidentId);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState('');
  const seenStatuses = useRef(new Map<string, Investigation['status']>());

  const hasActive = (history.data ?? []).some((i) => isInvestigationActive(i.status));
  // One shared clock for elapsed-time display; ticks only while something is active.
  const now = useNow(hasActive);

  // Announce genuine transitions only — never on initial hydration, never repeats.
  // Announce genuine transitions only — never on initial hydration, never
  // repeats for unchanged statuses.
  useEffect(() => {
    const items = history.data;
    if (!items) return;
    const prev = seenStatuses.current;
    const messages: string[] = [];
    for (const inv of items) {
      const last = prev.get(inv.id);
      if (last === undefined) {
        // First sight of this investigation: record silently (no hydration spam).
        prev.set(inv.id, inv.status);
        continue;
      }
      if (last !== inv.status) {
        prev.set(inv.id, inv.status);
        const text = announceFor(inv.status);
        if (text) messages.push(text);
      }
    }
    // Drop IDs that no longer exist so the map cannot grow unboundedly.
    for (const id of [...prev.keys()]) {
      if (!items.some((i) => i.id === id)) prev.delete(id);
    }
    // oxlint flags setState-in-effect; assigning then announcing in the same
    // effect is the correct pattern for derived announcements from polling.
    // eslint-disable-next-line react/set-state-in-effect
    if (messages.length > 0) setAnnouncement(messages.join(' '));
  }, [history.data]);

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
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
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
                nowMs={now}
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
