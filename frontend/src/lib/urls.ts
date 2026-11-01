/**
 * External URL safety for rendering runbook source links.
 * Only plain http(s) URLs without embedded credentials are accepted.
 * Everything else must render as an unavailable-reference note, never a link.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return false; // eslint-disable-line no-control-regex -- intentional: reject control characters in URLs
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) return false;
  // Reject deceptive URLs carrying credentials or non-host targets.
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (!parsed.hostname) return false;
  return true;
}
