// Whether a sale can still be returned, shared by every surface that offers
// the Return action (the sale detail modal and the sales receipt view) so the
// two never disagree.
//
// These are the Returns section's own guards restated, not new rules:
//   - a cancelled sale is refused outright by cloudflare/src/routes/returns.ts
//   - NewReturnModal shows each line at `remaining = quantity - already
//     returned`, so a sale whose every line is fully returned opens onto a
//     form with nothing selectable
// Surfacing the reason up front (disabled control + InfoHint) beats letting
// someone walk into a dead-end form or a 4xx.

export type SaleReturnBlockReason = '' | 'cancelled' | 'fully_returned'

type GuardLine = {
  quantity?: number | string | null
  qty?: number | string | null
  returned_quantity?: number | string | null
}

type GuardSale = {
  sale_status?: string | null
  items?: unknown
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseLines(raw: unknown): GuardLine[] {
  if (Array.isArray(raw)) return raw.filter((line): line is GuardLine => !!line && typeof line === 'object')
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((line): line is GuardLine => !!line && typeof line === 'object') : []
  } catch {
    return []
  }
}

export function getSaleReturnBlockReason(sale: GuardSale | null | undefined): SaleReturnBlockReason {
  if (!sale) return ''
  const status = String(sale.sale_status || 'completed')
  if (status === 'cancelled') return 'cancelled'
  if (status === 'returned') return 'fully_returned'
  // `returned_quantity` per line comes from GET /api/sales. A sale whose rows
  // predate it simply reports 0 returned, which errs toward ALLOWING the
  // action -- NewReturnModal then re-reads the real return history and
  // recomputes `remaining` itself, so nothing can be over-returned.
  const lines = parseLines(sale.items).filter((line) => toNumber(line.quantity ?? line.qty) > 0)
  if (!lines.length) return ''
  const allReturned = lines.every((line) => toNumber(line.returned_quantity) >= toNumber(line.quantity ?? line.qty))
  return allReturned ? 'fully_returned' : ''
}
