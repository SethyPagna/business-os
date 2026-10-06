// Production-scale fixture for the branch cutover (lane LB). Not a test: the scale tests and the bench load it.
// Sizes follow the read-only production inventory of 6 Oct 2026 and the cutover readiness sizing (G12 G-K):
//   products 8,352; branch_stock 8,352 rows per branch; positive lots Warehouse 1,399 / Shop 3,524; 758 shared
//   positive batch rows; ~16.4k product/branch pairs with lot rows; ~26k product_batches; sales 18k, sale_items
//   45k, allocations 45k, inventory_movements 60k, audit_logs 60k, action_history 15k (open applier rows of every
//   family), undo_snapshots 1k (some 200 KB merge snapshots). Deterministic; every quantity is an integer.
// rows(scale) returns { table: [row objects] } in insert order; statements(rows) returns multi-row INSERT SQL.
'use strict'

const SHOP = 2, WAREHOUSE = 1, LEGACY = 3

function rows({ scale = 1 } = {}) {
  const n = (count) => Math.max(1, Math.round(count * scale))
  const P = n(8352), shopTo = n(3408), whFrom = n(2000), sharedTo = whFrom + n(758) - 1, whTo = sharedTo + n(641)
  const t = {
    branches: [
      { id: WAREHOUSE, name: 'Warehouse', notes: 'back store', is_active: 1, is_default: 0, canonical_key: 'warehouse', role: 'warehouse', created_at: '2025-11-02 09:15:00' },
      { id: SHOP, name: 'Shop', notes: 'front of house', is_active: 1, is_default: 1, canonical_key: 'shop', role: 'shop', created_at: '2025-11-02 09:15:00' },
      { id: LEGACY, name: 'Shop', notes: 'legacy row retired in 2025', is_active: 0, is_default: 0, canonical_key: null, role: null, created_at: '2025-01-01 00:00:00' },
    ],
    users: [{ id: 7, username: 'operator', password: 'fixture', name: 'Operator', organization_id: 1, permissions: '{"branches":true,"backup_restore":true}', is_active: 1 }],
    system_flags: [{ key: 'branch_cutover_control_incarnation', value: '00000000-0000-4000-8000-000000000099' }],
    products: [], product_batches: [], branch_batch_stock: [], branch_stock: [],
    sales: [], sale_items: [], sale_item_batch_allocations: [], inventory_movements: [], returns: [], return_items: [],
    fees: [], shift_sessions: [], stock_transfers: [], stock_row_moves: [], supplier_invoices: [],
    undo_snapshots: [], action_history: [], stock_lot_adjustment_operations: [], stock_session_operations: [], stock_session_members: [],
    sale_bulk_operations: [], sale_bulk_members: [], audit_logs: [],
  }
  const day = (p, shift = 0) => `2026-0${1 + ((p + shift) % 9)}-${String(1 + ((p * 7 + shift) % 27)).padStart(2, '0')}`
  const lotQty = new Map() // `${batch}:${branch}` -> qty
  const stockQty = new Map() // `${product}:${branch}` -> qty
  const add = (map, key, q) => map.set(key, (map.get(key) || 0) + q)
  const lot = (id, product, received, { cost = 1 + (id % 40) / 4, expiry = null, supplier = null, branch = SHOP, at = {} } = {}) => {
    t.product_batches.push({ id, variant_product_id: product, batch_key: 'lot-' + id, lot_code: 'L' + id, received_at: received, expiry_date: expiry,
      unit_cost_usd: cost, received_branch_id: branch, received_quantity: Object.values(at).reduce((a, b) => a + b, 0) || 1, supplier_id: supplier,
      is_active: 1, batch_number: id, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' })
    for (const [b, q] of Object.entries(at)) { add(lotQty, id + ':' + b, q); add(stockQty, product + ':' + b, q) }
  }
  for (let p = 1; p <= P; p++) t.products.push({ id: p, name: 'Product ' + p, sku: 'SKU' + p, is_active: 1, cost_price_usd: 1, created_at: '2026-01-01', updated_at: '2026-01-01' })
  // Shop lots (one per selling product; 116 with a second, same-date lot), some shared with the Warehouse
  for (let p = 1; p <= shopTo; p++) {
    // slash dates as the Aug-28 import stored them (month-first, padded or not) merge with the ISO lot of that day; 24/08 is no date
    const slash = (iso, pad) => { const [y, m, d] = iso.split('-'); return pad ? m + '/' + d + '/' + y : Number(m) + '/' + Number(d) + '/' + y }
    const received = p % 95 === 0 ? '24/08/2026' : p % 5 === 0 ? slash(day(p), p % 10 === 0) : p % 19 === 0 ? day(p) + 'T18:30:00Z' : day(p)
    const cost = p % 13 === 0 ? null : p % 17 === 0 ? 0 : 1 + (p % 40) / 4
    const at = { [SHOP]: 1 + (p % 7) }
    if (p >= whFrom && p <= sharedTo) at[WAREHOUSE] = 1 + (p % 15)
    lot(p, p, received, { cost, supplier: p % 11 === 0 ? 1 + (p % 4) : null, at })
    if (p <= n(116)) lot(100000 + p, p, day(p), { cost: 2 + (p % 3), at: { [SHOP]: 1 } })
  }
  // Warehouse-only lots: a third on the Shop lot's date (merge), some with another expiry or supplier
  for (let p = sharedTo + 1; p <= whTo; p++) {
    lot(200000 + p, p, p % 3 === 0 ? day(p) : day(p, 1), { cost: p % 7 === 0 ? null : 2 + (p % 9) / 2, expiry: p % 9 === 0 ? '2027-0' + (1 + p % 9) + '-01' : null,
      supplier: p % 11 === 0 ? 9 : null, branch: WAREHOUSE, at: { [WAREHOUSE]: 1 + (p % 15) } })
  }
  // history: zero-quantity lots on most products (the ~16.4k product/branch pairs with lot rows)
  let zero = 300000
  for (let p = 1; p <= P; p++) {
    for (let k = 0; k < 1 + (p % 4 === 0 ? 2 : 1) + (p % 3 === 0 ? 1 : 0); k++) {
      const id = ++zero, branch = (p + k) % 2 === 0 ? SHOP : WAREHOUSE
      lot(id, p, day(p, k + 2), { branch, at: {} }); lotQty.set(id + ':' + branch, 0)
    }
  }
  for (const [key, quantity] of lotQty) { const [batch_id, branch_id] = key.split(':').map(Number); t.branch_batch_stock.push({ batch_id, branch_id, quantity, created_at: '2026-01-01', updated_at: '2026-01-01' }) }
  for (let p = 1; p <= P; p++) for (const b of [WAREHOUSE, SHOP]) {
    const untracked = (b === SHOP && p <= shopTo && p % 23 === 0) || (b === WAREHOUSE && p >= whFrom && p <= whTo && p % 29 === 0) ? 1 : 0
    t.branch_stock.push({ product_id: p, branch_id: b, quantity: (stockQty.get(p + ':' + b) || 0) + untracked })
  }
  for (const product of t.products) product.stock_quantity = (stockQty.get(product.id + ':1') || 0) + (stockQty.get(product.id + ':2') || 0)
  // sales, items, allocations, movements (event history at both branches and the retired legacy row)
  const S = n(18000)
  for (let s = 1; s <= S; s++) {
    const branch = s % 7 === 0 ? WAREHOUSE : s % 97 === 0 ? LEGACY : SHOP
    t.sales.push({ id: s, receipt_number: 'R' + s, branch_id: branch, branch_name: s % 3 === 0 ? null : branch === WAREHOUSE ? 'Warehouse' : 'Shop',
      total_usd: 5, created_at: day(s) + ' 10:00:00' })
  }
  const I = n(45000)
  for (let i = 1; i <= I; i++) {
    const sale = 1 + (i % S), product = 1 + (i * 31) % shopTo, branch = t.sales[sale - 1].branch_id
    t.sale_items.push({ id: i, sale_id: sale, product_id: product, branch_id: branch, quantity: 1, applied_price_usd: 5 })
    t.sale_item_batch_allocations.push({ sale_item_id: i, batch_id: product, branch_id: branch, quantity: 1 })
  }
  for (let m = 1; m <= n(60000); m++) {
    const product = 1 + (m * 13) % P
    t.inventory_movements.push({ id: m, product_id: product, branch_id: m % 5 === 0 ? WAREHOUSE : SHOP, branch_name: m % 4 === 0 ? null : 'Shop',
      movement_type: m % 3 === 0 ? 'stock_in' : 'sale', quantity: m % 3 === 0 ? 1 : -1, batch_id: product <= shopTo ? product : null, created_at: day(m) + ' 11:00:00' })
  }
  for (let r = 1; r <= n(500); r++) {
    t.returns.push({ id: r, sale_id: r * 3, branch_id: SHOP, branch_name: r % 2 ? 'Shop' : null })
    t.return_items.push({ id: r, return_id: r, product_id: 1 + r, quantity: 1, branch_id: SHOP, batch_id: 1 + r })
  }
  for (let f = 1; f <= n(3000); f++) t.fees.push({ id: 900000 + f, fee_type: 'delivery', amount_usd: 1, fee_date: day(f), sale_id: f, branch_id: f % 2 ? SHOP : WAREHOUSE })
  for (let s = 1; s <= n(1500); s++) {
    const date = new Date(Date.UTC(2022, 0, 1) + s * 86400000).toISOString().slice(0, 10)
    t.shift_sessions.push({ id: 900000 + s, shift_code: 'SH' + s, user_id: 7, branch_id: SHOP, business_date: date, opened_at: date + ' 08:00:00', closed_at: date + ' 20:00:00' })
  }
  for (let s = 1; s <= n(154); s++) t.stock_transfers.push({ id: s, product_id: s, from_branch_id: s % 2 ? WAREHOUSE : SHOP, to_branch_id: s % 2 ? SHOP : WAREHOUSE, quantity: 1 })
  for (let s = 1; s <= n(200); s++) t.stock_row_moves.push({ id: s, source_product_id: s, destination_product_id: s + 1, branch_id: SHOP, quantity: 1 })
  for (let s = 1; s <= n(500); s++) t.supplier_invoices.push({ id: s, source_branch: 'shop', branch_id: SHOP, legacy_id: 'L' + s, supplier_name: 'S' + (s % 9), invoice_date: day(s), status: 'open', source_file: 'f.xls', source_row: s })
  // undo snapshots: small sale/product snapshots and a few large merge snapshots (stock arrays under branch keys)
  for (let u = 1; u <= n(1000); u++) {
    const big = u % 25 === 0
    const stock = Array.from({ length: big ? 2500 : 20 }, (_, k) => ({ product_id: 1 + ((u + k) % P), branch_id: k % 2 ? SHOP : WAREHOUSE, quantity: 1 + (k % 5), note: 'x'.repeat(big ? 40 : 4) }))
    t.undo_snapshots.push({ id: u, kind: u % 3 === 0 ? 'sale.add_items' : 'product.merge', status: 'applied',
      payload_json: JSON.stringify(u % 3 === 0 ? { saleId: 1 + u, lines: [{ branchId: SHOP, productId: 1 + u }] } : { losers: [{ id: u, stock }] }) })
  }
  // action history: mostly client/closed rows, ~2k open applier rows across the families the cutover classifies
  const H = n(15000), appliers = ['sale.settlement', 'customer.gender_restore', 'stock.quantity_set', 'sale.add_items', 'product.merge', 'stock.session', 'sale.status.bulk', 'branch.update', 'stock.transfer']
  for (let h = 1; h <= H; h++) {
    const open = h % 7 === 0, applier = appliers[h % appliers.length]
    let undo = '{}', redo = '{}', status = open ? (h % 2 ? 'undoable' : 'redoable') : 'recorded'
    if (open || h % 5 === 0) {
      const payload = { applier }
      if (applier === 'sale.add_items' || applier === 'product.merge') payload.snapshot_id = 1 + (h % n(1000))
      if (applier === 'branch.update') payload.id = h % 2 ? SHOP : WAREHOUSE
      if (applier === 'stock.transfer') Object.assign(payload, { operation_id: 'op-' + h, generation: 0, permission: 'branches' })
      undo = redo = JSON.stringify(payload)
    }
    t.action_history.push({ id: h, scope: 'fixture', entity: 'fixture', entity_id: String(h), label: 'action ' + h, reversible: open ? 1 : 0, status,
      undo_payload: undo, redo_payload: redo, created_by_id: 7, created_by_name: 'operator', created_at: '2026-09-01 10:00:00', updated_at: '2026-09-01 10:00:00' })
    if (open && applier === 'stock.quantity_set') t.stock_lot_adjustment_operations.push({ id: 'adj-' + h, actor_id: 7, request_id: 'adj-' + h,
      request_json: JSON.stringify({ branchId: h % 2 ? SHOP : WAREHOUSE, productId: 1 + h % P }), request_digest: 'd', response_json: '{}', before_json: '{}', after_json: '{}', revision_json: '{}', history_id: h })
    if (open && applier === 'stock.session') {
      t.stock_session_operations.push({ id: 'ss-' + h, actor_id: 7, request_id: 'ss-' + h, mode: 'stock_in', request_json: '{}', history_id: h })
      for (let k = 0; k < 6; k++) t.stock_session_members.push({ operation_id: 'ss-' + h, line_id: 'l' + k, command_kind: 'receive', product_id: 1 + (h + k) % P, branch_id: k % 2 ? SHOP : WAREHOUSE, quantity: 1 })
    }
    if (open && applier === 'sale.status.bulk') {
      t.sale_bulk_operations.push({ id: 'sb-' + h, actor_id: 7, request_id: 'sb-' + h, request_json: '{}', history_id: h, receipt_json: '{}' })
      for (let k = 0; k < 40; k++) t.sale_bulk_members.push({ operation_id: 'sb-' + h, sale_id: 1 + (h + k * 17) % S, revision: 0, movement_fingerprint: 'f' })
    }
  }
  for (let a = 1; a <= n(60000); a++) t.audit_logs.push({ id: a, user_id: 7, user_name: 'operator', action: a % 3 ? 'sale_create' : 'stock_adjust', entity: 'sale', entity_id: String(a),
    details: JSON.stringify({ saleId: a, totalUsd: 5 }), created_at: day(a) + ' 12:00:00' })
  return t
}

const literal = (value) => value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replace(/'/g, "''") + "'"

/** Multi-row INSERT statements { sql, params }: literal values, except a long text in an oversize row is bound (D1: 100 KB per statement). */
function statements(tables, maxBytes = 90000, maxRows = 1e9) {
  const out = []
  for (const [table, list] of Object.entries(tables)) {
    if (!list.length) continue
    const columns = [...new Set(list.flatMap(row => Object.keys(row)))]
    const head = `INSERT INTO ${table}(${columns.join(',')}) VALUES `
    let body = []; let size = head.length
    for (const row of list) {
      const tuple = '(' + columns.map(c => literal(row[c])).join(',') + ')'
      if (body.length && (size + tuple.length + 1 > maxBytes || body.length >= maxRows)) { out.push({ sql: head + body.join(','), params: [] }); body = []; size = head.length }
      if (tuple.length + head.length > maxBytes) {
        const params = []
        out.push({ sql: head + '(' + columns.map(c => typeof row[c] === 'string' && row[c].length > 1000 ? (params.push(row[c]), '?') : literal(row[c])).join(',') + ')', params })
        continue
      }
      body.push(tuple); size += tuple.length + 1
    }
    if (body.length) out.push({ sql: head + body.join(','), params: [] })
  }
  return out
}

module.exports = { rows, statements, SHOP, WAREHOUSE, LEGACY }
