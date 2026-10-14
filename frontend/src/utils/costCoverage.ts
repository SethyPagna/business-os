import { partialCostNote, unknownCostLabel } from './costDisplay.ts'

type Translate = (key: string) => string | undefined

export type CostCoverage = {
  measured: boolean
  unknown: number
  allUnknown: boolean
}

const UNMEASURED: CostCoverage = { measured: false, unknown: 0, allUnknown: false }

function count(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/**
 * How much of a sales/profit figure had a recorded cost. A payload that predates the count keys (a stale cached
 * stats strip, an older Worker) is NOT MEASURED: it is neither complete nor unknown, and shows no marker.
 */
export function costCoverage(source: unknown): CostCoverage {
  if (!source || typeof source !== 'object') return UNMEASURED
  const row = source as Record<string, unknown>
  const unknown = count(row.cost_missing_snapshot_lines)
  if (unknown === null) return UNMEASURED
  const known = count(row.cost_known_lines)
  return { measured: true, unknown, allUnknown: unknown > 0 && known === 0 }
}

/** A cost-derived figure as text: the unknown label when nothing was costed, else the figure plus the partial note. */
export function costFigureText(formatted: string, coverage: CostCoverage, t: Translate): string {
  if (coverage.allUnknown) return unknownCostLabel(t)
  const note = partialCostNote(coverage.unknown, t)
  return note ? `${formatted} · ${note}` : formatted
}
