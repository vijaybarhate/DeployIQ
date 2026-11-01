import type { Investigation } from '../../types/api';

type Status = Investigation['status'];

const STATUS_LABEL: Record<Status, string> = {
  pending: 'queued',
  running: 'started',
  completed: 'completed',
  insufficient_evidence: 'completed with insufficient evidence',
  failed: 'failed',
  validation_failed: 'failed validation',
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function announcementFor(status: Status, id: string): string {
  if (status === 'pending') return `Investigation ${shortId(id)} queued.`;
  if (status === 'running') return `Investigation ${shortId(id)} started.`;
  return `Investigation ${shortId(id)} ${STATUS_LABEL[status]}.`;
}

/**
 * Decides which transitions to announce. State lives outside (per-component ref).
 *
 * - seen: last announced status per investigation id (mutated in place).
 * - createdIds: ids created by an explicit user trigger in this session.
 * - Historical records seen first are recorded silently (no hydration spam).
 * - Newly POST-created investigations announce immediately.
 * - Every transition announces, including consecutive identical messages for
 *   different investigations (ids differ, so messages always differ).
 * - IDs that disappear are pruned so the map cannot grow unboundedly.
 */
export function computeAnnouncements(
  seen: Map<string, Status>,
  current: ReadonlyArray<Pick<Investigation, 'id' | 'status'>>,
  createdIds: ReadonlySet<string>,
): { messages: string[]; announced: Array<{ id: string; status: Status }> } {
  const messages: string[] = [];
  const announced: Array<{ id: string; status: Status }> = [];
  const present = new Set<string>();

  for (const inv of current) {
    present.add(inv.id);
    const last = seen.get(inv.id);
    if (last === undefined) {
      seen.set(inv.id, inv.status);
      if (createdIds.has(inv.id)) {
        messages.push(announcementFor(inv.status, inv.id));
        announced.push({ id: inv.id, status: inv.status });
      }
      continue;
    }
    if (last !== inv.status) {
      seen.set(inv.id, inv.status);
      messages.push(announcementFor(inv.status, inv.id));
      announced.push({ id: inv.id, status: inv.status });
    }
  }
  for (const id of [...seen.keys()]) {
    if (!present.has(id)) seen.delete(id);
  }
  return { messages, announced };
}
