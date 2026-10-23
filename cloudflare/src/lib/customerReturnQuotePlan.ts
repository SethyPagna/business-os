import type { D1Compat } from './db'
import {
  buildCustomerReturnQuoteV1, CUSTOMER_RETURN_MAX_SALE_LINES,
  type CustomerReturnPrior, type CustomerReturnQuoteV1, type CustomerReturnSaleLine,
} from './customerReturnEntitlement'
import { ProductMergeLineageError, resolveProductMergeLineage } from './productMergeLineage'
import { productStockGuardError } from './productStockGuard'
import { saleReturnMoneySql } from './returnRefundSplit'
import { sha256Hex } from './saleRecordEvents'
import { canonicalMoney4, SaleMoneyContractError } from './saleMoneyPrecision'

// The money-v1 return quote and the authority it was computed from. Split out of routes/returns.ts so the same quote can be
// built from rows read by the three statements below (the quote route, the plain create) or from rows a larger single read
// already carries (the one-step exchange spends one D1 query where these three spend three -- see lib/returnExchangeContext.ts).

export const CUSTOMER_RETURN_MAX_PRIOR_ITEMS = 1_000
export const CUSTOMER_RETURN_AUTHORITY_MAX_BYTES = 1_500_000

export type CustomerReturnRequestedLine = { sale_item_id: number; quantity: number }
export type CustomerReturnQuoteAuthority = {
  sale: Record<string, unknown>
  sale_items: Record<string, unknown>[]
  prior_returns: Record<string, unknown>[]
  prior_items: Record<string, unknown>[]
}
export type CustomerReturnQuotePlan = {
  quote: CustomerReturnQuoteV1
  authority: CustomerReturnQuoteAuthority
  authority_json: string
  lineage: Awaited<ReturnType<typeof resolveProductMergeLineage>>
}
/** The rows a quote is computed from. */
export type CustomerReturnQuoteRows = {
  sale: Record<string, unknown> | null | undefined
  saleLines: Record<string, unknown>[]
  previousRows: Record<string, unknown>[]
}

/** The sale row the quote reads (and the authority predicate pins), as a SELECT list over alias `s` joined to `v` (sale_write_revisions). */
export const CUSTOMER_RETURN_QUOTE_SALE_COLUMNS = [
  'id', 'money_precision_version', 'calculated_total_usd', 'total_usd', 'subtotal_usd', 'discount_usd', 'membership_discount_usd',
  'tax_usd', 'exchange_rate', 'is_delivery', 'delivery_fee_usd', 'delivery_fee_paid_by', 'sale_status', 'status_before_return',
  'return_state', 'receipt_number', 'customer_id', 'customer_name', 'customer_phone', 'customer_address', 'branch_id', 'branch_name',
  'amount_paid_usd', 'amount_paid_khr',
] as const
export const CUSTOMER_RETURN_QUOTE_LINE_COLUMNS = [
  'id', 'sale_id', 'product_id', 'quantity', 'total_usd', 'total_khr', 'base_price_usd', 'base_price_khr', 'applied_price_usd',
  'applied_price_khr', 'product_discount_usd', 'product_discount_khr', 'product_discount_type', 'product_discount_label',
  'manual_discount_usd', 'manual_discount_khr', 'manual_discount_type', 'manual_discount_value', 'price_mode', 'pricing_snapshot_json',
  'product_name', 'branch_id', 'cost_price_usd', 'cost_price_khr', 'batch_id', 'batch_label', 'batch_expiry_date',
] as const

