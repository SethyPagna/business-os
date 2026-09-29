// The Worker holds approval until each row carrying one of these has a
// decision (PRODUCT_REVIEW_WARNING_KINDS in cloudflare/src/lib/importReviewQuery.ts).
export const PRODUCT_DECISION_WARNING_KINDS = ['negative_stock', 'barcode_collision', 'sku_collision', 'stock_receipt'] as const

type ReviewRowWarnings = { warnings?: Array<{ kind?: string }> }

const hasWarningKind = (row: ReviewRowWarnings, kinds: readonly string[]): boolean =>
  (row.warnings || []).some((warning) => kinds.includes(String(warning.kind || '')))

export function productRowNeedsDecision(row: ReviewRowWarnings): boolean {
  return hasWarningKind(row, PRODUCT_DECISION_WARNING_KINDS)
}

export function productRowIsStockReceipt(row: ReviewRowWarnings): boolean {
  return hasWarningKind(row, ['stock_receipt'])
}

export const KEEP_STOCK_DECISION = { action: 'apply', field_overrides: { _action: 'override_replace' } } as const

export function isKeepStockDecision(decision: { action?: string; field_overrides?: Record<string, unknown> } | null | undefined): boolean {
  return decision?.action === 'apply' && decision.field_overrides?._action === 'override_replace'
}
