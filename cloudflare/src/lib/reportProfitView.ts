// AL finding L4 (13 Oct 2026): the courier's actual cost is an
// administrator-only figure, but a non-admin with the cost-view grant still
// sees cost and profit. Removing the courier-cost keys from such a caller's
// response is not enough: the kernel's profit is
//
//   revenue - cost + delivery fees charged - actual courier cost
//
// and revenue, cost and the delivery fee are all on the same response, so the
// courier cost falls out by subtraction. A cost viewer who is not an
// administrator is therefore sent GOODS profit -- revenue - cost, the basis the
// product rows already use -- with `profit_excludes_delivery: true` so every
// screen can label the figure for what it is. Administrators are untouched.

/** Every key that carries the courier's actual cost, directly or as a difference. */
export const COURIER_COST_KEYS = [
  'delivery_actual_cost_usd', 'delivery_actual_cost_count', 'delivery_margin_usd', 'delivery_net_usd',
  'recognized_delivery_cost_usd', 'pending_delivery_cost_usd',
] as const

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}
// Inputs arrive quantized (cents on a headline, 4 places on a bucket row), so a
// difference of two of them is exact at 4 places; this only clears float noise.
const exact = (value: number): number => Math.round(value * 10_000) / 10_000
const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : null)

/**
 * The cost viewer's money: courier-cost keys removed and every profit figure
 * restated on goods alone. Only keys the row already carries are rewritten,
 * so absence keeps meaning "not sent", and the flag rides only on a row that
 * carried a profit figure.
 */
export function costViewProfit(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const key of COURIER_COST_KEYS) delete out[key]
  const has = (key: string) => typeof out[key] === 'number'
  const restated = has('profit_usd') || has('pending_profit_usd') || has('gross_profit_usd') || has('profit_without_not_paid_usd')
  if (has('profit_usd') && has('cost_usd')) {
    const revenue = num(out.revenue_usd)
    const profit = exact(revenue - num(out.cost_usd))
    out.profit_usd = profit
    if ('margin_pct' in out) out.margin_pct = percent(profit, revenue)
    if (has('profit_after_losses_usd')) out.profit_after_losses_usd = exact(profit - num(out.removal_loss_usd))
  }
  if (has('pending_profit_usd')) out.pending_profit_usd = exact(num(out.pending_revenue_usd) - num(out.pending_cost_usd))
  // Paid-only goods profit: the paid sales' revenue less their cost, so with - without stays the pending figure above.
  if (has('profit_without_not_paid_usd') && has('cost_usd')) {
    out.profit_without_not_paid_usd = exact(num(out.revenue_without_not_paid_usd) - (num(out.cost_usd) - num(out.pending_cost_usd)))
  }
  // A business-summary receipt row: net revenue less its own cost.
  if (has('gross_profit_usd') && has('cost_usd') && has('net_revenue_usd')) {
    out.gross_profit_usd = exact(num(out.net_revenue_usd) - num(out.cost_usd))
  }
  if (restated) out.profit_excludes_delivery = true
  return out
}
