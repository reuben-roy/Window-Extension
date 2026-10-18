/**
 * Resolves the `Access-Control-Allow-Origin` value for a request.
 *
 * An empty allowlist keeps the historical behaviour (`*`). Otherwise an entry is
 * either an exact origin or a `<scheme>://*` wildcard, which lets production
 * accept any Chromium extension origin without hard-coding an extension id.
 * Returns null when the origin is not allowed, so no CORS header is sent.
 */
export function resolveCorsOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (allowedOrigins.length === 0) return '*';
  if (!requestOrigin) return null;

  for (const allowed of allowedOrigins) {
    if (allowed === requestOrigin) return requestOrigin;
    if (allowed.endsWith('://*')) {
      const scheme = allowed.slice(0, -1);
      if (requestOrigin.startsWith(scheme) && requestOrigin.length > scheme.length) {
        return requestOrigin;
      }
    }
  }

  return null;
}
