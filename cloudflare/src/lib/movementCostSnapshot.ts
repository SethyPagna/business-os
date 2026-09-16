import { roundMoney4, sumProductsMoney4, weightedMeanMoney4, subtractDecimalSum } from './moneyPrecision'

export type MovementCostPair = {
  unitCostUsd: number | null
  unitCostKhr: number | null
  totalCostUsd: number | null
  totalCostKhr: number | null
}

export type MovementCostComponent = {
  quantity: number
  unitCostUsd?: number | null
  unitCostKhr?: number | null
}

const money = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new RangeError('Movement costs must be finite non-negative numbers')
  // Inputs here are authoritative captured lot/product costs, potentially from
  // historical rows with more than four decimals. Validate range, not reprice.
  // New user-input cost quantization belongs at the writer boundary.
  roundMoney4(parsed)
  return parsed
}

function resolveCurrency(
  quantity: number,
  components: MovementCostComponent[],
  field: 'unitCostUsd' | 'unitCostKhr',
  fallback: unknown,
  remainder: string,
): { unit: number | null; total: number | null } {
  const fallbackCost = money(fallback)
  const terms: { amount: number; factor: number | string }[] = []
  for (const component of components) {
    const componentQuantity = Number(component.quantity)
    if (!(componentQuantity > 0)) continue
    const cost = money(component[field]) ?? fallbackCost
    if (cost == null) return { unit: null, total: null }
    terms.push({ amount: cost, factor: componentQuantity })
  }
  if (remainder !== '0') {
    if (fallbackCost == null) return { unit: null, total: null }
    terms.push({ amount: fallbackCost, factor: remainder })
  }
  const roundedTotal = sumProductsMoney4(terms)
  const distinctCosts = new Set(terms.map(term => term.amount))
  const unit = distinctCosts.size === 1
    ? terms[0].amount
    : weightedMeanMoney4(terms, quantity)
  return { unit, total: roundedTotal }
}

/**
 * Resolve the immutable cost recorded on one stock movement.
 *
 * A component's lot cost wins when present. Missing lot/untracked cost may use
 * the product cost captured by the caller before the write. Zero is data, not
 * absence. If neither source can support a currency, that currency stays NULL
 * rather than being invented from an exchange rate or another currency.
 */
export function resolveMovementCostSnapshot(input: {
  quantity: number
  components?: MovementCostComponent[]
  fallbackUnitCostUsd?: number | null
  fallbackUnitCostKhr?: number | null
}): MovementCostPair {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || !(quantity > 0)) throw new RangeError('Movement quantity must be a finite positive number')
  const components = input.components || []
  const quantities: number[] = []
  for (const component of components) {
    const componentQuantity = Number(component.quantity)
    if (!Number.isFinite(componentQuantity) || componentQuantity < 0) {
      throw new RangeError('Movement cost component quantities must be finite non-negative numbers')
    }
    // Validate even zero-quantity component values; accepting Infinity merely
    // because its row carried no quantity would make malformed plans latent.
    money(component.unitCostUsd)
    money(component.unitCostKhr)
    quantities.push(componentQuantity)
  }
  // Fixed tolerances can erase real money on high-cost or tiny-quantity lots.
  // Compare decimal quantities exactly; retain every positive remainder as text
  // so subtraction does not introduce a binary error before valuation.
  const remainder = subtractDecimalSum(quantity, quantities)
  if (remainder.startsWith('-')) throw new RangeError('Movement cost components cannot exceed the movement quantity')
  money(input.fallbackUnitCostUsd)
  money(input.fallbackUnitCostKhr)
  const usd = resolveCurrency(quantity, components, 'unitCostUsd', input.fallbackUnitCostUsd, remainder)
  const khr = resolveCurrency(quantity, components, 'unitCostKhr', input.fallbackUnitCostKhr, remainder)
  return { unitCostUsd: usd.unit, unitCostKhr: khr.unit, totalCostUsd: usd.total, totalCostKhr: khr.total }
}
