import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { bumpVersion } from './cache'
import { getDb, type D1Compat } from './db'
import { financialCalculationValue } from './financialPrecision'
import type { SettlementPlan } from './paymentSettlement'
import { normalizeSearchText } from './searchMatch'

export const SALE_SETTLEMENT_ACTION_KIND = 'sale.settlement'

type Statement = { sql: string; params: Record<string, unknown> }

export type SaleSettlementLineMoney = {
  id: number
  applied_price_khr: number | null
  total_khr: number | null
  product_discount_khr: number | null
  base_price_khr: number | null
  manual_discount_khr: number | null
}

export type SaleSettlementState = {
  sale_status: string | null
  exchange_rate: number | null
  subtotal_khr: number | null
  discount_khr: number | null
  tax_khr: number | null
  total_khr: number | null
  delivery_fee_khr: number | null
  membership_discount_khr: number | null
  payment_method: string | null
  payment_details: string | null
  payment_currency: string | null
  amount_paid_usd: number | null
  amount_paid_khr: number | null
  change_usd: number | null
  change_khr: number | null
  change_is_actual: number
  change_exchange_rate: number | null
  search_normalized: string | null
  lines: SaleSettlementLineMoney[]
}

export type SaleSettlementSnapshot = {
  version: 1
  operationId: string
  saleId: number
  receiptNumber: string | null
  before: SaleSettlementState
  after: SaleSettlementState
}

function n(value: unknown): number {
  return Number(value) || 0
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : n(value)
}

export async function readSaleSettlementState(db: D1Compat, saleId: number): Promise<SaleSettlementState | null> {
  const sale = await db.prepare(`
    SELECT sale_status,exchange_rate,subtotal_khr,discount_khr,tax_khr,total_khr,
           delivery_fee_khr,membership_discount_khr,payment_method,payment_details,
           payment_currency,amount_paid_usd,amount_paid_khr,change_usd,change_khr,
           change_is_actual,change_exchange_rate,search_normalized
    FROM sales WHERE id=@id
  `).get<Record<string, unknown>>({ id: saleId })
  if (!sale) return null
  const lines = await db.prepare(`
    SELECT id,applied_price_khr,total_khr,product_discount_khr,
           base_price_khr,manual_discount_khr
    FROM sale_items WHERE sale_id=@id ORDER BY id
  `).all<Record<string, unknown>>({ id: saleId })
  return {
    sale_status: sale.sale_status == null ? null : String(sale.sale_status),
    exchange_rate: nullableNumber(sale.exchange_rate),
    subtotal_khr: nullableNumber(sale.subtotal_khr),
    discount_khr: nullableNumber(sale.discount_khr),
    tax_khr: nullableNumber(sale.tax_khr),
    total_khr: nullableNumber(sale.total_khr),
    delivery_fee_khr: nullableNumber(sale.delivery_fee_khr),
    membership_discount_khr: nullableNumber(sale.membership_discount_khr),
    payment_method: sale.payment_method == null ? null : String(sale.payment_method),
    payment_details: sale.payment_details == null ? null : String(sale.payment_details),
    payment_currency: sale.payment_currency == null ? null : String(sale.payment_currency),
    amount_paid_usd: nullableNumber(sale.amount_paid_usd),
    amount_paid_khr: nullableNumber(sale.amount_paid_khr),
    change_usd: nullableNumber(sale.change_usd),
    change_khr: nullableNumber(sale.change_khr),
    change_is_actual: Number(sale.change_is_actual) === 1 ? 1 : 0,
    change_exchange_rate: nullableNumber(sale.change_exchange_rate),
    search_normalized: sale.search_normalized == null ? null : String(sale.search_normalized),
    lines: lines.map((line) => ({
      id: Number(line.id),
      applied_price_khr: nullableNumber(line.applied_price_khr),
      total_khr: nullableNumber(line.total_khr),
      product_discount_khr: nullableNumber(line.product_discount_khr),
      base_price_khr: nullableNumber(line.base_price_khr),
      manual_discount_khr: nullableNumber(line.manual_discount_khr),
    })),
  }
}

