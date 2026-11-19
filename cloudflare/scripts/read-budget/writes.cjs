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

// A delivery sale: the same sale naming a delivery person, which adds the in-batch driver check (a primary-key probe on delivery_contacts).
const deliverySale = (n, offset) => ({
  id: `w-sale-delivery-${n}-lines`, label: `POST /api/sales ${n} line, delivery person named`, method: 'POST', url: '/api/sales',
  prepare: async (world) => {
    const body = await saleRequest(world, `dsale${n}`, await lots(world, n, offset))
    const driver = (await world.all('SELECT id FROM delivery_contacts ORDER BY id LIMIT 1'))[0]
    return { ...body, is_delivery: true, delivery_contact_id: driver.id }
  },
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
// `lots`: the count is typed per received date (ic_lot_counts, INV S6): each line is one received date, which the approval Sets from what the count found (the writer computes the target).
function approvalStep({ id, label, offset, counting, lots: dated = false }) {
  return { id, label, method: 'POST', url: '/api/inventory-checks/sessions/:id/approval',
    prepare: async (world) => {
      await world.addSwitches(dated ? ['ic_simple', 'ic_fix_stock', 'ic_lot_counts'] : ['ic_simple', 'ic_fix_stock'], counting ? {} : { without: ['call_counting'] })
      // The switches are memoized per isolate for 15 s: the counter's submission below must meet the row just written.
      await world.restart()
      const rows = await lots(world, 2, offset)
      // Nobody approves their own count: a counter (an approved device, as every non-administrator needs) submits, the administrator approves.
      await world.db.prepare("INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0)").bind(JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true })).run()
      await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_counter','budget_counter',?,902,'{}',1,?,0)").bind(bcrypt.hashSync('budget-password-1', 4), world.orgId).run()
      await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(902,'budget-device','budget device','approved',datetime('now'))").run()
      const login = await world.send('POST', '/api/auth/login', { username: 'budget_counter', password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
      if (!login.setCookie) throw new Error('approval fixture: the counter could not sign in: ' + login.text.slice(0, 200))
      const seen = dated ? new Map((await world.all('SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id = 1 AND batch_id IN (' + rows.map(() => '?').join(',') + ')', ...rows.map((r) => r.batch))).map((q) => [q.batch_id, Number(q.quantity)])) : null
      const lines = dated ? rows.map((r) => ({ productId: r.pid, lots: [{ batchId: r.batch, scope: 'lot', counted: seen.get(r.batch) - 2, seen: seen.get(r.batch) }] }))
        : rows.map((r) => ({ productId: r.pid, countedQuantity: 0, seenQuantity: null, checked: false }))
      const made = await world.send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('approval-submit'), lines }, { cookie: login.setCookie.split(';')[0] })
      if (made.status !== 201) throw new Error('approval fixture: submission answered ' + made.status)
      return { id: made.json.item.id, request: key('approval') }
    },
    run: async (world, send, prepared) => {
      try { return await send('POST', '/api/inventory-checks/sessions/' + prepared.id + '/approval', { decision: 'approve', requestId: prepared.request }) }
      finally { await world.restoreSwitches() }
    } }
}

// One decision on one line of a waiting count (migration 0316): the approver rejects one of the count's two lines. It moves no stock: ONE guarded batch writes the decision, the session's time and one audit
// event, after the reads of the approval, its line and the actor. The count and its counter are the approval shapes' (the same fixture); the other line stays open, so the approval does not end.
function approvalLine({ id, label, offset }) {
  const base = approvalStep({ id, label, offset, counting: true })
  return { ...base, url: '/api/inventory-checks/sessions/:id/approval/lines',
    prepare: async (world) => {
      const made = await base.prepare(world)
      const line = (await world.all('SELECT product_id FROM inventory_check_items WHERE session_id = ? ORDER BY product_id LIMIT 1', made.id))[0]
      return { ...made, productId: line.product_id }
    },
    run: async (world, send, prepared) => {
      try { return await send('POST', '/api/inventory-checks/sessions/' + prepared.id + '/approval/lines', { productId: prepared.productId, action: 'reject', requestId: prepared.request }) }
      finally { await world.restoreSwitches() }
    } }
}

