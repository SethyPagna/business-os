/**
 * planTier.ts - which Cloudflare plan this deployment runs on, and which of
 * its ceilings are smaller than they would be on the paid plan.
 *
 * The same codebase deploys twice: `wrangler.toml` (paid) and
 * `wrangler.free.toml` (free). Nearly two dozen numbers change between them
 * -- import chunk sizes, the stock-action ceiling, backup and restore batch
 * caps, the per-invocation CPU and subrequest budgets. On the free config the
 * app is not broken, it is *smaller*: imports take more passes, a stock file
 * has to be split sooner, a backup copies fewer files per run. Before this
 * module there was nothing anywhere in the admin app that said so, which made
 * every one of those a mystery rather than a documented trade-off.
 *
 * Everything here is DERIVED from the Worker's answer:
 *   - `limits` is the running tier's row of PLAN_LIMITS_BY_TIER
 *   - `notices` is the Worker's own diff of free against paid, one entry per
 *     ceiling that shrank (or capability that turned off), carrying BOTH
 *     numbers so the panel can state them without re-deriving anything
 * A limit added to cloudflare/src/lib/planTier.ts therefore appears here with
 * no change to this file -- except its label, which is the one thing the
 * Worker deliberately does not hold (it carries no display copy in either
 * language). LIMIT_LABEL_KEYS below is that missing half, and
 * tests/planTierNotice.test.ts fails if a field in the Worker's table has no
 * entry here, or an entry that is missing from either language pack.
 */

import { apiFetch } from '../api/http.ts'

export type PlanTier = 'free' | 'paid'

/**
 * Deliberately loose: the Worker owns this table's shape and adds fields to
 * it, and this module must not need editing (or, worse, silently drop a
 * field) when it does. Consumers read it through `notices`, which is typed.
 */
export type PlanLimits = Record<string, number | boolean | string> & { tier: PlanTier }

export type PlanNotice = {
  /** The PlanLimits field name -- a stable key, not display copy. */
  id: string
  /** 'smaller' = a reduced number; 'disabled' = a capability that is off. */
  kind: 'smaller' | 'disabled'
  free: number | boolean
  paid: number | boolean
}

export type PlanStatus = {
  tier: PlanTier
  limits: PlanLimits
  notices: PlanNotice[]
}

/**
 * Label key per limit. One entry per field of the Worker's PlanLimits (minus
 * `tier`, which is not a limit) -- including the fields that are EQUAL on
 * both tiers and so never produce a notice today, because "equal on both
 * tiers" is a decision that can be revisited and a missing label would then
 * surface as a raw identifier in front of an operator.
 *
 * The keys are listed as literals rather than built from the id (there is a
 * mechanical camelCase -> snake_case mapping) so `npm run verify:i18n`'s
 * pack-coverage scan and a reader searching the repo for a string both find
 * them.
 */
export const LIMIT_LABEL_KEYS: Record<string, string> = {
  rowsPerImportChunk: 'plan_limit_rows_per_import_chunk',
  preflightMaxRows: 'plan_limit_preflight_max_rows',
  materializeRowsPerChunk: 'plan_limit_materialize_rows_per_chunk',
  d1BatchChunkStatements: 'plan_limit_d1_batch_chunk_statements',
  stockActionMaxUnits: 'plan_limit_stock_action_max_units',
  stockActionMaxRows: 'plan_limit_stock_action_max_rows',
  stockActionClassifyWindow: 'plan_limit_stock_action_classify_window',
  stockActionDispatchRead: 'plan_limit_stock_action_dispatch_read',
  stockActionAddConcurrency: 'plan_limit_stock_action_add_concurrency',
  historicalSalesImportConcurrency: 'plan_limit_historical_sales_concurrency',
  importQueueMaxBatchSize: 'plan_limit_import_queue_batch_size',
  maxImagesPerImportRequest: 'plan_limit_max_images_per_request',
  maxAssetsPerBackup: 'plan_limit_max_assets_per_backup',
  backupTablePageSize: 'plan_limit_backup_table_page_size',
  backupRestoreRowsPerBatch: 'plan_limit_backup_restore_rows_per_batch',
  maxImageDeletesPerReset: 'plan_limit_max_image_deletes_per_reset',
  longAiImagePassesEnabled: 'plan_limit_long_ai_image_passes',
  kvWritesPerDay: 'plan_limit_kv_writes_per_day',
  r2ClassAPerMonth: 'plan_limit_r2_class_a_per_month',
  imagesTransformsPerMonth: 'plan_limit_images_transforms_per_month',
  cloudinaryTransformsPerMonth: 'plan_limit_cloudinary_transforms_per_month',
  cpuMsPerInvocation: 'plan_limit_cpu_ms_per_invocation',
  subrequestsPerInvocation: 'plan_limit_subrequests_per_invocation',
  d1DailyRowsReadCeiling: 'plan_limit_d1_daily_rows_read',
  d1DailyRowsWrittenCeiling: 'plan_limit_d1_daily_rows_written',
  d1MaxBoundParams: 'plan_limit_d1_max_bound_params',
  d1MaxSqlLengthBytes: 'plan_limit_d1_max_sql_length',
}

/**
 * Reads the running deployment's plan. Never throws for the caller's benefit
 * -- the panel that shows this is a notice, not a feature, and a failed read
 * must leave the page exactly as it was rather than replacing it with an
 * error the operator can do nothing about.
 */
export async function fetchPlanStatus(): Promise<PlanStatus | null> {
  try {
    const result = await apiFetch('GET', '/api/system/plan') as Partial<PlanStatus> | null
    const tier = result?.tier
    if (tier !== 'free' && tier !== 'paid') return null
    return {
      tier,
      limits: (result?.limits || { tier }) as PlanLimits,
      notices: Array.isArray(result?.notices) ? result.notices as PlanNotice[] : [],
    }
  } catch {
    return null
  }
}

/**
 * A notice's two values as display strings. Booleans become the on/off words
 * (the caller passes them in already translated, since this module holds no
 * copy); numbers get thousands separators, which matters for the several
 * seven- and nine-digit ceilings in this table.
 */
export function formatPlanNoticeValue(
  value: number | boolean,
  words: { on: string; off: string },
): string {
  if (typeof value === 'boolean') return value ? words.on : words.off
  if (!Number.isFinite(value)) return String(value)
  return value.toLocaleString('en-US')
}

/**
 * Label key for one notice, falling back to a humanized form of the id.
 *
 * The fallback exists because the Worker's table is the source of truth and
 * may gain a field before this module does. Showing "Some New Ceiling: 10
 * (paid 100)" is worse than a translated label but far better than dropping
 * the line -- the whole point of the panel is that nothing shrinks silently.
 * tests/planTierNotice.test.ts keeps the fallback from ever being reached in
 * a shipped build.
 */
export function planNoticeLabelKey(id: string): string | null {
  return LIMIT_LABEL_KEYS[id] || null
}

export function humanizePlanLimitId(id: string): string {
  const spaced = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bD1\b/gi, 'D1')
    .toLowerCase()
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
