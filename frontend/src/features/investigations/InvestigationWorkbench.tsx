import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api/client';
import { triggerInvestigation, useInvestigations, isInvestigationActive } from '../../hooks/queries';
import { useNow } from '../../hooks/useNow';
import type { Investigation } from '../../types/api';
import { computeAnnouncements, pruneCreatedIds } from './announcements';
import { InvestigationCard } from './InvestigationCard';

interface Props {
  incidentId: string;
  onInvestigated: () => void;
  onCiteEvidence: (anchorId: string) => void;
  /** Test seam: fixed clock value instead of the ticking shared clock. */
  nowMs?: number;
}

/** Trigger + collapsible per-attempt history. Latest attempt expanded by default. */
export function InvestigationWorkbench({ incidentId, onInvestigated, onCiteEvidence, nowMs }: Props) {
  const history = useInvestigations(incidentId);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState('');
  const seenStatuses = useRef(new Map<string, Investigation['status']>());
  const createdIds = useRef(new Set<string>());
  // Consecutive polls where a triggered ID never appears; dropped after the cap.
  const createdMisses = useRef(new Map<string, number>());
  // Re-render trigger so the bounded polling interval below starts/stops
  // as the pending set changes (refs alone do not trigger renders).
  const [pendingCount, setPendingCount] = useState(0);
  // Latest refetch helpers (stable across renders for the interval closure).
  const refetchRef = useRef(history.refetch);
  const fetchingRef = useRef(history.isFetching);
  useEffect(() => {
    refetchRef.current = history.refetch;
    fetchingRef.current = history.isFetching;
  });

  const hasActive = (history.data ?? []).some((i) => isInvestigationActive(i.status));
  // One shared clock for elapsed-time display; ticks only while active.
  // nowMs override exists for deterministic tests.
  const tickNow = useNow(hasActive);
  const now = nowMs ?? tickNow;

  // Announce genuine transitions only — never on initial hydration, never
  // repeats for unchanged statuses. Newly POST-created investigations announce
  // immediately; historical records stay silent. Announced and never-appearing
  // ids are dropped so the pending set cannot grow unboundedly.
  // Depends on dataUpdatedAt (not just data reference): React Query keeps the
  // same data reference when a refetch returns structurally identical data,
  // but dataUpdatedAt bumps on every SUCCESSFUL refresh. Failed requests do
  // not bump it and isSuccess is false, so they are never counted as misses.
  // The pending count uses a functional update and is NOT a dependency:
  // otherwise the state update itself would re-run this effect and count the
  // same refresh twice, expiring ghosts early.
  // eslint-disable-next-line react/set-state-in-effect -- intentional: announce polled transitions
  useEffect(() => {
    if (!history.isSuccess) return;
    const items = history.data;
    if (!items) return;
    const { messages, announced } = computeAnnouncements(
      seenStatuses.current,
      items,
      createdIds.current,
    );
    pruneCreatedIds(
      createdIds.current,
      createdMisses.current,
      new Set(items.map((i) => i.id)),
      new Set(announced.map((a) => a.id)),
    );
    const pending = createdIds.current.size;
    setPendingCount((current) => (current === pending ? current : pending));
    if (messages.length > 0) setAnnouncement(messages.join(' '));
  }, [history.data, history.dataUpdatedAt, history.isSuccess]);

  // Bounded self-polling: while POST-created IDs are still pending, keep
  // scheduling successful refreshes even if the parent page stopped polling
  // (e.g. history holds only terminal investigations). Stops as soon as the
  // pending set empties via announcement or expiry. Skips ticks while a
  // request is already in flight so requests never overlap.
  useEffect(() => {
    if (pendingCount === 0) return;
    const id = window.setInterval(() => {
      if (!fetchingRef.current) void refetchRef.current();
    }, 5000);
    return () => window.clearInterval(id);
  }, [pendingCount]);

  async function onInvestigate() {
    setTriggerError(null);
    setTriggering(true);
    try {
      const created = await triggerInvestigation(incidentId);
      // Mark user-created attempts so the announcer treats them as new,
      // not as pre-existing history. Sync the pending count immediately —
      // before the refresh below — so self-polling starts even when that
      // first refresh fails.
      if (created && typeof created.id === 'string') {
        createdIds.current.add(created.id);
        setPendingCount(createdIds.current.size);
      }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-200">Investigation workbench</h2>
        <button
          type="button"
          onClick={onInvestigate}
          disabled={triggering}
          data-tour="workbench-trigger"
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {triggering ? 'Investigating…' : 'Run AI investigation'}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        One active investigation at a time — every attempt keeps its own evidence and runbook
        snapshots below.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {triggerError && (
        <p role="alert" className="mt-2 text-sm text-amber-300">
          {triggerError}
        </p>
      )}
      <div className="mt-3" data-tour="workbench-history">
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
