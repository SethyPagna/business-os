// Online orders (KHQR lane, slice S5): the retention scrub for orders that were never paid.
//
// An order that ends expired, cancelled or qr_failed and never took any money holds a stranger's name, phone, address and social handles for no business reason.
// After `onlineOrderScrubAfterDays` (planTier, 90 on both plans) since it last changed, those fields are overwritten and `scrubbed_at` is set; the row itself, its
// items, totals and Records stay (the shop still counts how many orders were started), and one `scrubbed` Records row says when. Free text staff typed into that
// order's Records rows (the public comment and the internal note) is cleared with it, because it can repeat the customer's details.
//
// What is NEVER scrubbed here: an order that is paid, in review, fulfilled, or that has any payment with money on it (paid, review, a paid_at or a paid_amount),
// or that is linked to a sale. Those are business records; their retention belongs to the sale.
//
// One bounded job per rotation step: a candidate list over the partial index idx_online_orders_scrub, then ONE batch for the whole round. Every statement carries the
// full guard again, so an order that was paid (a late callback) or touched between the list and the batch is left alone, and running twice changes nothing.

import type { D1Compat } from './db'
import type { Env } from '../index'
import { getPlanLimits } from './planTier'

export const SCRUBBABLE_STATES = ['expired', 'cancelled', 'qr_failed'] as const
/** What replaces the text fields that cannot be empty (name, phone, and the address of a delivery order). Not translated: it is a marker, not wording. */
export const SCRUB_MARKER = '[scrubbed]'
/** Rounds per run: a backlog drains over several runs, one run never spends more than this many D1 calls on it. */
const MAX_ROUNDS = 3

const sqlTime = (date: Date): string => date.toISOString().replace('T', ' ').replace('Z', '')

export type ScrubDeps = { db: D1Compat; env: Env; now: () => Date }
export type ScrubSummary = { scrubbed: number; rounds: number }

/** True money anywhere on the order: the guard shared by the candidate list and every statement of the batch. */
const NEVER_PAID = `sale_id IS NULL AND paid_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM online_order_payments p WHERE p.order_id = online_orders.id AND (p.state IN ('paid','review') OR p.paid_at IS NOT NULL OR p.paid_amount IS NOT NULL))`

const STATES_SQL = SCRUBBABLE_STATES.map((state) => `'${state}'`).join(',')

export async function scrubUnpaidOrders(deps: ScrubDeps): Promise<ScrubSummary> {
  const limits = getPlanLimits(deps.env)
  const now = deps.now()
  const cutoff = sqlTime(new Date(now.getTime() - limits.onlineOrderScrubAfterDays * 86_400_000))
  const at = sqlTime(now)
  const summary: ScrubSummary = { scrubbed: 0, rounds: 0 }
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const candidates = await deps.db.prepare(`
      SELECT id FROM online_orders INDEXED BY idx_online_orders_scrub
      WHERE scrubbed_at IS NULL AND state IN (${STATES_SQL}) AND updated_at <= @cutoff AND ${NEVER_PAID}
      ORDER BY updated_at ASC, id ASC LIMIT @limit
    `).all<{ id: number }>({ cutoff, limit: limits.onlineOrderSweepMaxPerTick })
    if (!candidates.length) break
    summary.rounds += 1
    const statements = candidates.flatMap(({ id }) => {
      const params = { id, cutoff, at }
      const stillScrubbable = `scrubbed_at IS NULL AND state IN (${STATES_SQL}) AND updated_at <= @cutoff AND ${NEVER_PAID}`
      const justScrubbed = `EXISTS (SELECT 1 FROM online_orders WHERE id = @id AND scrubbed_at = @at)`
      return [
        {
          sql: `UPDATE online_orders SET customer_name = '${SCRUB_MARKER}', customer_phone = '${SCRUB_MARKER}',
                  customer_address = CASE WHEN fulfilment = 'delivery' THEN '${SCRUB_MARKER}' ELSE NULL END,
                  contact_telegram = NULL, contact_instagram = NULL, contact_facebook = NULL, contact_tiktok = NULL, contact_whatsapp = NULL, contact_other = NULL,
                  note = NULL, network_key = NULL, scrubbed_at = @at, revision = revision + 1, updated_at = @at
                WHERE id = @id AND ${stillScrubbable}`,
          params,
        },
        {
          sql: `INSERT INTO online_order_events (order_id, event, source, detail_json, created_at)
                SELECT @id, 'scrubbed', 'sweep', json_object('after_days', @days), @at WHERE ${justScrubbed}`,
          params: { id, at, days: limits.onlineOrderScrubAfterDays },
        },
        {
          sql: `UPDATE online_order_events SET public_comment = NULL, internal_note = NULL
                WHERE order_id = @id AND (public_comment IS NOT NULL OR internal_note IS NOT NULL) AND ${justScrubbed}`,
          params: { id, at },
        },
      ]
    })
    await deps.db.batch(statements)
    const done = await deps.db.prepare(`SELECT COUNT(*) AS n FROM online_orders WHERE scrubbed_at = @at`).get<{ n: number }>({ at })
    summary.scrubbed = Number(done?.n ?? 0)
    if (candidates.length < limits.onlineOrderSweepMaxPerTick) break
  }
  return summary
}