// ---- count tasks (owner, 19 Nov: a task follows the counts in effect): the write shapes of a TAKE-BACK. Each runs the setup in prepare() (before the isolate restarts) and measures the one request. ----
// The count session resume: a task closed by the auto-close when a count session closed; the resume reopens it in the SAME batch (D1 calls of the resume = the plain resume's + the reopen statements, no call of its own).
function taskResume() {
  return { id: 'w-inventory-check-task-resume', label: 'PATCH /api/inventory-checks/sessions/:id resume a closed count (reopens the task it closed)', method: 'PATCH', url: '/api/inventory-checks/sessions/:id',
    prepare: async (world) => {
      await world.addSwitches(['ic_wired'])
      await world.restart() // the switches are memoized per isolate for 15 s
      const ids = (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 3 OFFSET 160')).map((r) => r.id)
      const task = await world.send('POST', '/api/inventory-checks/tasks', { branchId: 1, requestId: key('task'), title: 'Budget task', productIds: ids })
      if (task.status !== 201) throw new Error('resume fixture: the issue answered ' + task.status + ' ' + task.text.slice(0, 200))
      const made = await world.send('POST', '/api/inventory-checks/sessions', { branchId: 1, requestId: key('check'), productIds: ids, scope: { membership: 'visible_page' } })
      if (made.status !== 201) throw new Error('resume fixture: the count session answered ' + made.status + ' ' + made.text.slice(0, 200))
      for (const productId of ids) {
        const o = await world.send('PATCH', '/api/inventory-checks/sessions/' + made.json.item.id + '/items/' + productId, { expectedRevision: 0, expectedSessionRevision: 0, requestId: key('observe'), state: 'done', counted_quantity: 0 })
        if (o.status !== 200) throw new Error('resume fixture: an item answered ' + o.status + ' ' + o.text.slice(0, 200))
      }
      const closed = await world.send('PATCH', '/api/inventory-checks/sessions/' + made.json.item.id, { expectedRevision: 0, requestId: key('close'), action: 'close' })
      if (closed.status !== 200 || !(closed.json.closedTasks || []).length) throw new Error('resume fixture: the close answered ' + closed.status + ' and closed no task ' + closed.text.slice(0, 200))
      return { id: made.json.item.id, revision: closed.json.item.revision, task: task.json.item.id }
    },
    run: async (world, send, f) => {
      try {
        const r = await send('PATCH', '/api/inventory-checks/sessions/' + f.id, { expectedRevision: f.revision, requestId: key('resume'), action: 'resume' })
        if (r.status === 200 && !(r.json.reopenedTasks || []).includes(f.task)) throw new Error('the resume reopened no task: ' + r.text.slice(0, 200))
        return r
      } finally { await world.restoreSwitches() }
    } }
}

// The Set that closes a difference and the task it completes (a counter's per-date count below the figure seen, rejected by the administrator, a task issued, the lot Set that makes stock match).
async function closingSet(world, offset) {
  await world.addSwitches(['ic_wired', 'ic_simple', 'ic_fix_stock', 'ic_lot_counts'])
  await world.restart() // the switches are memoized per isolate for 15 s
  const row = (await lots(world, 1, offset))[0]
  const stocked = await world.all('SELECT s.batch_id AS batch, s.quantity AS quantity FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id WHERE s.branch_id = 1 AND b.variant_product_id = ? ORDER BY s.batch_id', row.pid)
  const dates = stocked.filter((q) => Number(q.quantity) > 0)
  const target = dates.find((q) => q.batch === row.batch)
  const seen = Number(target.quantity)
      await world.db.prepare("INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0)").bind(JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true })).run()
      await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_counter','budget_counter',?,902,'{}',1,?,0)").bind(bcrypt.hashSync('budget-password-1', 4), world.orgId).run()
      await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(902,'budget-device','budget device','approved',datetime('now'))").run()
  const login = await world.send('POST', '/api/auth/login', { username: 'budget_counter', password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
  if (!login.setCookie) throw new Error('set fixture: the counter could not sign in: ' + login.text.slice(0, 200))
  const lines = [{ productId: row.pid, lots: dates.map((d) => ({ batchId: d.batch, scope: 'lot', counted: d.batch === row.batch ? seen - 1 : Number(d.quantity), seen: Number(d.quantity) })) }]
  const made = await world.send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('set-submit'), lines }, { cookie: login.setCookie.split(';')[0] })
  if (made.status !== 201) throw new Error('set fixture: the submission answered ' + made.status + ' ' + made.text.slice(0, 200))
  const rejected = await world.send('POST', '/api/inventory-checks/sessions/' + made.json.item.id + '/approval/lines', { productId: row.pid, action: 'reject', requestId: key('set-reject') })
  if (rejected.status !== 200) throw new Error('set fixture: the rejection answered ' + rejected.status + ' ' + rejected.text.slice(0, 200))
  const task = await world.send('POST', '/api/inventory-checks/tasks', { branchId: 1, requestId: key('task'), title: 'Budget task', productIds: [row.pid] })
  if (task.status !== 201) throw new Error('set fixture: the issue answered ' + task.status + ' ' + task.text.slice(0, 200))
  const set = await world.send('POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: row.pid, branchId: 1, batchId: row.batch, quantity: seen - 1, expectedLotQuantity: seen, reason: 'Physical count', client_request_id: key('set') })
  if (set.status !== 200 || set.json.issue_closed !== true || !(set.json.closed_tasks || []).includes(task.json.item.id)) throw new Error('set fixture: the Set did not close the difference and the task: ' + set.status + ' ' + set.text.slice(0, 300))
  return { history: set.json.action_history_id, task: task.json.item.id }
}
// Set Undo: takes the Set's own count back and reopens the task, in the Set replay's one batch.
function setUndo() {
  return { id: 'w-set-undo-reopens-task', label: 'POST /api/action-history/:id/undo a lot Set that closed a difference and a task (reopens the task)', method: 'POST', url: '/api/action-history/:id/undo',
    prepare: (world) => closingSet(world, 1340),
    run: async (world, send, f) => {
      try { return await send('POST', '/api/action-history/' + f.history + '/undo', {}) }
      finally { await world.restoreSwitches() }
    } }
}
// Set Redo: restores the count at its original time and closes the task again, in one batch.
function setRedo() {
  return { id: 'w-set-redo-closes-task', label: 'POST /api/action-history/:id/redo a lot Set (restores its count, closes the task again)', method: 'POST', url: '/api/action-history/:id/redo',
    prepare: async (world) => {
      const f = await closingSet(world, 1360)
      const u = await world.send('POST', '/api/action-history/' + f.history + '/undo', {})
      if (u.status !== 200) throw new Error('redo fixture: the Undo answered ' + u.status + ' ' + u.text.slice(0, 200))
      return f
    },
    run: async (world, send, f) => {
      try { return await send('POST', '/api/action-history/' + f.history + '/redo', {}) }
      finally { await world.restoreSwitches() }
    } }
}

