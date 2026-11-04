'use strict'
// The write shapes: what the Free plan has to carry in one request. Setup (a sale to cancel, a quote to confirm) runs in
// prepare(), before the isolate restarts, so the measured request is the first on a fresh isolate.
const bcrypt = require('bcryptjs')
const { runShape, ORIGIN } = require('./world.cjs')

const QUOTE_KEYS = ['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr']
const ZERO_QUOTE = { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 }
const COUNTED = ['sales', 'sale_items', 'sale_payment_events', 'returns', 'return_items', 'inventory_movements', 'stock_session_operations', 'stock_session_members',
  'stock_transfers', 'transfer_operation_receipts', 'sale_mutation_receipts', 'audit_logs', 'action_history', 'fees', 'customers', 'shift_sessions']

async function rowCounts(world) {
  const sql = 'SELECT ' + COUNTED.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')
    + ', (SELECT SUM(quantity) FROM branch_stock) AS branch_stock_qty, (SELECT SUM(quantity) FROM branch_batch_stock) AS lot_qty'
  return (await world.all(sql))[0]
}
const changedTables = (before, after) => Object.keys(after).filter((k) => before[k] !== after[k])

// Stocked lots of the active branch, a fresh slice per shape so no two shapes sell the same product.
async function lots(world, n, offset) {
  const rows = await world.all(`SELECT b.variant_product_id AS pid, b.id AS batch FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id
    JOIN products p ON p.id = b.variant_product_id AND p.is_active = 1 AND (p.id - 1000) % 8 NOT IN (1, 2) WHERE s.branch_id = 1 AND s.quantity >= 5 ORDER BY b.id LIMIT ? OFFSET ?`, n, offset)
  if (rows.length < n) throw new Error(`seed has only ${rows.length} stocked lots at offset ${offset}, need ${n}`)
  return rows
}

let sequence = 0
const key = (label) => `rb-${label}-${++sequence}`

