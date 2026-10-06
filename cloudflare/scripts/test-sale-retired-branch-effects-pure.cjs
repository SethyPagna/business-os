// CUTOVER-LC: stock effects of the SALE writers against a sale made at a branch that has since been retired
// (Shop -> "Old Shop", inactive, successor "LC Store"): single status change, bulk status change (with its
// undo and redo), amendments and add-items. The REAL routes/sales.ts, routes/actionHistory.ts and every kernel
// they use run against an in-memory SQLite with every migration applied; sales come from the real checkout.
//
// An ORACLE is the same set of routes exactly as they were before this change (git 2651672da: LB + LD, files
// routes/sales.ts, lib/saleBulkStatus.ts, lib/saleTransitions.ts, lib/saleAmendments.ts). It proves two things:
//   * while both branches are active the new code writes byte-identical statements (inert), and
//   * on the post-consolidation world the old code strands the units at the retired branch (the defect), so
//     the fixture discriminates the fix from the bug.
//
// Run (from cloudflare/): node scripts/test-sale-retired-branch-effects-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

// Two oracles. OLD = the writers before ANY retired-branch handling (b2b57f90b): the controls, and the inertness of the stock
// redirect. BEFORE_FEES = the merge of LC + LD (5e7a011a4: redirect in, expenses still booked at the sale's branch): the
// inertness of booking the cancellation expense to the successor, which can only differ once the sale's branch is retired.
const ORACLE_OLD = 'b2b57f90b344f26b708c5b5f44e4fde26199d29b'
const ORACLE_BEFORE_FEES = '5e7a011a4'
// CUTOVER-LR adds lib/saleLineAddition.ts (the per-line effect branch of an addition) so its inertness is proved too.
const ORACLE_FILES = new Set(['routes/sales.ts', 'lib/saleBulkStatus.ts', 'lib/saleTransitions.ts', 'lib/saleAmendments.ts', 'lib/saleLineAddition.ts'])
const USER = { id: 71, username: 'owner', name: 'Owner', permissions: JSON.stringify({ all: true }) }
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }

function makeWorld(oracleSha) {
  const cache = new Map()
  const overrides = {
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
    '../lib/audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': {
      bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0,
      cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
    },
    '../lib/telegram': {
      formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [],
      sendTelegramEvent: async () => {}, telegramMoney: (value) => String(value ?? ''),
    },
  }
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const text = oracleSha && ORACLE_FILES.has(rel)
      ? execFileSync('git', ['show', `${oracleSha}:cloudflare/src/${rel}`], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : fs.readFileSync(sourcePath, 'utf8')
    const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  return { sales: load('routes/sales.ts').default, history: load('routes/actionHistory.ts').default }
}
const fresh = makeWorld(null)
const old = makeWorld(ORACLE_OLD)
const beforeFees = makeWorld(ORACLE_BEFORE_FEES)

// The D1 binding the real lib/db.ts D1Compat wraps: prepare().bind().first()/all()/run() and batch() of bound
// statements, over a real SQLite. Native D1 counts the revision-trigger row of an INSERT INTO sales too.
function routeDb(sql, capture) {
  const bump = (text, changes) => (/INSERT\s+INTO\s+sales\s*\(/i.test(text) && changes > 0 ? changes + 1 : changes)
  return {
    prepare(text) {
      return {
        bind(...params) {
          return {
            text, params,
            async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
            async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
            async run() { const r = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: bump(text, Number(r.changes)), last_row_id: Number(r.lastInsertRowid) } } },
          }
        },
      }
    },
    async batch(statements) {
      if (capture) capture.push(statements.map((statement) => ({ sql: statement.text, params: statement.params })))
      return sql.transaction(() => statements.map((statement) => {
        const r = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: bump(statement.text, Number(r.changes)), last_row_id: Number(r.lastInsertRowid) } }
      }))()
    },
  }
}

// CUTOVER-LR: `redirect` is the X-Branch-Redirect header, the active branch the operator confirmed for a change addressed to a
// retired branch. Without it every such change is refused with branch_redirect_required.
const call = async (world, route, method, url, body, redirect = null) => {
  const response = await world.request(url, { method, headers: { 'content-type': 'application/json', ...(redirect == null ? {} : { 'x-branch-redirect': String(redirect) }) }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: route }, executionCtx)
  const text = await response.text()
  let json; try { json = JSON.parse(text) } catch { json = { error: text } }
  return { status: response.status, body: json }
}

function checkoutBody(id) {
  return {
    branch_id: 1, money_precision_version: 1,
    items: [{ product_id: 10, quantity: 2, branch_id: 1, batch_id: 500, applied_price_usd: 9.5, client_line_key: `line-${id}`, pricing_source: 'selling',
      pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } }],
    exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: 19, client_request_id: id,
    offline_owner: { version: 1, actor_id: USER.id, organization_id: null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
  }
}

