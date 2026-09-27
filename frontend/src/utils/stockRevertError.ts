// H-stock 2 (2026-09-27): the Worker's ledger revert
// (cloudflare/src/lib/stockRevert.ts, POST /api/inventory/movements/:id/revert)
// refuses a second revert of the same movement atomically and answers 409 with
// a code. These are the operator's-language texts for those codes; anything
// else keeps the server's message.
export const STOCK_REVERT_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  already_reverted: ['movement_already_reverted', 'This change was already reverted. Nothing was changed.'],
  stock_changed: ['movement_revert_stock_changed', 'The stock changed while this was being reverted. Nothing was changed; refresh and try again.'],
}

export function stockRevertErrorText(error: unknown, tr: (key: string, fallback: string) => string): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const entry = STOCK_REVERT_ERRORS[String(source.code || '')]
  if (entry) return tr(entry[0], entry[1])
  const message = String(source.message ?? source.error ?? '')
  return message || tr('revert_failed', 'Revert failed')
}
