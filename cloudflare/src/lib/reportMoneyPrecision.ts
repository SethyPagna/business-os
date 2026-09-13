import { MAX_MONEY_ABS, MONEY_PRECISION_POLICY_VERSION, type DecimalInput } from './moneyPrecision'

export const REPORT_MONEY_PAGE_SIZE = 500
export const REPORT_MONEY_MAX_ROWS = 100_000
const MAX_ABS = BigInt(MAX_MONEY_ABS)
type Fraction = { n: bigint; d: bigint }

export type ReportMoneyPrecisionMode = 'canonical_v1' | 'exact_recorded'
export type ReportMoneyChannel = 'sale_calculated_total' | 'sale_rounding_adjustment' | 'refund_payout' | 'cancellation' | 'cost_of_goods'
export type ReportMoneyRefusalCode = 'unsupported_precision_version' | 'unsupported_row' | 'invalid_saved_money4'
  | 'invalid_recorded_decimal' | 'invalid_quantity' | 'duplicate_row' | 'too_many_rows' | 'aggregate_overflow'
  | 'snapshot_changed' | 'maintenance_restore'

export class ReportMoneyPrecisionError extends RangeError {
  constructor(readonly code: ReportMoneyRefusalCode) { super(code); this.name = 'ReportMoneyPrecisionError' }
}

export function reportMoneyHttpError(error: ReportMoneyPrecisionError): { status: 409 | 413 | 422; message: string } {
  if (error.code === 'snapshot_changed' || error.code === 'maintenance_restore') {
    return { status: 409, message: 'Report snapshot changed; retry the request' }
  }
  if (error.code === 'too_many_rows') return { status: 413, message: 'Report is too large for one request' }
  return { status: 422, message: 'Report contains unsupported money data' }
}

function abs(value: bigint): bigint { return value < 0n ? -value : value }
function gcd(left: bigint, right: bigint): bigint {
  while (right !== 0n) { const remainder = left % right; left = right; right = remainder }
  return left
}
function fraction(n: bigint, d: bigint): Fraction {
  if (d === 0n) throw new ReportMoneyPrecisionError('invalid_recorded_decimal')
  if (d < 0n) { n = -n; d = -d }
  const divisor = gcd(abs(n), d)
  return { n: n / divisor, d: d / divisor }
}
function decimal(value: DecimalInput, canonicalV1: boolean): Fraction {
  const refusal = canonicalV1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal'
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new ReportMoneyPrecisionError(refusal)
  }
  const text = String(value).trim()
  if (!text || text.length > 96 || (canonicalV1 && !/^[+-]?\d+(?:\.\d{1,4})?$/.test(text))) {
    throw new ReportMoneyPrecisionError(refusal)
  }
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,2}))?$/.exec(text)
  if (!match) throw new ReportMoneyPrecisionError(refusal)
  const whole = match[2] || ''
  const tail = match[3] ?? match[4] ?? ''
  const digits = whole + tail
  const exponent = Number(match[5] || 0)
  if (digits.length > 40 || tail.length > 24 || Math.abs(exponent) > 24) throw new ReportMoneyPrecisionError(refusal)
  const scale = tail.length - exponent
  const signed = BigInt(digits) * (match[1] === '-' ? -1n : 1n)
  const parsed = scale >= 0 ? fraction(signed, 10n ** BigInt(scale)) : fraction(signed * 10n ** BigInt(-scale), 1n)
  if (abs(parsed.n) > MAX_ABS * parsed.d) throw new ReportMoneyPrecisionError(canonicalV1 ? refusal : 'aggregate_overflow')
  return parsed
}
function plus(left: Fraction, right: Fraction): Fraction { return fraction(left.n * right.d + right.n * left.d, left.d * right.d) }
function roundedUnits(value: Fraction, places: number): bigint {
  const scaled = value.n * 10n ** BigInt(places)
  let result = scaled / value.d
  const remainder = scaled % value.d
  if (abs(remainder) * 2n >= value.d) result += scaled < 0n ? -1n : 1n
  return result
}
function unitsText(units: bigint, places: number): string {
  const scale = 10n ** BigInt(places)
  const negative = units < 0n
  const absolute = negative ? -units : units
  return `${negative ? '-' : ''}${absolute / scale}.${String(absolute % scale).padStart(places, '0')}`
}