function khr(usd: unknown, rate: number): number | null {
  if (usd == null) return null
  return financialCalculationValue(financialCalculationValue(usd as number) * financialCalculationValue(rate))
}

export function buildSaleSettlementAfterState(
  before: SaleSettlementState,
  sale: Record<string, unknown>,
  lineRows: Array<Record<string, unknown>>,
  targetStatus: string,
  plan: SettlementPlan,
): SaleSettlementState {
  const rate = plan.exchangeRate
  return {
    sale_status: targetStatus,
    exchange_rate: rate,
    subtotal_khr: khr(sale.subtotal_usd, rate),
    discount_khr: khr(sale.discount_usd, rate),
    tax_khr: khr(sale.tax_usd, rate),
    total_khr: khr(sale.total_usd, rate),
    delivery_fee_khr: khr(sale.delivery_fee_usd, rate),
    membership_discount_khr: khr(sale.membership_discount_usd, rate),
    payment_method: plan.paymentMethod,
    payment_details: plan.paymentDetailsJson,
    payment_currency: plan.paymentCurrency,
    amount_paid_usd: plan.amountPaidUsd,
    amount_paid_khr: plan.amountPaidKhr,
    change_usd: plan.changeUsd,
    change_khr: plan.changeKhr,
    change_is_actual: 0,
    change_exchange_rate: null,
    search_normalized: normalizeSearchText([
      sale.receipt_number,
      sale.cashier_name,
      sale.customer_name,
      sale.customer_phone,
      sale.branch_name,
      plan.paymentMethod,
    ].filter(Boolean).join(' ')),
    lines: lineRows.map((line) => ({
      id: Number(line.id),
      applied_price_khr: khr(line.applied_price_usd, rate),
      total_khr: khr(line.total_usd, rate),
      product_discount_khr: khr(line.product_discount_usd, rate),
      base_price_khr: khr(line.base_price_usd, rate),
      manual_discount_khr: khr(line.manual_discount_usd, rate),
    })),
  }
}

export function saleSettlementStateStatements(saleId: number, state: SaleSettlementState, stamp: string): Statement[] {
  return [{
    sql: `UPDATE sales SET sale_status=@sale_status,exchange_rate=@exchange_rate,
          subtotal_khr=@subtotal_khr,discount_khr=@discount_khr,tax_khr=@tax_khr,
          total_khr=@total_khr,delivery_fee_khr=@delivery_fee_khr,
          membership_discount_khr=@membership_discount_khr,payment_method=@payment_method,
          payment_details=@payment_details,payment_currency=@payment_currency,
          amount_paid_usd=@amount_paid_usd,amount_paid_khr=@amount_paid_khr,
          change_usd=@change_usd,change_khr=@change_khr,change_is_actual=@change_is_actual,
          change_exchange_rate=@change_exchange_rate,search_normalized=@search_normalized,
          updated_at=@stamp WHERE id=@id`,
    params: { id: saleId, stamp, ...state, lines: undefined },
  }, ...state.lines.map((line) => ({
    sql: `UPDATE sale_items SET applied_price_khr=@applied_price_khr,total_khr=@total_khr,
          product_discount_khr=@product_discount_khr,base_price_khr=@base_price_khr,
          manual_discount_khr=@manual_discount_khr WHERE id=@id AND sale_id=@saleId`,
    params: { ...line, saleId },
  }))]
}

export function saleMutationGuard(predicate: string, params: Record<string, unknown>): Statement {
  return {
    sql: `INSERT INTO sale_mutation_guards(id,guard_value) SELECT 1,CASE WHEN ${predicate} THEN 1 ELSE 0 END`,
    params,
  }
}

