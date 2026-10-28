import type { Context } from 'hono'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import type { D1Compat } from './db'
import { actorSnapshot } from './actorSnapshot'
import { isAnonymousCustomer } from './anonymousCustomer'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersions } from './cache'
import {
  BranchRetiredNoSuccessorError, branchEffectGuardPredicate, branchEffectGuards, branchEffectRefusal, branchRedirectTarget,
  foldedLotSurvivors, resolveBranchEffect, type BranchEffect,
} from './branchEffect'
import { contactDisplayAddress } from './contactOptions'
import { customerReturnAuthorityPredicate, customerReturnQuotePlanFromRows, publicCustomerReturnQuote } from './customerReturnQuotePlan'
import { loyaltyAccrualSql } from './loyaltyEligibility'
import { multiplyMoney4 } from './moneyPrecision'
import { isCashPaymentMethod, paymentMethodKey, parseConfiguredMethods, parsePaymentMethodKinds } from './paymentMethodRegistry'
import { productStockGuardError, PRODUCT_HAS_STOCK_CODE, PRODUCT_HAS_STOCK_MESSAGE } from './productStockGuard'
import { businessDateTimeId } from './receiptNumber'
import { fillOmittedReturnCosts } from './returnCostAccess'
import {
  assertReturnCreatePlanBounds, assertReturnCreateQueryBudget, projectedReturnStateForReturnCreateV1, replacementSaleIdSql,
  returnCreateGuardStatement, returnCreateIdSql, returnCreateOwnMovementCountSql, returnCreatePreconditionSql, ReturnCreateBudgetError,
  RETURN_CREATE_REQUEST_BYTES, type ReturnCreateResponse, type ReturnCreateStatement,
} from './returnCreateAction'
import { ReturnExchangeError, settleExchange, type ExchangeLineIntent, type ExchangePaymentIntent } from './returnExchange'
import { priceAndQuoteExchange } from './returnExchangeQuote'
import { exchangeContextQuery, ExchangeContextTooLargeError, firstFreeNumber, numberCandidates, parseExchangeContext, type ExchangeContext, type ExchangeContextRow } from './returnExchangeContext'
import { planExchangeReturnLots, planExchangeStock, type ExchangeReturnLine, type ExchangeStockAction } from './returnExchangePlan'
import {
  branchStockStatement, exchangePostconditionSql, exchangeSaleRows, fallbackLotStatement, lotReceivedStatement, lotStockStatement,
  movementsStatement, productStockStatement, replacementItemsStatement, returnAllocationsStatement, returnItemsStatement,
  saleAllocationsStatement, saleItemsStatement,
  type ExchangeLotDelta, type ExchangeMovementRow, type ExchangeReturnAllocationRow, type ExchangeReturnItemRow,
} from './returnExchangeWrite'
import { refundCashOut, saleReturnTagWrite } from './returnRefundSplit'
import { DAMAGE_IN_MOVEMENT, planDamagedReturnLine, REPLACEMENT_OUT_MOVEMENT, resolveDamagedReturnChoice } from './returnsStock'
import { buildSaleCreationSnapshot } from './saleCreationSnapshot'
import { SaleMoneyContractError } from './saleMoneyPrecision'
import { buildSaleRecordEventsInsert, sha256Hex } from './saleRecordEvents'
import { normalizeSearchText } from './searchMatch'
import { executeStockTransaction, stockTransactionRefusal } from './stockTransaction'
import { recordStockCrossings } from './stockCrossingAlert'
import { TAGGED_DISPOSAL_MOVEMENT_TYPE } from './stockCondition'
import { formatSaleTelegramLines, sendReturnTelegramEvent } from './telegram'

// POST /api/returns for a money-v1 sale with replacement lines: the one-step exchange (owner, 22 Oct 2026). The shared prefix of
// createCustomerReturn (permission, request id, canonical intent, idempotency receipt) has already run; everything from the first
// read onwards is here, built so a Cloudflare Free invocation (50 D1 queries) can carry it: ONE read, then one set-based atomic write
// whose statement count does not grow with the number of lines (lib/returnExchangeContext.ts, lib/returnExchangeWrite.ts).
// The money model is documented in lib/returnExchange.ts.

type Ctx = Context<{ Bindings: Env; Variables: { user: SessionUser } }>

export type ExchangeCreateArgs = {
  c: Ctx
  db: D1Compat
  user: SessionUser
  actorId: number
  body: Record<string, any>
  intent: Record<string, any>
  requestJson: string
  requestDigest: string
  saleId: number
  clientRequestId: string
  movementIdFloor: number
  queryLimit: number
  /** The invocation's D1 statements so far, counted the way the plain create counts them. */
  statementsUsed: () => number
  /** The atomic batch is about to spend this many statements. */
  addStatements: (count: number) => void
  /** Re-reads the idempotency receipt after an ambiguous commit. */
  readReceipt: () => Promise<{ return_id: number; sale_id: number | null; request_digest: string; response_json: string } | undefined>
}

type Intent = {
  reason: string
  return_type: string
  notes: string | null
  items: Array<{ sale_item_id: number; quantity: number; stock_action: ExchangeStockAction; branch_id: number | null; batch_id: number | null; condition_tag?: string; damaged_disposition?: string }>
  replacement_items: ExchangeLineIntent[]
  expected_quote: unknown
  expected_exchange: unknown
  exchange_payment: ExchangePaymentIntent
}

