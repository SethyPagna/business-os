// The Stock Changes list paged by cursor (read switch `ledger_keyset`, default off; routes/products.ts GET /stock-ledger).
//
// The offset list runs a COUNT and a summary over the whole filtered history on EVERY page, and an offset walk whose cost grows with the page number.
// Here the first request (no cursor) answers exactly what the offset list answers -- rows, total, totalPages, summary -- and hands out `next_cursor`; every
// later page is the first `pageSize` rows after the cursor (lib/stockLedgerQuery.ts planStockLedgerKeyset) with no COUNT, no summary and no OFFSET: it
// costs its own rows and the day it starts in. The client keeps the total and the true page count from page 1 (`totals=1` asks for them again, after a
// write that moved them). `next_cursor` is present on every answer of this path -- null on the last page -- so its presence is how a client knows the
// server pages by cursor; a server with the switch off never sends it and the client keeps asking by page number.
import type { D1Compat } from './db'
import { attachBeforeQty, encodeStockLedgerCursor, nextStockLedgerCursor, planStockLedgerKeyset, type StockLedgerCursor, type StockLedgerQuery } from './stockLedgerQuery'

type Row = Record<string, unknown>

export type StockLedgerKeysetArgs = {
  page: number
  pageSize: number
  /** null: the first request (the offset page with the totals); else the page after this position. */
  cursor: StockLedgerCursor | null
  /** With a cursor: also count and summarise (a client refreshing after a write). Without one the totals are always sent. */
  totals: boolean
  view: string
}

export async function readStockLedgerKeyset(db: D1Compat, ledger: StockLedgerQuery, args: StockLedgerKeysetArgs): Promise<Record<string, unknown>> {
  const { page, pageSize, cursor } = args
  let rows: Row[]
  if (cursor) {
    const plan = planStockLedgerKeyset(ledger, cursor)
    rows = (await db.prepare(plan.rowsSql).all<Row>({ ...ledger.params, ...plan.params, limit: pageSize })) || []
    // A dated cursor's page that ran out of dated rows continues into the rows without a date (they sort last), as the offset list does.
    if (rows.length < pageSize && plan.tailSql) {
      const tail = (await db.prepare(plan.tailSql).all<Row>({ ...ledger.params, limit: pageSize - rows.length })) || []
      rows = [...rows, ...tail]
    }
  } else {
    rows = (await db.prepare(ledger.rowsSqlWith('', 'offset', true)).all<Row>({ ...ledger.params, limit: pageSize, offset: (page - 1) * pageSize })) || []
  }
  const next = rows.length === pageSize ? nextStockLedgerCursor(rows as Array<{ id?: unknown; keyset_instant?: unknown; keyset_day?: unknown }>) : null
  const items = attachBeforeQty(rows.map((row) => {
    const { keyset_instant: _instant, keyset_day: _day, ...rest } = row
    return rest
  }))
  const body: Record<string, unknown> = { items }
  if (!cursor || args.totals) {
    // The two statements the offset list runs, over the same scope. With no In/Out view the count IS the summary's own total (same joins, same base filters),
    // so one statement does both; with a view chip the count differs from the summary's and runs as it always did.
    const summaryRow = await db.prepare(ledger.summarySql).get<{ in_count: number; out_count: number; in_qty: number; out_qty: number; total: number }>(ledger.params)
    const total = ledger.whereSql === ledger.baseWhereSql
      ? Number(summaryRow?.total || 0)
      : Number((await db.prepare(ledger.countSql).get<{ total: number }>(ledger.params))?.total || 0)
    body.total = total
    body.page = page
    body.pageSize = pageSize
    body.totalPages = Math.max(1, Math.ceil(total / pageSize))
    body.view = args.view
    body.summary = {
      inCount: Number(summaryRow?.in_count || 0),
      outCount: Number(summaryRow?.out_count || 0),
      inQty: Number(summaryRow?.in_qty || 0),
      outQty: Number(summaryRow?.out_qty || 0),
      total: Number(summaryRow?.total || 0),
    }
  } else {
    body.page = page
    body.pageSize = pageSize
    body.view = args.view
  }
  body.next_cursor = next ? encodeStockLedgerCursor(next) : null
  return body
}
