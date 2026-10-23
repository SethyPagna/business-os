import { BRANCH_EFFECT_COLUMNS_SQL, type BranchEffectRow } from './branchEffect'
import {
  CUSTOMER_RETURN_MAX_PRIOR_ITEMS, CUSTOMER_RETURN_QUOTE_LINE_COLUMNS, CUSTOMER_RETURN_QUOTE_SALE_COLUMNS,
  type CustomerReturnQuoteRows,
} from './customerReturnQuotePlan'
import { CUSTOMER_RETURN_MAX_SALE_LINES } from './customerReturnEntitlement'
import { saleReturnMoneySql } from './returnRefundSplit'

// One D1 query for everything a one-step exchange reads before it writes.
//
// A Cloudflare Free invocation may spend 50 D1 queries, and a plain money-v1 return already spends 9 reads and a 19-statement write on it.
// The exchange needs strictly more state (the replacement products and their lots, the sale, the lots the returned units go back to, the
// numbers, the customer, the payment settings), so it reads all of it in ONE statement: a UNION ALL of small arms, every row a
// (kind, payload-json) pair. The write that follows is set-based (lib/returnExchangeWrite.ts) for the same reason.

export const EXCHANGE_CONTEXT_LIMITS = { allocations: 2000, branchStock: 2000, lots: 1000, lotStock: 4000 } as const

export type ExchangeContextInput = {
  saleId: number
  /** The sale lines being returned. */
  saleItemIds: readonly number[]
  /** The products of the replacement lines (their active lots with stock are the FIFO candidates). */
  replacementProductIds: readonly number[]
  /** Lots a line names itself (a replacement pick, a return pick). */
  explicitBatchIds: readonly number[]
  returnNumbers: readonly string[]
  receiptNumbers: readonly string[]
  /** The customer the body names; the sale's own customer when it names none. */
  customerId: number | null
}

export const EXCHANGE_SETTING_KEYS = ['pos_payment_methods', 'pos_payment_method_kinds', 'change_exchange_rate'] as const

function returnMoneyExpression(): string {
  const sql = saleReturnMoneySql('s')
  const suffix = ' AS return_money_json'
  if (!sql.endsWith(suffix)) throw new Error('saleReturnMoneySql no longer ends with its alias')
  return sql.slice(0, -suffix.length)
}

/** The one-key object that carries a lossless REAL through json_object (see exchangeContextQuery). */
const REAL_MARKER = '$real'

const PRIOR_COLUMNS = [
  'return_id', 'money_precision_version', 'calculated_refund_usd', 'rounding_adjustment_usd', 'total_refund_usd', 'return_status',
  'return_updated_at', 'return_item_id', 'sale_item_id', 'quantity', 'total_usd', 'refund_snapshot_json',
] as const

