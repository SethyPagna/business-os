import { addMoney4, divideMoney4, multiplyMoney4, roundMoney4, subtractMoney4, sumMoney4, weightedMeanMoney4 } from './moneyPrecision.ts'

// Stock-session money rules shared by the browser and the Worker. The copy in
// cloudflare/src/lib/stockSessionMath.ts must stay identical apart from its
// import line and the browser-only estimate at the end;
// frontend/tests/stockSessionMathParity.test.ts runs both.

/** Half a cent: the same "fully paid" tolerance sales use. */
export const SUPPLIER_TOTAL_TOLERANCE_USD = 0.005

export type StockSessionCostLine = { qty: number; unitCost: number }

export type MatchCostsResult =
  | { ok: true; costs: number[] }
  | { ok: false; code: 'items_total_zero' | 'paid_zero' }

const units = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** The lot's unit cost when free units arrive with the paid ones: the paid money spread over every unit. */
export function effectiveUnitCost(qty: number, free: number, unitCost: number): number {
  const paid = units(qty)
  const extra = units(free)
  if (!paid) return 0
  if (!extra) return roundMoney4(unitCost)
  return divideMoney4(multiplyMoney4(unitCost, paid), paid + extra)
}

/** What the supplier is paid for: each line's paid quantity times its unit cost, free units excluded. */
export function paidItemsTotal(lines: readonly StockSessionCostLine[]): number {
  return sumMoney4(lines.map((line) => multiplyMoney4(Number(line.unitCost) || 0, units(line.qty))))
}

export function supplierTotalMatches(itemsTotal: number, paid: number): boolean {
  return Math.abs(subtractMoney4(paid, itemsTotal)) <= SUPPLIER_TOTAL_TOLERANCE_USD
}

/**
 * Rescale every unit cost so the items total equals what was paid, 4 dp each.
 * The rounding left over goes to the line with the most units first, then to
 * the others in turn, so a line with few units can absorb the last fraction.
 * A zero-cost line stays free.
 */
export function matchCostsToPaid(lines: readonly StockSessionCostLine[], paid: number): MatchCostsResult {
  const total = paidItemsTotal(lines)
  const target = roundMoney4(paid)
  if (total === 0 && target > 0) return { ok: false, code: 'items_total_zero' }
  if (target === 0 && total > 0) return { ok: false, code: 'paid_zero' }
  if (total === 0) return { ok: true, costs: lines.map((line) => roundMoney4(Number(line.unitCost) || 0)) }
  const costs = lines.map((line) => {
    const cost = Number(line.unitCost) || 0
    return units(line.qty) && cost > 0 ? weightedMeanMoney4([{ amount: cost, factor: target }], total) : roundMoney4(cost)
  })
  const order = lines
    .map((line, index) => ({ index, qty: units(line.qty) }))
    .filter((entry) => entry.qty > 0 && costs[entry.index] > 0)
    .sort((a, b) => b.qty - a.qty || a.index - b.index)
  for (const { index, qty } of order) {
    const residual = subtractMoney4(target, paidItemsTotal(lines.map((line, at) => ({ qty: line.qty, unitCost: costs[at] }))))
    if (residual === 0) break
    const next = addMoney4(costs[index], divideMoney4(residual, qty))
    if (next > 0) costs[index] = next
  }
  return { ok: true, costs }
}

// ---- browser only below this line ----

/**
 * The Review step's catalog cost after a receipt, before the server has
 * recomputed it: the quantity-weighted mean of what is on hand and what
 * arrives. A cost of 0 means not recorded and takes no part. The server's
 * catalogCostRecompute stays authoritative.
 */
export function estimateCatalogCostAfter(onHand: number, currentCost: number, addedQty: number, addedCost: number): number {
  const held = units(onHand)
  const added = units(addedQty)
  const current = Number(currentCost) > 0 ? Number(currentCost) : 0
  const incoming = Number(addedCost) > 0 ? Number(addedCost) : 0
  const terms = [
    ...(held && current ? [{ amount: current, factor: held }] : []),
    ...(added && incoming ? [{ amount: incoming, factor: added }] : []),
  ]
  if (!terms.length) return roundMoney4(current || incoming)
  return weightedMeanMoney4(terms, terms.reduce((sum, term) => sum + term.factor, 0))
}