export async function readCustomerReturnQuoteRows(
  db: D1Compat, saleId: number, excludeReturnId: number | null,
): Promise<CustomerReturnQuoteRows> {
  const sale = await db.prepare(`SELECT ${CUSTOMER_RETURN_QUOTE_SALE_COLUMNS.map((name) => `s.${name}`).join(',')},${saleReturnMoneySql('s')},
    COALESCE(v.revision,0) AS sale_revision
    FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id=@saleId`)
    .get<Record<string, unknown>>({ saleId })
  if (!sale) throw new SaleMoneyContractError('customer_return_sale_not_found')
  if (String(sale.sale_status || 'completed') === 'cancelled') throw new SaleMoneyContractError('customer_return_sale_invalid')
  const saleLines = await db.prepare(`SELECT ${CUSTOMER_RETURN_QUOTE_LINE_COLUMNS.join(',')}
    FROM sale_items WHERE sale_id=@saleId ORDER BY id LIMIT @limit`)
    .all<Record<string, unknown>>({ saleId, limit: CUSTOMER_RETURN_MAX_SALE_LINES + 1 })
  const previousRows = await db.prepare(`SELECT r.id AS return_id,r.money_precision_version,r.calculated_refund_usd,
    r.rounding_adjustment_usd,r.total_refund_usd,r.status AS return_status,r.updated_at AS return_updated_at,
    ri.id AS return_item_id,ri.sale_item_id,ri.quantity,ri.total_usd,ri.refund_snapshot_json
    FROM returns r LEFT JOIN return_items ri ON ri.return_id=r.id
    WHERE r.sale_id=@saleId AND COALESCE(r.return_scope,'customer')='customer'
      AND COALESCE(r.status,'completed')<>'cancelled'
      AND (@excludeReturnId IS NULL OR r.id<>@excludeReturnId)
    ORDER BY r.id,ri.id LIMIT @limit`)
    .all<Record<string, unknown>>({ saleId, excludeReturnId, limit: CUSTOMER_RETURN_MAX_PRIOR_ITEMS + 1 })
  return { sale, saleLines, previousRows }
}

export async function customerReturnQuotePlanFromRows(
  db: D1Compat, saleId: number, requested: CustomerReturnRequestedLine[], rows: CustomerReturnQuoteRows,
): Promise<CustomerReturnQuotePlan> {
  const { sale, saleLines, previousRows } = rows
  if (!sale) throw new SaleMoneyContractError('customer_return_sale_not_found')
  if (String(sale.sale_status || 'completed') === 'cancelled') throw new SaleMoneyContractError('customer_return_sale_invalid')
  if (saleLines.length > CUSTOMER_RETURN_MAX_SALE_LINES) throw new SaleMoneyContractError('customer_return_sale_invalid')
  let lineage: Awaited<ReturnType<typeof resolveProductMergeLineage>>
  try {
    lineage = await resolveProductMergeLineage(db, saleId, saleLines)
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) throw stockGuard
    if (error instanceof ProductMergeLineageError) throw new SaleMoneyContractError(error.code)
    throw error
  }
  if (previousRows.length > CUSTOMER_RETURN_MAX_PRIOR_ITEMS) throw new SaleMoneyContractError('customer_return_cohort_too_large')
  const previousById = new Map<number, CustomerReturnPrior>()
  const priorReturns = new Map<number, Record<string, unknown>>()
  const priorItems: Record<string, unknown>[] = []
  for (const row of previousRows) {
    const id = Number(row.return_id)
    let prior = previousById.get(id)
    if (!prior) {
      prior = {
        id,
        money_precision_version: Number(row.money_precision_version) as 1,
        calculated_refund_usd: Number(row.calculated_refund_usd),
        rounding_adjustment_usd: Number(row.rounding_adjustment_usd),
        total_refund_usd: Number(row.total_refund_usd),
        items: [],
      }
      previousById.set(id, prior)
      priorReturns.set(id, {
        id, money_precision_version: row.money_precision_version,
        calculated_refund_usd: row.calculated_refund_usd, rounding_adjustment_usd: row.rounding_adjustment_usd,
        total_refund_usd: row.total_refund_usd, status: row.return_status, updated_at: row.return_updated_at,
      })
    }
    if (row.return_item_id != null) {
      prior.items.push({
        sale_item_id: row.sale_item_id == null ? null : Number(row.sale_item_id),
        quantity: Number(row.quantity), total_usd: Number(row.total_usd),
        refund_snapshot_json: row.refund_snapshot_json == null ? null : String(row.refund_snapshot_json),
      })
      priorItems.push({ id: row.return_item_id, return_id: id, sale_item_id: row.sale_item_id,
        quantity: row.quantity, total_usd: row.total_usd, refund_snapshot_json: row.refund_snapshot_json })
    }
  }
  const exchangeRate = Number(sale.exchange_rate)
  const customerDeliveryFee = Number(sale.is_delivery) === 1 && String(sale.delivery_fee_paid_by || 'customer') === 'customer'
    ? canonicalMoney4(sale.delivery_fee_usd ?? 0, true) : 0
  const quote = buildCustomerReturnQuoteV1({
    sale: {
      sale_id: Number(sale.id), sale_revision: Number(sale.sale_revision),
      money_precision_version: Number(sale.money_precision_version),
      calculated_total_usd: sale.calculated_total_usd == null ? null : Number(sale.calculated_total_usd),
      total_usd: Number(sale.total_usd), subtotal_usd: Number(sale.subtotal_usd),
      discount_usd: Number(sale.discount_usd), membership_discount_usd: Number(sale.membership_discount_usd),
      tax_usd: Number(sale.tax_usd), exchange_rate: exchangeRate,
      customer_delivery_fee_usd: customerDeliveryFee,
      lines: await Promise.all(saleLines.map(async (line) => ({
        ...line as CustomerReturnSaleLine,
        pricing_snapshot_digest: await sha256Hex(String(line.pricing_snapshot_json ?? '')),
      }))),
    },
    requested,
    previous: [...previousById.values()],
    productIdentityBindings: lineage.bindings,
  })
  if (lineage.bindings.length) {
    const coherent = await db.prepare(`SELECT CASE WHEN (${lineage.condition}) THEN 1 ELSE 0 END AS valid`)
      .get<{ valid: number }>(lineage.params)
    if (Number(coherent?.valid) !== 1) throw new SaleMoneyContractError('product_merge_lineage_conflict')
  }
  const authority: CustomerReturnQuoteAuthority = {
    sale, sale_items: saleLines, prior_returns: [...priorReturns.values()], prior_items: priorItems,
  }
  const authorityJson = JSON.stringify(authority)
  if (new TextEncoder().encode(authorityJson).byteLength > CUSTOMER_RETURN_AUTHORITY_MAX_BYTES) {
    throw new SaleMoneyContractError('customer_return_authority_too_large')
  }
  return { quote, authority, authority_json: authorityJson, lineage }
}