// States: 'before' = both branches active with NULL roles (what runs today), 'after' = the consolidation's end
// state (LC Store role shop key warehouse, Old Shop retired with successor LC Store), 'orphan' = retired, no successor.
// Production ids here: 1 = Shop, 2 = Warehouse. The Shop sale drew lot 500 (8 left at Shop after the sale); the
// Warehouse holds 5 in lot 600, received the same day, so the consolidation folded 500 into 600.
let migratedTemplate = null
function migratedDb() {
  if (!migratedTemplate) {
    const seed = new Database(':memory:')
    seed.pragma('foreign_keys = OFF')
    for (const migration of loadAll()) seed.exec(migration)
    migratedTemplate = seed.serialize()
    seed.close()
  }
  const db = new Database(migratedTemplate)
  db.pragma('foreign_keys = OFF')
  return db
}

async function build(state, capture) {
  const db = migratedDb()
  db.exec('DELETE FROM branches')
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1)").run()
  db.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
              VALUES(10,'Powder','POWDER',15,9.5,38000,4,16000,1)`).run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)').run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,2,5)').run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
              VALUES(500,10,'powder-shop','POWDER-S','2027-06-01','2026-09-01',1,1)`).run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
              VALUES(600,10,'powder-wh','POWDER-W','2027-06-01','2026-09-01',1,2)`).run()
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)').run()
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,2,5)').run()
  const created = await call(fresh.sales, routeDb(db, null), 'POST', '/', checkoutBody(`checkout-${state}`))
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const saleId = created.body.sale.id
  const lineId = created.body.sale.items[0].id
  assert.equal(stockOf(db).shop, 8, 'the checkout took 2 of the 10 at Shop')
  if (state !== 'before') {
    db.exec(`UPDATE branch_batch_stock SET quantity = quantity + 8 WHERE batch_id = 600 AND branch_id = 2;
             UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 500 AND branch_id = 1;
             UPDATE branch_stock SET quantity = quantity + 8 WHERE product_id = 10 AND branch_id = 2;
             UPDATE branch_stock SET quantity = 0 WHERE product_id = 10 AND branch_id = 1;
             DELETE FROM branches;`)
    db.prepare("INSERT INTO branches(id,name,role,canonical_key,is_default,is_active) VALUES(2,'LC Store','shop','warehouse',1,1)").run()
    db.prepare("INSERT INTO branches(id,name,role,canonical_key,is_default,is_active,successor_branch_id) VALUES(1,'Old Shop','shop','shop',0,0,?)").run([state === 'orphan' ? null : 2])
    db.prepare("INSERT INTO audit_logs(user_name,action,entity,entity_id,details) VALUES('op','branch_cutover_lot_fold','product_batch','600',?)")
      .run([JSON.stringify({ operationId: 'op-1', productId: 10, survivorBatchId: 600, foldedBatchIds: [500], branchId: 2 })])
  }
  return { db, route: routeDb(db, capture), saleId, lineId, capture }
}

function stockOf(db) {
  const q = (sql) => db.prepare(sql).get()?.quantity ?? null
  return {
    shop: q('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1'),
    store: q('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2'),
    lot500AtOld: q('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1'),
    lot500AtStore: q('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=2'),
    lot600AtStore: q('SELECT quantity FROM branch_batch_stock WHERE batch_id=600 AND branch_id=2'),
    product: q('SELECT stock_quantity AS quantity FROM products WHERE id=10'),
  }
}
const ledgerSnapshot = (db) => JSON.stringify(['branch_stock', 'branch_batch_stock', 'products', 'inventory_movements', 'sales', 'sale_items', 'sale_item_batch_allocations', 'fees']
  .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const plain = (value) => JSON.parse(JSON.stringify(value))
const movementsOf = (db, type) => plain(db.prepare('SELECT branch_id, branch_name, addressed_branch_name, quantity, batch_id FROM inventory_movements WHERE movement_type=? ORDER BY id').all([type]))

// Random fee ids are the only per-run noise besides timestamps, receipt numbers and uuids.
const scrub = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/-\d{12,}/g, '<id>').replace(/\d{8}[ -]\d{6}/g, '<receipt>').replace(/\d{4}-\d{2}-\d{2}[ T][\d:.Z]+/g, '<ts>')

function normalised(batches) {
  return scrub(JSON.stringify(batches))
    .replace(/"stamp":"[^"]*"/g, '"stamp":"<ts>"')
}

const setStatus = (world, w, body, saleId = w.saleId, redirect = null) => call(world, w.route, 'PATCH', `/${saleId}/status`, { expected_exchange_rate: 4000, ...body }, redirect)
const cancelBody = (id, extra = {}) => ({ client_request_id: id, sale_status: 'cancelled', cancel_reason: 'mistake', ...extra })
const reviveBody = (id) => ({ client_request_id: id, sale_status: 'completed' })
const bulkBody = (w, target, key, extra = {}) => ({
  client_request_id: key, target_status: target, ...(target === 'cancelled' ? { cancel_reason: 'mistake' } : {}),
  items: w.db.prepare('SELECT id, sale_status expected_status, updated_at expected_updated_at FROM sales ORDER BY id').all(), ...extra,
})
const decreaseBody = (w, key) => ({
  kind: 'line_quantity_decreased', money_precision_version: 1, client_request_id: key, expected_exchange_rate: 4000, sale_item_id: w.lineId, quantity: 1,
  pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 },
})
// Retries with each authoritative quote the route hands back (header quote, line pricing quote), like the app does.
async function amendQuoted(world, w, body, redirect = null) {
  let sent = body
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await call(world, w.route, 'POST', `/${w.saleId}/amendments`, sent, redirect)
    if (result.status === 409 && result.body.code === 'sale_header_quote_conflict') { sent = { ...sent, expected_header_quote: result.body.header_quote }; continue }
    if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict' && result.body.pricing_quote) { sent = { ...sent, pricing_quote: result.body.pricing_quote }; continue }
    w.sent = sent
    return result
  }
  throw new Error('amendment quotes did not settle')
}
async function addQuoted(world, w, body, redirect = null) {
  let sent = body
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await call(world, w.route, 'POST', `/${w.saleId}/items`, sent, redirect)
    if (result.status === 409 && result.body.code === 'sale_header_quote_conflict') { sent = { ...sent, expected_header_quote: result.body.header_quote }; continue }
    if (result.status === 409 && result.body.code === 'sale_pricing_quote_conflict' && Array.isArray(result.body.pricing_quotes)) {
      sent = { ...sent, items: sent.items.map((item) => { const q = result.body.pricing_quotes.find((x) => x.client_line_key === item.client_line_key); return q ? { ...item, pricing_quote: { gross_usd: q.gross_usd, product_discount_usd: q.product_discount_usd, manual_discount_usd: q.manual_discount_usd, total_usd: q.total_usd, total_khr: q.total_khr } } : item }) }
      continue
    }
    return result
  }
  throw new Error('add-items quotes did not settle')
}
async function amend(world, w, body, redirect = null) {
  const first = await call(world, w.route, 'POST', `/${w.saleId}/amendments`, body, redirect)
  if (first.status !== 409 || first.body.code !== 'sale_header_quote_conflict') return first
  const sent = { ...body, expected_header_quote: first.body.header_quote }
  const second = await call(world, w.route, 'POST', `/${w.saleId}/amendments`, sent, redirect)
  w.sent = sent
  return second
}

;(async () => {
  // ---------------------------------------------------------------- single status: cancel, un-cancel, replay
  {
    const w = await build('after')
    const before = stockOf(w.db)
    assert.deepEqual(before, { shop: 0, store: 13, lot500AtOld: 0, lot500AtStore: null, lot600AtStore: 13, product: 13 + 0 + 2 - 2 })
    // CUTOVER-LR: never silent. Without the confirmed branch the cancel is refused with the redirect to ask about.
    const untouched = ledgerSnapshot(w.db)
    const asked = await setStatus(fresh.sales, w, cancelBody('cut-cancel-1'))
    assert.equal(asked.status, 409, JSON.stringify(asked.body))
    assert.equal(asked.body.code, 'branch_redirect_required')
    assert.deepEqual(asked.body.redirect, { addressed_branch_id: 1, addressed_branch_name: 'Old Shop', successor_branch_id: 2, successor_branch_name: 'LC Store', targets: [{ id: 2, name: 'LC Store' }], requested_target_id: null })
    assert.equal(ledgerSnapshot(w.db), untouched, 'the refused cancel writes nothing')
    const invalid = await setStatus(fresh.sales, w, cancelBody('cut-cancel-1'), w.saleId, 1)
    assert.equal(invalid.body.code, 'branch_redirect_target_invalid', 'the disabled branch cannot be its own redirect')
    assert.equal(invalid.body.redirect.requested_target_id, 1)
    assert.equal(ledgerSnapshot(w.db), untouched, 'nor does an invalid target write anything')
    const cancelled = await setStatus(fresh.sales, w, cancelBody('cut-cancel-1'), w.saleId, 2)
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    assert.deepEqual(plain(stockOf(w.db)), { shop: 0, store: 15, lot500AtOld: 0, lot500AtStore: null, lot600AtStore: 15, product: 15 },
      'the 2 units come back to LC Store, into the lot that exists there now (600 absorbed 500); nothing lands at Old Shop')
    assert.deepEqual(movementsOf(w.db, 'return'), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: 2, batch_id: 600 }],
      'the movement names the branch the stock really went to and the label the sale was made under')
    assert.deepEqual(plain(w.db.prepare('SELECT branch_id, branch_name, sale_status FROM sales WHERE id=?').get([w.saleId])), { branch_id: 1, branch_name: 'Shop', sale_status: 'cancelled' }, 'the sale keeps its own branch and label')
    assert.equal(w.db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE sale_item_id=?').get([w.lineId]).released_quantity, 2)
    // Double apply: the same request id replays; the stock moves once.
    const settled = ledgerSnapshot(w.db)
    const replayed = await setStatus(fresh.sales, w, cancelBody('cut-cancel-1'), w.saleId, 2)
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body))
    assert.equal(ledgerSnapshot(w.db), settled, 'a replayed request writes nothing')
    // Reversal: un-cancel takes the same 2 units out of the same lot at the confirmed branch.
    assert.equal((await setStatus(fresh.sales, w, reviveBody('cut-revive-1'))).body.code, 'branch_redirect_required', 'un-cancel asks too')
    const revived = await setStatus(fresh.sales, w, reviveBody('cut-revive-1'), w.saleId, 2)
    assert.equal(revived.status, 200, JSON.stringify(revived.body))
    assert.deepEqual(stockOf(w.db), before, 'un-cancel puts every stock figure back exactly where it was')
    assert.deepEqual(movementsOf(w.db, 'sale').slice(-1), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: -2, batch_id: 600 }])
    // Control: the oracle (old code) strands the units at the retired branch, in the folded lot.
    const o = await build('after')
    const strandedCancel = await setStatus(old.sales, o, cancelBody('cut-cancel-old'))
    assert.equal(strandedCancel.status, 200, JSON.stringify(strandedCancel.body))
    const stranded = stockOf(o.db)
    assert.equal(stranded.shop, 2, 'CONTROL: the old code puts the units at Old Shop (inactive, nothing can sell them)')
    assert.equal(stranded.lot500AtOld, 2, 'CONTROL: and into the folded lot')
  }
  console.log('PASS single status: cancel / un-cancel of an old Shop sale move stock at LC Store in the merged lot, replay moves once, old code strands')

  // ---------------------------------------------------------------- single status: refusals
  {
    const w = await build('orphan')
    const before = ledgerSnapshot(w.db)
    // No successor: the operator is still asked, with no default, and any active selling branch may take it.
    const askedNoSuccessor = await setStatus(fresh.sales, w, cancelBody('cut-orphan-1'))
    assert.equal(askedNoSuccessor.status, 409, JSON.stringify(askedNoSuccessor.body))
    assert.equal(askedNoSuccessor.body.code, 'branch_redirect_required')
    assert.equal(askedNoSuccessor.body.redirect.successor_branch_id, null)
    assert.deepEqual(askedNoSuccessor.body.redirect.targets, [{ id: 2, name: 'LC Store' }])
    assert.equal(ledgerSnapshot(w.db), before, 'nothing is written while the redirect is unconfirmed')
    // No active branch that can take it at all: refused outright, even with a named target.
    w.db.exec("UPDATE branches SET role='warehouse' WHERE id=2")
    for (const redirect of [null, 2]) {
      const refused = await setStatus(fresh.sales, w, cancelBody('cut-orphan-1'), w.saleId, redirect)
      assert.equal(refused.status, 409, JSON.stringify(refused.body))
      assert.equal(refused.body.code, 'branch_retired_no_successor')
    }
    assert.equal(ledgerSnapshot(w.db), before, 'nothing is written when no active selling branch exists')
    const d = await build('after')
    d.db.prepare('UPDATE sale_items SET damaged_lot_id = (SELECT 1) WHERE id = ?').run([d.lineId])
    const damaged = await setStatus(fresh.sales, d, cancelBody('cut-damaged-1'), d.saleId, 2)
    assert.equal(damaged.status, 409, JSON.stringify(damaged.body))
    assert.equal(damaged.body.code, 'branch_retired_damaged_stock')
    // A transition that moves no stock never blocks on the retired branch.
    const orphanPaid = await build('orphan')
    orphanPaid.db.prepare("UPDATE sales SET sale_status='awaiting_payment', amount_paid_usd=19, amount_paid_khr=0 WHERE id=?").run([orphanPaid.saleId])
    const noMove = await setStatus(fresh.sales, orphanPaid, { client_request_id: 'cut-nomove-1', sale_status: 'completed' })
    assert.notEqual(noMove.body.code, 'branch_retired_no_successor', 'awaiting_payment -> completed moves no stock, so it is not refused for the missing successor')
    assert.notEqual(noMove.body.code, 'branch_redirect_required', 'nor asked for a redirect')
  }
  console.log('PASS single status: a retired branch with no successor refuses before any write, a damaged line refuses, a no-stock transition is not blocked')

  // ---------------------------------------------------------------- single status: cancellation expense
  {
    const w = await build('after')
    assert.equal((await setStatus(fresh.sales, w, cancelBody('cut-fee-1', { cancel_fee_usd: 1.5, cancel_fee_note: 'courier already paid' }))).body.code, 'branch_redirect_required')
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM fees WHERE label LIKE 'Cancelled sale%'").get().n, 0, 'the unconfirmed cancel books no expense')
    const withFee = await setStatus(fresh.sales, w, cancelBody('cut-fee-1', { cancel_fee_usd: 1.5, cancel_fee_note: 'courier already paid' }), w.saleId, 2)
    assert.equal(withFee.status, 200, JSON.stringify(withFee.body))
    assert.deepEqual(plain(w.db.prepare("SELECT branch_id, branch_name, sale_id, amount_usd FROM fees WHERE label LIKE 'Cancelled sale%'").all()), [{ branch_id: 2, branch_name: 'LC Store', sale_id: w.saleId, amount_usd: 1.5 }],
      'the lost-fee expense is booked to LC Store (Old Shop has no drawer) and stays linked to the old Shop sale')
    const o = await build('after')
    const oldFee = await setStatus(old.sales, o, cancelBody('cut-fee-old', { cancel_fee_usd: 1.5 }))
    assert.equal(oldFee.status, 400, 'CONTROL: the old code refuses the expense because the sale branch is inactive')
    const revived = await setStatus(fresh.sales, w, reviveBody('cut-fee-revive'), w.saleId, 2)
    assert.equal(revived.status, 200, JSON.stringify(revived.body))
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM fees WHERE label LIKE 'Cancelled sale%'").get().n, 0, 'un-cancel removes the expense it created')
  }
  console.log('PASS single status: the cancellation expense of an old Shop sale is booked to LC Store and removed again by un-cancel')

  // ---------------------------------------------------------------- bulk status: cancel, undo, redo, replay
  {
    const w = await build('after')
    const before = stockOf(w.db)
    const req = bulkBody(w, 'cancelled', 'cut-bulk-1')
    const untouched = ledgerSnapshot(w.db)
    const asked = await call(fresh.sales, w.route, 'POST', '/bulk-status', req)
    assert.equal(asked.status, 409, JSON.stringify(asked.body))
    assert.equal(asked.body.code, 'branch_redirect_required', 'the group is refused until the redirect is confirmed')
    assert.equal(asked.body.redirect.successor_branch_id, 2)
    assert.deepEqual(asked.body.sale_ids, [w.saleId], 'and names the sale that needs it')
    assert.equal(ledgerSnapshot(w.db), untouched, 'the refused group writes nothing')
    const applied = await call(fresh.sales, w.route, 'POST', '/bulk-status', req, 2)
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    const after = { shop: 0, store: 15, lot500AtOld: 0, lot500AtStore: null, lot600AtStore: 15, product: 15 }
    assert.deepEqual(stockOf(w.db), after, 'bulk cancel lands at LC Store in the merged lot')
    assert.deepEqual(movementsOf(w.db, 'return'), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: 2, batch_id: 600 }])
    const settled = ledgerSnapshot(w.db)
    const again = await call(fresh.sales, w.route, 'POST', '/bulk-status', req, 2)
    assert.equal(again.status, 200)
    assert.equal(ledgerSnapshot(w.db), settled, 'the same bulk request id replays and writes nothing')
    const undone = await call(fresh.history, w.route, 'POST', `/${applied.body.actionHistoryId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.deepEqual(stockOf(w.db), before, 'undo reverses at the same branch and lot')
    const redone = await call(fresh.history, w.route, 'POST', `/${applied.body.actionHistoryId}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(redone.status, 200, JSON.stringify(redone.body))
    assert.deepEqual(stockOf(w.db), after, 'redo applies it again, once')
    const o = await build('after')
    const oldApplied = await call(old.sales, o.route, 'POST', '/bulk-status', bulkBody(o, 'cancelled', 'cut-bulk-old'))
    assert.equal(oldApplied.status, 200, JSON.stringify(oldApplied.body))
    assert.equal(stockOf(o.db).shop, 2, 'CONTROL: the old bulk path strands the units at Old Shop')
    // Grouped cancel with a cancellation expense: booked to LC Store, undone and redone with the status change.
    const withFee = await build('after')
    const feeReq = { ...bulkBody(withFee, 'cancelled', 'cut-bulk-fee'), cancel_reason: undefined,
      items: withFee.db.prepare('SELECT id, sale_status expected_status, updated_at expected_updated_at FROM sales ORDER BY id').all().map((i) => ({ ...i, cancel: { reason: 'mistake', fee_usd: 1.5 } })) }
    const feeApplied = await call(fresh.sales, withFee.route, 'POST', '/bulk-status', feeReq, 2)
    assert.equal(feeApplied.status, 200, JSON.stringify(feeApplied.body))
    const feeRows = () => plain(withFee.db.prepare("SELECT branch_id, branch_name, sale_id, amount_usd FROM fees WHERE label LIKE 'Cancelled sale%'").all())
    assert.deepEqual(feeRows(), [{ branch_id: 2, branch_name: 'LC Store', sale_id: withFee.saleId, amount_usd: 1.5 }], 'grouped cancel books the expense to LC Store too')
    const feeUndone = await call(fresh.history, withFee.route, 'POST', `/${feeApplied.body.actionHistoryId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(feeUndone.status, 200, JSON.stringify(feeUndone.body))
    assert.deepEqual(feeRows(), [], 'undo removes the expense')
    const feeRedone = await call(fresh.history, withFee.route, 'POST', `/${feeApplied.body.actionHistoryId}/redo`, { require_applied: true, expected_generation: 1 })
    assert.equal(feeRedone.status, 200, JSON.stringify(feeRedone.body))
    assert.deepEqual(feeRows(), [{ branch_id: 2, branch_name: 'LC Store', sale_id: withFee.saleId, amount_usd: 1.5 }], 'redo books it again, once')
    const orphan = await build('orphan')
    const orphanBefore = ledgerSnapshot(orphan.db)
    orphan.db.exec("UPDATE branches SET role='warehouse' WHERE id=2")
    const refused = await call(fresh.sales, orphan.route, 'POST', '/bulk-status', bulkBody(orphan, 'cancelled', 'cut-bulk-orphan'), 2)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'branch_retired_no_successor')
    assert.equal(ledgerSnapshot(orphan.db), orphanBefore, 'a retired branch with no successor writes nothing')
  }
  console.log('PASS bulk status: cancel lands at LC Store, undo/redo reverse and reapply exactly, replay writes nothing, no successor refuses, old code strands')

  // ---------------------------------------------------------------- amendments: decrease redirected, additions refused
  {
    const w = await build('after')
    const before = stockOf(w.db)
    const decAsked = await amend(fresh.sales, w, decreaseBody(w, 'cut-amend-dec'))
    assert.equal(decAsked.body.code, 'branch_redirect_required', 'a decrease asks where the unit goes back')
    const decreased = await amend(fresh.sales, w, decreaseBody(w, 'cut-amend-dec'), 2)
    assert.equal(decreased.status, 200, JSON.stringify(decreased.body))
    assert.deepEqual(stockOf(w.db), { ...before, store: before.store + 1, lot600AtStore: before.lot600AtStore + 1, product: before.product + 1 },
      'the unit taken off the sale returns to LC Store, in the merged lot')
    assert.deepEqual(movementsOf(w.db, 'return'), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: 1, batch_id: 600 }])
    assert.equal(w.db.prepare('SELECT quantity FROM sale_items WHERE id=?').get([w.lineId]).quantity, 1)
    assert.equal(w.db.prepare('SELECT branch_id FROM sale_items WHERE id=?').get([w.lineId]).branch_id, 1, 'the stored line keeps its own branch')
    const settled = ledgerSnapshot(w.db)
    const replayed = await call(fresh.sales, w.route, 'POST', `/${w.saleId}/amendments`, w.sent, 2)
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body))
    assert.equal(ledgerSnapshot(w.db), settled, 'a replayed amendment writes nothing')
    const o = await build('after')
    const oldDecreased = await amend(old.sales, o, decreaseBody(o, 'cut-amend-old'))
    assert.equal(oldDecreased.status, 400, 'CONTROL: the old code refuses every amendment of a sale at a retired branch')

    // CUTOVER-LR: an increase on an old Shop sale takes its unit at the confirmed branch; the stored line keeps the sale's branch.
    const add = await build('after')
    const addBefore = ledgerSnapshot(add.db)
    const increaseBody = { ...decreaseBody(add, 'cut-amend-inc'), kind: 'line_quantity_increased',
      pricing_quote: { gross_usd: 28.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 28.5, total_khr: 114000 } }
    const increaseAsked = await amend(fresh.sales, add, increaseBody)
    assert.equal(increaseAsked.status, 409, JSON.stringify(increaseAsked.body))
    assert.equal(increaseAsked.body.code, 'branch_redirect_required')
    assert.equal(ledgerSnapshot(add.db), addBefore, 'the unconfirmed increase writes nothing')
    const stockBeforeIncrease = stockOf(add.db)
    const increased = await amendQuoted(fresh.sales, add, increaseBody, 2)
    assert.equal(increased.status, 200, JSON.stringify(increased.body))
    assert.deepEqual(stockOf(add.db), { ...stockBeforeIncrease, store: stockBeforeIncrease.store - 1, lot600AtStore: stockBeforeIncrease.lot600AtStore - 1, product: stockBeforeIncrease.product - 1 },
      'the added unit comes off LC Store, from the lot that exists there now; Old Shop is untouched')
    assert.deepEqual(movementsOf(add.db, 'sale').slice(-1), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: -1, batch_id: 600 }],
      'the movement names where the unit really came from and the branch the sale was made under')
    assert.deepEqual(plain(add.db.prepare('SELECT branch_id, quantity FROM sale_items WHERE id=?').get([add.lineId])), { branch_id: 1, quantity: 3 }, 'the line keeps the sale branch')
    assert.deepEqual(plain(add.db.prepare('SELECT batch_id, branch_id, quantity FROM sale_item_batch_allocations WHERE sale_item_id=? ORDER BY id').all([add.lineId])),
      [{ batch_id: 500, branch_id: 1, quantity: 2 }, { batch_id: 600, branch_id: 2, quantity: 1 }], 'the new take is its own allocation row at the confirmed branch; the Shop take keeps its provenance')
    assert.deepEqual(plain(add.db.prepare('SELECT branch_id, branch_name FROM sales WHERE id=?').get([add.saleId])), { branch_id: 1, branch_name: 'Shop' }, 'the sale is never moved')

    // Add items to an old Shop sale: same rule, a new line under the sale's branch, stock at the confirmed branch.
    const addLine = await build('after')
    const addLineBefore = ledgerSnapshot(addLine.db)
    const addBody = { client_request_id: 'cut-add-1', money_precision_version: 1, expected_exchange_rate: 4000,
      items: [{ product_id: 10, quantity: 1, branch_id: 1, client_line_key: 'cut-add-line-1', pricing_source: 'selling',
        pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }] }
    const addAsked = await call(fresh.sales, addLine.route, 'POST', `/${addLine.saleId}/items`, addBody)
    assert.equal(addAsked.status, 409, JSON.stringify(addAsked.body))
    assert.equal(addAsked.body.code, 'branch_redirect_required')
    assert.equal(ledgerSnapshot(addLine.db), addLineBefore, 'the unconfirmed addition writes nothing')
    const addInvalid = await call(fresh.sales, addLine.route, 'POST', `/${addLine.saleId}/items`, addBody, 99)
    assert.equal(addInvalid.body.code, 'branch_redirect_target_invalid')
    const addStockBefore = stockOf(addLine.db)
    const added = await addQuoted(fresh.sales, addLine, addBody, 2)
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.deepEqual(stockOf(addLine.db), { ...addStockBefore, store: addStockBefore.store - 1, lot600AtStore: addStockBefore.lot600AtStore - 1, product: addStockBefore.product - 1 })
    const newLine = plain(addLine.db.prepare('SELECT id, branch_id, quantity FROM sale_items WHERE sale_id=? AND id<>? ORDER BY id').all([addLine.saleId, addLine.lineId]))
    assert.equal(newLine.length, 1)
    assert.deepEqual({ branch_id: newLine[0].branch_id, quantity: newLine[0].quantity }, { branch_id: 1, quantity: 1 }, 'the new line is recorded under the sale branch')
    assert.deepEqual(plain(addLine.db.prepare('SELECT batch_id, branch_id, quantity FROM sale_item_batch_allocations WHERE sale_item_id=?').all([newLine[0].id])), [{ batch_id: 600, branch_id: 2, quantity: 1 }])
    assert.deepEqual(movementsOf(addLine.db, 'sale').slice(-1), [{ branch_id: 2, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: -1, batch_id: 600 }])
    // Its Undo hands the unit back where it was taken (the reversal snapshot holds the confirmed branch), asking nothing.
    const historyId = addLine.db.prepare("SELECT id FROM action_history ORDER BY id DESC LIMIT 1").get().id
    const addUndone = await call(fresh.history, addLine.route, 'POST', `/${historyId}/undo`, { require_applied: true, expected_generation: 0 })
    assert.equal(addUndone.status, 200, JSON.stringify(addUndone.body))
    assert.deepEqual(stockOf(addLine.db), addStockBefore, 'undo of the redirected addition restores LC Store exactly')
  }
  console.log('PASS amendments and add-items: every change to an old Shop sale asks first; a confirmed decrease, increase and new line move stock at LC Store with Shop provenance; the sale and its lines keep their branch')

  // ---------------------------------------------------------------- inert while both branches are active
  {
    const scenarios = [
      ['single cancel', async (world, w) => setStatus(world, w, cancelBody('inert-cancel'))],
      // A stray X-Branch-Redirect while every branch is active is never read: same statements as the code before it existed.
      ['single cancel with a redirect header', async (world, w) => setStatus(world, w, cancelBody('inert-cancel-hdr'), w.saleId, 2)],
      ['add items with a redirect header', async (world, w) => addQuoted(world, w, { client_request_id: 'inert-add-hdr', money_precision_version: 1, expected_exchange_rate: 4000,
        items: [{ product_id: 10, quantity: 1, branch_id: 1, client_line_key: 'inert-add-line-hdr', pricing_source: 'selling',
          pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }] }, 2)],
      ['single cancel with expense', async (world, w) => setStatus(world, w, cancelBody('inert-cancel-fee', { cancel_fee_usd: 1 }))],
      ['bulk cancel', async (world, w) => call(world, w.route, 'POST', '/bulk-status', bulkBody(w, 'cancelled', 'inert-bulk'))],
      ['bulk cancel with expense', async (world, w) => call(world, w.route, 'POST', '/bulk-status', {
        ...bulkBody(w, 'cancelled', 'inert-bulk-fee'), items: w.db.prepare('SELECT id, sale_status expected_status, updated_at expected_updated_at FROM sales ORDER BY id').all().map((i) => ({ ...i, cancel: { reason: 'mistake', fee_usd: 1 } })), cancel_reason: undefined })],
      ['amend decrease', async (world, w) => amend(world, w, decreaseBody(w, 'inert-amend'))],
      ['amend increase', async (world, w) => amendQuoted(world, w, { ...decreaseBody(w, 'inert-amend-inc'), kind: 'line_quantity_increased',
        pricing_quote: { gross_usd: 28.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 28.5, total_khr: 114000 } })],
      ['add items', async (world, w) => addQuoted(world, w, { client_request_id: 'inert-add', money_precision_version: 1, expected_exchange_rate: 4000,
        items: [{ product_id: 10, quantity: 1, branch_id: 1, client_line_key: 'inert-add-line', pricing_source: 'selling',
          pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }] })],
    ]
    for (const [name, run] of scenarios) {
      const newCapture = []; const oldCapture = []
      const a = await build('before', newCapture); const b = await build('before', oldCapture)
      const x = await run(fresh.sales, a); const y = await run(/expense/.test(name) ? beforeFees.sales : old.sales, b)
      assert.equal(x.status, y.status, `${name}: same status (${JSON.stringify(x.body)} vs ${JSON.stringify(y.body)})`)
      assert.equal(x.status, 200, `${name}: ${JSON.stringify(x.body)}`)
      const statementsA = normalised(newCapture); const statementsB = normalised(oldCapture)
      let where = 0
      while (where < statementsA.length && statementsA[where] === statementsB[where]) where++
      assert.equal(statementsA === statementsB, true, `${name}: byte-identical statements while both branches are active; first difference near: ${statementsA.slice(Math.max(0, where - 150), where + 150)} <> ${statementsB.slice(Math.max(0, where - 150), where + 150)}`)
      const ledgerA = scrub(ledgerSnapshot(a.db)); const ledgerB = scrub(ledgerSnapshot(b.db))
      let at = 0
      while (at < ledgerA.length && ledgerA[at] === ledgerB[at]) at++
      assert.equal(ledgerA === ledgerB, true, `${name}: identical resulting ledgers; first difference near: ${ledgerA.slice(Math.max(0, at - 100), at + 100)} <> ${ledgerB.slice(Math.max(0, at - 100), at + 100)}`)
      assert.equal(a.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE addressed_branch_name IS NOT NULL").get().n, 0, `${name}: no provenance column is written`)
    }
  }
  console.log('PASS both branches active: cancel / bulk cancel / expense / amendment write byte-identical statements and ledgers to the code before this change')

  // ---------------------------------------------------------------- roles set, names unchanged, both active: still inert
  {
    const a = await build('before')
    a.db.exec("UPDATE branches SET role='shop', canonical_key='shop' WHERE id=1; UPDATE branches SET role='warehouse', canonical_key='warehouse' WHERE id=2")
    const cancelled = await setStatus(fresh.sales, a, cancelBody('roles-cancel'))
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    assert.deepEqual(movementsOf(a.db, 'return'), [{ branch_id: 1, branch_name: null, addressed_branch_name: null, quantity: 2, batch_id: 500 }], 'an active branch restocks itself, in its own lot, with no provenance label')
  }
  console.log('PASS both branches active with roles set (0229 done): the sale restocks its own branch and lot, unlabelled')
})().catch((error) => { console.error(error); process.exit(1) })
