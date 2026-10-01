import type { D1Compat } from './db'
import { selectInChunks } from './sqlBinding'
import { allocateAcrossLots, type FifoLotAvailability } from './productBatches'

type SupplierLot = FifoLotAvailability & { unitCostUsd: number | null }
type SupplierLine = { product_id: number; branch_id?: number; batch_id?: number; quantity: number; cost_price_usd?: number; cost_price_khr?: number; unit_cost_usd?: number; unit_cost_khr?: number }

export function canonicalSupplierReturnIntent(body: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => {
    if (value == null) return null
    if (typeof value !== 'string') throw new Error('Supplier return text fields must be strings')
    return value.trim() || null
  }
  const reason = text(body.reason)
  if (!reason) throw new Error('Reason is required')
  return {
    scope: 'supplier_return_v1', sale_id: null, supplier_id: body.supplier_id,
    supplier_name: text(body.supplier_name), branch_id: body.branch_id ?? null,
    reason, notes: text(body.notes), settlement: String(body.settlement || 'refund').toLowerCase(),
    supplier_compensation_usd: body.supplier_compensation_usd ?? null,
    supplier_compensation_khr: body.supplier_compensation_khr ?? null,
    exchange_rate: body.exchange_rate ?? null, return_number: text(body.return_number),
    items: (body.items as Array<SupplierLine & { product_name?: string }>).map(item => ({
      product_id: item.product_id, product_name: text(item.product_name), quantity: item.quantity,
      branch_id: item.branch_id ?? body.branch_id, batch_id: item.batch_id ?? null,
      cost_price_usd: item.cost_price_usd ?? item.unit_cost_usd ?? null,
      cost_price_khr: item.cost_price_khr ?? item.unit_cost_khr ?? null,
    })),
  }
}

export function validateSupplierReturnMoney(body: Record<string, unknown>, items: SupplierLine[]): void {
  const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  for (const field of ['supplier_compensation_usd', 'supplier_compensation_khr']) {
    if (Object.prototype.hasOwnProperty.call(body, field) && !amount(body[field])) throw new Error('Compensation must be finite and nonnegative')
  }
  if (body.supplier_compensation_usd !== undefined && Math.abs(Number(body.supplier_compensation_usd) * 100 - Math.round(Number(body.supplier_compensation_usd) * 100)) > 1e-8) throw new Error('USD compensation must use whole cents')
  if (body.supplier_compensation_khr !== undefined && !Number.isSafeInteger(body.supplier_compensation_khr)) throw new Error('KHR compensation must use whole riel')
  if (body.exchange_rate !== undefined && (!amount(body.exchange_rate) || Number(body.exchange_rate) <= 0)) throw new Error('Exchange rate must be positive')
  if (body.settlement !== undefined && !['refund', 'credit', 'replacement', 'writeoff'].includes(String(body.settlement).toLowerCase())) throw new Error('A valid supplier settlement is required')
  for (const field of ['payment_status', 'payment_method', 'supplier_loss_usd', 'supplier_loss_khr', 'stock_action', 'disposition', 'treatment', 'coverage', 'supplier_coverage']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) throw new Error('Unsupported supplier return payment or treatment field')
  }
  for (const item of items) {
    for (const field of ['payment_status', 'payment_method', 'stock_action', 'disposition', 'treatment', 'coverage', 'supplier_coverage', 'return_to_stock', 'supplier_id']) {
      if (Object.prototype.hasOwnProperty.call(item, field)) throw new Error('Unsupported supplier return item payment or treatment field')
    }
    if (!amount(item.quantity) || item.quantity <= 0) throw new Error('Return quantity must be finite and positive')
    for (const currency of ['usd', 'khr'] as const) {
      const cost = item[`cost_price_${currency}`], unit = item[`unit_cost_${currency}`]
      if ((cost !== undefined && !amount(cost)) || (unit !== undefined && !amount(unit))) throw new Error('Unit costs must be finite and nonnegative')
      if (cost !== undefined && unit !== undefined && cost !== unit) throw new Error('Conflicting unit cost fields')
    }
  }
}

export function supplierReturnCosts(items: SupplierLine[], branchId: number | undefined, availability: Map<string, SupplierLot[]>): Array<{ usd: number; khr: number }> {
  const lots = new Map([...availability].map(([key, values]) => [key, values.map(value => ({ ...value }))]))
  return items.map(item => {
    if (item.batch_id === undefined) return { usd: item.cost_price_usd ?? item.unit_cost_usd ?? 0, khr: item.cost_price_khr ?? item.unit_cost_khr ?? 0 }
    const available = lots.get(`${item.product_id}:${item.branch_id ?? branchId}`) || []
    const selected = available.filter(lot => lot.batchId === item.batch_id)
    const { takes, uncovered } = allocateAcrossLots(selected, item.quantity)
    if (uncovered > 0) throw new Error('The selected supplier received lot does not have enough stock at this branch')
    let usd = 0
    for (const take of takes) {
      const lot = available.find(value => value.batchId === take.batchId)!
      if (lot.unitCostUsd === null) throw new Error('The selected supplier lot has no recorded cost basis; review the return')
      usd += lot.unitCostUsd * take.quantity
      lot.available -= take.quantity
    }
    const unitUsd = usd / item.quantity, unitKhr = item.cost_price_khr ?? item.unit_cost_khr ?? 0
    const provided = item.cost_price_usd ?? item.unit_cost_usd
    if (provided !== undefined && Math.abs(provided - unitUsd) > 0.00005 + 1e-9) throw new Error('The selected supplier lot cost changed; review the return')
    return { usd: unitUsd, khr: unitKhr }
  })
}

export async function supplierReturnLots(db: D1Compat, supplierId: number, pairs: Array<{ productId: number; branchId: number }>): Promise<Map<string, SupplierLot[]>> {
  const map = new Map<string, SupplierLot[]>()
  const products = [...new Set(pairs.map(pair => pair.productId))]
  const branches = [...new Set(pairs.map(pair => pair.branchId))]
  const rows = await selectInChunks(products, branches.length + 1, chunk => db.prepare(`
    SELECT pb.variant_product_id AS product_id,bbs.branch_id,pb.id AS batch_id,pb.lot_code,pb.received_at,pb.expiry_date,bbs.quantity AS available,
      CASE WHEN pb.received_quantity>0 AND pb.received_cost_usd IS NOT NULL THEN 1.0*pb.received_cost_usd/pb.received_quantity ELSE pb.unit_cost_usd END AS unit_usd
    FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
    WHERE pb.supplier_id=? AND pb.variant_product_id IN (${chunk.map(() => '?').join(',')})
      AND bbs.branch_id IN (${branches.map(() => '?').join(',')}) AND pb.is_active=1 AND bbs.quantity>0
    ORDER BY (pb.received_at IS NULL),pb.received_at,pb.batch_number,pb.id
  `).all<{ product_id: number; branch_id: number; batch_id: number; lot_code: string | null; received_at: string | null; expiry_date: string | null; available: number; unit_usd: number | null }>([supplierId, ...chunk, ...branches]))
  for (const row of rows) {
    const key = `${row.product_id}:${row.branch_id}`
    const lots = map.get(key) || []
    if (row.unit_usd !== null && (!Number.isFinite(row.unit_usd) || row.unit_usd < 0)) throw new Error('The supplier lot has invalid recorded cost')
    lots.push({ batchId: row.batch_id, lotCode: row.lot_code, receivedAt: row.received_at, expiryDate: row.expiry_date, available: row.available, unitCostUsd: row.unit_usd })
    map.set(key, lots)
  }
  return map
}
