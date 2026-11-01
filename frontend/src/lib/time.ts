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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Human-readable local timestamp: "01 Nov 2026, 14:16".
 * Returns the raw value unchanged when it cannot be parsed (never fabricate).
 */
export function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const d = new Date(ms);
  return (
    `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}
