import type { D1Compat } from './db'
import { CATALOG_COST_HAS_RECORDED_LOT_SQL } from './catalogCostRecompute'
import { MERGE_COST_LATEST_MANUAL_SQL, mergeCostAuthorityUsdSql } from './productCostReview'
import { PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_GROUP, PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_REVIEW, PRODUCT_CONFLICT_ACTION_MAX_GROUP_SOURCE_BYTES, PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES } from './productConflictActionGroups'

type Row = Record<string, unknown>
export type MergeCostStep = { mergeId: number; stock: 'merge' | 'write_off' }
export type MergeCostPreviewPlan = { keepId: number; steps: MergeCostStep[] }
export type MergeCostPreviewGraph = { products: Row[]; batches: Row[]; batchStock: Row[]; currentCostEntries: Row[] }
export type MergeCostAuthority = {
  version: 1
  keeperId: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  needsReview: boolean
  source: 'received_lot' | 'manual' | 'keeper_fallback'
}
export class MergeCostPreviewUnavailableError extends Error {
  readonly code = 'resolve_plan_budget'
  constructor() { super('This merge cost preview exceeds the existing review limits.') }
}
function money(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new MergeCostPreviewUnavailableError()
  return value
}
function jsonRows(rows: Row[], fields: string[]): Row[] {
  return rows.map(row => Object.fromEntries(fields.map(field => {
    const value = row[field] ?? null
    if ((typeof value === 'number' && !Number.isFinite(value)) || (value !== null && typeof value === 'object')) throw new MergeCostPreviewUnavailableError()
    return [field, value]
  })))
}
export function projectMergeCostGraph(graph: MergeCostPreviewGraph, plans: MergeCostPreviewPlan[]): MergeCostPreviewGraph {
  const result: MergeCostPreviewGraph = { products: [], batches: [], batchStock: [], currentCostEntries: [] }
  const seen = new Set<number>()
  for (const plan of plans) {
    const ids = [plan.keepId, ...plan.steps.map(step => step.mergeId)]
    if (ids.length < 2 || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0 || seen.has(id))) throw new MergeCostPreviewUnavailableError()
    ids.forEach(id => seen.add(id))
    const members = new Set(ids), keeper = graph.products.find(row => Number(row.id) === plan.keepId)
    if (!keeper || graph.products.filter(row => members.has(Number(row.id))).length !== ids.length) throw new MergeCostPreviewUnavailableError()
    const batches = jsonRows(graph.batches.filter(row => members.has(Number(row.variant_product_id))), ['id', 'variant_product_id', 'batch_key', 'is_active', 'unit_cost_usd', 'received_at'])
    if (batches.length > PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_GROUP) throw new MergeCostPreviewUnavailableError()
    const batchIds = new Set(batches.map(row => Number(row.id)))
    const stock = jsonRows(graph.batchStock.filter(row => batchIds.has(Number(row.batch_id))), ['batch_id', 'branch_id', 'quantity'])
    const byKey = new Map(batches.filter(row => Number(row.variant_product_id) === plan.keepId).map(row => [String(row.batch_key), row]))
    for (const step of plan.steps) {
      if (!['merge', 'write_off'].includes(step.stock)) throw new MergeCostPreviewUnavailableError()
      for (const batch of batches.filter(row => Number(row.variant_product_id) === step.mergeId)) {
        const ownStock = stock.filter(row => Number(row.batch_id) === Number(batch.id))
        if (step.stock === 'write_off') {
          batch.is_active = 0
          ownStock.forEach(row => { row.quantity = 0 })
          continue
        }
        const target = byKey.get(String(batch.batch_key))
        if (!target) {
          batch.variant_product_id = plan.keepId
          byKey.set(String(batch.batch_key), batch)
          continue
        }
        const targetStock = stock.filter(row => Number(row.batch_id) === Number(target.id))
        if ([...ownStock, ...targetStock].some(row => Number(row.quantity) > 0)) target.is_active = 1
        for (const row of ownStock) {
          if (!Number(row.quantity)) continue
          const existing = targetStock.find(item => Number(item.branch_id) === Number(row.branch_id))
          if (existing) existing.quantity = Number(existing.quantity) + Number(row.quantity)
          else { const moved = { ...row, batch_id: target.id }; stock.push(moved); targetStock.push(moved) }
          row.quantity = 0
        }
        batch.is_active = 0
      }
    }
    const entries = jsonRows(graph.currentCostEntries.filter(row => members.has(Number(row.product_id))), ['id', 'product_id', 'cost_usd', 'baseline_batch_id'])
    entries.forEach(row => { row.product_id = plan.keepId })
    const group = { products: [{ id: plan.keepId, cost_price_usd: money(keeper.cost_price_usd), cost_price_khr: money(keeper.cost_price_khr) }], batches, batchStock: stock, currentCostEntries: entries }
    if (new TextEncoder().encode(JSON.stringify(group)).length > PRODUCT_CONFLICT_ACTION_MAX_GROUP_SOURCE_BYTES) throw new MergeCostPreviewUnavailableError()
    result.products.push(...group.products); result.batches.push(...batches); result.batchStock.push(...stock); result.currentCostEntries.push(...entries)
  }
  if (result.batches.length > PRODUCT_CONFLICT_ACTION_MAX_LOT_ROWS_PER_REVIEW || new TextEncoder().encode(JSON.stringify(result)).length > PRODUCT_CONFLICT_ACTION_MAX_REVIEW_DETAIL_BYTES) throw new MergeCostPreviewUnavailableError()
  return result
}
const PREVIEW_SQL = `WITH products AS (
  SELECT json_extract(value,'$.id') id,json_extract(value,'$.cost_price_usd') cost_price_usd,json_extract(value,'$.cost_price_khr') cost_price_khr FROM json_each(@graph,'$.products')
), product_batches AS (
  SELECT json_extract(value,'$.id') id,json_extract(value,'$.variant_product_id') variant_product_id,json_extract(value,'$.is_active') is_active,
    json_extract(value,'$.unit_cost_usd') unit_cost_usd,json_extract(value,'$.received_at') received_at FROM json_each(@graph,'$.batches')
), branch_batch_stock AS (
  SELECT json_extract(value,'$.batch_id') batch_id,json_extract(value,'$.quantity') quantity FROM json_each(@graph,'$.batchStock')
), product_cost_entries AS (
  SELECT json_extract(value,'$.id') id,json_extract(value,'$.product_id') product_id,json_extract(value,'$.cost_usd') cost_usd,
    json_extract(value,'$.baseline_batch_id') baseline_batch_id FROM json_each(@graph,'$.currentCostEntries')
)
SELECT products.id keeperId,${mergeCostAuthorityUsdSql('products.cost_price_usd')} cost_price_usd,products.cost_price_khr,
  CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN 0 ELSE 1 END needsReview,
  CASE WHEN ${CATALOG_COST_HAS_RECORDED_LOT_SQL} THEN 'received_lot' WHEN ${MERGE_COST_LATEST_MANUAL_SQL} IS NOT NULL THEN 'manual' ELSE 'keeper_fallback' END source
FROM products ORDER BY products.id`

export async function previewMergeCosts(db: D1Compat, graph: MergeCostPreviewGraph, plans: MergeCostPreviewPlan[]): Promise<MergeCostAuthority[]> {
  const projected = projectMergeCostGraph(graph, plans)
  const rows = await db.prepare(PREVIEW_SQL).all<Omit<MergeCostAuthority, 'version' | 'needsReview'> & { needsReview: number }>({ graph: JSON.stringify(projected) })
  return rows.map(row => ({ ...row, version: 1, needsReview: Boolean(row.needsReview) }))
}
