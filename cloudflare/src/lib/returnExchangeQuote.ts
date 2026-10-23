import { branchCanSell } from './branchRoles'
import { WAREHOUSE_NOT_SELLABLE_ERROR } from './branchRoleGuards'
import { branchEffectRefusal, resolveBranchEffect, type BranchEffect, type BranchEffectRow } from './branchEffect'
import type { CustomerReturnQuotePlan } from './customerReturnQuotePlan'
import type { D1Compat } from './db'
import { multiplyMoney4 } from './moneyPrecision'
import type { PermissionUser } from './permissions'
import { productStockGuardError } from './productStockGuard'
import {
  buildExchangeQuoteV1, priceExchangeLines, ReturnExchangeError, type ExchangeLineIntent, type ExchangePricing, type ExchangeQuoteV1,
} from './returnExchange'
import type { ExchangeCatalogProduct } from './returnExchangeContext'
import { planReturnMoney, ReturnMoneyError, saleReturnMoney } from './returnRefundSplit'
import { canSetSalePrice, firstDisallowedReplacementPrice, RETURN_REPLACEMENT_PRICE_REFUSAL } from './returnReplacementPrice'
import { recordedSoldLinesForReplacement } from './returnsStock'

// The replacement side of an exchange, priced and quoted from what the refund quote already read. The quote route and the create call this
// ONE function, so the figure the till reviews is the figure the commit recomputes and compares.

export type ExchangeQuoteInputs = {
  db: D1Compat
  user: PermissionUser
  saleId: number
  plan: CustomerReturnQuotePlan
  /** The sale lines being returned (the quote's, or the create's merged lines). */
  returnedLines: ReadonlyArray<{ sale_item_id: number; product_id: number | null; quantity: number }>
  replacementIntents: readonly ExchangeLineIntent[]
  branches: readonly BranchEffectRow[]
  products: ReadonlyMap<number, ExchangeCatalogProduct>
  /** The branch the body names (else the sale's, else the first replacement line's). */
  bodyBranchId: unknown
  redirectTarget: number | null
  evaluatedAt: string
  /** The shop's change_exchange_rate setting (raw); the quote states the riel rate it implies. */
  changeRateSetting?: unknown
}

export type ExchangeQuoteResult =
  | {
    ok: true
    rate: number
    headerEffect: BranchEffect | null
    recordedBranchId: number | null
    branchId: number
    branchRow: BranchEffectRow
    replacementIntents: ExchangeLineIntent[]
    priced: ExchangePricing
    quote: ExchangeQuoteV1
    refundUsd: number
    refundKhr: number
    owedReductionUsd: number
    notPaid: boolean
  }
  | { ok: false; status: 400 | 403 | 409; body: Record<string, unknown> }

const positiveRate = (value: unknown): number | null => {
  const rate = Number(value)
  return value != null && value !== '' && Number.isFinite(rate) && rate > 0 ? rate : null
}
const recordedCost = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}
const SCHEMA_DEFAULT_EXCHANGE_RATE = 4100

