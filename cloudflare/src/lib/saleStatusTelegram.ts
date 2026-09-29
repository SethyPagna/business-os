import type { Env } from '../index'
import { getDb } from './db'
import { formatSaleStatusTelegramLines, sendTelegramEvent } from './telegram'

export type SaleStatusTelegramChange = {
  saleId: number
  fromStatus: string
  toStatus: string
  reason?: string | null
  skippedUnits?: number
  lostFeeUsd?: number
  lostFeeKhr?: number
}

type SaleIdentity = { id: number; receipt_number: string | null; customer_name: string | null }

// One message per action, not per sale: a 25-sale group sent as 25 messages
// would outrun Telegram's per-group rate limit and lose the tail.
export async function sendSaleStatusTelegramEvent(env: Env, changes: readonly SaleStatusTelegramChange[], by: string | null): Promise<void> {
  if (!changes.length) return
  const rows = await getDb(env).prepare('SELECT id, receipt_number, customer_name FROM sales WHERE id IN (SELECT value FROM json_each(@ids))')
    .all<SaleIdentity>({ ids: JSON.stringify(changes.map((change) => change.saleId)) })
  const sales = new Map(rows.map((row) => [Number(row.id), row]))
  await sendTelegramEvent(env, {
    type: 'status',
    lines: changes.flatMap(({ saleId, ...change }) => formatSaleStatusTelegramLines({
      ...change,
      receipt: sales.get(saleId)?.receipt_number || saleId,
      customer: sales.get(saleId)?.customer_name,
      by,
    })),
  })
}
