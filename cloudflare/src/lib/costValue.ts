import { MAX_MONEY_ABS, sumMoney4 } from './moneyPrecision'

export type CostSum = { usd: number; unknown: number; complete: boolean }

export function knownCost(value: unknown): number | null {
  let numeric: number
  if (typeof value === 'number') numeric = value
  else if (typeof value === 'string' && value.trim() !== '') numeric = Number(value)
  else return null
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= MAX_MONEY_ABS ? numeric + 0 : null
}

export function sumKnown<T>(rows: readonly T[], pick: (row: T) => unknown): CostSum {
  const known: number[] = []
  let unknown = 0
  for (const row of rows) {
    const cost = knownCost(pick(row))
    if (cost === null) unknown++
    else known.push(cost)
  }
  return { usd: known.length ? sumMoney4(known) : 0, unknown, complete: unknown === 0 }
}

export const COST_KNOWN_SUM = (expr: string): string => `SUM(CASE WHEN ${expr} IS NOT NULL THEN ${expr} END)`

export const COST_UNKNOWN_COUNT = (expr: string): string => `SUM(CASE WHEN ${expr} IS NULL THEN 1 ELSE 0 END)`
