// KHQR S6b: a customer return whose refund goes back through ABA (returns.refund_channel = 'aba', migration 0293). Owner ruling 10 Nov 2026: shifts are only for understanding, so
// such a refund moves the refunded / revenue / profit figures and NEVER a drawer figure (lib/shiftReconciliation.ts reads refund_channel 'aba' as no cash out).
// The refund is the Records of the return itself: it writes no refund_noted Record. The Reports block "Refunds sent through ABA" reads two disjoint sources: the refund_noted
// notes staff wrote for a refund sent outside a return, and these returns (lib/onlineOrderReceived.ts). Nothing writes both, so nothing counts twice.
import type { D1Compat } from './db'

export type AbaRefundPlan = { ok: true; orderId: number } | { ok: false; status: 400 | 409; code: string; error: string }

/**
 * The checks before an ABA refund return is written: the sale fulfilled an online order, and the dollars this return sends back through ABA fit in what the customer paid
 * online less what earlier ABA returns and staff refund notes already sent. `cashRefundUsd` is the cash part of the refund (the part above any debt it lowered).
 */
export async function planAbaRefund(db: D1Compat, input: { saleId: number | null; cashRefundUsd: number }): Promise<AbaRefundPlan> {
  if (!input.saleId) return { ok: false, status: 400, code: 'refund_channel_requires_online_order', error: 'Only a return against a sale of an online order can be refunded through ABA.' }
  const row = await db.prepare(`SELECT o.id,
      (SELECT COALESCE(SUM(COALESCE(p.paid_amount, p.amount)), 0) FROM online_order_payments p WHERE p.order_id = o.id AND p.state = 'paid') AS paid_usd,
      (SELECT COALESCE(SUM(r.total_refund_usd - COALESCE(r.owed_reduction_usd, 0)), 0) FROM returns r WHERE r.sale_id = o.sale_id AND r.refund_channel = 'aba' AND COALESCE(r.status, 'completed') <> 'cancelled') AS aba_usd,
      (SELECT COALESCE(SUM(e.amount_usd), 0) FROM online_order_events e WHERE e.order_id = o.id AND e.event = 'refund_noted') AS noted_usd
    FROM online_orders o WHERE o.sale_id = @sale`).get<{ id: number; paid_usd: number; aba_usd: number; noted_usd: number }>({ sale: input.saleId }).catch(() => null)
  if (!row) return { ok: false, status: 400, code: 'refund_channel_requires_online_order', error: 'Only a return against a sale of an online order can be refunded through ABA.' }
  const left = Math.round((Number(row.paid_usd) - Number(row.aba_usd) - Number(row.noted_usd)) * 10000) / 10000
  if (input.cashRefundUsd > left + 0.00005) {
    return { ok: false, status: 409, code: 'aba_refund_over_online', error: `Only ${Math.max(0, left).toFixed(2)} USD of what the customer paid online is left to refund through ABA.` }
  }
  return { ok: true, orderId: Number(row.id) }
}
