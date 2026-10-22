import { returnCreateIdSql, replacementSaleIdSql, type ReturnCreateStatement } from './returnCreateAction'
import type { ExchangeFallbackLot, ExchangeStockPlan } from './returnExchangePlan'
import type { PricedExchangeLine } from './returnExchange'

// The write of a one-step exchange, as SET-BASED statements: every table that used to get one INSERT/UPDATE per line gets exactly one
// statement over a JSON array, so the number of D1 statements a Free invocation spends does not grow with the number of lines.
// Lines are keyed inside the statement the way the rows are keyed in the database: a return line by (return, sale_item_id) -- a v1
// return names each sale line once -- and a replacement line by its position among the new sale's items (ids rise in insert order).

const j = (field: string) => `json_extract(j.value,'$.${field}')`
const returnId = returnCreateIdSql()
const saleId = replacementSaleIdSql()
// The replacement sale's items, numbered in insert order: the n-th JSON line is the n-th item.
const orderedItems = `WITH s AS (SELECT id,ROW_NUMBER() OVER (ORDER BY id)-1 AS ord FROM sale_items WHERE sale_id=${saleId})`

type Statement = ReturnCreateStatement | null

export type ExchangeReturnItemRow = {
  sale_item_id: number; product_id: number | null; product_name: string | null; quantity: number
  applied_price_usd: number; applied_price_khr: number; cost_price_usd: number | null; cost_price_khr: number | null
  total_usd: number; total_khr: number; return_to_stock: 0 | 1; stock_action: string; branch_id: number | null
  /** The lot recorded on the row: the single lot a whole line went back into, else null. */
  batch_id: number | null
  /** The line's own return-event lot, when its units had no lot to return to. */
  fallback_key: string | null
  refund_snapshot_json: string | null
}

export function returnItemsStatement(items: readonly ExchangeReturnItemRow[], clientRequestId: string): Statement {
  if (!items.length) return null
  return {
    sql: `INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,
        cost_price_usd,cost_price_khr,total_usd,total_khr,return_to_stock,stock_action,branch_id,batch_id,refund_snapshot_json)
      SELECT ${returnId},${j('sale_item_id')},${j('product_id')},${j('product_name')},${j('quantity')},${j('applied_price_usd')},${j('applied_price_khr')},
        ${j('cost_price_usd')},${j('cost_price_khr')},${j('total_usd')},${j('total_khr')},${j('return_to_stock')},${j('stock_action')},${j('branch_id')},
        COALESCE(${j('batch_id')},(SELECT id FROM product_batches WHERE variant_product_id=${j('product_id')} AND batch_key=${j('fallback_key')})),
        ${j('refund_snapshot_json')}
      FROM json_each(@items) j ORDER BY CAST(j.key AS INTEGER)`,
    params: { items: JSON.stringify(items), returnClientRequestId: clientRequestId },
  }
}

export type ExchangeReturnAllocationRow = {
  sale_item_id: number; product_id: number | null; branch_id: number | null; quantity: number
  batch_id: number | null; fallback_key: string | null
}

export function returnAllocationsStatement(rows: readonly ExchangeReturnAllocationRow[], clientRequestId: string): Statement {
  if (!rows.length) return null
  return {
    sql: `INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)
      SELECT (SELECT id FROM return_items WHERE return_id=${returnId} AND sale_item_id=${j('sale_item_id')}),${j('sale_item_id')},
        COALESCE(${j('batch_id')},(SELECT id FROM product_batches WHERE variant_product_id=${j('product_id')} AND batch_key=${j('fallback_key')})),
        ${j('branch_id')},${j('quantity')}
      FROM json_each(@allocations) j ORDER BY CAST(j.key AS INTEGER)`,
    params: { allocations: JSON.stringify(rows), returnClientRequestId: clientRequestId },
  }
}

/** A return-event lot for units the sale cannot say a lot for: the same row a receive would create, keyed by this request and line. */
export function fallbackLotStatement(lot: ExchangeFallbackLot): ReturnCreateStatement {
  return {
    sql: `INSERT INTO product_batches (
        variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes,
        batch_number, supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date,
        received_quantity, received_branch_id, received_branch_name, received_cost_usd
      ) VALUES (
        @productId, @batchKey, @lotCode, NULL, @receivedAt, 1, @notes,
        (SELECT COALESCE(MAX(batch_number), 0) + 1 FROM product_batches WHERE variant_product_id = @productId),
        NULL, NULL, NULL, NULL, NULL,
        @quantity, @branchId, (SELECT name FROM branches WHERE id = @branchId), NULL
      ) ON CONFLICT(variant_product_id, batch_key) DO UPDATE SET
        is_active = 1,
        received_quantity = COALESCE(received_quantity, 0) + excluded.received_quantity,
        updated_at = CURRENT_TIMESTAMP`,
    params: { productId: lot.productId, batchKey: lot.batchKey, lotCode: lot.lotCode, receivedAt: lot.receivedAt, notes: lot.notes, quantity: lot.quantity, branchId: lot.branchId },
  }
}

