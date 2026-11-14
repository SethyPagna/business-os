import type { Env } from '../index'
import type { SalesDailyComputed } from './salesDailyTotals'

// The seam between the stored-daily-totals cron (lib/salesDailyCron.ts) and the report kernel (lib/salesAnalytics.ts).
//
// computeDays is the kernel's own bounded read of the RAW records for the named business dates (one date-index read for all of them, the same
// pagers and refusals as a request), folded with the kernel's own per-sale facts and additive aggregation into one payload per date and branch.
// It never finishes a figure: the non-additive steps run after a reader has summed days. A date the kernel refuses (unsupported money rows, too many
// rows) comes back with the kernel's own refusal code and no payload. '' names the sales whose created_at is NULL or unreadable.
//
// Slice 1, phase A ships the interface only: the kernel refactor lands after lane/sales-stats-reads releases salesAnalytics.ts, and until then no
// kernel is wired, so the recompute and reconcile steps answer { skipped: 'kernel-not-wired' } and nothing is ever stored or served.
export interface SalesDailyKernel {
  /** Must equal SALES_DAILY_KERNEL_VERSION; a cron that finds them apart refuses to store anything. */
  readonly version: number
  computeDays(env: Env, days: readonly string[]): Promise<ReadonlyMap<string, SalesDailyComputed>>
}

export function getSalesDailyKernel(): SalesDailyKernel | null {
  return null
}
