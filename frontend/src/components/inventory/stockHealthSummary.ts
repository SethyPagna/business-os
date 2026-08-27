// The ONE place the stock-health -> colour mapping lives (11.20 / 5.5).
//
// The Inventory stat cards used to spell out "42 Healthy | 5 Low | 2 Out" in
// grey text. The user asked for COLOUR to carry the status in the default view
// (green healthy / amber low / red out), leaving the names to the detail
// breakdown. Extracting the mapping here -- rather than hard-coding the three
// colour classes at the render site -- means every surface that shows a
// stock-health split (this card today, Branches/POS tomorrow) reads the SAME
// colour for the SAME status and cannot drift, the same single-source rule as
// attachBatchCounts. Colour is never the ONLY signal: each segment still
// carries its label for the title/aria text, so screen readers and hover keep
// the words.

export type StockHealthKey = 'healthy' | 'low' | 'out'

export interface StockHealthSegment {
  key: StockHealthKey
  count: number
  /** Tailwind text-colour classes (light + dark) for this status. */
  colorClass: string
  /** Human label, kept for title/aria so colour is not the sole cue. */
  label: string
}

const STOCK_HEALTH_COLOURS: Record<StockHealthKey, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  low: 'text-amber-600 dark:text-amber-400',
  out: 'text-red-600 dark:text-red-400',
}

/** Colour class for one stock-health status. Use this, never a literal. */
export function stockHealthColour(key: StockHealthKey): string {
  return STOCK_HEALTH_COLOURS[key]
}

/**
 * The healthy/low/out segments in display order, each with its colour and
 * label. Counts are coerced to finite non-negative integers so a missing or
 * NaN input renders as 0 rather than "NaN".
 */
export function buildStockHealthSegments(
  counts: { healthy: unknown; low: unknown; out: unknown },
  labels: { healthy: string; low: string; out: string },
): StockHealthSegment[] {
  const n = (value: unknown): number => {
    const num = Math.trunc(Number(value))
    return Number.isFinite(num) && num > 0 ? num : 0
  }
  return [
    { key: 'healthy', count: n(counts.healthy), colorClass: STOCK_HEALTH_COLOURS.healthy, label: labels.healthy },
    { key: 'low', count: n(counts.low), colorClass: STOCK_HEALTH_COLOURS.low, label: labels.low },
    { key: 'out', count: n(counts.out), colorClass: STOCK_HEALTH_COLOURS.out, label: labels.out },
  ]
}
