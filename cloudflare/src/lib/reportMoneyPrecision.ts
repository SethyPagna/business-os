import {
  MAX_MONEY_ABS,
  MONEY_PRECISION_POLICY_VERSION,
  MoneyPrecisionError,
  multiplyMoney4,
  roundMoney4,
  type DecimalInput,
} from './moneyPrecision'

export const REPORT_MONEY_MAX_ROWS = 100_000
const UNITS_PER_USD = 10_000n
const MAX_ABS_UNITS = BigInt(MAX_MONEY_ABS) * UNITS_PER_USD

export type ReportMoneyChannel =
  | 'sale_calculated_total'
  | 'sale_rounding_adjustment'
  | 'refund_payout'
  | 'cancellation'
  | 'cost_of_goods'

export type ReportMoneyRefusalCode =
  | 'unsupported_precision_version'
  | 'unsupported_row'
  | 'invalid_saved_money4'
  | 'invalid_quantity'
  | 'duplicate_row'
  | 'too_many_rows'
  | 'aggregate_overflow'

export class ReportMoneyPrecisionError extends RangeError {
  constructor(readonly code: ReportMoneyRefusalCode) {
    super(code)
    this.name = 'ReportMoneyPrecisionError'
  }
}

export type ReportSavedScalar = {
  kind: 'saved_scalar'
  id: string
  channel: Exclude<ReportMoneyChannel, 'cost_of_goods'>
  money_precision_version: 1
  value_usd: DecimalInput
}

export type ReportSavedItemCost = {
  kind: 'item_cost'
  id: string
  channel: 'cost_of_goods'
  money_precision_version: 1
  cost_price_usd: DecimalInput | null
  quantity: DecimalInput
}

export type ReportMoneyRow = ReportSavedScalar | ReportSavedItemCost

export type ReportMoneyDiagnostic = {
  code: 'unknown_cost'
  row_id: string
}

export type ReportMoneyTotals = Record<ReportMoneyChannel, string>

function decimalPlaces4(value: DecimalInput): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  if (typeof value === 'number' && !Number.isFinite(value)) return false
  return /^[+-]?\d+(?:\.\d{1,4})?$/.test(String(value).trim())
}

function savedMoney4Units(value: DecimalInput): bigint {
  if (!decimalPlaces4(value)) throw new ReportMoneyPrecisionError('invalid_saved_money4')
  let rounded: number
  try { rounded = roundMoney4(value) } catch { throw new ReportMoneyPrecisionError('invalid_saved_money4') }
  return BigInt(rounded.toFixed(4).replace('.', ''))
}

function quantityText(value: DecimalInput): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new ReportMoneyPrecisionError('invalid_quantity')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ReportMoneyPrecisionError('invalid_quantity')
  const text = String(value).trim()
  if (!(Number(text) > 0)) throw new ReportMoneyPrecisionError('invalid_quantity')
  try { multiplyMoney4('0', text) } catch { throw new ReportMoneyPrecisionError('invalid_quantity') }
  return text
}

function money4Text(units: bigint): string {
  if (units > MAX_ABS_UNITS || units < -MAX_ABS_UNITS) throw new ReportMoneyPrecisionError('aggregate_overflow')
  const negative = units < 0n
  const absolute = negative ? -units : units
  const text = `${negative ? '-' : ''}${absolute / UNITS_PER_USD}.${String(absolute % UNITS_PER_USD).padStart(4, '0')}`
  return text
}

export class ReportMoneyAccumulator {
  private readonly units: Record<ReportMoneyChannel, bigint> = {
    sale_calculated_total: 0n,
    sale_rounding_adjustment: 0n,
    refund_payout: 0n,
    cancellation: 0n,
    cost_of_goods: 0n,
  }
  private readonly seen = new Set<string>()
  private readonly issues: ReportMoneyDiagnostic[] = []

  constructor(private readonly maxRows = REPORT_MONEY_MAX_ROWS) {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > REPORT_MONEY_MAX_ROWS) {
      throw new ReportMoneyPrecisionError('too_many_rows')
    }
  }

  addPage(rows: readonly ReportMoneyRow[]): void {
    if (this.seen.size + rows.length > this.maxRows) throw new ReportMoneyPrecisionError('too_many_rows')
    const pageIds = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id || pageIds.has(row.id) || this.seen.has(row.id)) {
        throw new ReportMoneyPrecisionError('duplicate_row')
      }
      if (row.money_precision_version !== MONEY_PRECISION_POLICY_VERSION) {
        throw new ReportMoneyPrecisionError('unsupported_precision_version')
      }
      if ((row.kind === 'item_cost' && row.channel !== 'cost_of_goods')
        || (row.kind === 'saved_scalar' && !['sale_calculated_total', 'sale_rounding_adjustment', 'refund_payout', 'cancellation'].includes(row.channel))
        || (row.kind !== 'item_cost' && row.kind !== 'saved_scalar')) {
        throw new ReportMoneyPrecisionError('unsupported_row')
      }
      pageIds.add(row.id)
    }

    // Validate and stage the complete page before publishing any part of it.
    const staged: Array<{ id: string; channel?: ReportMoneyChannel; units?: bigint; issue?: ReportMoneyDiagnostic }> = []
    for (const row of rows) {
      if (row.kind === 'item_cost') {
        quantityText(row.quantity)
        if (row.cost_price_usd === null) {
          staged.push({ id: row.id, issue: { code: 'unknown_cost', row_id: row.id } })
          continue
        }
      }
      let valueUnits: bigint
      if (row.kind === 'item_cost') {
        if (!decimalPlaces4(row.cost_price_usd!) || Number(row.cost_price_usd) < 0) throw new ReportMoneyPrecisionError('invalid_saved_money4')
        const quantity = quantityText(row.quantity)
        let product: number
        try { product = multiplyMoney4(row.cost_price_usd!, quantity) } catch (error) {
          if (error instanceof MoneyPrecisionError && error.code === 'money_overflow') throw new ReportMoneyPrecisionError('aggregate_overflow')
          throw new ReportMoneyPrecisionError('invalid_quantity')
        }
        valueUnits = savedMoney4Units(product)
      } else {
        valueUnits = savedMoney4Units(row.value_usd)
      }
      staged.push({ id: row.id, channel: row.channel, units: valueUnits })
    }
    for (const entry of staged) {
      this.seen.add(entry.id)
      if (entry.issue) this.issues.push(entry.issue)
      else this.units[entry.channel!] += entry.units!
    }
  }

  totals(): ReportMoneyTotals {
    return {
      sale_calculated_total: money4Text(this.units.sale_calculated_total),
      sale_rounding_adjustment: money4Text(this.units.sale_rounding_adjustment),
      refund_payout: money4Text(this.units.refund_payout),
      cancellation: money4Text(this.units.cancellation),
      cost_of_goods: money4Text(this.units.cost_of_goods),
    }
  }

  diagnostics(): readonly ReportMoneyDiagnostic[] { return [...this.issues] }
  complete(): boolean { return this.issues.length === 0 }
  rowCount(): number { return this.seen.size }
}
