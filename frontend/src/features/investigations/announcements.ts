import type { Investigation } from '../../types/api';

export type InvestigationStatus = Investigation['status'];

const TRANSITION_MESSAGES: Record<Investigation['status'], string> = {
  pending: 'Investigation queued.',
  running: 'Investigation started.',
  completed: 'Investigation completed.',
  insufficient_evidence: 'Investigation completed with insufficient evidence.',
  failed: 'Investigation failed.',
  validation_failed: 'Investigation validation failed.',
};

/**
 * Pure announcement planner: decides which status changes to announce.
 *
 * - seen: last announced status per investigation id (persist across renders).
 * - createdIds: ids created by an explicit user trigger in this session.
 * - Historical records seen for the first time are recorded silently
 *   (no hydration spam).
 * - A freshly POST-created investigation is announced immediately, even on
 *   first sight (it is new, not history).
 * - Only actual transitions generate messages; repeated polls are silent.
 * - Identical messages for *different* investigations are each announced once.
 */
export function computeAnnouncements(
  seen: Map<string, Investigation['status']>,
  current: Pick<Investigation, 'id' | 'status'>[],
  createdIds: ReadonlySet<string>,
): { messages: string[]; announced: Array<{ id: string; status: Investigation['status'] }> } {
  const messages: string[] = [];
  const announced: Array<{ id: string; status: Investigation['status'] }> = [];
  const present = new Set<string>();

  for (const inv of current) {
    present.add(inv.id);
    const last = seen.get(inv.id);
    if (last === undefined) {
      if (createdIds.has(inv.id)) {
        const text = TRANSITION_MESSAGES[inv.status];
        if (text) {
          messages.push(text);
          announced.push({ id: inv.id, status: inv.status });
        }
      }
      seen.set(inv.id, inv.status);
      continue;
    }
    if (last !== inv.status) {
      seen.set(inv.id, inv.status);
      const text = TRANSITION_MESSAGES[inv.status];
      if (text) {
        messages.push(text);
        announced.push({ id: inv.id, status: inv.status });
      }
    }
  }
  for (const id of [...seen.keys()]) {
    if (!present.has(id)) seen.delete(id);
  }
  return { messages, announced };
}

export function announcementText(status: Investigation['status']): string | null {
  return TRANSITION_MESSAGES[status] ?? null;
}
