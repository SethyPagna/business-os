// Production-scale fixture for the lane-B stock and cost audit queries. Not a test: audit-b-bench.cjs and
// test-audit-b-scale-workerd.cjs load it. It starts from the branch-cutover fixture (sizes of the 6 Oct 2026 inventory:
// 8,352 products, ~26k lots, 18k sales, 45k sale items and allocations) and replaces its incoherent movement log with a
// coherent one: one 'sale' deduction per sale item and one receipt per stocked (product, branch, lot) that also carries what was sold from it,
// ~70k movements at scale 1 (production: ~60k), stamped with batch ids, references and costs. It adds cost entries, transfer legs for every
// stock_transfers row, and plants ~0.5% defects (a missing sale movement, a drifting rollup) so the queries have
// something to report and the examples / json paths execute. Deterministic.
'use strict'
const base = require('./branch-cutover-scale-fixture.cjs')
const { SHOP, WAREHOUSE } = base

function rows({ scale = 1 } = {}) {
  const t = base.rows({ scale })
  const stamp = (i) => `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')} ${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`
  const movements = []
  let id = 0
  const push = (m) => movements.push({ id: ++id, product_name: 'Product ' + m.product_id, branch_name: m.branch_id === WAREHOUSE ? 'Warehouse' : 'Shop', user_id: 7, user_name: 'operator', ...m })
  const lotOf = new Map(t.product_batches.map((b) => [b.id, b]))
  // what the sale items took out of each (product, branch, lot): the receipts below carry it, so replaying the log still lands on branch_stock
  const sold = new Map()
  const soldKey = (p, br, lot) => p + '|' + br + '|' + (lot ?? '')
  for (const item of t.sale_items) {
    const k = soldKey(item.product_id, item.branch_id, item.product_id <= 3408 ? item.product_id : null)
    sold.set(k, (sold.get(k) || 0) + 1)
  }
  const tracked = new Map()
  // one receipt per positive lot row (the batch id and the lot's cost; plus what was later sold from it), then the untracked remainder of each stock row
  for (const r of t.branch_batch_stock) if (r.quantity > 0) {
    const b = lotOf.get(r.batch_id)
    const k = soldKey(b.variant_product_id, r.branch_id, b.id)
    const quantity = r.quantity + (sold.get(k) || 0)
    sold.delete(k)
    push({ product_id: b.variant_product_id, branch_id: r.branch_id, movement_type: 'add', quantity, unit_cost_usd: b.unit_cost_usd, total_cost_usd: b.unit_cost_usd == null ? null : b.unit_cost_usd * quantity,
      reason: 'Stock in', batch_id: b.id, created_at: stamp(id) })
    const pk = b.variant_product_id + ':' + r.branch_id
    tracked.set(pk, (tracked.get(pk) || 0) + r.quantity)
  }
  for (const r of t.branch_stock) {
    const rest = r.quantity - (tracked.get(r.product_id + ':' + r.branch_id) || 0)
    const k = soldKey(r.product_id, r.branch_id, null)
    const quantity = rest + (sold.get(k) || 0)
    sold.delete(k)
    if (quantity > 0) push({ product_id: r.product_id, branch_id: r.branch_id, movement_type: 'add', quantity, reason: 'Opening stock', created_at: '2026-01-01 00:00:00' })
  }
  // sold from a lot or branch that holds nothing now: its own receipt (net zero)
  for (const [k, quantity] of sold) {
    const [product, branch, lot] = k.split('|')
    push({ product_id: Number(product), branch_id: Number(branch), movement_type: 'add', quantity, unit_cost_usd: 2, total_cost_usd: 2 * quantity, reason: 'Stock in', batch_id: lot === '' ? null : Number(lot), created_at: '2026-01-01 00:00:00' })
  }
  // every sale item: the deduction at the sale's branch; 0.5% of the deductions are lost (a planted defect)
  for (const item of t.sale_items) {
    if (item.id % 200 === 0) continue
    push({ product_id: item.product_id, branch_id: item.branch_id, movement_type: 'sale', quantity: 1, reason: 'Sale R' + item.sale_id, reference_id: String(item.sale_id),
      batch_id: item.product_id <= 3408 ? item.product_id : null, created_at: stamp(item.id) })
  }
  // transfers: two legs per row at one instant, no reference (legs are matched by product, branch and time)
  for (const tr of t.stock_transfers) {
    const when = stamp(tr.id * 7)
    push({ product_id: tr.product_id, branch_id: tr.from_branch_id, movement_type: 'transfer_out', quantity: tr.quantity, reason: 'Transfer', created_at: when })
    push({ product_id: tr.product_id, branch_id: tr.to_branch_id, movement_type: 'transfer_in', quantity: tr.quantity, reason: 'Transfer', created_at: when })
  }
  t.inventory_movements = movements
  // a manual cost entry on every 8th product (baseline = its newest lot id)
  const newest = new Map()
  for (const b of t.product_batches) newest.set(b.variant_product_id, Math.max(newest.get(b.variant_product_id) || 0, b.id))
  t.product_cost_entries = []
  for (const p of t.products) if (p.id % 8 === 0) t.product_cost_entries.push({ product_id: p.id, cost_usd: 1 + (p.id % 7), source: 'manual', user_id: 7, user_name: 'operator', baseline_batch_id: newest.get(p.id) || 0 })
  // 0.5% of the rollups drift (planted)
  for (const p of t.products) if (p.id % 200 === 0) p.stock_quantity = (p.stock_quantity || 0) + 1
  return t
}

module.exports = { rows, statements: base.statements, SHOP, WAREHOUSE }
