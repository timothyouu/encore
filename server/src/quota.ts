export class QuotaStoppedError extends Error {
  constructor() { super('Gemini quota reached. Provider calls stopped until restart; no paid fallback.'); }
}
export function isQuotaError(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const error = value as Record<string, unknown>;
  return value instanceof QuotaStoppedError || error.status === 429 || error.code === 429 ||
    error.status === 'RESOURCE_EXHAUSTED' || error.code === 'RESOURCE_EXHAUSTED' ||
    (typeof error.message === 'string' && /RESOURCE_EXHAUSTED|\b429\b|quota.*exceed/i.test(error.message)) ||
    isQuotaError(error.cause, seen) || isQuotaError(error.error, seen);
}