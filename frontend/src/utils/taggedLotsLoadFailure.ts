// The Products page's tagged-stock read (damaged_stock_lots child rows) used
// to swallow every failure into the exact same generic toast -- a 403, a
// 5xx, and a dropped connection all rendered "Failed to load tagged stock"
// with nothing to tell an operator (or a later session reading an owner
// report) which one actually happened. apiFetch (frontend/src/api/http.ts)
// attaches `.status` to every thrown error, so this distinguishes them.
//
// Its own dependency-free file, not inlined in Products.tsx, so it can be
// unit-tested without bundling that component's full import graph (icons,
// CSS side-effect imports, every API module) just to reach one function.
export function describeTaggedLotsLoadFailure(
  error: unknown,
  tr: (key: string, fallbackEn?: string, fallbackKm?: string) => string,
): string {
  const base = tr('stock_tagged_load_failed', 'Failed to load tagged stock')
  const status = Number((error as { status?: unknown } | null)?.status) || 0
  const detail = error instanceof Error ? error.message : ''
  if (status === 403) return `${base} — ${tr('permission_denied', 'You no longer have permission for this action.')}`
  if (status) return `${base} (HTTP ${status}${detail ? `: ${detail}` : ''})`
  return detail ? `${base}: ${detail}` : base
}