export function exchangeContextQuery(input: ExchangeContextInput): { sql: string; params: Record<string, unknown> } {
  // D1 refuses a compound SELECT of more than four terms, so the datasets are scalar subqueries of ONE row, each a JSON array.
  const list = (columns: string, from: string) => `COALESCE((SELECT json_group_array(json_object(${columns})) FROM (${from})),'[]')`
  // json_object renders a REAL with 15 significant digits, so a stored 64400.00000000001 comes back as 64400.0 and the commit's own
  // guard (which compares the exact stored value) would refuse a perfectly current row. quote() is lossless; the reviver in
  // parseExchangeContext turns the marker back into the exact double the plain driver path hands over.
  const exact = (expression: string) => `CASE WHEN typeof(${expression})='real' THEN json_object('${REAL_MARKER}',quote(${expression})) ELSE ${expression} END`
  const pairs = (columns: readonly string[]) => columns.map((column) => `'${column}',${exact(column)}`).join(',')
  const sql = `WITH wanted AS (
      SELECT pb.id,pb.variant_product_id,pb.is_active,pb.lot_code,pb.expiry_date,pb.received_at,pb.batch_number
      FROM product_batches pb
      WHERE (pb.variant_product_id IN (SELECT value FROM json_each(@replacementProductIds)) AND pb.is_active=1
          AND EXISTS(SELECT 1 FROM branch_batch_stock x WHERE x.batch_id=pb.id AND x.quantity>0))
        OR pb.id IN (SELECT batch_id FROM sale_item_batch_allocations WHERE sale_item_id IN (SELECT value FROM json_each(@saleItemIds)))
        OR pb.id IN (SELECT batch_id FROM sale_items WHERE id IN (SELECT value FROM json_each(@saleItemIds)) AND batch_id IS NOT NULL)
        OR pb.id IN (SELECT value FROM json_each(@explicitBatchIds))
    ),
    wanted_products AS (
      SELECT value AS id FROM json_each(@replacementProductIds)
      UNION SELECT product_id FROM sale_items WHERE id IN (SELECT value FROM json_each(@saleItemIds))
    )
    SELECT
      (SELECT json_object(${CUSTOMER_RETURN_QUOTE_SALE_COLUMNS.map((column) => `'${column}',${exact(`s.${column}`)}`).join(',')},
        'return_money_json',('' || ${returnMoneyExpression()}),'sale_revision',COALESCE(v.revision,0))
        FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id=@saleId) AS sale,
      ${list(pairs(CUSTOMER_RETURN_QUOTE_LINE_COLUMNS), `SELECT * FROM sale_items WHERE sale_id=@saleId ORDER BY id LIMIT ${CUSTOMER_RETURN_MAX_SALE_LINES + 1}`)} AS sale_lines,
      ${list(pairs(PRIOR_COLUMNS), `SELECT r.id AS return_id,r.money_precision_version,r.calculated_refund_usd,r.rounding_adjustment_usd,r.total_refund_usd,
          r.status AS return_status,r.updated_at AS return_updated_at,ri.id AS return_item_id,ri.sale_item_id,ri.quantity,ri.total_usd,ri.refund_snapshot_json
          FROM returns r LEFT JOIN return_items ri ON ri.return_id=r.id
          WHERE r.sale_id=@saleId AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.status,'completed')<>'cancelled'
          ORDER BY r.id,ri.id LIMIT ${CUSTOMER_RETURN_MAX_PRIOR_ITEMS + 1}`)} AS prior,
      COALESCE((SELECT json_group_array(return_number) FROM returns WHERE return_number IN (SELECT value FROM json_each(@returnNumbers))),'[]') AS taken_returns,
      COALESCE((SELECT json_group_array(receipt_number) FROM sales WHERE receipt_number IN (SELECT value FROM json_each(@receiptNumbers))),'[]') AS taken_receipts,
      ${list(pairs(BRANCH_EFFECT_COLUMNS_SQL.split(',').map((column) => column.trim())), 'SELECT * FROM branches')} AS branches,
      ${list(pairs(['id', 'name', 'cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr', 'updated_at', 'is_active']),
        'SELECT * FROM products WHERE id IN (SELECT id FROM wanted_products)')} AS products,
      ${list(pairs(['product_id', 'branch_id', 'quantity']),
        `SELECT product_id,branch_id,quantity FROM branch_stock WHERE product_id IN (SELECT id FROM wanted_products) LIMIT ${EXCHANGE_CONTEXT_LIMITS.branchStock + 1}`)} AS branch_stock,
      ${list(pairs(['id', 'sale_item_id', 'batch_id', 'quantity', 'released_quantity']),
        `SELECT id,sale_item_id,batch_id,quantity,released_quantity FROM sale_item_batch_allocations
          WHERE sale_item_id IN (SELECT value FROM json_each(@saleItemIds)) ORDER BY id LIMIT ${EXCHANGE_CONTEXT_LIMITS.allocations + 1}`)} AS allocations,
      ${list("'id',id,'product_id',variant_product_id,'is_active',is_active,'lot_code',lot_code,'expiry_date',expiry_date,'received_at',received_at,'batch_number',batch_number",
        `SELECT * FROM wanted LIMIT ${EXCHANGE_CONTEXT_LIMITS.lots + 1}`)} AS lots,
      ${list(pairs(['batch_id', 'branch_id', 'quantity']),
        `SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM wanted) LIMIT ${EXCHANGE_CONTEXT_LIMITS.lotStock + 1}`)} AS lot_stock,
      ${list(pairs(['id', 'membership_number', 'is_anonymous']),
        'SELECT id,membership_number,is_anonymous FROM customers WHERE id=COALESCE(@customerId,(SELECT customer_id FROM sales WHERE id=@saleId))')} AS customer,
      ${list(pairs(['key', 'value']), `SELECT key,value FROM settings WHERE key IN (${EXCHANGE_SETTING_KEYS.map((key) => `'${key}'`).join(',')})`)} AS settings`
  return {
    sql,
    params: {
      saleId: input.saleId,
      saleItemIds: JSON.stringify([...new Set(input.saleItemIds)]),
      replacementProductIds: JSON.stringify([...new Set(input.replacementProductIds)]),
      explicitBatchIds: JSON.stringify([...new Set(input.explicitBatchIds)]),
      returnNumbers: JSON.stringify(input.returnNumbers),
      receiptNumbers: JSON.stringify(input.receiptNumbers),
      customerId: input.customerId,
    },
  }
}

