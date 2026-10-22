// The Returns screen's side of a one-step exchange (6.0.958): the replacement lines the Worker is asked to quote, what the customer owes or is
// owed once it is netted against the refund, and the customer's payment rows in the shape the create call takes. Pure, so a test drives every
// figure; the Worker (cloudflare/src/lib/returnExchange.ts) recomputes the same numbers and refuses a payment that does not cover them.

import type { ExchangePaymentV1, ExchangeQuoteV1, ReplacementItemV1 } from '../../../api/returnsTransport.ts'
import { buildSettlementPayload, settlementOutstandingUsd, settlementRowsIssue, settlementTotals, type SettlementRow } from '../../sales/saleSettlement.ts'
import type { ReplacementPart } from './replacementPricing.ts'

export type ExchangeChangeCurrency = 'USD' | 'KHR'

type ReplacementRowInput = { product_id: number | string; branch_id: number | string | null; batch_id: number | null; catalog_usd: number }

const positiveId = (value: unknown): number | null => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * The replacement lines the Worker prices, one per part (a row of units a returned unit covers at the sold price, and a row of the rest at
 * the catalog price). A part at the catalog price carries no price at all: the server's own catalog price applies, so a till never posts a
 * price of its own that it did not need to. A part at any other price is posted, and the Worker refuses it when the caller may not set it.
 */
export function exchangeReplacementItems<Row extends ReplacementRowInput>(rows: readonly Row[], partsOf: (row: Row) => readonly ReplacementPart[]): ReplacementItemV1[] {
  return rows.flatMap((row) => partsOf(row).flatMap((part): ReplacementItemV1[] => {
    const productId = positiveId(row.product_id)
    if (!productId || !(part.quantity > 0)) return []
    return [{
      product_id: productId, branch_id: positiveId(row.branch_id), batch_id: positiveId(row.batch_id), quantity: part.quantity,
      ...(Math.abs(part.priceUsd - row.catalog_usd) > 0.000001 ? { applied_price_usd: part.priceUsd } : {}),
    }]
  }))
}

export type ExchangeDue = { kind: 'pay' | 'give' | 'even'; usd: number }

/** What the exchange comes to for the customer: pays (net > 0), is given back (net < 0), or nothing moves. */
export function exchangeDue(exchange: Pick<ExchangeQuoteV1, 'net_usd'>): ExchangeDue {
  const net = Number(exchange.net_usd) || 0
  return net > 0 ? { kind: 'pay', usd: net } : net < 0 ? { kind: 'give', usd: -net } : { kind: 'even', usd: 0 }
}

/**
 * The payment rows the screen opens with: the whole amount due in the shop's first payment method. Nothing is asked when the exchange is
 * even or gives money back, and nothing is netted across a debt (a Not Paid original leaves the replacement Not Paid), so no rows either.
 */
export function initialExchangePayRows(exchange: Pick<ExchangeQuoteV1, 'net_usd' | 'not_paid'>, configuredMethods: readonly string[]): SettlementRow[] {
  const due = exchangeDue(exchange)
  if (due.kind !== 'pay' || exchange.not_paid) return []
  return [{ id: 'settlement-new', method: configuredMethods[0] || '', usd: due.usd.toFixed(2), khr: '' }]
}

/** What the customer still owes after the rows entered (0 when the tender covers it within the half-cent the Worker allows). */
export function exchangeOutstandingUsd(rows: readonly SettlementRow[], exchange: Pick<ExchangeQuoteV1, 'net_usd' | 'exchange_rate'>): number {
  const due = exchangeDue(exchange)
  if (due.kind !== 'pay') return 0
  return settlementOutstandingUsd(rows, { totalUsd: due.usd, exchangeRate: exchange.exchange_rate, moneyPrecisionVersion: 1 })
}

/** What the customer overpaid, to be handed back as change in the chosen currency (0 unless the rows exceed the amount due). */
export function exchangeOverpaymentUsd(rows: readonly SettlementRow[], exchange: Pick<ExchangeQuoteV1, 'net_usd' | 'exchange_rate'>): number {
  const due = exchangeDue(exchange)
  if (due.kind === 'give') return due.usd
  if (due.kind === 'even') return 0
  const { paidEquivalentUsd } = settlementTotals(rows, exchange.exchange_rate)
  return Math.max(0, Math.round((paidEquivalentUsd - due.usd) * 10000) / 10000)
}

/** What a give-back or an overpayment comes to in riel: at the sale's rate, rounded DOWN to 100 (the drawer never hands out more than is owed). */
export function changeRielRoundedDown(usd: number, exchangeRate: number): number {
  return Math.floor((Number(usd) || 0) * (Number(exchangeRate) || 0) / 100 + 1e-9) * 100
}

export type ExchangePayIssue = 'method' | 'amount' | 'short' | null

/** Why the payment cannot be sent yet, or null. A Not Paid original, an even exchange and a give-back need no payment rows. */
export function exchangePaymentIssue(rows: readonly SettlementRow[], exchange: Pick<ExchangeQuoteV1, 'net_usd' | 'exchange_rate' | 'not_paid'>, configured: readonly string[]): ExchangePayIssue {
  const due = exchangeDue(exchange)
  if (due.kind !== 'pay' || exchange.not_paid) return rows.length ? settlementRowsIssue(rows, configured) : null
  const rowIssue = settlementRowsIssue(rows, configured)
  if (rowIssue) return rowIssue
  return exchangeOutstandingUsd(rows, exchange) > 0 ? 'short' : null
}

/** The payment the create call carries: the customer's rows (never the refund credit, which the Worker adds itself) and the change currency. */
export function exchangePaymentBody(rows: readonly SettlementRow[], exchange: Pick<ExchangeQuoteV1, 'net_usd' | 'not_paid'>, configured: readonly string[], changeCurrency: ExchangeChangeCurrency): ExchangePaymentV1 {
  const due = exchangeDue(exchange)
  const used = due.kind === 'pay' && !exchange.not_paid ? rows : []
  return { details: buildSettlementPayload(used, configured)?.payment_details ?? [], change_currency: changeCurrency }
}
