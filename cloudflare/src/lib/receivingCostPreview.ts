import type { D1Compat } from './db'
import { normalizeTypedDate } from './batchCode'
import { CATALOG_COST_DERIVE_SQL } from './catalogCostRecompute'
import { multiplyMoney4, nullableMoney4, roundMoney4 } from './moneyPrecision'
import { effectiveUnitCost } from './stockSessionMath'
import { parseFreeQuantity, stockReceiptGateCode } from './stockReceiptGate'
import { parseStockConditionTag } from './stockCondition'

type Row = Record<string, unknown>
type PreviewLine = {
  key: string
  productId: number | null
  branchId: number | null
  batchId: number | null
  quantity: number
  availableDelta: number
  unitCostUsd: number | null
  receivedAt: string
  supplierName: string | null
  supplierId: number | null
  reason: string | null
}

export type ReceivingCostPreviewResult = {
  key: string
  productId: number | null
  status: 'ready' | 'unavailable'
  beforeUsd: number | null
  afterUsd: number | null
  reason: string | null
}

export class ReceivingCostPreviewInputError extends Error {}

const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const positiveId = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string')
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null

export function parseReceivingCostPreview(raw: unknown, today = new Date().toISOString().slice(0, 10)): PreviewLine[] {
  if (!object(raw) || !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 25) {
    throw new ReceivingCostPreviewInputError('Provide between 1 and 25 receiving lines.')
  }
  const keys = new Set<string>()
  const lines = raw.lines.map((input): PreviewLine => {
    if (!object(input) || typeof input.key !== 'string' || !input.key.trim() || input.key.length > 160 || keys.has(input.key) || !object(input.body)) {
      throw new ReceivingCostPreviewInputError('Every receiving line needs a unique key and a body.')
    }
    keys.add(input.key)
    const body = input.body
    const session = input.wire === 'stock_session'
    const value = (camel: string, snake: string) => body[session ? snake : camel]
    const productId = positiveId(value('productId', 'product_id'))
    const branchId = positiveId(value('branchId', 'branch_id'))
    const batch = value('batchId', 'batch_id')
    const batchId = batch === 'new' || batch == null ? null : positiveId(batch)
    const supplier = value('supplierName', 'supplier_name')
    const line: PreviewLine = { key: input.key, productId, branchId, batchId, quantity: 0, availableDelta: 0,
      unitCostUsd: null, receivedAt: today, supplierName: typeof supplier === 'string' ? supplier.trim() : null,
      supplierId: positiveId(value('supplierId', 'supplier_id')), reason: null }
    if (typeof input.wire !== 'string' || !['receive', 'adjust', 'stock_session'].includes(input.wire)
      || (input.wire === 'adjust' && (body.type !== 'add' || body.attribution === 'correction' || body.unlockPricing === true || body.pricing != null))
      || (session && (body.kind !== 'receive' || body.freeQuantity != null || body.free_quantity != null))) line.reason = 'unsupported_operation'
    else if (!productId) line.reason = 'product_unavailable'
    else if (!branchId) line.reason = 'branch_unavailable'
    else if (batch != null && batch !== 'new' && batchId == null) line.reason = 'invalid_target'
    else if (value('supplierId', 'supplier_id') != null && line.supplierId == null) line.reason = 'supplier_unavailable'
    else if (supplier != null && typeof supplier !== 'string') line.reason = 'supplier_required'
    const rawDate = value('receivedDate', 'received_date')
    if (rawDate != null && typeof rawDate !== 'string') line.reason ||= 'invalid_date'
    else if (typeof rawDate === 'string' && rawDate.trim()) {
      const date = normalizeTypedDate(rawDate)
      if (!date) line.reason ||= 'invalid_date'
      else line.receivedAt = date
    } else if (session) line.reason ||= 'invalid_date'
    try {
      const paid = Number(body.quantity)
      const free = session ? 0 : body.freeQuantity == null ? 0 : parseFreeQuantity(body.freeQuantity)
      if (!Number.isFinite(paid) || free == null || paid < 0 || paid + free <= 0
        || (session && (typeof body.quantity !== 'number' || paid > 1_000_000_000))) {
        line.reason ||= 'invalid_quantity'
        return line
      }
      const rawCost = value('unitCostUsd', 'unit_cost_usd')
      if (rawCost != null && Number(rawCost) < 0) line.reason ||= 'cost_negative'
      if (session && rawCost != null && (typeof rawCost !== 'number' || rawCost > 1_000_000_000)) line.reason ||= 'invalid_cost'
      let cost = input.wire === 'adjust' && rawCost != null
        ? roundMoney4(typeof rawCost === 'string' ? rawCost : Number(rawCost))
        : nullableMoney4(rawCost as number | string | null)
      if (cost != null && (!Number.isFinite(cost) || cost < 0)) line.reason ||= 'cost_negative'
      const freeGoods = value('freeGoods', 'free_goods') === true || (!session && paid === 0 && free > 0)
      line.reason ||= stockReceiptGateCode({ isStockIn: true, supplierName: line.supplierName,
        lotAttributionDeferred: batchId != null,
        unitCostUsd: cost, freeGoods, quantity: paid, freeQuantity: free }) || null
      if (cost != null) multiplyMoney4(cost, paid)
      if (free > 0) cost = paid === 0 ? 0 : effectiveUnitCost(paid, free, cost ?? 0)
      const tag = parseStockConditionTag(body.conditionTag ?? body.condition_tag)
      if (!tag.ok) line.reason ||= 'unsupported_operation'
      else if (tag.tag && input.wire !== 'adjust') line.reason ||= 'unsupported_operation'
      line.quantity = paid + free
      line.availableDelta = tag.ok && tag.tag ? 0 : line.quantity
      line.unitCostUsd = cost
    } catch { line.reason ||= 'invalid_cost' }
    return line
  })
  const counts = new Map<number, number>()
  for (const line of lines) if (line.productId != null) counts.set(line.productId, (counts.get(line.productId) || 0) + 1)
  for (const line of lines) if (line.productId != null && (counts.get(line.productId) || 0) > 1) line.reason = 'duplicate_product'
  return lines
}