/** Units that went back into an existing lot reactivate it and count as received there, exactly as a receive of them would. */
export function lotReceivedStatement(restocks: ExchangeStockPlan['lotRestocks']): Statement {
  if (!restocks.length) return null
  return {
    sql: `UPDATE product_batches SET is_active = 1,
        received_quantity = COALESCE(received_quantity, 0) + (SELECT SUM(${j('quantity')}) FROM json_each(@lots) j WHERE ${j('batch_id')} = product_batches.id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id IN (SELECT ${j('batch_id')} FROM json_each(@lots) j)`,
    params: { lots: JSON.stringify(restocks) },
  }
}

export type ExchangeLotDelta = { batch_id: number | null; product_id: number; fallback_key: string | null; branch_id: number; delta: number }

/**
 * The lot ledger: one signed delta per (lot, branch). SQLite checks CHECK(quantity >= 0) on the row an upsert PROPOSES before it
 * looks for the conflict, so a negative delta cannot ride in as the inserted quantity: the insert proposes max(delta, 0) and the
 * conflict branch adds the real delta. A lot that cannot cover its negative delta fails the CHECK on that update and aborts the whole commit;
 * a negative delta against a missing row proposes a zero row and fails the postcondition's after-figure instead.
 */
export function lotStockStatement(deltas: readonly ExchangeLotDelta[]): Statement {
  const rows = deltas.filter((row) => row.delta !== 0)
  if (!rows.length) return null
  return {
    sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
      SELECT COALESCE(${j('batch_id')},(SELECT id FROM product_batches WHERE variant_product_id=${j('product_id')} AND batch_key=${j('fallback_key')})),
        ${j('branch_id')},MAX(${j('delta')},0)
      FROM json_each(@deltas) j WHERE ${j('delta')} <> 0
      ON CONFLICT(batch_id, branch_id) DO UPDATE SET
        quantity = branch_batch_stock.quantity + (SELECT json_extract(d.value,'$.delta') FROM json_each(@deltas) d
          WHERE json_extract(d.value,'$.batch_id') = excluded.batch_id AND json_extract(d.value,'$.branch_id') = excluded.branch_id),
        updated_at = CURRENT_TIMESTAMP`,
    params: { deltas: JSON.stringify(rows) },
  }
}

/** The branch ledger, with the same upsert shape and the same reason as lotStockStatement. */
export function branchStockStatement(snapshots: ExchangeStockPlan['branchSnapshots']): Statement {
  const rows = snapshots.filter((row) => row.delta !== 0).map(({ product_id, branch_id, delta }) => ({ product_id, branch_id, delta }))
  if (!rows.length) return null
  return {
    sql: `INSERT INTO branch_stock (product_id, branch_id, quantity)
      SELECT ${j('product_id')},${j('branch_id')},MAX(${j('delta')},0) FROM json_each(@pairs) j WHERE ${j('delta')} <> 0
      ON CONFLICT(product_id, branch_id) DO UPDATE SET
        quantity = branch_stock.quantity + (SELECT json_extract(d.value,'$.delta') FROM json_each(@pairs) d
          WHERE json_extract(d.value,'$.product_id') = excluded.product_id AND json_extract(d.value,'$.branch_id') = excluded.branch_id)`,
    params: { pairs: JSON.stringify(rows) },
  }
}

export function productStockStatement(productIds: readonly number[]): Statement {
  if (!productIds.length) return null
  return {
    sql: `UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id),
        updated_at=CURRENT_TIMESTAMP
      WHERE id IN (SELECT value FROM json_each(@productIds))`,
    params: { productIds: JSON.stringify(productIds) },
  }
}

export type ExchangeMovementRow = {
  movement_type: string; product_id: number; product_name: string | null; branch_id: number
  /** Only a redirected return line names the branch it landed on and the one it was addressed to. */
  branch_name: string | null; addressed_branch_name: string | null
  quantity: number; unit_cost_usd: number | null; unit_cost_khr: number | null; reason: string
  batch_id: number | null; fallback_key: string | null
}

export function movementsStatement(rows: readonly ExchangeMovementRow[], input: { clientRequestId: string; userId: number | string | null; userName: string | null }): Statement {
  if (!rows.length) return null
  return {
    sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,addressed_branch_name,movement_type,quantity,
        unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
      SELECT ${j('product_id')},${j('product_name')},${j('branch_id')},${j('branch_name')},${j('addressed_branch_name')},${j('movement_type')},${j('quantity')},
        ${j('unit_cost_usd')},${j('unit_cost_khr')},ROUND(${j('unit_cost_usd')}*ABS(${j('quantity')}),4),ROUND(${j('unit_cost_khr')}*ABS(${j('quantity')}),4),
        ${j('reason')},${returnId},@userId,@userName,
        COALESCE(${j('batch_id')},(SELECT id FROM product_batches WHERE variant_product_id=${j('product_id')} AND batch_key=${j('fallback_key')}))
      FROM json_each(@movements) j ORDER BY CAST(j.key AS INTEGER)`,
    params: { movements: JSON.stringify(rows), userId: input.userId, userName: input.userName, returnClientRequestId: input.clientRequestId },
  }
}

