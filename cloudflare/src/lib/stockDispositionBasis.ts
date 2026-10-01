type DecimalFraction = { numerator: bigint; denominator: bigint }
const MAX_MONEY4 = 1000000000000000n

function decimalFraction(value: unknown): DecimalFraction {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) throw new RangeError('unsupported_decimal')
  const text = String(value).trim()
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,2}))?$/.exec(text)
  if (!match || text.length > 96) throw new RangeError('unsupported_decimal')
  const whole = match[2] || '', tail = match[3] ?? match[4] ?? '', exponent = Number(match[5] || 0)
  if ((whole + tail).length > 40 || tail.length > 24 || Math.abs(exponent) > 24) throw new RangeError('unsupported_decimal_precision')
  const scale = tail.length - exponent
  const numerator = BigInt(whole + tail) * (match[1] === '-' ? -1n : 1n)
  return scale >= 0 ? { numerator, denominator: 10n ** BigInt(scale) } : { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n }
}

function decimalText(value: DecimalFraction): string {
  if (value.numerator < 0n) throw new RangeError('negative_quantity')
  if (value.numerator === 0n) return '0'
  let a = value.numerator, b = value.denominator
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder }
  value = { numerator: value.numerator/a, denominator: value.denominator/a }
  let scale = 0, factor = 1n
  while (factor % value.denominator !== 0n && scale < 48) { scale++; factor *= 10n }
  if (factor % value.denominator !== 0n || scale > 24) throw new RangeError('unsupported_decimal_precision')
  const digits = String(value.numerator * factor / value.denominator).padStart(scale + 1, '0')
  return scale ? `${digits.slice(0,-scale)}.${digits.slice(-scale)}`.replace(/0+$/,'').replace(/\.$/,'') : digits
}

export function quantityDecimal(value: unknown, allowZero = false): string {
  const quantity = decimalFraction(value)
  if (quantity.numerator < 0n || (!allowZero && quantity.numerator === 0n) || quantity.numerator > 1000000000n * quantity.denominator) throw new RangeError('quantity_out_of_range')
  const text = decimalText(quantity)
  if (!Number.isFinite(Number(text)) || (!allowZero && Number(text) <= 0)) throw new RangeError('unsupported_quantity_representation')
  const physical = decimalFraction(Number(text))
  if (physical.numerator * quantity.denominator !== quantity.numerator * physical.denominator) throw new RangeError('unsupported_quantity_representation')
  return text
}

export function exactMoney4(value: unknown): number {
  const amount = decimalFraction(value), scaled = amount.numerator * 10000n
  if (scaled < 0n || scaled % amount.denominator !== 0n || scaled / amount.denominator > MAX_MONEY4) throw new RangeError('unsupported_money4')
  return Number(scaled / amount.denominator)
}

function moneyInteger(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > MAX_MONEY4) throw new RangeError('invalid_money4_integer')
  return BigInt(value)
}

export function subtractQuantity(total: unknown, values: readonly unknown[]): string {
  let remaining = decimalFraction(quantityDecimal(total,true))
  for (const value of values) {
    const part = decimalFraction(quantityDecimal(value,true))
    remaining = { numerator: remaining.numerator * part.denominator - part.numerator * remaining.denominator, denominator: remaining.denominator * part.denominator }
    remaining = decimalFraction(decimalText(remaining))
  }
  return quantityDecimal(decimalText(remaining),true)
}

export function allocateDispositionBasis(remainingQuantity: unknown, remainingGross4: number, remainingCoverage4: number, quantity: unknown) {
  const available = decimalFraction(quantityDecimal(remainingQuantity)), take = decimalFraction(quantityDecimal(quantity))
  const remaining = subtractQuantity(remainingQuantity,[quantity])
  const gross = moneyInteger(remainingGross4), coverage = moneyInteger(remainingCoverage4)
  if (coverage > gross) throw new RangeError('coverage_exceeds_basis')
  const ratioNumerator = take.numerator * available.denominator, ratioDenominator = take.denominator * available.numerator
  const grossTake = gross * ratioNumerator / ratioDenominator
  const netTake = (gross - coverage) * ratioNumerator / ratioDenominator
  const coverageTake = grossTake - netTake
  return {
    quantity: quantityDecimal(quantity), gross4: Number(grossTake), coverage4: Number(coverageTake), net4: Number(netTake),
    remainingQuantity: remaining, remainingGross4: Number(gross-grossTake), remainingCoverage4: Number(coverage-coverageTake), remainingNet4: Number(gross-coverage-netTake),
  }
}