/** Exact rational used within one bounded report read. No monetary operand is
 * quantized until a response boundary calls toNumber()/toText(). */
export class ReportExactDecimal {
  private constructor(private readonly value: Fraction) {}
  static zero(): ReportExactDecimal { return new ReportExactDecimal({ n: 0n, d: 1n }) }
  static recorded(value: DecimalInput): ReportExactDecimal { return new ReportExactDecimal(decimal(value, false)) }
  static money(value: DecimalInput, version: 0 | 1): ReportExactDecimal {
    if (version !== 0 && version !== MONEY_PRECISION_POLICY_VERSION) throw new ReportMoneyPrecisionError('unsupported_precision_version')
    return new ReportExactDecimal(decimal(value, version === MONEY_PRECISION_POLICY_VERSION))
  }
  static quantity(value: DecimalInput): ReportExactDecimal {
    let parsed: Fraction
    try { parsed = decimal(value, false) } catch { throw new ReportMoneyPrecisionError('invalid_quantity') }
    if (parsed.n <= 0n) throw new ReportMoneyPrecisionError('invalid_quantity')
    return new ReportExactDecimal(parsed)
  }
  add(other: ReportExactDecimal): ReportExactDecimal { return new ReportExactDecimal(plus(this.value, other.value)) }
  subtract(other: ReportExactDecimal): ReportExactDecimal { return new ReportExactDecimal(plus(this.value, { n: -other.value.n, d: other.value.d })) }
  multiply(other: ReportExactDecimal): ReportExactDecimal { return new ReportExactDecimal(fraction(this.value.n * other.value.n, this.value.d * other.value.d)) }
  divide(other: ReportExactDecimal): ReportExactDecimal {
    if (other.value.n === 0n) throw new ReportMoneyPrecisionError('invalid_recorded_decimal')
    return new ReportExactDecimal(fraction(this.value.n * other.value.d, this.value.d * other.value.n))
  }
  compare(other: ReportExactDecimal): number {
    const difference = this.value.n * other.value.d - other.value.n * this.value.d
    return difference < 0n ? -1 : difference > 0n ? 1 : 0
  }
  min(other: ReportExactDecimal): ReportExactDecimal { return this.compare(other) <= 0 ? this : other }
  max(other: ReportExactDecimal): ReportExactDecimal { return this.compare(other) >= 0 ? this : other }
  isNegative(): boolean { return this.value.n < 0n }
  isPositive(): boolean { return this.value.n > 0n }
  assertMoneyBound(): ReportExactDecimal {
    if (abs(this.value.n) > MAX_ABS * this.value.d) throw new ReportMoneyPrecisionError('aggregate_overflow')
    return this
  }
  toText(places = 4): string { this.assertMoneyBound(); return unitsText(roundedUnits(this.value, places), places) }
  toNumber(places = 2): number {
    const value = Number(this.toText(places))
    if (!Number.isFinite(value)) throw new ReportMoneyPrecisionError('aggregate_overflow')
    return value || 0
  }
}

export type ReportSavedScalar = { kind: 'saved_scalar'; id: string; channel: Exclude<ReportMoneyChannel, 'cost_of_goods'>; money_precision_version: 0 | 1; value_usd: DecimalInput }
export type ReportSavedItemCost = { kind: 'item_cost'; id: string; channel: 'cost_of_goods'; money_precision_version: 0 | 1; cost_price_usd: DecimalInput | null; quantity: DecimalInput }
export type ReportMoneyRow = ReportSavedScalar | ReportSavedItemCost
export type ReportMoneyDiagnostic = { code: 'unknown_cost'; row_id: string }
export type ReportMoneyTotals = Record<ReportMoneyChannel, string>