export type ExchangeSaleItemRow = {
  product_id: number; product_name: string; quantity: number
  applied_price_usd: number; applied_price_khr: number; cost_price_usd: number | null; cost_price_khr: number | null
  total_usd: number; total_khr: number; branch_id: number; price_mode: string; base_price_usd: number; base_price_khr: number
  batch_id: number | null; batch_label: string | null; batch_expiry_date: string | null
  pricing_snapshot_json: string; product_discount_type: string | null; product_discount_label: string | null
  product_discount_usd: number; product_discount_khr: number
  manual_discount_type: string | null; manual_discount_value: number; manual_discount_usd: number; manual_discount_khr: number
}

const SALE_ITEM_FIELDS = [
  'product_id', 'product_name', 'quantity', 'applied_price_usd', 'applied_price_khr', 'cost_price_usd', 'cost_price_khr', 'total_usd', 'total_khr',
  'branch_id', 'price_mode', 'base_price_usd', 'base_price_khr', 'batch_id', 'batch_label', 'batch_expiry_date', 'pricing_snapshot_json',
  'product_discount_type', 'product_discount_label', 'product_discount_usd', 'product_discount_khr', 'manual_discount_type',
  'manual_discount_value', 'manual_discount_usd', 'manual_discount_khr',
] as const

export function saleItemsStatement(rows: readonly ExchangeSaleItemRow[], replacementClientRequestId: string): Statement {
  if (!rows.length) return null
  return {
    sql: `INSERT INTO sale_items(sale_id,${SALE_ITEM_FIELDS.join(',')})
      SELECT ${saleId},${SALE_ITEM_FIELDS.map(j).join(',')}
      FROM json_each(@lines) j ORDER BY CAST(j.key AS INTEGER)`,
    params: { lines: JSON.stringify(rows), replacementClientRequestId },
  }
}

export type ExchangeReplacementItemRow = {
  product_id: number; product_name: string; branch_id: number; batch_id: number | null; quantity: number
  applied_price_usd: number; applied_price_khr: number; total_usd: number; total_khr: number
}

export function replacementItemsStatement(rows: readonly ExchangeReplacementItemRow[], ids: { clientRequestId: string; replacementClientRequestId: string }): Statement {
  if (!rows.length) return null
  return {
    sql: `${orderedItems}
      INSERT INTO return_replacement_items(return_id,sale_item_id,product_id,product_name,branch_id,batch_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr)
      SELECT ${returnId},s.id,${j('product_id')},${j('product_name')},${j('branch_id')},${j('batch_id')},${j('quantity')},${j('applied_price_usd')},${j('applied_price_khr')},${j('total_usd')},${j('total_khr')}
      FROM json_each(@lines) j JOIN s ON s.ord=CAST(j.key AS INTEGER)`,
    params: { lines: JSON.stringify(rows), returnClientRequestId: ids.clientRequestId, replacementClientRequestId: ids.replacementClientRequestId },
  }
}

export type ExchangeSaleAllocationRow = { line: number; batch_id: number; branch_id: number; quantity: number; lot_code: string | null; expiry_date: string | null }

export function saleAllocationsStatement(rows: readonly ExchangeSaleAllocationRow[], replacementClientRequestId: string): Statement {
  if (!rows.length) return null
  return {
    sql: `${orderedItems}
      INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity,released_at)
      SELECT s.id,${j('batch_id')},${j('branch_id')},${j('quantity')},${j('lot_code')},${j('expiry_date')},0,NULL
      FROM json_each(@allocations) j JOIN s ON s.ord=${j('line')}`,
    params: { allocations: JSON.stringify(rows), replacementClientRequestId },
  }
}