export async function priceAndQuoteExchange(input: ExchangeQuoteInputs): Promise<ExchangeQuoteResult> {
  const fail = (status: 400 | 403 | 409, body: Record<string, unknown>): ExchangeQuoteResult => ({ ok: false, status, body })
  const sale = input.plan.authority.sale
  const soldLines = input.plan.authority.sale_items as Array<Record<string, any>>
  const rate = positiveRate(sale.exchange_rate) ?? SCHEMA_DEFAULT_EXCHANGE_RATE

  // Where the new goods leave from: the branch the body names, else the sale's, else the first line's. A retired branch is redirected to
  // its successor only on the operator's say-so (X-Branch-Redirect); every replacement line must leave from that one active, selling branch.
  const recordedBranchId = Number(input.bodyBranchId || sale.branch_id || input.replacementIntents[0]?.branch_id) || null
  let headerEffect: BranchEffect | null = null
  let replacementIntents: ExchangeLineIntent[]
  try {
    headerEffect = recordedBranchId ? resolveBranchEffect(input.branches, recordedBranchId, { sells: true, target: input.redirectTarget }) : null
    replacementIntents = input.replacementIntents.map((line) => {
      const effect = resolveBranchEffect(input.branches, line.branch_id || recordedBranchId, { sells: true, target: input.redirectTarget })
      return effect.redirected ? { ...line, branch_id: effect.effectBranchId } : line
    })
  } catch (error) {
    const stockGuard = productStockGuardError(error)
    if (stockGuard) return fail(409, { error: stockGuard.message, code: stockGuard.code })
    const refusal = branchEffectRefusal(error)
    if (refusal) return fail(409, refusal as Record<string, unknown>)
    throw error
  }
  const branchId = headerEffect?.redirected ? headerEffect.effectBranchId : recordedBranchId
  const branchRow = branchId ? input.branches.find((row) => Number(row.id) === branchId) ?? null : null
  if (!branchId || !branchRow || Number(branchRow.is_active || 0) !== 1 || !branchCanSell(branchRow)
    || replacementIntents.some((line) => Number(line.branch_id || branchId) !== branchId)) {
    return fail(400, { error: WAREHOUSE_NOT_SELLABLE_ERROR })
  }
  if (replacementIntents.some((line) => Number(input.products.get(line.product_id)?.is_active || 0) !== 1)) {
    return fail(400, { error: 'Each replacement line needs an active catalog product' })
  }

  let priced: ExchangePricing
  try {
    priced = priceExchangeLines({
      lines: replacementIntents.map((intent) => {
        const product = input.products.get(intent.product_id)!
        return {
          intent, branchId: Number(intent.branch_id || branchId),
          product: {
            id: product.id, name: product.name, selling_price_usd: product.selling_price_usd, selling_price_khr: product.selling_price_khr,
            cost_price_usd: product.cost_price_usd, cost_price_khr: product.cost_price_khr,
          },
          unitCostUsd: recordedCost(product.cost_price_usd), unitCostKhr: recordedCost(product.cost_price_khr),
        }
      }),
      exchangeRate: rate, evaluatedAt: input.evaluatedAt, poolKey: crypto.randomUUID(),
    })
  } catch (error) {
    if (error instanceof ReturnExchangeError) return fail(error.statusCode, { error: error.message, code: error.code })
    throw error
  }

  // A replacement is an exchange plus an optional extra purchase with no cap on its quantity. Only a caller who may set a price on a sale
  // may price it under the catalog / promotion price; the units a returned unit of the same product covers may sell down to the price the
  // original sale recorded, each returned unit at the sale line it came from (lib/returnReplacementPrice.ts, 6.0.960). v1 prices are dollars, with riel derived at the sale's rate on both sides.
  if (!canSetSalePrice(input.user)) {
    const offender = await firstDisallowedReplacementPrice(input.db, priced.lines.map((line) => {
      return {
        productId: line.product_id, quantity: line.quantity, priceUsd: line.unit_price_usd, priceKhr: line.unit_price_khr,
        catalogUsd: line.catalog_usd, catalogKhr: multiplyMoney4(line.catalog_usd, rate),
        returned: recordedSoldLinesForReplacement(soldLines as never, input.returnedLines, line.product_id, rate),
      }
    }), rate)
    if (offender) return fail(403, { ...RETURN_REPLACEMENT_PRICE_REFUSAL, product_id: offender.productId })
  }

  const refundUsd = input.plan.quote.total_refund_usd
  const refundKhr = input.plan.quote.total_refund_khr
  let owedReductionUsd = 0
  let notPaid = false
  const money = saleReturnMoney({ ...sale, id: input.saleId })
  try {
    const moneyPlan = planReturnMoney({
      sale: money.sale, recompute: [0],
      returns: [
        ...money.returns.map((row) => ({ id: Number(row.id), active: row.status !== 'cancelled', refundUsd: row.total_refund_usd, owedReductionUsd: row.owed_reduction_usd, currency: row.refund_currency })),
        { id: 0, active: true, refundUsd, owedReductionUsd: 0, currency: 'USD' },
      ],
    })
    owedReductionUsd = moneyPlan.owedReductionUsd.get(0) ?? 0
    notPaid = moneyPlan.saleReadsNotPaid
  } catch (error) {
    if (error instanceof ReturnMoneyError) return fail(409, { error: error.message, code: error.code })
    throw error
  }
  return {
    ok: true, rate, headerEffect, recordedBranchId, branchId, branchRow, replacementIntents, priced,
    quote: buildExchangeQuoteV1({ saleId: input.saleId, exchangeRate: rate, changeRateSetting: input.changeRateSetting, pricing: priced, refundUsd, owedReductionUsd, notPaid }),
    refundUsd, refundKhr, owedReductionUsd, notPaid,
  }
}