export type ExchangeCatalogProduct = {
  id: number; name: string; cost_price_usd: number | null; cost_price_khr: number | null
  selling_price_usd: number | null; selling_price_khr: number | null; updated_at: string | null; is_active: number | null
}
export type ExchangeLot = {
  id: number; product_id: number; is_active: number | null; lot_code: string | null; expiry_date: string | null
  received_at: string | null; batch_number: number | null
}
export type ExchangeContext = CustomerReturnQuoteRows & {
  takenReturnNumbers: Set<string>
  takenReceiptNumbers: Set<string>
  branches: BranchEffectRow[]
  products: Map<number, ExchangeCatalogProduct>
  /** `${product_id}:${branch_id}` -> quantity */
  branchStock: Map<string, number>
  /** Per sale line, oldest first, with units still outstanding (quantity - released_quantity > 0). */
  allocations: Map<number, Array<{ batch_id: number; outstanding: number }>>
  lots: Map<number, ExchangeLot>
  /** `${batch_id}:${branch_id}` -> quantity */
  lotStock: Map<string, number>
  customer: { id: number; membership_number: string | null; is_anonymous: number | null } | null
  settings: Record<string, string>
}

export class ExchangeContextTooLargeError extends Error {
  constructor(readonly arm: string) {
    super(`The exchange touches too much stock to review in one step (${arm}).`)
  }
}

/** The one row exchangeContextQuery answers: every column a JSON text. */
export type ExchangeContextRow = Record<'sale' | 'sale_lines' | 'prior' | 'taken_returns' | 'taken_receipts' | 'branches' | 'products' | 'branch_stock'
  | 'allocations' | 'lots' | 'lot_stock' | 'customer' | 'settings', string | null>

// return_money_json is TEXT on the plain read; a JSON-aware driver could hand a nested array back, so keep it the text it always was.
function asPlainSale(sale: Record<string, unknown> | null): Record<string, unknown> | null {
  if (sale && sale.return_money_json != null && typeof sale.return_money_json !== 'string') sale.return_money_json = JSON.stringify(sale.return_money_json)
  return sale
}