/** The per-line rows the set-based statements above are built from, in one place so the counts the commit proves are the counts written. */
export function exchangeSaleRows(lines: readonly PricedExchangeLine[], takes: ExchangeStockPlan['replacementTakes'], explicitBatchIds: ReadonlyArray<number | null>): {
  items: ExchangeSaleItemRow[]; replacements: ExchangeReplacementItemRow[]; allocations: ExchangeSaleAllocationRow[]
} {
  const items: ExchangeSaleItemRow[] = []
  const replacements: ExchangeReplacementItemRow[] = []
  const allocations: ExchangeSaleAllocationRow[] = []
  lines.forEach((line, index) => {
    const lineTakes = takes[index] || []
    const single = lineTakes.length === 1 && lineTakes[0].quantity === line.quantity ? lineTakes[0] : null
    const snapshot = JSON.parse(line.pricing_snapshot_json) as { pool: { lines: Array<{ line_key: string; manual: { type: string; value: number } }> } }
    const manual = snapshot.pool.lines.find((entry) => entry.line_key === line.key)!.manual
    items.push({
      product_id: line.product_id, product_name: line.product_name, quantity: line.quantity,
      applied_price_usd: line.amounts.applied_price_usd, applied_price_khr: line.amounts.applied_price_khr,
      cost_price_usd: line.cost_price_usd, cost_price_khr: line.cost_price_khr,
      total_usd: line.amounts.total_usd, total_khr: line.amounts.total_khr, branch_id: line.branch_id,
      price_mode: line.metadata.price_mode, base_price_usd: line.amounts.base_price_usd, base_price_khr: line.amounts.base_price_khr,
      batch_id: single?.batchId ?? null, batch_label: single?.lotCode ?? null, batch_expiry_date: single?.expiryDate ?? null,
      pricing_snapshot_json: line.pricing_snapshot_json,
      product_discount_type: line.metadata.product_discount_type, product_discount_label: line.metadata.product_discount_label,
      product_discount_usd: 0, product_discount_khr: 0,
      manual_discount_type: manual.type === 'none' ? null : manual.type, manual_discount_value: manual.value,
      manual_discount_usd: 0, manual_discount_khr: 0,
    })
    replacements.push({
      product_id: line.product_id, product_name: line.product_name, branch_id: line.branch_id, batch_id: explicitBatchIds[index] ?? null,
      quantity: line.quantity, applied_price_usd: line.amounts.applied_price_usd, applied_price_khr: line.amounts.applied_price_khr,
      total_usd: line.amounts.total_usd, total_khr: line.amounts.total_khr,
    })
    for (const take of lineTakes) {
      allocations.push({ line: index, batch_id: take.batchId, branch_id: line.branch_id, quantity: take.quantity, lot_code: take.lotCode, expiry_date: take.expiryDate })
    }
  })
  return { items, replacements, allocations }
}

/** The extra checks the exchange adds to a return's postcondition: the replacement sale is whole and linked both ways. */
export function exchangePostconditionSql(): string {
  return `AND EXISTS(SELECT 1 FROM sales s2 WHERE s2.id=${saleId}
      AND s2.source_return_id=${returnId} AND s2.money_precision_version=1
      AND s2.total_usd=json_extract(@expectedJson,'$.sale2.total_usd')
      AND s2.calculated_total_usd=json_extract(@expectedJson,'$.sale2.calculated_total_usd')
      AND s2.amount_paid_usd=json_extract(@expectedJson,'$.sale2.amount_paid_usd')
      AND s2.amount_paid_khr=json_extract(@expectedJson,'$.sale2.amount_paid_khr')
      AND s2.change_usd=json_extract(@expectedJson,'$.sale2.change_usd')
      AND s2.change_khr=json_extract(@expectedJson,'$.sale2.change_khr')
      AND s2.sale_status=json_extract(@expectedJson,'$.sale2.sale_status')
      AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=s2.id)=json_extract(@expectedJson,'$.sale2.lines')
      AND ABS(COALESCE((SELECT SUM(total_usd) FROM sale_items WHERE sale_id=s2.id),0)-json_extract(@expectedJson,'$.sale2.subtotal_usd'))<0.00005
      AND EXISTS(SELECT 1 FROM returns r WHERE r.id=${returnId} AND r.replacement_sale_id=s2.id))`
}