function writeShapes() {
  const shapes = [
    { id: 'w-login-cold', label: 'POST /api/auth/login (cold isolate)', method: 'POST', url: '/api/auth/login', anon: true,
      prepare: (world) => ({ username: require('./seed.cjs').ADMIN.username, password: require('./seed.cjs').ADMIN.password, organizationId: world.orgId }),
      run: async (world, send, body) => send('POST', '/api/auth/login', body) },
    deliverySale(1, 700), sale(1, 0), sale(3, 20), sale(10, 40), sale(30, 80), sale(86, 140), sale(3, 240, { paid: false }),
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
    // W7: the bulk transfers run on a world whose two branches are both active (canonical shop + warehouse), so they end 200 and measure the transfer itself; w-transfer-1-line above keeps
    // the refusal on the base world (branch 2 inactive), so one shape still proves a refused transfer writes nothing.
    transferBulk(5, 1020), transferBulk(20, 1040),
    // Slice C: the shift close with Telegram ON. The close writes the shift and one telegram_shift_report_sends row and queues the report (the report itself is delivered by the queue consumer in an
    // invocation of its own: test-shift-close-call-ceiling-native.cjs pins that invocation at <= 45 calls; it is not an HTTP route, so it has no read-budget entry).
    shiftClose(),
    { id: 'w-adjust', label: 'POST /api/inventory/adjust (remove 1)', method: 'POST', url: '/api/inventory/adjust',
      prepare: async (world) => (await lots(world, 1, 900))[0],
      run: async (world, send, r) => send('POST', '/api/inventory/adjust', { productId: r.pid, branchId: 1, quantity: 1, type: 'remove', reason: 'damaged', client_request_id: key('adjust') }) },
    // ---- INV-A S2: the surgical Set (Inventory count / Products received-date edit). Self-contained block: the lead unions it with builder B's shapes. ----
    { id: 'w-adjust-set-lot', label: 'POST /api/inventory/adjust Set one received date (expectedLotQuantity)', method: 'POST', url: '/api/inventory/adjust',
      prepare: async (world) => { const r = (await lots(world, 1, 1100))[0]; const q = await world.all('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1', r.batch); return { ...r, was: Number(q[0].quantity) } },
      run: async (world, send, r) => send('POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: r.pid, branchId: 1, batchId: r.batch, quantity: r.was - 1, expectedLotQuantity: r.was, reason: 'Physical count', client_request_id: key('set-lot') }) },
    { id: 'w-batch-branch-set', label: 'PATCH /api/batches/:id/branches/:branchId Set one received date at a branch', method: 'PATCH', url: '/api/batches/:id/branches/1',
      prepare: async (world) => { const r = (await lots(world, 1, 1110))[0]; const q = await world.all('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1', r.batch); return { ...r, was: Number(q[0].quantity) } },
      run: async (world, send, r) => send('PATCH', `/api/batches/${r.batch}/branches/1`, { quantity: r.was - 1, expectedLotQuantity: r.was, reason: 'Physical count', client_request_id: key('batch-set') }) },
    // ---- end INV-A S2 ----
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
    // ---- INV-B S5 (self-contained block; the lead unions it with builder A's): the count per received date and the direct Set from the row. ----
    // 20 products, one received date each, counted one below the figure seen (every line differs, so one approval is queued). Sighted (the world's admin): the seen figure is guarded inside
    // the batch. No stock ledger statement runs, which is what brings it from the 10.5K rows of the older submission to the lines it writes.
    { id: 'w-inventory-check-submission-lots-20', label: 'POST /api/inventory-checks/submissions 20 products, one received date each (ic_lot_counts)', method: 'POST', url: '/api/inventory-checks/submissions',
      prepare: async (world) => {
        await world.addSwitches(['ic_simple', 'ic_fix_stock', 'ic_lot_counts'])
        const rows = await lots(world, 20, 1300)
        // A per-date count must name every stocked date of its product (the server refuses a partial one), so each product carries all of its stocked batches; the first of them is the picked slice's lot.
        const stocked = await world.all('SELECT b.variant_product_id AS pid, s.batch_id AS batch, s.quantity AS quantity FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id WHERE s.branch_id = 1 AND s.quantity > 0 AND b.is_active = 1 AND b.variant_product_id IN (' + rows.map(() => '?').join(',') + ') ORDER BY s.batch_id', ...rows.map((r) => r.pid))
        return rows.map((r) => ({ ...r, dates: stocked.filter((q) => q.pid === r.pid).map((q) => ({ batch: q.batch, seen: Number(q.quantity) })) }))
      },
      run: async (world, send, rows) => {
        try { return await send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: key('submission-lots'), lines: rows.map((r) => ({ productId: r.pid, lots: r.dates.map((d, i) => ({ batchId: d.batch, scope: 'lot', counted: i === 0 ? d.seen - 1 : d.seen, seen: d.seen })) })) }) }
        finally { await world.restoreSwitches() }
      } },
    // The direct Set from the row: the lot Set writer with the expected figure on screen, named as a Fix stock request so the (widened) hold on a waiting count runs first.
    { id: 'w-inventory-check-row-set', label: 'POST /api/inventory/adjust Set one received date from the Inventory row (ic_lot_counts hold)', method: 'POST', url: '/api/inventory/adjust',
      prepare: async (world) => {
        await world.addSwitches(['ic_fix_stock', 'ic_lot_counts'])
        const r = (await lots(world, 1, 1330))[0]
        const q = await world.all('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 1', r.batch)
        return { ...r, was: Number(q[0].quantity) }
      },
      run: async (world, send, r) => {
        try { return await send('POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: r.pid, branchId: 1, batchId: r.batch, quantity: r.was - 1, expectedLotQuantity: r.was, reason: 'Inventory check', client_request_id: `icfix_rbsession_${r.pid}_${key('rowset').replace(/[^A-Za-z0-9]/g, '')}` }) }
        finally { await world.restoreSwitches() }
      } },
    // ---- end INV-B S5 ----
    // Approving a submitted count (ic_fix_stock). The lane's own shape measures the Free plan as it runs until call_counting is turned ON: the first request of
    // an approval applies ONE stock line (a lowering Set), records it and answers. The second is the same request under the write pass's own config, call_counting
    // ON (P1.1): the commit's cap becomes stockInLinesPerRequestByCalls (2 on Free), so one request applies both lines and finishes the approval.
    approvalStep({ id: 'w-inventory-check-approval-step', label: 'POST /api/inventory-checks/sessions/:id/approval 2 lines (ic_fix_stock, first line)', offset: 1100, counting: false }),
    approvalLine({ id: 'w-inventory-check-approval-line', label: 'POST /api/inventory-checks/sessions/:id/approval/lines reject one of 2 lines (ic_fix_stock)', offset: 1250 }),
    approvalStep({ id: 'w-inventory-check-approval-step-counted', label: 'POST /api/inventory-checks/sessions/:id/approval 2 lines (ic_fix_stock, call_counting ON, both lines)', offset: 1150, counting: true }),
    // INV S6: the same two-line step with the count typed per received date (ic_lot_counts): each line is one received date Set from what the count found, no stock ledger read.
    approvalStep({ id: 'w-inventory-check-approval-lot-line', label: 'POST /api/inventory-checks/sessions/:id/approval 2 received-date lines (ic_fix_stock, ic_lot_counts, call_counting ON, both lines)', offset: 1200, counting: true, lots: true }),
    { id: 'w-fee', label: 'POST /api/fees', method: 'POST', url: '/api/fees',
      run: async (world, send) => send('POST', '/api/fees', { fee_type: 'other', label: 'Ice', amount_usd: 1, amount_khr: 0, fee_date: world.ctx.today, branch_id: 1, client_request_id: key('fee') }) },
    // Deleting a delivery person: one atomic batch (guard + delete). A person no sale or fee names is deleted; one a sale names is refused with contact_has_sales and writes nothing.
    // The sale-to-driver link is set up directly here (the seed has no delivering sale), so the refused request meets a real linked row.
    { id: 'w-delivery-contact-delete', label: 'DELETE /api/delivery-contacts/:id (no sale or fee names it)', method: 'DELETE', url: '/api/delivery-contacts/:id',
      prepare: async (world) => (await world.all('SELECT id FROM delivery_contacts ORDER BY id DESC LIMIT 1'))[0].id,
      run: async (world, send, id) => send('DELETE', `/api/delivery-contacts/${id}`) },
    { id: 'w-delivery-contact-delete-refused', label: 'DELETE /api/delivery-contacts/:id (a sale names it: refused)', method: 'DELETE', url: '/api/delivery-contacts/:id',
      prepare: async (world) => {
        const id = (await world.all('SELECT id FROM delivery_contacts ORDER BY id LIMIT 1'))[0].id
        await world.db.prepare('UPDATE sales SET delivery_contact_id = ? WHERE id = (SELECT MIN(id) FROM sales)').bind(id).run()
        return id
      },
      run: async (world, send, id) => send('DELETE', `/api/delivery-contacts/${id}`) },
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
    // the take-back shapes run last: their fixtures turn read switches on and leave history rows that would move the shapes before them
    taskResume(), setUndo(), setRedo(),
    { id: 'w-logout', label: 'POST /api/auth/logout', method: 'POST', url: '/api/auth/logout', body: {} },
  ]
  return shapes.map((s) => ({ kind: 'write', variant: 'base', ...s }))
}

const BRANCH_2_ACTIVE = "UPDATE branches SET name='Second Store', role='warehouse', canonical_key='warehouse', is_active=1, is_default=0, successor_branch_id=NULL WHERE id=2"
const BRANCH_2_RETIRED = "UPDATE branches SET name='Old Store', role='warehouse', canonical_key='warehouse', is_active=0, is_default=0, successor_branch_id=1 WHERE id=2"
function transferBulk(n, offset) {
  return { id: `w-transfer-bulk-${n}-lines`, label: `POST /api/branches/transfer-bulk ${n} lines`, method: 'POST', url: '/api/branches/transfer-bulk',
    prepare: async (world) => { await world.db.prepare(BRANCH_2_ACTIVE).run(); return lots(world, n, offset) },
    run: async (world, send, rows) => {
      try {
        return await send('POST', '/api/branches/transfer-bulk', { transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'budget', client_request_id: key('transfer'),
          items: rows.map((r) => ({ productId: r.pid, quantity: 1, batchId: r.batch })) })
      } finally { await world.db.prepare(BRANCH_2_RETIRED).run() }
    } }
}

// The instant the shift-close fixture opens and closes at: 16:00 UTC of the seed's anchor date (23:00 business time, the same business date) so the window holds the same few
// hours of seed rows on every day, but never earlier than two seconds after the real clock, so no row a previous shape stamped with the real time falls inside the window
// [open, open + 1 day). The business date of the result stays the real one (readCurrent reads SQLite's own clock) except in the last two seconds before 17:00 UTC.
function shiftCloseInstant(anchorDate, nowMs) {
  return Math.max(Date.parse(anchorDate + 'T16:00:00Z'), nowMs + 2000)
}

// The admin opens a shift in branch 1 (setup, before the isolate restarts) and the measured request closes it with Telegram configured (chat id, automation on, the world's bot token).
function shiftClose() {
  return { id: 'w-shift-close', label: 'POST /api/shifts/:id/close (Telegram ON, report queued)', method: 'POST', url: '/api/shifts/:id/close',
    prepare: async (world) => {
      await world.db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('telegram_chat_id','-1001','v1'),('telegram_automation_enabled','true','v1'),('shift_admin_exempt','false','v1')").run()
      // The seed's dated rows end at its anchor (12:00 business time, 05:00 UTC of the business date), so how many of them fall in the close's read window (twelve hours before the
      // open, two days after the close) depends on the real clock; the shift is therefore opened and closed at a pinned instant (shiftCloseInstant), not at the real one.
      // The pinned instant is never BEHIND the real clock either: earlier shapes of this pass wrote rows stamped with the real time (one wrote 4,240 fees with a NULL branch), the
      // close's last-activity look holds its window open a day beyond, and from 16:00 to 17:00 UTC the fixed 16:00 UTC instant is already past, so those rows sat inside the window
      // and the close read 6,209 rows against a budget of 2,566. Pinned by test-read-budget-shift-clock-pure.cjs.
      world.clockMs = shiftCloseInstant(world.ctx.anchorDate, Date.now())
      const opened = await world.send('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
      if (opened.status >= 300) { world.clockMs = null; throw new Error(`shift fixture: open answered ${opened.status} ${opened.text.slice(0, 200)}`) }
      const shift = opened.json.shift || opened.json
      return { id: shift.id, revision: shift.revision }
    },
    // The admin is exempt from shifts by default; the fixture turns that off for the request and puts the settings back so no later shape sees a shift rule.
    run: async (world, send, shift) => {
      try { return await send('POST', `/api/shifts/${shift.id}/close`, { client_request_id: key('shift-close'), expected_revision: shift.revision, closing_counted_usd: 100, closing_counted_khr: 41000 }) }
      finally { world.clockMs = null; await world.db.prepare("DELETE FROM settings WHERE key IN ('telegram_chat_id','telegram_automation_enabled','shift_admin_exempt')").run() }
    } }
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

module.exports = { shiftCloseInstant, writeShapes, measureWrite, rowCounts, lots, resetSequence, returnOf }
