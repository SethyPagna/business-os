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
  return parsed
}

const finite = (value: number, message: string): number => {
  if (!Number.isFinite(value)) throw new RangeError(message)
  return value
}

const add = (left: number, right: number): number => finite(left + right, 'Movement cost sum exceeds the supported range')
const multiply = (left: number, right: number): number => finite(left * right, 'Movement cost total exceeds the supported range')
const round4 = (value: number): number => {
  const scaled = finite(value * 10_000, 'Movement cost rounding exceeds the supported range')
  return finite(Math.round(scaled) / 10_000, 'Movement cost rounding exceeds the supported range')
}

function resolveCurrency(
  quantity: number,
  components: MovementCostComponent[],
  field: 'unitCostUsd' | 'unitCostKhr',
  fallback: unknown,
): { unit: number | null; total: number | null } {
  const fallbackCost = money(fallback)
  let covered = 0
  let total = 0
  for (const component of components) {
    const componentQuantity = Number(component.quantity)
    if (!(componentQuantity > 0)) continue
    const cost = money(component[field]) ?? fallbackCost
    if (cost == null) return { unit: null, total: null }
    covered = add(covered, componentQuantity)
    total = add(total, multiply(componentQuantity, cost))
  }
  if (covered + 0.000000001 < quantity) {
    if (fallbackCost == null) return { unit: null, total: null }
    total = add(total, multiply(quantity - covered, fallbackCost))
  }
  const roundedTotal = round4(total)
  return { unit: round4(finite(roundedTotal / quantity, 'Movement unit cost exceeds the supported range')), total: roundedTotal }
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
  let covered = 0
  for (const component of components) {
    const componentQuantity = Number(component.quantity)
    if (!Number.isFinite(componentQuantity) || componentQuantity < 0) {
      throw new RangeError('Movement cost component quantities must be finite non-negative numbers')
    }
    // Validate even zero-quantity component values; accepting Infinity merely
    // because its row carried no quantity would make malformed plans latent.
    money(component.unitCostUsd)
    money(component.unitCostKhr)
    covered = add(covered, componentQuantity)
  }
  if (covered > quantity + 0.000000001) throw new RangeError('Movement cost components cannot exceed the movement quantity')
  money(input.fallbackUnitCostUsd)
  money(input.fallbackUnitCostKhr)
  const usd = resolveCurrency(quantity, components, 'unitCostUsd', input.fallbackUnitCostUsd)
  const khr = resolveCurrency(quantity, components, 'unitCostKhr', input.fallbackUnitCostKhr)
  return { unitCostUsd: usd.unit, unitCostKhr: khr.unit, totalCostUsd: usd.total, totalCostKhr: khr.total }
}