const recordedCost = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export async function createExchangeReturnV1(args: ExchangeCreateArgs): Promise<Response> {
  const { c, db, user, body, requestJson, requestDigest, saleId, clientRequestId } = args
  const intent = args.intent as unknown as Intent
  const actorId = args.actorId
  const actorName = actorSnapshot(user)
  const reason = String(intent.reason)
  const reply = (status: number, payload: Record<string, unknown>) => c.json(payload, status as 400)
  const guardMapped = (error: unknown): Response | null => {
    const stockGuard = productStockGuardError(error)
    return stockGuard ? reply(409, { error: stockGuard.message, code: stockGuard.code }) : null
  }

  // ---- the one read -----------------------------------------------------------------------------------------------------
  const now = new Date()
  const stamp = businessDateTimeId(now)
  const returnCandidates = numberCandidates(`RET-${stamp}`)
  const receiptCandidates = numberCandidates(stamp)
  const query = exchangeContextQuery({
    saleId,
    saleItemIds: intent.items.map((item) => item.sale_item_id),
    replacementProductIds: intent.replacement_items.map((line) => line.product_id),
    explicitBatchIds: [...intent.items.map((item) => item.batch_id), ...intent.replacement_items.map((line) => line.batch_id)].filter((id): id is number => id != null),
    returnNumbers: returnCandidates,
    receiptNumbers: receiptCandidates,
    customerId: Number(body.customer_id) > 0 ? Number(body.customer_id) : null,
  })
  let ctx: ExchangeContext
  try {
    ctx = parseExchangeContext(await db.prepare(query.sql).get<ExchangeContextRow>(query.params))
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    if (error instanceof ExchangeContextTooLargeError) return reply(400, { error: error.message, code: 'return_exchange_too_large' })
    throw error
  }

  // ---- the money-v1 refund quote: the same authority and the same comparison as a plain return ---------------------------------
  let plan: Awaited<ReturnType<typeof customerReturnQuotePlanFromRows>>
  try {
    plan = await customerReturnQuotePlanFromRows(db, saleId, intent.items.map((item) => ({ sale_item_id: item.sale_item_id, quantity: item.quantity })), ctx)
    if (JSON.stringify(publicCustomerReturnQuote(plan.quote)) !== JSON.stringify(intent.expected_quote)) {
      return reply(409, { error: 'The refund quote changed. Review it before recording the return.', code: 'customer_return_quote_stale', action: 'review_required' })
    }
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const mapped = guardMapped(error)
    if (mapped) return mapped
    if (error instanceof SaleMoneyContractError) return reply(409, { error: error.message, code: error.message, action: 'review_required' })
    throw error
  }
  const sale = plan.authority.sale
  const soldLines = plan.authority.sale_items as Array<Record<string, any>>
  const soldById = new Map(soldLines.map((line) => [Number(line.id), line]))
  const saleWriteRevision = Number(sale.sale_revision)
  const beforeSaleStatus = String(sale.sale_status || 'completed')

  // ---- the lines being returned ----------------------------------------------------------------------------------------------
  type MergedLine = ExchangeReturnLine & { condition_tag?: string; damaged_disposition?: string }
  let returnLines: MergedLine[] = intent.items.map((item) => {
    const sold = soldById.get(item.sale_item_id)!
    return {
      sale_item_id: item.sale_item_id, product_id: sold.product_id == null ? null : Number(sold.product_id),
      product_name: (sold.product_name as string | null) ?? null, quantity: item.quantity,
      branch_id: sold.branch_id == null ? item.branch_id : Number(sold.branch_id), batch_id: item.batch_id,
      stock_action: item.stock_action, cost_price_usd: sold.cost_price_usd == null ? null : Number(sold.cost_price_usd),
      cost_price_khr: sold.cost_price_khr == null ? null : Number(sold.cost_price_khr),
      sold_batch_id: sold.batch_id == null ? null : Number(sold.batch_id), effect: null,
      ...(item.condition_tag ? { condition_tag: item.condition_tag } : {}),
      ...(item.damaged_disposition ? { damaged_disposition: item.damaged_disposition } : {}),
    }
  })
  for (const line of returnLines) {
    if (line.stock_action !== 'damaged') continue
    const choice = resolveDamagedReturnChoice(line)
    if (!choice.ok) return reply(400, { error: choice.error })
  }
  const committedReturnLines = plan.authority.prior_items.map((line) => ({ sale_item_id: line.sale_item_id == null ? null : Number(line.sale_item_id), quantity: Number(line.quantity) }))
  let projectedTag: ReturnType<typeof projectedReturnStateForReturnCreateV1>
  try {
    projectedTag = projectedReturnStateForReturnCreateV1(soldLines as Array<{ id: number; quantity: number }>, committedReturnLines, returnLines)
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const mapped = guardMapped(error)
    if (mapped) return mapped
    return reply(409, { error: (error as Error).message, code: 'customer_return_quote_stale', action: 'review_required' })
  }

  // ---- the replacement sale: where it leaves from, its prices, the debt, the quote the till reviewed -----------------------------
  const occurredAt = now.toISOString()
  const redirectTarget = branchRedirectTarget(c)
  const quoted = await priceAndQuoteExchange({
    db, user, saleId, plan, returnedLines: returnLines, replacementIntents: intent.replacement_items, branches: ctx.branches, products: ctx.products,
    bodyBranchId: body.branch_id, redirectTarget, evaluatedAt: occurredAt, changeRateSetting: ctx.settings.change_exchange_rate,
  })
  if (!quoted.ok) return reply(quoted.status, quoted.body)
  const { rate, headerEffect, recordedBranchId, branchId, branchRow, replacementIntents, priced, quote: exchangeQuote, refundUsd, refundKhr, owedReductionUsd, notPaid } = quoted
  if (JSON.stringify(exchangeQuote) !== JSON.stringify(intent.expected_exchange)) {
    return reply(409, { error: 'The replacement changed. Review it before recording the return.', code: 'customer_return_quote_stale', action: 'review_required' })
  }
  // Each returned line lands on its own branch, redirected like the header when that branch is retired.
  try {
    returnLines = returnLines.map((line) => {
      const recorded = Number(line.branch_id || recordedBranchId) || null
      try {
        const effect = recorded ? resolveBranchEffect(ctx.branches, recorded, { target: redirectTarget }) : null
        return { ...line, effect, branch_id: effect?.redirected ? effect.effectBranchId : line.branch_id }
      } catch (error) {
        // A line that moves no stock has nothing to strand, so it never blocks.
        if (!(error instanceof BranchRetiredNoSuccessorError) || line.stock_action !== 'none') throw error
        return { ...line, effect: null }
      }
    })
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const mapped = guardMapped(error)
    if (mapped) return mapped
    const refusal = branchEffectRefusal(error)
    if (refusal) return reply(409, refusal as Record<string, unknown>)
    throw error
  }
  const addressedLabel = (effect: BranchEffect): string | null =>
    (Number(sale.branch_id) === effect.addressedBranchId && (sale.branch_name as string | null)) || effect.addressedName
  const addressedBranchName = headerEffect?.redirected ? addressedLabel(headerEffect) : null
  const branchName = branchRow.name ?? null

  // ---- costs, and the products a restock may reach ------------------------------------------------------------------------------
  try {
    returnLines = returnLines.map((line) => ({
      ...line,
      ...fillOmittedReturnCosts({ ...line, id: line.sale_item_id } as never, soldLines as never, 'sale'),
    }))
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const mapped = guardMapped(error)
    if (mapped) return mapped
    return reply(409, { error: (error as Error).message, code: 'return_cost_source_review_required' })
  }
  // Stock can only be added to a product that has not been removed (the guard a receive carries).
  if (returnLines.some((line) => line.stock_action === 'restock' && line.product_id && Number(ctx.products.get(line.product_id)?.is_active || 0) !== 1)) {
    return reply(409, { error: PRODUCT_HAS_STOCK_MESSAGE, code: PRODUCT_HAS_STOCK_CODE })
  }

  // ---- the tender -----------------------------------------------------------------------------------------------------------------
  const configuredMethods = parseConfiguredMethods(ctx.settings.pos_payment_methods)
  const kinds = parsePaymentMethodKinds(ctx.settings.pos_payment_method_kinds)
  const cashMethod = configuredMethods.find((method) => isCashPaymentMethod(method, kinds)) ?? 'Cash'
  if (configuredMethods.length) {
    const known = new Set(configuredMethods.map(paymentMethodKey))
    if (intent.exchange_payment.details.some((row) => !known.has(paymentMethodKey(row.method)))) {
      return reply(400, { error: "Choose one of the shop's payment methods.", code: 'return_exchange_payment_method' })
    }
  }
  let settlement: ReturnType<typeof settleExchange>
  try {
    settlement = settleExchange({
      totalUsd: priced.total_usd, creditUsd: exchangeQuote.credit_usd, cashMethod, payment: intent.exchange_payment,
      exchangeRate: rate, changeRateSetting: ctx.settings.change_exchange_rate, notPaid,
    })
  } catch (error) {
    if (error instanceof ReturnExchangeError) return reply(error.statusCode, { error: error.message, code: error.code })
    throw error
  }

  // ---- the stock: lots out and in, decided before any write ---------------------------------------------------------------------
  const productNames = new Map([...ctx.products.values()].map((product) => [product.id, product.name] as const))
  const lots = planExchangeReturnLots(returnLines, ctx, productNames, branchId)
  if (!lots.ok) return reply(lots.refusal.status, lots.refusal.body)
  // A return redirected to the successor gives its units back to the lot that is there NOW: a lot the consolidation folded into another
  // is restocked as that survivor, never as the folded id.
  const lotSurvivors = new Map<string, number>()
  const redirectedEffectIds = [...new Set(returnLines.filter((line) => line.effect?.redirected).map((line) => line.effect!.effectBranchId))]
  for (const effectId of redirectedEffectIds) {
    const wanted = returnLines.flatMap((line, index) => line.effect?.effectBranchId === effectId && line.effect.redirected
      ? [...lots.lotPlans[index].splits.map((split) => split.batchId), ...(line.sold_batch_id ? [line.sold_batch_id] : [])] : [])
    for (const [folded, survivor] of await foldedLotSurvivors(db, effectId, wanted)) lotSurvivors.set(`${effectId}:${folded}`, survivor)
  }
  const stock = planExchangeStock({
    ctx, returnLines, lotPlans: lots.lotPlans, lotSurvivors, headerBranchId: branchId, clientRequestId, occurredAt,
    replacementLines: priced.lines.map((line, index) => ({
      productId: line.product_id, productName: line.product_name, branchId: line.branch_id, batchId: replacementIntents[index].batch_id, quantity: line.quantity,
    })),
  })
  if (!stock.ok) return reply(stock.refusal.status, stock.refusal.body)

  // ---- the customer on the replacement sale ----------------------------------------------------------------------------------
  const candidateCustomerId = Number(body.customer_id || sale.customer_id) || null
  const candidateCustomer = candidateCustomerId && ctx.customer?.id === candidateCustomerId ? ctx.customer : null
  const customerGuard = candidateCustomerId ? {
    customer_id: candidateCustomerId, exists: candidateCustomer ? 1 : 0, is_anonymous: Number(candidateCustomer?.is_anonymous || 0),
    membership_number: candidateCustomer?.membership_number || '',
  } : null
  const anonymous = isAnonymousCustomer(candidateCustomer)
  const saleCustomerId = candidateCustomer && !anonymous ? candidateCustomerId : null
  const saleCustomerName = anonymous ? null : (body.customer_name as string | undefined) || (sale.customer_name as string | null) || null
  const saleCustomerPhone = anonymous ? null : (sale.customer_phone as string | null) || null
  const saleCustomerAddress = anonymous ? null : contactDisplayAddress(sale.customer_address as string | null) || null
  const membershipNumber = candidateCustomer && !anonymous ? candidateCustomer.membership_number || null : null

  // ---- identity of everything this request writes ------------------------------------------------------------------------------
  const returnNumber = (intent as unknown as { return_number?: string | null }).return_number || firstFreeNumber(returnCandidates, ctx.takenReturnNumbers)
  const replacementReceiptNumber = firstFreeNumber(receiptCandidates, ctx.takenReceiptNumbers)
  const receiptId = crypto.randomUUID()
  const operationId = crypto.randomUUID()
  const replacementClientRequestId = `return-replacement:${await sha256Hex(`${actorId}:${clientRequestId}`)}`
  const returnIdSql = returnCreateIdSql()
  const saleIdSql = replacementSaleIdSql()
  const originalReceipt = (body.receipt_number as string | undefined) || (sale.receipt_number as string | null) || null
  const saleStatus = settlement.saleStatus
  const subtotalKhr = multiplyMoney4(priced.subtotal_usd, rate)

  const creationSnapshot = buildSaleCreationSnapshot({
    moneyPrecisionVersion: 1, calculatedTotalUsd: priced.calculated_total_usd, roundingAdjustmentUsd: priced.rounding_adjustment_usd,
    origin: 'return_replacement', recordedAt: occurredAt, saleAt: occurredAt, receiptNumber: replacementReceiptNumber, actor: user,
    cashierId: actorId, cashierName: actorName, saleStatus,
    items: priced.lines.map((line) => ({ product_id: line.product_id, product_name: line.product_name, quantity: line.quantity, unitPriceUsd: line.unit_price_usd, lineTotalUsd: line.total_usd })),
    totalUsd: priced.total_usd, paymentMethod: settlement.paymentMethod || null, paymentDetails: settlement.paymentDetails,
    amountPaidUsd: settlement.amountPaidUsd, amountPaidKhr: settlement.amountPaidKhr,
    changeUsd: settlement.change.changeUsd, changeKhr: settlement.change.changeKhr, isDelivery: false, deliveryFeeUsd: 0,
    customerSnapshot: saleCustomerId || String(saleCustomerName ?? '').trim() ? { id: saleCustomerId, name: saleCustomerName } : null,
    membershipSnapshot: membershipNumber ? { number: membershipNumber, discountUsd: 0, discountKhr: 0, pointsRedeemed: 0 } : null,
  })
  const replacementNotice = {
    status: saleStatus, createdAt: occurredAt, receiptNumber: replacementReceiptNumber, cashier: actorName, customer: saleCustomerName,
    phone: saleCustomerPhone, branch: branchName,
    items: priced.lines.map((line) => ({ name: line.product_name, quantity: line.quantity, unitPriceUsd: line.unit_price_usd, basePriceUsd: null, lineTotalUsd: line.total_usd })),
    exchangeRate: rate, isDelivery: false, deliveryFeeUsd: 0, deliveryPaidBy: null, driver: null,
    subtotalUsd: priced.subtotal_usd, discountUsd: 0, taxUsd: 0, totalUsd: priced.total_usd, totalKhr: priced.total_khr,
    paidUsd: settlement.amountPaidUsd, paidKhr: settlement.amountPaidKhr, changeUsd: settlement.change.changeUsd, changeKhr: settlement.change.changeKhr,
    paymentMethod: settlement.paymentMethod || null,
  }

  // ---- the guard: exactly what was read ---------------------------------------------------------------------------------------
  const restockProductIds = new Set(returnLines.filter((line) => line.stock_action === 'restock' && line.product_id).map((line) => Number(line.product_id)))
  const productIds = [...new Set([...returnLines.map((line) => Number(line.product_id)), ...priced.lines.map((line) => line.product_id)].filter((id) => Number.isSafeInteger(id) && id > 0))]
  const replacementProductIds = new Set(priced.lines.map((line) => line.product_id))
  const guardState = {
    sale: { id: saleId, revision: saleWriteRevision, status: beforeSaleStatus, status_before_return: (sale.status_before_return as string | null) || '' },
    branch: { id: Number(branchRow.id), name: branchRow.name || '', is_active: Number(branchRow.is_active || 0) },
    products: productIds.map((id) => {
      const product = ctx.products.get(id)
      return {
        id, updated_at: product?.updated_at || '', name: product?.name || '', is_active: Number(product?.is_active || 0),
        requires_active: replacementProductIds.has(id) || restockProductIds.has(id) ? 1 : 0,
        cost_price_usd: recordedCost(product?.cost_price_usd), cost_price_khr: recordedCost(product?.cost_price_khr),
        selling_price_usd: Number(product?.selling_price_usd) || 0, selling_price_khr: Number(product?.selling_price_khr) || 0,
      }
    }),
    customer: customerGuard,
    branch_stock: stock.plan.branchSnapshots,
    batch_stock: stock.plan.batchSnapshots,
  }
  const guardJson = JSON.stringify(guardState)
  if (new TextEncoder().encode(guardJson).byteLength > RETURN_CREATE_REQUEST_BYTES) throw new ReturnCreateBudgetError()
  const effectGuards = branchEffectGuards([headerEffect, ...returnLines.map((line) => line.effect)].filter((effect): effect is BranchEffect => !!effect), true)
  const commonGuardParams = {
    guardJson, receiptId, actorId, requestId: clientRequestId, requestDigest, returnNumber, replacementClientRequestId, replacementReceiptNumber,
    customerReturnAuthorityJson: plan.authority_json,
    ...(effectGuards.length ? { effectsJson: JSON.stringify(effectGuards) } : {}),
    ...plan.lineage.params,
  }
  const precondition = returnCreatePreconditionSql({
    authorityPredicate: customerReturnAuthorityPredicate(), lineageCondition: plan.lineage.condition,
    effectGuardPredicate: effectGuards.length ? branchEffectGuardPredicate('@effectsJson') : null,
  })

  // ---- rows ---------------------------------------------------------------------------------------------------------------------
  const quoteItems = new Map(plan.quote.items.map((item) => [item.sale_item_id, item]))
  const effectiveBatchId = (index: number, batchId: number | null): number | null => {
    const effect = returnLines[index].effect
    return batchId != null && effect?.redirected ? lotSurvivors.get(`${effect.effectBranchId}:${batchId}`) ?? batchId : batchId
  }
  const returnItemRows: ExchangeReturnItemRow[] = []
  const returnAllocationRows: ExchangeReturnAllocationRow[] = []
  const movementRows: ExchangeMovementRow[] = []
  const damagedStatements: ReturnCreateStatement[] = []
  let movementCount = 0
  returnLines.forEach((line, index) => {
    const quote = quoteItems.get(line.sale_item_id)!
    const productId = Number(line.product_id) || null
    const lineBranchId = Number(line.branch_id || branchId) || null
    const productName = line.product_name?.trim() || (productId ? ctx.products.get(productId)?.name : null) || null
    const lotPlan = stock.plan.lotPlans[index]
    const fallback = stock.plan.fallbackLots.find((lot) => lot.lineIndex === index) ?? null
    const recordedBatchId = lotPlan.splits.length === 1 && lotPlan.splits[0].quantity === line.quantity ? lotPlan.splits[0].batchId : null
    const fallbackKey = fallback && !lotPlan.splits.length ? fallback.batchKey : null
    if (line.stock_action === 'damaged' && productId && lineBranchId) {
      const choice = resolveDamagedReturnChoice(line)
      if (choice.ok) {
        damagedStatements.push(...planDamagedReturnLine({
          productId, productName, branchId: lineBranchId, batchId: effectiveBatchId(index, line.sold_batch_id), returnIdSql, quantity: line.quantity, reason,
          userId: actorId, userName: actorName, tag: choice.tag, disposition: choice.disposition, unitCostUsd: line.cost_price_usd, unitCostKhr: line.cost_price_khr,
        }).map((statement) => ({ sql: statement.sql, params: { ...(statement.params as Record<string, unknown>), returnClientRequestId: clientRequestId } })))
        movementCount += choice.disposition === 'remove' ? 2 : 1
      }
    }
    returnItemRows.push({
      sale_item_id: line.sale_item_id, product_id: productId, product_name: productName, quantity: line.quantity,
      applied_price_usd: quote.applied_price_usd, applied_price_khr: quote.applied_price_khr,
      cost_price_usd: line.cost_price_usd, cost_price_khr: line.cost_price_khr, total_usd: quote.total_usd, total_khr: quote.total_khr,
      return_to_stock: line.stock_action === 'restock' ? 1 : 0, stock_action: line.stock_action, branch_id: lineBranchId,
      batch_id: recordedBatchId, fallback_key: fallbackKey, refund_snapshot_json: quote.refund_snapshot_json ?? null,
    })
    if (line.stock_action === 'restock' && productId && lineBranchId) {
      for (const split of lotPlan.splits) {
        returnAllocationRows.push({ sale_item_id: line.sale_item_id, product_id: productId, branch_id: lineBranchId, quantity: split.quantity, batch_id: split.batchId, fallback_key: null })
      }
      if (fallback) {
        returnAllocationRows.push({ sale_item_id: line.sale_item_id, product_id: productId, branch_id: lineBranchId, quantity: lotPlan.plainQuantity, batch_id: null, fallback_key: fallback.batchKey })
      }
      const redirect = line.effect?.redirected ? line.effect : null
      movementRows.push({
        movement_type: 'return', product_id: productId, product_name: productName, branch_id: lineBranchId,
        branch_name: redirect?.effectName ?? null, addressed_branch_name: redirect ? addressedLabel(redirect) : null,
        quantity: line.quantity, unit_cost_usd: line.cost_price_usd, unit_cost_khr: line.cost_price_khr,
        reason: `Return: ${reason}${redirect ? ` (sale at ${addressedLabel(redirect)})` : ''}`, batch_id: recordedBatchId, fallback_key: fallbackKey,
      })
      movementCount += 1
    }
  })
  priced.lines.forEach((line, index) => {
    movementRows.push({
      movement_type: REPLACEMENT_OUT_MOVEMENT, product_id: line.product_id, product_name: line.product_name, branch_id: line.branch_id,
      branch_name: null, addressed_branch_name: null, quantity: -line.quantity, unit_cost_usd: line.cost_price_usd, unit_cost_khr: line.cost_price_khr,
      reason: `Replacement for return #${returnNumber}`, batch_id: replacementIntents[index].batch_id, fallback_key: null,
    })
    movementCount += 1
  })
  const saleRows = exchangeSaleRows(priced.lines, stock.plan.replacementTakes, replacementIntents.map((line) => line.batch_id))
  const lotDeltas: ExchangeLotDelta[] = [
    ...stock.plan.batchSnapshots.map((row) => ({ batch_id: row.batch_id, product_id: row.product_id, fallback_key: null, branch_id: row.branch_id, delta: row.delta })),
    ...stock.plan.fallbackLots.map((lot) => ({ batch_id: null, product_id: lot.productId, fallback_key: lot.batchKey, branch_id: lot.branchId, delta: lot.quantity })),
  ]

  // ---- the statements -------------------------------------------------------------------------------------------------------------
  const statements: ReturnCreateStatement[] = [returnCreateGuardStatement(operationId, 'precondition', precondition, commonGuardParams)]
  const push = (statement: ReturnCreateStatement | null) => { if (statement) statements.push(statement) }
  statements.push({
    sql: `INSERT INTO returns(
      return_number,client_request_id,sale_id,receipt_number,cashier_id,cashier_name,
      customer_id,customer_name,branch_id,branch_name,return_scope,reason,return_type,
      notes,total_refund_usd,total_refund_khr,exchange_rate,status,search_normalized,
      money_precision_version,calculated_refund_usd,rounding_adjustment_usd,refund_currency,owed_reduction_usd${addressedBranchName ? ',addressed_branch_name' : ''}
    ) VALUES(
      @return_number,@returnClientRequestId,@sale_id,@receipt_number,@cashier_id,@cashier_name,
      @customer_id,@customer_name,@branch_id,@branch_name,'customer',@reason,@return_type,
      @notes,@total_refund_usd,@total_refund_khr,@exchange_rate,'completed',@search_normalized,
      1,@calculated_refund_usd,@rounding_adjustment_usd,'USD',@owed_reduction_usd${addressedBranchName ? ',@addressed_branch_name' : ''}
    )`,
    params: {
      return_number: returnNumber, returnClientRequestId: clientRequestId, sale_id: saleId, receipt_number: originalReceipt,
      cashier_id: actorId, cashier_name: actorName,
      customer_id: body.customer_id || sale.customer_id || null, customer_name: body.customer_name || sale.customer_name || null,
      branch_id: branchId, branch_name: branchName, reason,
      ...(addressedBranchName ? { addressed_branch_name: addressedBranchName } : {}),
      return_type: String(intent.return_type), notes: intent.notes,
      total_refund_usd: refundUsd, total_refund_khr: refundKhr, owed_reduction_usd: owedReductionUsd, exchange_rate: Number(sale.exchange_rate),
      calculated_refund_usd: plan.quote.calculated_refund_usd, rounding_adjustment_usd: plan.quote.rounding_adjustment_usd,
      search_normalized: normalizeSearchText([returnNumber, originalReceipt, actorName, body.customer_name || sale.customer_name, branchName, reason, intent.return_type, intent.notes].filter(Boolean).join(' ')),
    },
  })
  statements.push({
    sql: `INSERT INTO sales(
      receipt_number,client_request_id,cashier_id,cashier_name,branch_id,branch_name,
      customer_id,customer_name,customer_phone,customer_address,payment_method,payment_details,
      payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
      total_usd,total_khr,money_precision_version,calculated_total_usd,rounding_adjustment_usd,
      amount_paid_usd,amount_paid_khr,change_usd,change_khr,change_is_actual,change_exchange_rate,
      membership_discount_usd,membership_discount_khr,membership_points_redeemed,is_delivery,
      loyalty_accrual,sale_status,notes,items,search_normalized,source_return_id,creation_snapshot_json,updated_at
    ) VALUES(
      @receipt_number,@replacementClientRequestId,@cashier_id,@cashier_name,@branch_id,@branch_name,
      @customer_id,@customer_name,@customer_phone,@customer_address,@payment_method,@payment_details,
      'USD',@exchange_rate,@subtotal_usd,@subtotal_khr,0,0,0,0,
      @total_usd,@total_khr,1,@calculated_total_usd,@rounding_adjustment_usd,
      @amount_paid_usd,@amount_paid_khr,@change_usd,@change_khr,@change_is_actual,@change_exchange_rate,
      0,0,0,0,${loyaltyAccrualSql()},@sale_status,@notes,@items,@search_normalized,${returnIdSql},@creation_snapshot_json,@occurredAt
    )`,
    params: {
      receipt_number: replacementReceiptNumber, replacementClientRequestId, cashier_id: actorId, cashier_name: actorName,
      branch_id: branchId, branch_name: branchName, customer_id: saleCustomerId, customer_name: saleCustomerName,
      customer_phone: saleCustomerPhone, customer_address: saleCustomerAddress,
      payment_method: settlement.paymentMethod || null, payment_details: JSON.stringify(settlement.paymentDetails), exchange_rate: rate,
      subtotal_usd: priced.subtotal_usd, subtotal_khr: subtotalKhr, total_usd: priced.total_usd, total_khr: priced.total_khr,
      calculated_total_usd: priced.calculated_total_usd, rounding_adjustment_usd: priced.rounding_adjustment_usd,
      amount_paid_usd: settlement.amountPaidUsd, amount_paid_khr: settlement.amountPaidKhr,
      change_usd: settlement.change.changeUsd, change_khr: settlement.change.changeKhr,
      change_is_actual: settlement.change.changeIsActual, change_exchange_rate: settlement.change.changeExchangeRate,
      sale_status: saleStatus, notes: `Replacement for return ${returnNumber}${originalReceipt ? ` / receipt ${originalReceipt}` : ''}`,
      items: JSON.stringify(saleRows.items.map((item, position) => ({
        // The catalog price the line was priced against: what a later cancel of the return holds the units that stay to (they sold at it or under it only because of the return).
        catalog_usd: priced.lines[position].catalog_usd,
        product_id: item.product_id, product_name: item.product_name, quantity: item.quantity,
        applied_price_usd: item.applied_price_usd, applied_price_khr: item.applied_price_khr, base_price_usd: item.base_price_usd, base_price_khr: item.base_price_khr,
        total_usd: item.total_usd, total_khr: item.total_khr, cost_price_usd: item.cost_price_usd, cost_price_khr: item.cost_price_khr,
        branch_id: item.branch_id, batch_id: item.batch_id, batch_label: item.batch_label, batch_expiry_date: item.batch_expiry_date,
      }))),
      search_normalized: normalizeSearchText([replacementReceiptNumber, returnNumber, originalReceipt, actorName, saleCustomerName, branchName, ...priced.lines.map((line) => line.product_name)].filter(Boolean).join(' ')),
      returnClientRequestId: clientRequestId, creation_snapshot_json: creationSnapshot, occurredAt,
    },
  })
  statements.push({
    sql: `UPDATE returns SET replacement_sale_id=${saleIdSql},updated_at=@occurredAt WHERE id=${returnIdSql}`,
    params: { replacementClientRequestId, returnClientRequestId: clientRequestId, occurredAt },
  })
  statements.push(...damagedStatements)
  push(returnItemsStatement(returnItemRows, clientRequestId))
  push(returnAllocationsStatement(returnAllocationRows, clientRequestId))
  for (const lot of stock.plan.fallbackLots) statements.push(fallbackLotStatement(lot))
  push(lotReceivedStatement(stock.plan.lotRestocks))
  push(lotStockStatement(lotDeltas))
  push(branchStockStatement(stock.plan.branchSnapshots))
  push(productStockStatement(stock.plan.touchedProductIds))
  push(movementsStatement(movementRows, { clientRequestId, userId: actorId, userName: actorName }))
  push(saleItemsStatement(saleRows.items, replacementClientRequestId))
  push(replacementItemsStatement(saleRows.replacements, { clientRequestId, replacementClientRequestId }))
  push(saleAllocationsStatement(saleRows.allocations, replacementClientRequestId))
  let eventBytes = 0
  // Only the return tag moves (owner, 20 Oct 2026), and the sale write and its Records line only when it does.
  const tagWrite = saleReturnTagWrite(sale as never, projectedTag, saleId, occurredAt)
  const saleStatusAfter = tagWrite ? tagWrite.saleStatusAfter : beforeSaleStatus
  if (tagWrite) {
    statements.push(tagWrite.statement)
    const event = buildSaleRecordEventsInsert([{
      saleId, sourceKind: 'return_create', sourceId: receiptId, generation: 0, kind: 'status_changed', via: 'apply', subject: returnNumber,
      actorId, actorUsername: actorName, occurredAt,
      changes: [{ field: 'sale_status', before: { state: 'known_value', value: tagWrite.before }, after: { state: 'known_value', value: tagWrite.after } }],
    }])!
    statements.push(event.statement)
    eventBytes = event.eventsBytes
  }
  const auditDetails = JSON.stringify({
    source_kind: 'return_create', source_id: receiptId, generation: 0, sale_id: saleId, return_number: returnNumber,
    return_items: returnLines.length, replacement_items: priced.lines.length, event_recorded: eventBytes > 0,
    exchange: { total_usd: priced.total_usd, refund_usd: refundUsd, credit_usd: exchangeQuote.credit_usd, net_usd: exchangeQuote.net_usd },
    ...(addressedBranchName ? { branch_id: branchId, addressed_branch_id: headerEffect!.addressedBranchId, addressed_branch_name: addressedBranchName } : {}),
  })
  statements.push({
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
      VALUES(@userId,@userName,'create','return_create',@receiptId,@details,'returns',${returnIdSql},@details)`,
    params: { userId: actorId, userName: actorName, receiptId, details: auditDetails, returnClientRequestId: clientRequestId },
  })
  const receiptResultIndex = statements.length
  statements.push({
    sql: `INSERT INTO return_create_receipts(
      id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at
    ) VALUES(
      @receiptId,@actorId,${returnIdSql},@saleId,@requestId,@requestDigest,@requestJson,
      json_object('id',${returnIdSql},'returnNumber',@returnNumber,'replacementSaleId',${saleIdSql},'replacementReceiptNumber',@replacementReceiptNumber),@occurredAt
    ) RETURNING return_id,sale_id,request_digest,response_json`,
    params: {
      receiptId, actorId, returnClientRequestId: clientRequestId, replacementClientRequestId, saleId, requestId: clientRequestId,
      requestDigest, requestJson, returnNumber, replacementReceiptNumber, occurredAt,
    },
  })
  const expected = {
    return_items: returnLines.length, return_allocations: stock.plan.returnAllocationCount,
    replacement_items: priced.lines.length, sale_allocations: stock.plan.saleAllocationCount,
    movements: movementCount, event: eventBytes > 0 ? 1 : 0,
    sale_status: saleStatusAfter, tag: tagWrite ? { value: projectedTag } : null,
    branch_stock: stock.plan.branchSnapshots, batch_stock: stock.plan.batchSnapshots,
    money: { refund_currency: 'USD', owed_reduction_usd: owedReductionUsd },
    v1_header: {
      money_precision_version: 1, calculated_refund_usd: plan.quote.calculated_refund_usd, rounding_adjustment_usd: plan.quote.rounding_adjustment_usd,
      total_refund_usd: plan.quote.total_refund_usd, total_refund_khr: plan.quote.total_refund_khr,
    },
    v1_items: plan.quote.items.map((item) => ({
      sale_item_id: item.sale_item_id, quantity: item.quantity, applied_price_usd: item.applied_price_usd, applied_price_khr: item.applied_price_khr,
      total_usd: item.total_usd, total_khr: item.total_khr, refund_snapshot_json: item.refund_snapshot_json,
    })),
    sale2: {
      total_usd: priced.total_usd, calculated_total_usd: priced.calculated_total_usd, subtotal_usd: priced.subtotal_usd, lines: priced.lines.length,
      amount_paid_usd: settlement.amountPaidUsd, amount_paid_khr: settlement.amountPaidKhr,
      change_usd: settlement.change.changeUsd, change_khr: settlement.change.changeKhr, sale_status: saleStatus,
    },
  }
  const postcondition = `
    EXISTS(SELECT 1 FROM return_create_receipts WHERE id=@receiptId AND actor_id=@actorId
      AND request_id=@requestId AND request_digest=@requestDigest)
    AND (SELECT COUNT(*) FROM return_items WHERE return_id=${returnIdSql})=json_extract(@expectedJson,'$.return_items')
    AND (SELECT COUNT(*) FROM return_item_batch_allocations WHERE return_item_id IN(
      SELECT id FROM return_items WHERE return_id=${returnIdSql}))=json_extract(@expectedJson,'$.return_allocations')
    AND (SELECT COUNT(*) FROM return_replacement_items WHERE return_id=${returnIdSql})=json_extract(@expectedJson,'$.replacement_items')
    AND (SELECT COUNT(*) FROM sale_item_batch_allocations WHERE sale_item_id IN(
      SELECT id FROM sale_items WHERE sale_id=${saleIdSql}))=json_extract(@expectedJson,'$.sale_allocations')
    AND ${returnCreateOwnMovementCountSql(returnIdSql, ['return', DAMAGE_IN_MOVEMENT, REPLACEMENT_OUT_MOVEMENT, TAGGED_DISPOSAL_MOVEMENT_TYPE])}=json_extract(@expectedJson,'$.movements')
    AND (SELECT COUNT(*) FROM sale_record_events WHERE source_kind='return_create' AND source_id=@receiptId
      AND generation=0)=json_extract(@expectedJson,'$.event')
    AND EXISTS(SELECT 1 FROM audit_logs WHERE entity='return_create' AND entity_id=@receiptId)
    AND EXISTS(SELECT 1 FROM returns r
      WHERE r.id=${returnIdSql}
        AND r.money_precision_version=json_extract(@expectedJson,'$.v1_header.money_precision_version')
        AND r.calculated_refund_usd=json_extract(@expectedJson,'$.v1_header.calculated_refund_usd')
        AND r.rounding_adjustment_usd=json_extract(@expectedJson,'$.v1_header.rounding_adjustment_usd')
        AND r.total_refund_usd=json_extract(@expectedJson,'$.v1_header.total_refund_usd')
        AND r.total_refund_khr=json_extract(@expectedJson,'$.v1_header.total_refund_khr'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.v1_items') j WHERE NOT EXISTS(
      SELECT 1 FROM return_items ri WHERE ri.return_id=${returnIdSql}
        AND ri.sale_item_id=json_extract(j.value,'$.sale_item_id') AND ri.quantity=json_extract(j.value,'$.quantity')
        AND ri.applied_price_usd=json_extract(j.value,'$.applied_price_usd')
        AND ri.applied_price_khr=json_extract(j.value,'$.applied_price_khr')
        AND ri.total_usd=json_extract(j.value,'$.total_usd') AND ri.total_khr=json_extract(j.value,'$.total_khr')
        AND ri.refund_snapshot_json=json_extract(j.value,'$.refund_snapshot_json')))
    AND COALESCE((SELECT sale_status FROM sales WHERE id=@saleId),'completed')=json_extract(@expectedJson,'$.sale_status')
    AND (json_type(@expectedJson,'$.tag')='null' OR (SELECT return_state FROM sales WHERE id=@saleId) IS json_extract(@expectedJson,'$.tag.value'))
    AND EXISTS(SELECT 1 FROM returns r WHERE r.id=${returnIdSql} AND r.refund_currency=json_extract(@expectedJson,'$.money.refund_currency')
      AND r.owed_reduction_usd=json_extract(@expectedJson,'$.money.owed_reduction_usd'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.branch_stock') j
      WHERE COALESCE((SELECT quantity FROM branch_stock WHERE product_id=json_extract(j.value,'$.product_id')
        AND branch_id=json_extract(j.value,'$.branch_id')),0)!=json_extract(j.value,'$.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.batch_stock') j
      WHERE COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=json_extract(j.value,'$.batch_id')
        AND branch_id=json_extract(j.value,'$.branch_id')),0)!=json_extract(j.value,'$.after'))
    AND NOT EXISTS(SELECT 1 FROM json_each(@expectedJson,'$.branch_stock') j
      WHERE COALESCE((SELECT stock_quantity FROM products WHERE id=json_extract(j.value,'$.product_id')),0)
        !=COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=json_extract(j.value,'$.product_id')),0))
    ${exchangePostconditionSql()}
  `
  statements.push(returnCreateGuardStatement(operationId, 'postcondition', postcondition, {
    ...commonGuardParams, expectedJson: JSON.stringify(expected), saleId, returnClientRequestId: clientRequestId, movementIdFloor: args.movementIdFloor,
  }))
  statements.push({ sql: 'DELETE FROM return_create_guards WHERE operation_id=@operationId', params: { operationId } })

  // ---- admission: a plan this invocation cannot carry is refused before it writes anything -----------------------------------------
  const transactionStatementCount = 1 // the plan commits as ONE db.batch(): one call
  try {
    assertReturnCreatePlanBounds(statements, args.intent, eventBytes)
    // Cold cache fallback including quota and retries (six), notification reads including retries (six + the replacement alert's two).
    assertReturnCreateQueryBudget(args.queryLimit, args.statementsUsed(), transactionStatementCount, 14)
  } catch (error) {
    if (error instanceof ReturnCreateBudgetError) throw error
    const mapped = guardMapped(error)
    if (mapped) return mapped
    return reply(400, { error: (error as Error).message, code: 'return_too_large' })
  }

  // ---- commit ------------------------------------------------------------------------------------------------------------------------
  let committed: { return_id: number; sale_id: number | null; request_digest: string; response_json: string } | undefined
  try {
    args.addStatements(transactionStatementCount)
    if (!db.batchOnce) throw new Error('Customer returns require single-attempt atomic writes')
    const results = await executeStockTransaction(db, statements, 'once')
    if (results.length === statements.length) committed = results[receiptResultIndex]?.results?.[0] as typeof committed
  } catch (error) {
    const mapped = guardMapped(error)
    if (mapped) return mapped
    try {
      const receipt = await args.readReceipt()
      if (receipt) {
        if (receipt.request_digest === requestDigest && (receipt.sale_id ?? null) === saleId) return c.json(JSON.parse(receipt.response_json) as ReturnCreateResponse)
        return reply(409, { error: 'client_request_id was already used for different return data.', code: 'idempotency_conflict' })
      }
      const refusal = stockTransactionRefusal(error)
      if (refusal) return reply(503, refusal as Record<string, unknown>)
      return reply(409, { error: 'The sale or stock changed while this return was being recorded. Reload and try again.', code: 'write_conflict', action: 'reload_required' })
    } catch {
      return reply(503, { error: 'The result could not be confirmed. Keep this return open and retry the same request.', code: 'unknown_outcome', action: 'retry_same_request' })
    }
  }
  if (!committed || committed.request_digest !== requestDigest || (committed.sale_id ?? null) !== saleId
    || !Number.isSafeInteger(committed.return_id) || committed.return_id <= 0 || typeof committed.response_json !== 'string') {
    return reply(503, { error: 'The result could not be confirmed. Retry the same request.', code: 'unknown_outcome', action: 'retry_same_request' })
  }
  const response = JSON.parse(committed.response_json) as ReturnCreateResponse
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return', id: response.id }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersions(c.env, ['products', 'returns', 'sales']))
  // The replacement lines deduct stock like a sale does (owner ruling 6 Oct 2026: alert on crossing).
  c.executionCtx.waitUntil(recordStockCrossings(c.env, { saleId: null, lines: priced.lines.map((line) => ({ productId: line.product_id, branchId: line.branch_id, quantity: line.quantity })) }))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: response.id }))
  const cashRefundUsd = refundCashOut({ total_refund_usd: refundUsd, total_refund_khr: refundKhr, owed_reduction_usd: owedReductionUsd, refund_currency: 'USD' }).usd
  c.executionCtx.waitUntil(sendReturnTelegramEvent(c.env, response.id, {
    kind: 'customer', returnNumber, receiptNumber: originalReceipt, party: (body.customer_name as string | undefined) || (sale.customer_name as string | null) || null,
    branch: branchName, reason, returnType: String(intent.return_type), by: actorName,
    ...(owedReductionUsd === 0 ? { refundUsd, refundKhr } : { refundUsd: cashRefundUsd, refundKhr: 0, debtLoweredUsd: owedReductionUsd }),
  }, [{ type: 'sales', lines: formatSaleTelegramLines(replacementNotice as never) }])
    .catch((error) => console.error('[telegram] return notification failed', error)))
  c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: saleId }))
  return c.json(response)
}

