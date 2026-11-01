/** Small time helpers with invalid-input handling (never fabricate). */

export function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole seconds between two epoch-ms timestamps; null when not computable. */
export function elapsedSeconds(fromMs: number | null, nowMs: number): number | null {
  if (fromMs === null || nowMs < fromMs) return null;
  return Math.floor((nowMs - fromMs) / 1000);
}

export function formatElapsed(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
