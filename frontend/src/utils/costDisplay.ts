import { MAX_MONEY_ABS, sumMoney4 } from './moneyPrecision.ts'

type Translate = (key: string) => string | undefined

export type CostTotal = { total: number | null; unknown: number }

export function knownCost(value: unknown): number | null {
  let numeric: number
  if (typeof value === 'number') numeric = value
  else if (typeof value === 'string' && value.trim() !== '') numeric = Number(value)
  else return null
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= MAX_MONEY_ABS ? numeric + 0 : null
}

export function isKnownCost(value: unknown): boolean {
  return knownCost(value) !== null
}

function fill(template: string, count: number): string {
  return template.replace('{count}', String(count))
}

export function unknownCostLabel(t: Translate): string {
  return t('cost_unknown') || 'Unknown cost'
}

export function formatCostOrUnknown(value: unknown, fmt: (amount: number) => string, t: Translate): string {
  const cost = knownCost(value)
  return cost === null ? unknownCostLabel(t) : fmt(cost)
}

export function costTotal<T = unknown>(rows: readonly T[], pick: (row: T) => unknown = (row) => row): CostTotal {
  const known: number[] = []
  let unknown = 0
  for (const row of rows) {
    const cost = knownCost(pick(row))
    if (cost === null) unknown++
    else known.push(cost)
  }
  return { total: known.length ? sumMoney4(known) : null, unknown }
}

export function partialCostNote(count: number, t: Translate): string | null {
  return count > 0 ? fill(t('cost_partial_count') || 'Partial — {count} unknown cost', count) : null
}

export function allUnknownCostNote(count: number, t: Translate): string {
  return fill(t('cost_all_unknown') || 'Unknown — no cost recorded on {count}', count)
}