export async function customerReturnQuotePlanFromDb(
  db: D1Compat, saleId: number, requested: CustomerReturnRequestedLine[], excludeReturnId: number | null = null,
): Promise<CustomerReturnQuotePlan> {
  return customerReturnQuotePlanFromRows(db, saleId, requested, await readCustomerReturnQuoteRows(db, saleId, excludeReturnId))
}

export function publicCustomerReturnQuote(quote: CustomerReturnQuoteV1) {
  return {
    money_precision_version: quote.money_precision_version,
    sale_id: quote.sale_id,
    sale_revision: quote.sale_revision,
    calculated_refund_usd: quote.calculated_refund_usd,
    rounding_adjustment_usd: quote.rounding_adjustment_usd,
    total_refund_usd: quote.total_refund_usd,
    total_refund_khr: quote.total_refund_khr,
    items: quote.items.map(({ refund_snapshot_json: _snapshot, ...line }) => line),
  }
}

export function customerReturnAuthorityPredicate(param = '@customerReturnAuthorityJson'): string {
  return `
    EXISTS(SELECT 1 FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id
      WHERE s.id=json_extract(${param},'$.sale.id')
        AND s.money_precision_version IS json_extract(${param},'$.sale.money_precision_version')
        AND s.calculated_total_usd IS json_extract(${param},'$.sale.calculated_total_usd')
        AND s.total_usd IS json_extract(${param},'$.sale.total_usd')
        AND s.subtotal_usd IS json_extract(${param},'$.sale.subtotal_usd')
        AND s.discount_usd IS json_extract(${param},'$.sale.discount_usd')
        AND s.membership_discount_usd IS json_extract(${param},'$.sale.membership_discount_usd')
        AND s.tax_usd IS json_extract(${param},'$.sale.tax_usd')
        AND s.exchange_rate IS json_extract(${param},'$.sale.exchange_rate')
        AND s.is_delivery IS json_extract(${param},'$.sale.is_delivery')
        AND s.delivery_fee_usd IS json_extract(${param},'$.sale.delivery_fee_usd')
        AND s.delivery_fee_paid_by IS json_extract(${param},'$.sale.delivery_fee_paid_by')
        AND s.sale_status IS json_extract(${param},'$.sale.sale_status')
        AND s.status_before_return IS json_extract(${param},'$.sale.status_before_return')
        AND s.return_state IS json_extract(${param},'$.sale.return_state')
        AND COALESCE(v.revision,0)=json_extract(${param},'$.sale.sale_revision'))
    AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=json_extract(${param},'$.sale.id'))
      =json_array_length(${param},'$.sale_items')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.sale_items') j WHERE NOT EXISTS(
      SELECT 1 FROM sale_items si WHERE si.id=json_extract(j.value,'$.id')
        AND si.sale_id=json_extract(${param},'$.sale.id')
        AND si.product_id IS json_extract(j.value,'$.product_id') AND si.quantity IS json_extract(j.value,'$.quantity')
        AND si.total_usd IS json_extract(j.value,'$.total_usd') AND si.total_khr IS json_extract(j.value,'$.total_khr')
        AND si.base_price_usd IS json_extract(j.value,'$.base_price_usd') AND si.base_price_khr IS json_extract(j.value,'$.base_price_khr')
        AND si.applied_price_usd IS json_extract(j.value,'$.applied_price_usd') AND si.applied_price_khr IS json_extract(j.value,'$.applied_price_khr')
        AND si.product_discount_usd IS json_extract(j.value,'$.product_discount_usd') AND si.product_discount_khr IS json_extract(j.value,'$.product_discount_khr')
        AND si.product_discount_type IS json_extract(j.value,'$.product_discount_type')
        AND si.product_discount_label IS json_extract(j.value,'$.product_discount_label')
        AND si.manual_discount_usd IS json_extract(j.value,'$.manual_discount_usd') AND si.manual_discount_khr IS json_extract(j.value,'$.manual_discount_khr')
        AND si.manual_discount_type IS json_extract(j.value,'$.manual_discount_type') AND si.manual_discount_value IS json_extract(j.value,'$.manual_discount_value')
        AND si.price_mode IS json_extract(j.value,'$.price_mode') AND si.pricing_snapshot_json IS json_extract(j.value,'$.pricing_snapshot_json')))
    AND (SELECT COUNT(*) FROM returns r WHERE r.sale_id=json_extract(${param},'$.sale.id')
      AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.status,'completed')<>'cancelled')
      =json_array_length(${param},'$.prior_returns')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.prior_returns') j WHERE NOT EXISTS(
      SELECT 1 FROM returns r WHERE r.id=json_extract(j.value,'$.id') AND r.sale_id=json_extract(${param},'$.sale.id')
        AND r.money_precision_version IS json_extract(j.value,'$.money_precision_version')
        AND r.calculated_refund_usd IS json_extract(j.value,'$.calculated_refund_usd')
        AND r.rounding_adjustment_usd IS json_extract(j.value,'$.rounding_adjustment_usd')
        AND r.total_refund_usd IS json_extract(j.value,'$.total_refund_usd')
        AND r.status IS json_extract(j.value,'$.status') AND r.updated_at IS json_extract(j.value,'$.updated_at')
        AND COALESCE(r.return_scope,'customer')='customer' AND COALESCE(r.status,'completed')<>'cancelled'))
    AND (SELECT COUNT(*) FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE r.sale_id=json_extract(${param},'$.sale.id') AND COALESCE(r.return_scope,'customer')='customer'
        AND COALESCE(r.status,'completed')<>'cancelled')=json_array_length(${param},'$.prior_items')
    AND NOT EXISTS(SELECT 1 FROM json_each(${param},'$.prior_items') j WHERE NOT EXISTS(
      SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE ri.id=json_extract(j.value,'$.id') AND ri.return_id=json_extract(j.value,'$.return_id')
        AND r.sale_id=json_extract(${param},'$.sale.id') AND COALESCE(r.return_scope,'customer')='customer'
        AND COALESCE(r.status,'completed')<>'cancelled'
        AND ri.sale_item_id IS json_extract(j.value,'$.sale_item_id') AND ri.quantity IS json_extract(j.value,'$.quantity')
        AND ri.total_usd IS json_extract(j.value,'$.total_usd') AND ri.refund_snapshot_json IS json_extract(j.value,'$.refund_snapshot_json')))
  `
}