// Shadow only the receipt's prospective relations; the valuation expression stays shared with every writer.
export const RECEIVING_COST_PREVIEW_SQL = `WITH
  requested AS (
    SELECT CAST(key AS INTEGER) AS ordinal,
      json_extract(value,'$.key') AS line_key, json_extract(value,'$.productId') AS product_id,
      json_extract(value,'$.branchId') AS branch_id, json_extract(value,'$.batchId') AS batch_id,
      json_extract(value,'$.unitCostUsd') AS unit_cost_usd, json_extract(value,'$.receivedAt') AS received_at,
      json_extract(value,'$.availableDelta') AS available_delta,
      json_extract(value,'$.supplierName') AS supplier_name, json_extract(value,'$.supplierId') AS supplier_id,
      json_extract(value,'$.reason') AS input_reason
    FROM json_each(@lines)
  ),
  product_cost_entries AS (
    SELECT pce.* FROM main.product_cost_entries pce WHERE pce.product_id IN (SELECT product_id FROM requested)
  ),
  baselines AS (
    SELECT r.*, COALESCE((SELECT baseline_batch_id FROM product_cost_entries WHERE product_id=r.product_id ORDER BY id DESC LIMIT 1),0) AS baseline_id,
      (SELECT COALESCE(MAX(id),0) FROM main.product_batches)+ordinal+1 AS virtual_id
    FROM requested r
  ),
  selected AS (
    SELECT r.*, (SELECT pb.id FROM main.product_batches pb
      WHERE pb.variant_product_id=r.product_id AND pb.id>r.baseline_id AND pb.unit_cost_usd IS r.unit_cost_usd
        AND ((r.batch_id IS NOT NULL AND pb.id=r.batch_id)
          OR (r.batch_id IS NULL AND substr(COALESCE(pb.received_at,''),1,10)=r.received_at))
      ORDER BY pb.id LIMIT 1) AS existing_id
    FROM baselines r
  ),
  targets AS (
    SELECT r.*, COALESCE(existing_id,virtual_id) AS target_id,
      CASE WHEN input_reason IS NOT NULL THEN input_reason
        WHEN NOT EXISTS(SELECT 1 FROM main.products p WHERE p.id=r.product_id AND p.is_active=1) THEN 'product_unavailable'
        WHEN NOT EXISTS(SELECT 1 FROM main.branches b WHERE b.id=r.branch_id AND b.is_active=1) THEN 'branch_unavailable'
        WHEN batch_id IS NOT NULL AND existing_id IS NULL THEN 'invalid_target'
        WHEN supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM main.suppliers s WHERE s.id=r.supplier_id) THEN 'supplier_unavailable'
        WHEN COALESCE(supplier_name,'')='' AND supplier_id IS NULL AND NOT EXISTS(
          SELECT 1 FROM main.product_batches pb WHERE pb.id=r.batch_id AND trim(COALESCE(pb.supplier_name,''))<>'') THEN 'supplier_required'
      END AS reason
    FROM selected r
  ),
  product_batches AS (
    SELECT pb.id,pb.variant_product_id,pb.unit_cost_usd,pb.received_at,
      CASE WHEN pb.id=t.target_id THEN 1 ELSE pb.is_active END AS is_active
    FROM main.product_batches pb JOIN targets t ON t.product_id=pb.variant_product_id AND t.reason IS NULL
    UNION ALL
    SELECT target_id,product_id,unit_cost_usd,received_at,1 FROM targets WHERE existing_id IS NULL AND reason IS NULL
  ),
  branch_batch_stock AS (
    SELECT bs.batch_id,bs.branch_id,bs.quantity+
      CASE WHEN bs.batch_id=t.target_id AND bs.branch_id=t.branch_id THEN t.available_delta ELSE 0 END AS quantity
    FROM main.branch_batch_stock bs JOIN main.product_batches pb ON pb.id=bs.batch_id
      JOIN targets t ON t.product_id=pb.variant_product_id AND t.reason IS NULL
    UNION ALL
    SELECT t.target_id,t.branch_id,t.available_delta FROM targets t WHERE t.reason IS NULL
      AND NOT EXISTS(SELECT 1 FROM main.branch_batch_stock bs WHERE bs.batch_id=t.target_id AND bs.branch_id=t.branch_id)
  ),
  products AS (SELECT p.id,p.cost_price_usd FROM main.products p WHERE p.id IN (SELECT product_id FROM requested))
SELECT t.line_key AS key,t.product_id AS productId,
  CASE WHEN t.reason IS NULL THEN 'ready' ELSE 'unavailable' END AS status,
  CASE WHEN t.reason IN ('product_unavailable','branch_unavailable') THEN NULL ELSE products.cost_price_usd END AS beforeUsd,
  CASE WHEN t.reason IS NULL THEN COALESCE(${CATALOG_COST_DERIVE_SQL},products.cost_price_usd) END AS afterUsd,
  t.reason
FROM targets t LEFT JOIN products ON products.id=t.product_id ORDER BY t.ordinal`

export async function previewReceivingCosts(db: D1Compat, lines: ReturnType<typeof parseReceivingCostPreview>): Promise<ReceivingCostPreviewResult[]> {
  return db.prepare(RECEIVING_COST_PREVIEW_SQL).all<ReceivingCostPreviewResult>({ lines: JSON.stringify(lines) })
}