// A sale request the server accepts first time: the quote and the header quote are fetched through the 409s that write nothing.
async function saleRequest(world, label, rows, { paid = true } = {}) {
  const k = key(label)
  const body = { branch_id: 1, money_precision_version: 1, sale_status: paid ? 'completed' : 'awaiting_payment', exchange_rate: 4000, payment_currency: 'USD', client_request_id: k,
    offline_owner: { version: 1, actor_id: 901, organization_id: world.orgId, authority: ORIGIN, runtime: 'cloudflare-workers' }, amount_paid_usd: 0, amount_paid_khr: 0,
    items: rows.map((r, i) => ({ product_id: r.pid, quantity: 1, branch_id: 1, batch_id: r.batch, client_line_key: `${k}-l${i}`, pricing_source: 'selling', pricing_quote: { ...ZERO_QUOTE } })) }
  let r = await world.send('POST', '/api/sales', body)
  if (r.status === 409 && r.json?.code === 'sale_pricing_quote_conflict') {
    const quotes = new Map(r.json.pricing_quotes.map((x) => [x.client_line_key, x]))
    for (const item of body.items) item.pricing_quote = Object.fromEntries(QUOTE_KEYS.map((q) => [q, quotes.get(item.client_line_key)[q]]))
  } else if (r.status !== 409) throw new Error(`${label}: quote probe answered ${r.status} ${r.text.slice(0, 200)}`)
  const total = body.items.reduce((s, it) => s + Number(it.pricing_quote.total_usd || 0), 0)
  if (paid) Object.assign(body, { payment_details: [{ method: 'Cash', amount_usd: Math.ceil(total), amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: Math.ceil(total), amount_paid_khr: 0 })
  r = await world.send('POST', '/api/sales', body)
  if (r.status === 409 && r.json?.code === 'sale_header_quote_conflict') body.expected_header_quote = r.json.header_quote
  else if (r.status < 300) { body.client_request_id = key(label); body.items.forEach((it, i) => { it.client_line_key = `${body.client_request_id}-l${i}` }) }
  return body
}

// Direct to the database: setup of a sale in the state a shape needs, not a Worker request.
async function setSaleStatus(world, id, status) {
  const cancelled = status === 'cancelled'
  await world.db.prepare('UPDATE sales SET sale_status = ?, status_before_cancel = ?, cancel_reason = ?, cancelled_at = ? WHERE id = ?')
    .bind(status, cancelled ? 'completed' : null, cancelled ? 'mistake' : null, cancelled ? world.ctx.anchor : null, id).run()
}

// The seeded sale's lots are mostly empty (stock sits on the newest lot): put five units back on every line so a restock-on-uncancel can deduct.
async function stockUpSale(world, id) {
  const lines = "(SELECT batch_id FROM sale_items WHERE sale_id = ?)"
  await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('stock_transaction_permit', 'legacy-separate-pool-v1')").run()
  await world.db.batch([
    world.db.prepare(`UPDATE branch_batch_stock SET quantity = quantity + 5 WHERE branch_id = 1 AND batch_id IN ${lines}`).bind(id),
    world.db.prepare('UPDATE branch_stock SET quantity = quantity + 5 WHERE branch_id = 1 AND product_id IN (SELECT product_id FROM sale_items WHERE sale_id = ?)').bind(id),
    world.db.prepare('UPDATE products SET stock_quantity = stock_quantity + 5 WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ?)').bind(id),
  ])
  await world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
}

const saleId = (r) => r?.json && (r.json.id || r.json.sale_id || r.json.sale?.id)
async function createSale(world, label, rows, opts) {
  const body = await saleRequest(world, label, rows, opts)
  const r = await world.send('POST', '/api/sales', body)
  if (r.status >= 300) throw new Error(`${label}: setup sale answered ${r.status} ${r.text.slice(0, 200)}`)
  return saleId(r)
}

const sale = (n, offset, { paid = true } = {}) => ({
  id: `w-sale-${paid ? '' : 'not-paid-'}${n}-lines`, label: `POST /api/sales ${paid ? '' : 'Not Paid '}${n} lines`, method: 'POST', url: '/api/sales',
  prepare: async (world) => saleRequest(world, `sale${n}`, await lots(world, n, offset), { paid }),
  run: async (world, send, body) => send('POST', '/api/sales', body),
})

const status = (id, body) => ({ method: 'PATCH', url: `/api/sales/${id}/status`, body })

function stockSession(n, offset) {
  return { id: `w-stock-session-${n}-lines`, label: `POST /api/inventory/sessions stock_in ${n} lines`, method: 'POST', url: '/api/inventory/sessions',
    prepare: async (world) => ({ client_request_id: key('stock'), mode: 'stock_in', defaults: { supplier_name: 'Supplier 3', branch_id: 1, received_date: world.ctx.today.split('-').reverse().join('/') },
      items: (await lots(world, n, offset)).map((r, i) => ({ line_id: `l-${i}`, kind: 'receive', product_id: r.pid, quantity: 3, unit_cost_usd: 2 })) }),
    run: async (world, send, body) => send('POST', '/api/inventory/sessions', body) }
}

// saleLines: how many lines the sale being returned has (10 for the budgeted shapes); a loophole test returns a longer sale.
function returnOf(n, offset, saleLines = 10) {
  return { id: `w-return-${n}-lines`, label: `POST /api/returns ${n} lines (restock)`, method: 'POST', url: '/api/returns',
    prepare: async (world) => {
      const id = await createSale(world, `ret${n}`, await lots(world, saleLines, offset))
      const lines = (await world.all('SELECT id, product_id FROM sale_items WHERE sale_id = ? ORDER BY id', id)).slice(0, n)
      const quote = await world.send('POST', '/api/returns/quote', { sale_id: id, items: lines.map((l) => ({ sale_item_id: l.id, quantity: 1 })) })
      if (quote.status !== 200) throw new Error(`return quote answered ${quote.status} ${quote.text.slice(0, 200)}`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.json
      return { client_request_id: key('return'), money_precision_version: 1, sale_id: id, reason: 'budget', expected_quote: expected,
        items: lines.map((l) => ({ sale_item_id: l.id, product_id: l.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 })) }
    },
    run: async (world, send, body) => send('POST', '/api/returns', body) }
}

// A counter submits two counts of 0 (an approved device, as every non-administrator needs: nobody approves their own count) and the administrator approves the
// session once. `counting` false = the pass's call_counting switch is taken away for this request (the Free plan before it is turned on); true = as the pass has it.
function approvalStep({ id, label, offset, counting }) {
  return { id, label, method: 'POST', url: '/api/inventory-checks/sessions/:id/approval',
    prepare: async (world) => {
      await world.addSwitches(['ic_simple', 'ic_fix_stock'], counting ? {} : { without: ['call_counting'] })
      // The switches are memoized per isolate for 15 s: the counter's submission below must meet the row just written.
      await world.restart()
      const rows = await lots(world, 2, offset)
      // Nobody approves their own count: a counter (an approved device, as every non-administrator needs) submits, the administrator approves.
      await world.db.prepare("INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0)").bind(JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true })).run()
      await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_counter','budget_counter',?,902,'{}',1,?,0)").bind(bcrypt.hashSync('budget-password-1', 4), world.orgId).run()
      await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(902,'budget-device','budget device','approved',datetime('now'))").run()
      const login = await world.send('POST', '/api/auth/login', { username: 'budget_counter', password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
      if (!login.setCookie) throw new Error('approval fixture: the counter could not sign in: ' + login.text.slice(0, 200))
      const made = await world.send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('approval-submit'), lines: rows.map((r) => ({ productId: r.pid, countedQuantity: 0, seenQuantity: null, checked: false })) }, { cookie: login.setCookie.split(';')[0] })
      if (made.status !== 201) throw new Error('approval fixture: submission answered ' + made.status)
      return { id: made.json.item.id, request: key('approval') }
    },
    run: async (world, send, prepared) => {
      try { return await send('POST', '/api/inventory-checks/sessions/' + prepared.id + '/approval', { decision: 'approve', requestId: prepared.request }) }
      finally { await world.restoreSwitches() }
    } }
}

function writeShapes() {
  const shapes = [
    { id: 'w-login-cold', label: 'POST /api/auth/login (cold isolate)', method: 'POST', url: '/api/auth/login', anon: true,
      prepare: (world) => ({ username: require('./seed.cjs').ADMIN.username, password: require('./seed.cjs').ADMIN.password, organizationId: world.orgId }),
      run: async (world, send, body) => send('POST', '/api/auth/login', body) },
    sale(1, 0), sale(3, 20), sale(10, 40), sale(30, 80), sale(86, 140), sale(3, 240, { paid: false }),
    { id: 'w-pay-not-paid', label: 'PATCH /api/sales/:id/status Not Paid -> Completed (take payment)', method: 'PATCH', url: '/api/sales/:id/status',
      prepare: async (world) => createSale(world, 'unpaid', await lots(world, 3, 260), { paid: false }),
      run: async (world, send, id) => send('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: key('pay'), expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 400, amount_khr: 0 }] }) },
    { id: 'w-sale-cancel-3-lines', label: 'PATCH /api/sales/:id/status cancel 3-line sale', method: 'PATCH', url: '/api/sales/:id/status',
      prepare: async (world) => createSale(world, 'cancel3', await lots(world, 3, 280)),
      run: async (world, send, id) => send('PATCH', `/api/sales/${id}/status`, { sale_status: 'cancelled', client_request_id: key('cancel'), cancel_reason: 'mistake', cancel_note: 'budget' }) },
    // The seeded 86-line sale (the production maximum). A new one cannot be created at the base (SQLITE_TOOBIG), so these three
    // act on the seeded row; the cancel and the amendment leave it as it was, the un-cancel finds it cancelled.
    { id: 'w-sale-86-amend', label: 'POST /api/sales/:id/amendments 86-line sale, one line +1', method: 'POST', url: '/api/sales/:id/amendments',
      prepare: async (world) => {
        const id = world.ctx.bigSaleId
        await setSaleStatus(world, id, 'completed')
        await stockUpSale(world, id)
        const line = (await world.all('SELECT id, quantity FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', id))[0]
        const body = { kind: 'line_quantity_increased', sale_item_id: line.id, quantity: line.quantity + 1, client_request_id: key('amend'), money_precision_version: 1, expected_exchange_rate: 4000 }
        // Two 409s that write nothing name the recorded price and the exact header total; the measured request carries both.
        const first = await world.send('POST', `/api/sales/${id}/amendments`, body)
        if (first.status !== 409 || first.json?.code !== 'sale_pricing_quote_conflict') throw new Error(`amendment probe answered ${first.status} ${first.text.slice(0, 200)}`)
        body.pricing_quote = first.json.pricing_quote
        const second = await world.send('POST', `/api/sales/${id}/amendments`, body)
        if (second.status !== 409 || second.json?.code !== 'sale_header_quote_conflict') throw new Error(`amendment probe answered ${second.status} ${second.text.slice(0, 200)}`)
        return { id, body: { ...body, expected_header_quote: second.json.header_quote } }
      },
      run: async (world, send, { id, body }) => send('POST', `/api/sales/${id}/amendments`, body) },
    { id: 'w-sale-86-cancel', label: 'PATCH /api/sales/:id/status cancel 86-line sale', method: 'PATCH', url: '/api/sales/:id/status',
      prepare: async (world) => { await setSaleStatus(world, world.ctx.bigSaleId, 'completed'); return world.ctx.bigSaleId },
      run: async (world, send, id) => send('PATCH', `/api/sales/${id}/status`, { sale_status: 'cancelled', client_request_id: key('cancel'), cancel_reason: 'mistake', cancel_note: 'budget' }) },
    { id: 'w-sale-86-uncancel', label: 'PATCH /api/sales/:id/status un-cancel 86-line sale', method: 'PATCH', url: '/api/sales/:id/status',
      prepare: async (world) => { await setSaleStatus(world, world.ctx.bigSaleId, 'cancelled'); await stockUpSale(world, world.ctx.bigSaleId); return world.ctx.bigSaleId },
      run: async (world, send, id) => send('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: key('uncancel'), expected_exchange_rate: 4000 }) },
    returnOf(1, 600), returnOf(3, 620), returnOf(10, 640),
    stockSession(1, 700), stockSession(5, 720), stockSession(20, 740), stockSession(25, 780), stockSession(60, 820),
    { id: 'w-transfer-1-line', label: 'POST /api/inventory/transfer 1 line', method: 'POST', url: '/api/inventory/transfer',
      prepare: async (world) => (await lots(world, 1, 1000))[0],
      run: async (world, send, r) => send('POST', '/api/inventory/transfer', { transfer_provenance_version: 1, productId: r.pid, fromBranchId: 1, toBranchId: 2, quantity: 1, reason: 'budget', client_request_id: key('transfer') }) },
    transferBulk(5, 1020), transferBulk(20, 1040),
    { id: 'w-adjust', label: 'POST /api/inventory/adjust (remove 1)', method: 'POST', url: '/api/inventory/adjust',
      prepare: async (world) => (await lots(world, 1, 900))[0],
      run: async (world, send, r) => send('POST', '/api/inventory/adjust', { productId: r.pid, branchId: 1, quantity: 1, type: 'remove', reason: 'damaged', client_request_id: key('adjust') }) },
    { id: 'w-fast-stock-in-1-line', label: 'POST /api/inventory/fast-stock-in/commit 1 line', method: 'POST', url: '/api/inventory/fast-stock-in/commit',
      prepare: async (world) => lots(world, 1, 910), run: async (world, send, rows) => send('POST', '/api/inventory/fast-stock-in/commit', fastStockIn(rows)) },
    { id: 'w-fast-stock-in-3-lines', label: 'POST /api/inventory/fast-stock-in/commit 3 lines', method: 'POST', url: '/api/inventory/fast-stock-in/commit',
      prepare: async (world) => lots(world, 3, 920), run: async (world, send, rows) => send('POST', '/api/inventory/fast-stock-in/commit', fastStockIn(rows)) },
    { id: 'w-inventory-check-session-20', label: 'POST /api/inventory-checks/sessions 20 products', method: 'POST', url: '/api/inventory-checks/sessions',
      prepare: async (world) => (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 20 OFFSET 40')).map((r) => r.id),
      run: async (world, send, ids) => send('POST', '/api/inventory-checks/sessions', { branchId: 1, title: 'Budget count 2', productIds: ids, scope: {}, requestId: key('check') }) },
    // The owner's way to count (ic_simple): 20 picked products with their counts, recorded whole as one closed session. Counted 0 against stock differs, so every line is an issue.
    { id: 'w-inventory-check-submission-20', label: 'POST /api/inventory-checks/submissions 20 products (ic_simple)', method: 'POST', url: '/api/inventory-checks/submissions',
      prepare: async (world) => {
        await world.addSwitches(['ic_simple'])
        return (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 20 OFFSET 80')).map((r) => r.id)
      },
      run: async (world, send, ids) => {
        try { return await send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submission'), lines: ids.map((productId) => ({ productId, countedQuantity: 0, seenQuantity: null, checked: false })) }) }
        finally { await world.restoreSwitches() }
      } },
    // Approving a submitted count (ic_fix_stock). The lane's own shape measures the Free plan as it runs until call_counting is turned ON: the first request of
    // an approval applies ONE stock line (a lowering Set), records it and answers. The second is the same request under the write pass's own config, call_counting
    // ON (P1.1): the commit's cap becomes stockInLinesPerRequestByCalls (2 on Free), so one request applies both lines and finishes the approval.
    approvalStep({ id: 'w-inventory-check-approval-step', label: 'POST /api/inventory-checks/sessions/:id/approval 2 lines (ic_fix_stock, first line)', offset: 1100, counting: false }),
    approvalStep({ id: 'w-inventory-check-approval-step-counted', label: 'POST /api/inventory-checks/sessions/:id/approval 2 lines (ic_fix_stock, call_counting ON, both lines)', offset: 1150, counting: true }),
    { id: 'w-fee', label: 'POST /api/fees', method: 'POST', url: '/api/fees',
      run: async (world, send) => send('POST', '/api/fees', { fee_type: 'other', label: 'Ice', amount_usd: 1, amount_khr: 0, fee_date: world.ctx.today, branch_id: 1, client_request_id: key('fee') }) },
    { id: 'w-customer-create', label: 'POST /api/customers', method: 'POST', url: '/api/customers',
      run: async (world, send) => send('POST', '/api/customers', { name: 'Budget Customer', phone: '0009990001', client_request_id: key('customer') }) },
    { id: 'w-product-price-edit', label: 'PUT /api/products/:id price edit', method: 'PUT', url: '/api/products/1003',
      prepare: async (world) => (await world.all('SELECT * FROM products WHERE id=1003'))[0],
      run: async (world, send, p) => send('PUT', '/api/products/1003', { ...p, selling_price_usd: 11, expected_updated_at: p.updated_at, client_request_id: key('edit') }) },
    { id: 'w-read-switch-flip', label: 'PUT /api/runtime/read-switches', method: 'PUT', url: '/api/runtime/read-switches',
      // The write pass boots with call_counting stored (P1.1), so the row already carries epoch 1; the flip names the epoch the world holds
      // instead of assuming an empty row (0), which the route answers 409 read_switch_epoch_stale.
      prepare: async (world) => {
        const row = (await world.all("SELECT value FROM system_flags WHERE key='read_switches'"))[0]
        try { return Number(JSON.parse(row.value).epoch) || 0 } catch { return 0 }
      },
      run: async (world, send, epoch) => send('PUT', '/api/runtime/read-switches', { name: 'probe', state: 'on', expectedEpoch: epoch }) },
    { id: 'w-logout', label: 'POST /api/auth/logout', method: 'POST', url: '/api/auth/logout', body: {} },
  ]
  return shapes.map((s) => ({ kind: 'write', variant: 'base', ...s }))
}

function transferBulk(n, offset) {
  return { id: `w-transfer-bulk-${n}-lines`, label: `POST /api/branches/transfer-bulk ${n} lines`, method: 'POST', url: '/api/branches/transfer-bulk',
    prepare: async (world) => lots(world, n, offset),
    run: async (world, send, rows) => send('POST', '/api/branches/transfer-bulk', { transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'budget', client_request_id: key('transfer'),
      items: rows.map((r) => ({ productId: r.pid, quantity: 1, batchId: r.batch })) }) }
}

function fastStockIn(rows) {
  return { lines: rows.map((r, i) => ({ key: `k${i}`, wire: 'adjust', body: { productId: r.pid, branchId: 1, quantity: 2, type: 'add', reason: 'Stock in', unitCostUsd: 2, supplierName: 'Supplier 3', client_request_id: key('fsi') } })) }
}

// One shape, cold: rows read and written, D1 calls, and which tables changed in the measured request alone.
async function measureWrite(world, shape, { fingerprints = false } = {}) {
  const out = await runShape(world, shape, { cold: true, cacheMiss: false, counts: rowCounts, fingerprints })
  return { ...out, changed: changedTables(out.countsBefore || {}, out.countsAfter || {}) }
}

// Request ids come from one counter, so two worlds that run the same shapes in the same order send the same ids.
const resetSequence = () => { sequence = 0 }

module.exports = { writeShapes, measureWrite, rowCounts, lots, resetSequence, returnOf }
