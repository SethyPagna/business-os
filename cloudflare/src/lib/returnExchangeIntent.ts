// The request side of a one-step exchange on a money-v1 sale: the shapes a till may send and their canonical forms. Dependency-free on
// purpose -- lib/returnCreateAction.ts digests the canonical intent, and that module must stay loadable on its own.

export const RETURN_EXCHANGE_MAX_LINES = 50
export const RETURN_EXCHANGE_MAX_TENDER_ROWS = 11 // one of the sale's 12 payment rows is the refund credit

export class ReturnExchangeError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: 400 | 409 = 400) {
    super(message)
    this.name = 'ReturnExchangeError'
  }
}

export type ExchangeLineIntent = {
  product_id: number
  branch_id: number | null
  batch_id: number | null
  quantity: number
  /** What the till posted; null when it posted none (the catalog price applies). */
  applied_price_usd: number | null
}

// ---- the quote the till reviews ---------------------------------------------------------------------------------------

export type ExchangeQuoteV1 = {
  version: 1
  sale_id: number
  exchange_rate: number
  /** The original sale reads Not Paid: no cash is netted across a debt; a shortfall leaves the replacement Not Paid. */
  not_paid: boolean
  lines: Array<{
    product_id: number; product_name: string; branch_id: number; batch_id: number | null; quantity: number
    unit_price_usd: number; unit_price_khr: number; total_usd: number; total_khr: number
  }>
  calculated_total_usd: number
  rounding_adjustment_usd: number
  /** T: what the replacement sale totals, whole cents. */
  total_usd: number
  total_khr: number
  /** R: the refund of the lines returned. */
  refund_usd: number
  /** D: the part of R that lowers a debt on the original sale (never cash). */
  owed_reduction_usd: number
  /** C = R - D: the cash share of the refund, netted into the replacement as a tender. */
  credit_usd: number
  /** T - C in whole cents: the customer pays it when positive, is given it back when negative. */
  net_usd: number
}

const QUOTE_KEYS = [
  'version', 'sale_id', 'exchange_rate', 'not_paid', 'lines', 'calculated_total_usd', 'rounding_adjustment_usd',
  'total_usd', 'total_khr', 'refund_usd', 'owed_reduction_usd', 'credit_usd', 'net_usd',
] as const
const QUOTE_LINE_KEYS = [
  'product_id', 'product_name', 'branch_id', 'batch_id', 'quantity', 'unit_price_usd', 'unit_price_khr', 'total_usd', 'total_khr',
] as const

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReturnExchangeError('return_exchange_quote_invalid', 'The replacement quote is invalid.')
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    throw new ReturnExchangeError('return_exchange_quote_invalid', 'The replacement quote is invalid.')
  }
  return record
}

/** The reviewed quote re-emitted in the server's own key order, or a 400. Equality with the server's fresh quote is the stale check. */
export function canonicalExchangeExpected(value: unknown): ExchangeQuoteV1 {
  const fail = (): never => { throw new ReturnExchangeError('return_exchange_quote_invalid', 'The replacement quote is invalid.') }
  const quote = exactObject(value, QUOTE_KEYS)
  const num = (field: unknown): number => typeof field === 'number' && Number.isFinite(field) ? field : fail()
  if (quote.version !== 1 || typeof quote.not_paid !== 'boolean' || !Array.isArray(quote.lines)
    || quote.lines.length < 1 || quote.lines.length > RETURN_EXCHANGE_MAX_LINES) fail()
  const lines = (quote.lines as unknown[]).map((raw) => {
    const line = exactObject(raw, QUOTE_LINE_KEYS)
    if (typeof line.product_name !== 'string') fail()
    const batch = line.batch_id === null ? null : num(line.batch_id)
    return {
      product_id: num(line.product_id), product_name: line.product_name as string, branch_id: num(line.branch_id), batch_id: batch,
      quantity: num(line.quantity), unit_price_usd: num(line.unit_price_usd), unit_price_khr: num(line.unit_price_khr),
      total_usd: num(line.total_usd), total_khr: num(line.total_khr),
    }
  })
  return {
    version: 1, sale_id: num(quote.sale_id), exchange_rate: num(quote.exchange_rate), not_paid: quote.not_paid as boolean, lines,
    calculated_total_usd: num(quote.calculated_total_usd), rounding_adjustment_usd: num(quote.rounding_adjustment_usd),
    total_usd: num(quote.total_usd), total_khr: num(quote.total_khr), refund_usd: num(quote.refund_usd),
    owed_reduction_usd: num(quote.owed_reduction_usd), credit_usd: num(quote.credit_usd), net_usd: num(quote.net_usd),
  }
}

// ---- the tender the customer adds -------------------------------------------------------------------------------------

export type ExchangeTenderRow = { method: string; amount_usd: number; amount_khr: number }
export type ExchangePaymentIntent = { details: ExchangeTenderRow[]; change_currency: 'USD' | 'KHR' }

const METHOD_MAX = 80

/** The customer's payment rows and the currency an overpayment / give-back is handed back in, validated; a 400 names the row. */
export function canonicalExchangePayment(value: unknown): ExchangePaymentIntent {
  const bad = (message: string): never => { throw new ReturnExchangeError('return_exchange_payment_invalid', message) }
  if (value === undefined || value === null) return { details: [], change_currency: 'USD' }
  if (typeof value !== 'object' || Array.isArray(value)) return bad('The replacement payment is invalid.')
  const source = value as Record<string, unknown>
  if (Object.keys(source).some((key) => !['details', 'change_currency'].includes(key))) return bad('The replacement payment is invalid.')
  const rows = source.details === undefined || source.details === null ? [] : source.details
  if (!Array.isArray(rows) || rows.length > RETURN_EXCHANGE_MAX_TENDER_ROWS) return bad('The replacement payment has too many rows.')
  const currency = source.change_currency === undefined || source.change_currency === null ? 'USD'
    : typeof source.change_currency === 'string' ? source.change_currency.trim().toUpperCase() : ''
  if (currency !== 'USD' && currency !== 'KHR') return bad('The change currency must be USD or KHR.')
  const details = rows.map((raw): ExchangeTenderRow => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('Each payment row must be an object.')
    const row = raw as Record<string, unknown>
    const method = typeof row.method === 'string' ? row.method.trim() : ''
    if (!method || method.length > METHOD_MAX || method.includes(' + ')) return bad('Each payment row needs a payment method.')
    const usd = row.amount_usd === undefined || row.amount_usd === null || row.amount_usd === '' ? 0 : Number(row.amount_usd)
    const khr = row.amount_khr === undefined || row.amount_khr === null || row.amount_khr === '' ? 0 : Number(row.amount_khr)
    if (!Number.isFinite(usd) || !Number.isFinite(khr) || usd < 0 || khr < 0) return bad('Payment amounts cannot be negative.')
    if (Math.abs(usd * 100 - Math.round(usd * 100)) > 1e-6) return bad('Dollar amounts use whole cents.')
    if (!Number.isInteger(khr)) return bad('Riel amounts use whole riel.')
    if (usd <= 0 && khr <= 0) return bad('Each payment row needs an amount.')
    return { method, amount_usd: Math.round(usd * 100) / 100, amount_khr: khr }
  })
  return { details, change_currency: currency }
}
