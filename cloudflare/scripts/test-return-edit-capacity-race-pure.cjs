const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')
const { Hono } = require('hono')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

const root = path.resolve(__dirname, '..')
const sourceRoot = path.join(root, 'src')
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7) || 'all'
assert.ok(['all', 'duplicate', 'race', 'employee', 'controls'].includes(selectedCase), 'unknown --case')
const modules = new Map()
const notificationStubs = {
  'lib/cache.ts': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  'durable-objects/broadcastHub.ts': { broadcast: async () => {} },
  'lib/telegram.ts': {
    sendReturnTelegramEvent: async () => {}, sendReturnStatusTelegramEvents: async () => {}, sendTelegramEvent: async () => {},
    formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [],
  },
}

function routeSource() {
  let source = (process.env.CPB2_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.CPB2_SOURCE_REF}:cloudflare/src/routes/returns.ts`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(sourceRoot, 'routes/returns.ts'), 'utf8')).replace(/\r\n/g, '\n')
  const mutant = process.env.CPB2_MUTANT
  if (mutant === 'early-only') {
    const aggregate = `    try {
      assertReturnCreateCapacity(soldLines, siblingLines, proposedLines)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
`
    assert.equal(source.split(aggregate).length, 2, 'aggregate mutant anchor must occur once')
    source = source.replace(aggregate, '')
  } else if (mutant === 'aggregate-only') {
    const start = source.indexOf('  type LinkedSaleState = {', source.indexOf("app.patch('/:id'"))
    const end = source.indexOf('  // The sale decides here too.', start)
    assert.ok(start > 0 && end > start, 'early revision mutant anchor missing')
    const capture = source.slice(start, end)
    source = source.slice(0, start) + source.slice(end)
    source = source.replace('if (Number(linkedSale?.money_precision_version) === 1)', 'if ((await saleMoneyPrecisionVersion(db, existing.sale_id)) === 1)')
    const anchor = '  let projectedSaleStatus: string | null = null\n'
    assert.equal(source.split(anchor).length, 2, 'late revision mutant anchor must occur once')
    source = source.replace(anchor, capture + anchor)
  } else assert.equal(mutant, undefined, 'unknown CPB2_MUTANT')
  return source
}

function load(file) {
  const rel = path.relative(sourceRoot, file).replace(/\\/g, '/')
  if (notificationStubs[rel]) return notificationStubs[rel]
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }
  modules.set(file, mod)
  const source = rel === 'routes/returns.ts' ? routeSource() : fs.readFileSync(file, 'utf8')
  const output = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: file }).code
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name)
    const target = path.resolve(path.dirname(file), name)
    return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts'))
  }
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, mod, mod.exports, file, path.dirname(file))
  return mod.exports
}

const app = new Hono()
app.route('/api/returns', load(path.join(sourceRoot, 'routes/returns.ts')).default)
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()
const effectTables = ['sales', 'sale_items', 'returns', 'return_items', 'return_replacement_items', 'products', 'product_batches',
  'branch_stock', 'branch_batch_stock', 'sale_item_batch_allocations', 'return_item_batch_allocations', 'damaged_stock_lots',
  'fees', 'inventory_movements', 'undo_snapshots', 'action_history', 'sale_record_events', 'sale_write_revisions',
  'return_write_revisions', 'return_mutation_receipts', 'return_bulk_operations', 'return_bulk_members',
  'sale_bulk_guards', 'return_bulk_guards', 'audit_logs', 'system_flags']

function fixture({ sold = 3, sibling = null } = {}) {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const name of migrations) sql.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
  const now = new Date().toISOString()
  for (const [id, permissions, code] of [[901, { all: true }, 'admin'], [902, { returns: true }, 'employee'],
    [903, { returns: true, 'returns:edit': false }, 'employee-denied'], [904, { returns: 'review' }, 'employee-review']]) {
    sql.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(?,?,?,?)').run(id, code, code, JSON.stringify(permissions))
    sql.prepare('INSERT INTO users(id,username,name,password,role_id,permissions) VALUES(?,?,?,?,?,?)').run(id, `cpb2-${id}`, code, 'fixture-only', id, '{}')
    sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)')
      .run(id, createHash('sha256').update(`cpb2-token-${id}`).digest('hex'), now, now, '2099-01-01T00:00:00.000Z')
  }
  sql.exec(`INSERT INTO branches(id,name) VALUES(901,'Shop');
    INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr) VALUES(901,'A',21,2,8000);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(901,901,21);
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(901,901,'original-lot','2026-10-01',1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(901,901,1);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,branch_id,money_precision_version,updated_at)
      VALUES(901,'CPB2-SALE','partial_return','completed',901,0,'sale-before');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr)
      VALUES(901,901,901,'A',${sold},901,901,5,20000,2,8000);
    INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(901,901,901,901,${sold},0);
    INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,status,return_scope,money_precision_version,updated_at)
      VALUES(901,'CPB2-RETURN',901,901,'Shop','Original',5,20000,'completed','customer',0,'return-before');
    INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,branch_id,batch_id,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,return_to_stock,stock_action)
      VALUES(901,901,901,901,'A',1,901,901,5,20000,2,8000,5,20000,1,'restock');
    INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(901,901,901,901,1);`)
  if (sibling) {
    sql.prepare(`INSERT INTO returns(id,return_number,sale_id,branch_id,status,return_scope,updated_at)
      VALUES(902,'CPB2-SIBLING',901,901,?,?,?)`).run(sibling.status || 'completed', sibling.scope || 'customer', 'sibling-before')
    sql.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,branch_id,cost_price_usd,cost_price_khr,return_to_stock,stock_action)
      VALUES(902,?,901,'A',?,901,2,8000,0,'none')`).run(sibling.direct ? 901 : null, sibling.quantity)
  }
  let afterRead = null, beforeBatch = null, failSql = null, loseAck = false, batches = 0
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return { text, params,
          async all() {
            const results = sqliteD1Call(sql.prepare(text), 'all', params)
            if (afterRead?.match(text)) { const hook = afterRead; afterRead = null; await hook.run() }
            return { results, meta: {} }
          },
          async run() {
            const result = sqliteD1Call(sql.prepare(text), 'run', params)
            return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
          },
        }
      } }
    },
    async batch(statements) {
      batches++
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook() }
      const result = sql.transaction(() => statements.map(statement => {
        if (failSql && statement.text.includes(failSql)) throw new Error('injected fixture failure')
        const result = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
      if (loseAck) { loseAck = false; throw new Error('injected lost acknowledgement') }
      return result
    },
  } }
  const snapshot = () => JSON.stringify(effectTables.map(table => [table, sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  const call = async (body, { actor = 901, method = 'PATCH' } = {}) => {
    const pending = []
    const response = await app.request('/api/returns/901', { method,
      headers: { 'content-type': 'application/json', cookie: `bos_session=cpb2-token-${actor}` },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }, env, { waitUntil(promise) { pending.push(promise) }, passThroughOnException() {} })
    const payload = await response.json()
    await Promise.all(pending)
    return { status: response.status, body: payload }
  }
  return { sql, call, snapshot, close: () => sql.close(), batches: () => batches,
    afterRead(match, run) { afterRead = { match, run } }, beforeBatch(run) { beforeBatch = run },
    fail(text) { failSql = text }, loseAck() { loseAck = true },
  }
}

const line = (quantity, extra = {}) => ({ sale_item_id: 901, product_id: 901, product_name: 'A', branch_id: 901,
  quantity, cost_price_usd: 2, cost_price_khr: 8000, stock_action: 'restock', ...extra })
const edit = (items, extra = {}) => ({ client_request_id: 'cpb2-edit-request-0001', expected_updated_at: 'return-before', items, notes: 'Edited', ...extra })
async function withFixture(options, run) { const f = fixture(options); try { await run(f) } finally { f.close() } }

async function duplicates() {
  for (const [label, items, sibling] of [
    ['duplicate exact sale item', [line(2), line(2)], null],
    ['duplicate product fallback', [line(2, { sale_item_id: null }), line(2, { sale_item_id: null })], null],
    ['mixed exact and fallback', [line(2), line(1, { sale_item_id: null })], null],
    ['active fallback sibling shares direct capacity', [line(2)], { quantity: 1 }],
  ]) await withFixture({ sold: 2, sibling }, async f => {
    const before = f.snapshot()
    const result = await f.call(edit(items))
    assert.equal(result.status, 400, `${label}: ${JSON.stringify(result)}`)
    assert.equal(f.snapshot(), before, `${label} must write nothing`)
    assert.equal(f.batches(), 0, 'capacity refusal must happen before a write batch')
  })
  console.log('PASS duplicate/direct/fallback projected cohort overflow writes nothing')
}

async function races() {
  await withFixture({}, async f => {
    let afterCompetitor = null
    const revision = f.sql.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=901').get().revision
    f.afterRead(text => /SELECT id,product_id,applied_price_usd,applied_price_khr FROM sale_items WHERE sale_id=/.test(text), () => {
      f.sql.exec('UPDATE sale_items SET applied_price_usd=7,applied_price_khr=28000 WHERE id=901')
      assert.ok(f.sql.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=901').get().revision > revision)
      afterCompetitor = f.snapshot()
    })
    const result = await f.call(edit([line(2)]))
    assert.ok(afterCompetitor, 'price race must fire after the original price rows are copied')
    assert.equal(result.status, 409, `stale original price must refuse: ${JSON.stringify(result)}`)
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(f.snapshot(), afterCompetitor, 'refusal must preserve the competing writer and write no edit effects')
    assert.equal(f.batches(), 1, 'price race reaches the revision-fenced batch')
  })
  for (const table of ['sales', 'returns']) await withFixture({}, async f => {
    let afterCompetitor
    f.beforeBatch(() => { f.sql.exec(`UPDATE ${table} SET notes='Competing write' WHERE id=901`); afterCompetitor = f.snapshot() })
    const result = await f.call(edit([line(2)]))
    assert.equal(result.status, 409, `${table} commit race: ${JSON.stringify(result)}`)
    assert.equal(f.snapshot(), afterCompetitor, `${table} fence must roll back every planned effect`)
  })
  console.log('PASS copied-price race and parent/return commit races preserve competing effects')
}

async function employee() {
  await withFixture({}, async f => {
    const input = edit([line(2, { cost_price_usd: undefined, cost_price_khr: undefined })])
    const saved = await f.call(input, { actor: 902 })
    assert.equal(saved.status, 200, `employee exact sale item with omitted costs: ${JSON.stringify(saved)}`)
    const item = f.sql.prepare('SELECT sale_item_id,cost_price_usd,cost_price_khr FROM return_items WHERE return_id=901').get()
    assert.deepEqual(item, { sale_item_id: 901, cost_price_usd: 2, cost_price_khr: 8000 })
    const applied = f.snapshot()
    assert.deepEqual(await f.call(input, { actor: 902 }), saved, 'employee exact retry uses its actor receipt')
    assert.equal(f.snapshot(), applied)
    const detail = await f.call(null, { actor: 902, method: 'GET' })
    assert.equal(detail.status, 200)
    assert.ok(detail.body.items.every(item => !('cost_price_usd' in item) && !('cost_price_khr' in item)))
    const override = edit([line(2)], { client_request_id: 'cpb2-employee-override-0001', expected_updated_at: saved.body.updated_at })
    const refused = await f.call(override, { actor: 902 })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.code, 'product_cost_edit_required')
    assert.equal(f.snapshot(), applied, 'employee cost override must leave the permitted edit intact')
  })
  console.log('PASS real employee exact-line edit retains omitted costs, redacts reads, rejects explicit cost overrides')
}

async function controls() {
  await withFixture({ sibling: { quantity: 1 } }, async f => {
    const input = edit([line(1), line(1)])
    const result = await f.call(input)
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(f.sql.prepare('SELECT SUM(quantity) n FROM return_items WHERE return_id=901').get().n, 2)
    assert.equal(f.sql.prepare('SELECT total_refund_usd n FROM returns WHERE id=901').get().n, 10)
    assert.equal(f.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=901 AND branch_id=901').get().n, 22)
    assert.equal(f.sql.prepare('SELECT quantity n FROM branch_batch_stock WHERE batch_id=901 AND branch_id=901').get().n, 2)
    assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=901').get().sale_status, 'returned')
    for (const table of ['sale_record_events', 'return_mutation_receipts', 'audit_logs']) assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1, table)
    const applied = f.snapshot()
    assert.deepEqual(await f.call(input), result, 'exact retry returns the durable response')
    assert.equal(f.snapshot(), applied)
    assert.equal((await f.call({ ...input, notes: 'Different payload' })).body.code, 'idempotency_conflict')
    assert.equal(f.snapshot(), applied)
    assert.equal(f.batches(), 1)
  })
  for (const sibling of [{ quantity: 99, status: 'cancelled' }, { quantity: 99, scope: 'supplier' }]) await withFixture({ sold: 2, sibling }, async f => {
    assert.equal((await f.call(edit([line(2)]))).status, 200, 'inactive/non-customer siblings consume no customer entitlement')
  })
  await withFixture({}, async f => {
    const input = edit([line(2, { sale_item_id: null, cost_price_usd: undefined, cost_price_khr: undefined, batch_id: 901 })])
    assert.equal((await f.call(input, { actor: 902 })).status, 200, 'real employee role permits edit with omitted costs')
    const item = f.sql.prepare('SELECT cost_price_usd,cost_price_khr FROM return_items WHERE return_id=901').get()
    assert.deepEqual(item, { cost_price_usd: 2, cost_price_khr: 8000 })
    const detail = await f.call(null, { actor: 902, method: 'GET' })
    assert.equal(detail.status, 200)
    assert.ok(detail.body.items.every(item => !('cost_price_usd' in item) && !('cost_price_khr' in item)), 'actual response middleware redacts costs')
  })
  for (const actor of [903, 904]) await withFixture({}, async f => {
    const before = f.snapshot()
    assert.equal((await f.call(edit([line(2)]), { actor })).status, 403)
    assert.equal(f.snapshot(), before, 'actual action/review permissions must deny without effects')
  })
  await withFixture({}, async f => {
    const before = f.snapshot()
    const result = await f.call(edit([line(2)]), { actor: 902 })
    assert.equal(result.status, 403)
    assert.equal(result.body.code, 'product_cost_edit_required')
    assert.equal(f.snapshot(), before)
  })
  for (const [change, status, code] of [
    ["UPDATE returns SET money_precision_version=1,calculated_refund_usd=5 WHERE id=901", 409, 'customer_return_edit_v1_not_supported'],
    ["UPDATE sales SET money_precision_version=1,calculated_total_usd=0 WHERE id=901", 409, 'money_precision_review_needed'],
    ["UPDATE returns SET status='cancelled' WHERE id=901", 409, 'return_edit_cancelled'],
    ["UPDATE returns SET return_scope='supplier' WHERE id=901", 400, undefined],
  ]) await withFixture({}, async f => {
    f.sql.exec(change)
    const before = f.snapshot()
    const result = await f.call(edit([line(2)]))
    assert.equal(result.status, status, JSON.stringify(result))
    if (code) assert.equal(result.body.code, code)
    assert.equal(f.snapshot(), before)
  })
  await withFixture({}, async f => {
    const input = edit([line(2)])
    const before = f.snapshot()
    f.fail('INSERT INTO return_mutation_receipts')
    assert.equal((await f.call(input)).status, 500)
    assert.equal(f.snapshot(), before, 'storage failure must roll back stock, lines, status, events and receipt')
    f.fail(null)
    assert.equal((await f.call(input)).status, 200)
  })
  await withFixture({}, async f => {
    const input = edit([line(2)])
    f.loseAck()
    const result = await f.call(input)
    assert.equal(result.status, 200, 'uncertain acknowledgement is recovered from the committed receipt')
    const applied = f.snapshot()
    assert.deepEqual(await f.call(input), result)
    assert.equal(f.snapshot(), applied)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM return_mutation_receipts').get().n, 1)
    assert.equal(f.batches(), 1)
  })
  console.log('PASS boundary quantities/stock/refund/status, receipts/retry, real permissions/cost redaction, held edits and atomic failures')
}

async function main() {
  if (selectedCase === 'all' || selectedCase === 'duplicate') await duplicates()
  if (selectedCase === 'all' || selectedCase === 'race') await races()
  if (selectedCase === 'all' || selectedCase === 'employee') await employee()
  if (selectedCase === 'all' || selectedCase === 'controls') await controls()
  console.log(`PASS return edit integrity: ${migrations.length} real migrations; actual Hono/auth/D1Compat/guards/audit; source=${process.env.CPB2_SOURCE_REF || 'worktree'}; mutant=${process.env.CPB2_MUTANT || 'none'}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