function replayAuditStatement(user: SessionUser, saleId: number, direction: 'undo' | 'redo', operationId: string): Statement {
  return {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
          VALUES(@userId,@userName,@action,'sale',@saleId,@details,'sale',@saleId,@details)`,
    params: {
      userId: user.id,
      userName: user.name,
      action: `action_${direction}`,
      saleId: String(saleId),
      details: JSON.stringify({ applier: SALE_SETTLEMENT_ACTION_KIND, operationId, direction }),
    },
  }
}

export async function notifySaleSettlementAction(env: Env): Promise<void> {
  await Promise.allSettled([
    bumpVersion(env, 'sales'),
    broadcast(env, 'sales', { action: 'update' }),
  ])
}

class SaleSettlementReplayConflict extends Error {
  readonly statusCode = 409
}

export async function replaySaleSettlementAction(
  env: Env,
  user: SessionUser,
  direction: 'undo' | 'redo',
  historyId: number,
  generation: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!Number.isSafeInteger(generation) || Number(generation) < 0) {
    throw new SaleSettlementReplayConflict('Refresh history before replaying this settlement.')
  }
  const db = getDb(env)
  const operation = await db.prepare(`
    SELECT * FROM sale_mutation_receipts
    WHERE history_id=@history AND mutation_kind='settlement'
  `).get<Record<string, unknown>>({ history: historyId })
  if (!operation || String(operation.id) !== String(payload.operation_id || '') || Number(operation.generation) !== Number(generation)) {
    throw new SaleSettlementReplayConflict('This settlement changed or its saved receipt does not match.')
  }
  let before: SaleSettlementState
  let after: SaleSettlementState
  try {
    before = JSON.parse(String(operation.before_json)) as SaleSettlementState
    after = JSON.parse(String(operation.after_json)) as SaleSettlementState
  } catch {
    throw new SaleSettlementReplayConflict('This settlement receipt is unreadable.')
  }
  const saleId = Number(operation.sale_id)
  const expected = direction === 'undo' ? after : before
  const target = direction === 'undo' ? before : after
  const current = await readSaleSettlementState(db, saleId)
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new SaleSettlementReplayConflict('This sale was edited after the settlement. Refresh before reversing it.')
  }
  const expectedHistoryStatus = direction === 'undo' ? 'undoable' : 'redoable'
  const nextHistoryStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const stamp = new Date().toISOString()
  const statements: Statement[] = [
    { sql: 'DELETE FROM sale_mutation_guards', params: {} },
    saleMutationGuard(`EXISTS(
      SELECT 1 FROM sale_mutation_receipts r JOIN action_history h ON h.id=r.history_id
      WHERE r.id=@operation AND r.history_id=@history AND r.generation=@generation
        AND r.sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=r.sale_id),0)
        AND h.status=@historyStatus
    )`, { operation: operation.id, history: historyId, generation, historyStatus: expectedHistoryStatus }),
    ...saleSettlementStateStatements(saleId, target, stamp),
    {
      sql: `UPDATE sale_mutation_receipts SET generation=generation+1,
            sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0),
            updated_at=@stamp WHERE id=@operation`,
      params: { saleId, stamp, operation: operation.id },
    },
    {
      sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,
            undo_payload=json_set(undo_payload,'$.generation',@nextGeneration),
            redo_payload=json_set(redo_payload,'$.generation',@nextGeneration)
            WHERE id=@history`,
      params: { status: nextHistoryStatus, stamp, nextGeneration: Number(generation) + 1, history: historyId },
    },
    replayAuditStatement(user, saleId, direction, String(operation.id)),
    { sql: 'DELETE FROM sale_mutation_guards', params: {} },
  ]
  try {
    await db.batch(statements)
  } catch (error) {
    if (/constraint|guard_value/i.test(String(error))) {
      throw new SaleSettlementReplayConflict('This sale or settlement changed. Nothing was reversed.')
    }
    throw error
  }
}
