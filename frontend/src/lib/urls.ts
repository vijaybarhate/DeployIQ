/**
 * External URL safety for rendering runbook source links.
 * Only plain http(s) URLs without embedded credentials are accepted.
 * Everything else must render as an unavailable-reference note, never a link.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Returns the trimmed URL if safe, otherwise null. */
export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Check the ORIGINAL string: trim() strips \n \t \r, which must fail validation.
  // eslint-disable-next-line no-control-regex -- intentional: reject control characters in URLs
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) return null;
  // Deceptive credentials or missing host: not a safe link target.
  if (parsed.username !== '' || parsed.password !== '' || !parsed.hostname) return null;
  return trimmed;
}

export function isSafeHttpUrl(raw: unknown): boolean {
  return normalizeHttpUrl(raw) !== null;
}