export function parseExchangeContext(row: ExchangeContextRow | undefined | null): ExchangeContext {
  const revive = (_key: string, value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value as object)
      if (keys.length === 1 && keys[0] === REAL_MARKER) return Number((value as Record<string, unknown>)[REAL_MARKER])
    }
    return value
  }
  const json = <T,>(value: string | null | undefined, fallback: T): T => value == null ? fallback : JSON.parse(value, revive) as T
  const array = (key: keyof ExchangeContextRow, limit?: number): Array<Record<string, unknown>> => {
    const list = json<Array<Record<string, unknown>>>(row?.[key], [])
    if (limit != null && list.length > limit) throw new ExchangeContextTooLargeError(String(key))
    return list
  }
  const previousRows = array('prior').sort((a, b) => Number(a.return_id) - Number(b.return_id) || Number(a.return_item_id ?? 0) - Number(b.return_item_id ?? 0))
  const allocations = new Map<number, Array<{ batch_id: number; outstanding: number }>>()
  for (const entry of array('allocations', EXCHANGE_CONTEXT_LIMITS.allocations).sort((a, b) => Number(a.id) - Number(b.id))) {
    const outstanding = Math.max(0, (Number(entry.quantity) || 0) - (Number(entry.released_quantity) || 0))
    if (outstanding <= 0) continue
    const key = Number(entry.sale_item_id)
    const list = allocations.get(key) ?? []
    list.push({ batch_id: Number(entry.batch_id), outstanding })
    allocations.set(key, list)
  }
  const lots = new Map<number, ExchangeLot>()
  for (const entry of array('lots', EXCHANGE_CONTEXT_LIMITS.lots)) {
    lots.set(Number(entry.id), {
      id: Number(entry.id), product_id: Number(entry.product_id), is_active: entry.is_active == null ? null : Number(entry.is_active),
      lot_code: (entry.lot_code as string | null) ?? null, expiry_date: (entry.expiry_date as string | null) ?? null,
      received_at: (entry.received_at as string | null) ?? null, batch_number: entry.batch_number == null ? null : Number(entry.batch_number),
    })
  }
  const products = new Map<number, ExchangeCatalogProduct>()
  for (const entry of array('products')) products.set(Number(entry.id), entry as unknown as ExchangeCatalogProduct)
  const customerRow = array('customer')[0]
  return {
    sale: asPlainSale(json<Record<string, unknown> | null>(row?.sale, null)),
    saleLines: array('sale_lines').sort((a, b) => Number(a.id) - Number(b.id)),
    previousRows,
    takenReturnNumbers: new Set(json<string[]>(row?.taken_returns, []).map(String)),
    takenReceiptNumbers: new Set(json<string[]>(row?.taken_receipts, []).map(String)),
    branches: array('branches') as unknown as BranchEffectRow[],
    products,
    branchStock: new Map(array('branch_stock', EXCHANGE_CONTEXT_LIMITS.branchStock).map((entry) => [`${Number(entry.product_id)}:${Number(entry.branch_id)}`, Number(entry.quantity) || 0])),
    allocations,
    lots,
    lotStock: new Map(array('lot_stock', EXCHANGE_CONTEXT_LIMITS.lotStock).map((entry) => [`${Number(entry.batch_id)}:${Number(entry.branch_id)}`, Number(entry.quantity) || 0])),
    customer: customerRow ? {
      id: Number(customerRow.id), membership_number: (customerRow.membership_number as string | null) ?? null,
      is_anonymous: customerRow.is_anonymous == null ? null : Number(customerRow.is_anonymous),
    } : null,
    settings: Object.fromEntries(array('settings').map((entry) => [String(entry.key), String(entry.value ?? '')])),
  }
}

/** The first candidate number nobody holds; the last resort mirrors uniqueBusinessDateTimeNumber's random suffix. */
export function firstFreeNumber(candidates: readonly string[], taken: ReadonlySet<string>, random: () => string = () => Math.random().toString(36).slice(2, 6).toUpperCase()): string {
  for (const candidate of candidates) if (!taken.has(candidate)) return candidate
  return `${candidates[0]}-${random()}`
}

/** `base`, `base-2`, ... `base-10`: the candidates uniqueBusinessDateTimeNumber would probe, in its order. */
export function numberCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 9 }, (_, index) => `${base}-${index + 2}`)]
}