export class ReportMoneyAccumulator {
  private readonly totalsByChannel: Record<ReportMoneyChannel, ReportExactDecimal> = {
    sale_calculated_total: ReportExactDecimal.zero(), sale_rounding_adjustment: ReportExactDecimal.zero(),
    refund_payout: ReportExactDecimal.zero(), cancellation: ReportExactDecimal.zero(), cost_of_goods: ReportExactDecimal.zero(),
  }
  private readonly seen = new Set<string>()
  private readonly issues: ReportMoneyDiagnostic[] = []
  constructor(private readonly maxRows = REPORT_MONEY_MAX_ROWS) {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > REPORT_MONEY_MAX_ROWS) throw new ReportMoneyPrecisionError('too_many_rows')
  }
  addPage(rows: readonly ReportMoneyRow[]): void {
    if (rows.length > REPORT_MONEY_PAGE_SIZE || this.seen.size + rows.length > this.maxRows) throw new ReportMoneyPrecisionError('too_many_rows')
    const pageIds = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id || pageIds.has(row.id) || this.seen.has(row.id)) throw new ReportMoneyPrecisionError('duplicate_row')
      // This public accumulator remains the canonical-v1 primitive introduced
      // before reader activation. Legacy exact arithmetic is handled by the
      // snapshot reader through ReportExactDecimal.money(value, 0).
      if (row.money_precision_version !== MONEY_PRECISION_POLICY_VERSION) throw new ReportMoneyPrecisionError('unsupported_precision_version')
      if ((row.kind === 'item_cost' && row.channel !== 'cost_of_goods')
        || (row.kind === 'saved_scalar' && !['sale_calculated_total', 'sale_rounding_adjustment', 'refund_payout', 'cancellation'].includes(row.channel))
        || (row.kind !== 'item_cost' && row.kind !== 'saved_scalar')) throw new ReportMoneyPrecisionError('unsupported_row')
      pageIds.add(row.id)
    }
    const staged: Array<{ id: string; channel?: ReportMoneyChannel; value?: ReportExactDecimal; issue?: ReportMoneyDiagnostic }> = []
    for (const row of rows) {
      if (row.kind === 'item_cost') {
        const quantity = ReportExactDecimal.quantity(row.quantity)
        if (row.cost_price_usd === null) { staged.push({ id: row.id, issue: { code: 'unknown_cost', row_id: row.id } }); continue }
        const cost = ReportExactDecimal.money(row.cost_price_usd, row.money_precision_version)
        if (cost.isNegative()) throw new ReportMoneyPrecisionError(row.money_precision_version === 1 ? 'invalid_saved_money4' : 'invalid_recorded_decimal')
        const line = cost.multiply(quantity).assertMoneyBound()
        staged.push({ id: row.id, channel: row.channel, value: ReportExactDecimal.recorded(line.toText(4)) })
      } else staged.push({ id: row.id, channel: row.channel, value: ReportExactDecimal.money(row.value_usd, row.money_precision_version) })
    }
    for (const entry of staged) {
      this.seen.add(entry.id)
      if (entry.issue) this.issues.push(entry.issue)
      else this.totalsByChannel[entry.channel!] = this.totalsByChannel[entry.channel!].add(entry.value!)
    }
  }
  totals(): ReportMoneyTotals { return Object.fromEntries(Object.entries(this.totalsByChannel).map(([key, value]) => [key, value.toText(4)])) as ReportMoneyTotals }
  diagnostics(): readonly ReportMoneyDiagnostic[] { return [...this.issues] }
  complete(): boolean { return this.issues.length === 0 }
  rowCount(): number { return this.seen.size }
}
