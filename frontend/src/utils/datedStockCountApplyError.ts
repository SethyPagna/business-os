// H-stock 1 (2026-09-27): the Worker applies a dated stock count as ONE
// atomic batch (cloudflare/src/lib/datedStockCountApply.ts) and refuses a
// double submit or a stale plan with 409 code dated_stock_count_conflict,
// nothing written. This is the operator's-language text for that code;
// anything else keeps the server's message.
export const DATED_STOCK_COUNT_APPLY_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  dated_stock_count_conflict: ['dated_count_apply_conflict', 'The stock count history for these products changed while this import was being applied. Nothing was changed; preview and apply again.'],
}

export function datedStockCountApplyErrorText(error: unknown, tr: (key: string, fallback: string) => string): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const entry = DATED_STOCK_COUNT_APPLY_ERRORS[String(source.code || '')]
  if (entry) return tr(entry[0], entry[1])
  const message = String(source.message ?? source.error ?? '')
  return message || tr('dated_count_apply_failed', 'The import failed to apply.')
}
