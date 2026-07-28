/** Pure helpers for the audit interceptor — kept separate so they're testable. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_KEYS = ['id', 'entryId', 'paymentId', 'attachmentId', 'reconciliationId'];

/** Pull a UUID record id out of a response body or route params, else null. */
export function pickRecordId(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;
  for (const k of ID_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && UUID_RE.test(v)) return v;
  }
  return null;
}

/**
 * Derive a coarse "table"/domain label from the request path, ignoring the
 * global /api prefix. e.g. "/api/sales/payments" -> "sales".
 */
export function domainFromPath(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  const start = parts[0] === 'api' ? 1 : 0;
  return parts[start] ?? 'unknown';
}

export const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
