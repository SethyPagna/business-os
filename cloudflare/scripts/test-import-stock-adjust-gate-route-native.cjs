// Security follow-up B (release review a77883c78, should-fix 6). Inventory and stock-actions imports ignored the
// "adjust stock" permission: their gates asked for inventory (Full) plus inventory:import, never inventory:adjust, so a
// role with adjust switched off and import on could still add, remove or set stock by file. 6.0.910 closed the same
// hole for a products import (test-import-stock-gate-pure.cjs); this extends that one gate -- productImportChangesStock,
// PRODUCT_IMPORT_STOCK_REFUSAL, allowProductStockWrites -- to the other two stock-moving import types, at the same three
// boundaries, on the REAL Hono routes and the REAL importEngine over a migrated database (node:sqlite). Only the edges
// (session, audit sink, cache, broadcast, image queue) are stubbed. Cases for each of inventory and stock_actions:
//   approve  -- a file that moves stock, approved by a caller without inventory:adjust       -> 403, nothing queued;
//   retry    -- the same file re-applied by that caller                                       -> 403, approver not re-stamped;
//   apply    -- approved by an adjuster who then loses the grant while it waits               -> refused, nothing written;
//   apply    -- already approved (before the rule) by a caller without the grant              -> refused, nothing written;
//   controls -- an adjuster and the admin complete the same file; a file that moves no stock is not refused for a caller
//               without the grant (the gate is about stock, not about the import type).
// Run with --base to load importEngine.ts / importJobs.ts exactly as a77883c78 had them: the refusal cases go red.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '..', 'src')
const BASE = process.argv.includes('--base') ? 'a77883c78' : null

// ---------------------------------------------------------------- loader ----
const transpiled = new Map()
function makeWorld() {
  const cache = new Map()
  const rel = file => path.relative(SRC, file).replaceAll('\\', '/')
  const requireAuth = async (c, next) => {
    const user = c.env.DB.prepare(`SELECT u.id,u.username,u.name,u.organization_id,u.role_id,u.permissions,u.is_active,
        r.code AS role_code,r.permissions AS role_permissions,r.name AS role_name
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=@id`).get({ id: Number(c.req.header('x-test-user')) })
    if (!user) return c.json({ success: false, error: 'Unauthorized' }, 401)
    c.set('user', user)
    return next()
  }
  const fence = () => ({ getImportFencedDb: async env => env.DB, isImportMaintenanceFenceError: () => false })
  const stubs = {
    'lib/db': () => ({ getDb: env => env.DB, ...fence() }),
    'lib/importMaintenanceFence': fence,
    'lib/auth': () => ({ requireAuth }),
    'lib/audit': () => ({ audit: async () => {} }),
    'lib/cache': () => ({ bumpVersion: async () => {}, bumpVersions: async () => {} }),
    'durable-objects/broadcastHub': () => ({ broadcast: async () => {} }),
    'lib/imageAudit': () => ({ enqueueImageNormalization: async () => {} }),
  }
  function source(file) {
    if (BASE && ['lib/importEngine.ts', 'routes/importJobs.ts'].includes(rel(file))) {
      return require('node:child_process').execFileSync('git', ['show', `${BASE}:cloudflare/src/${rel(file)}`],
        { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    }
    return fs.readFileSync(file, 'utf8')
  }
  function load(file) {
    const key = rel(file)
    if (cache.has(key)) return cache.get(key).exports
    const mod = { exports: {} }
    cache.set(key, mod)
    const stub = stubs[key.replace(/\.ts$/, '')]
    if (stub) { mod.exports = stub(); return mod.exports }
    const text = source(file)
    if (!transpiled.has(text)) {
      transpiled.set(text, ts.transpileModule(text, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
      }).outputText)
    }
    const shim = id => {
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(file), id)
        for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return load(candidate)
      }
      return require(id)
    }
    new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled.get(text))(mod.exports, shim, mod, file, path.dirname(file))
    return mod.exports
  }
  return {
    engine: load(path.join(SRC, 'lib', 'importEngine.ts')),
    routes: load(path.join(SRC, 'routes', 'importJobs.ts')),
  }
}

// ---------------------------------------------------------------- fixture ---
let template
let tmp
function prepareTemplate() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-stock-adjust-gate-'))
  template = path.join(tmp, 'template.sqlite')
  const raw = new DatabaseSync(template)
  raw.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) raw.exec(sql)
  raw.close()
}
let copies = 0
const opened = []
function openCase() {
  const file = path.join(tmp, `case-${copies++}.sqlite`)
  fs.copyFileSync(template, file)
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA foreign_keys = OFF;')
  sqlite.limits.exprDepth = 100
  opened.push(sqlite)
  return new D1Compat(sqlite)
}

// Every import type here is an acquisition-cost format (cost view + entry), and a stock-actions file also needs products
// and sales. The ONLY difference between the actors is inventory:adjust.
const IMPORTER = { inventory: true, products: true, sales: true, product_cost_view: true, product_cost_edit: true }
const ACTORS = {
  noAdjust: { id: 91, grants: { ...IMPORTER, 'inventory:adjust': false } },
  adjuster: { id: 92, grants: { ...IMPORTER } },
  admin: { id: 95, grants: {}, role: 98 },
}
const JOBS = {
  // One Add row: 3 units of Serum into the default branch.
  inventory: { policy: { inventory_action: 'add' }, row: { _rowNumber: 2, barcode: 'SER-1', quantity: '3', unit_cost_usd: '2' }, quiet: { _rowNumber: 2, barcode: 'SER-1', quantity: '0', unit_cost_usd: '2' } },
  stock_actions: { policy: { stock_action_mode: 'direct' }, row: { _rowNumber: 2, name: 'Serum', barcode: 'SER-1', shop: '3', date: '2026-01-01', action: 'add', cost_price: '2', supplier: 'Supplier', batch: 'B1' }, quiet: null },
}

function fixture(world) {
  const raw = openCase()
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql)
      return { get: p => st.get(p), all: p => st.all(p), run: async p => {
        const r = st.run(p)
        return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) }
      } }
    },
    batch: items => raw.batch(items), batchOnce: items => db.batch(items), staging: null,
  }
  db.staging = db
  raw.prepare("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(991,'Probe','shop','shop',1,1)").run()
  raw.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(98,'Administrator','admin','{}',1)").run()
  for (const [name, actor] of Object.entries(ACTORS)) {
    raw.prepare('INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(@id,@name,@name,\'hash\',@role,@permissions,1)')
      .run({ id: actor.id, name, role: actor.role ?? null, permissions: JSON.stringify(actor.grants) })
  }
  seedStockFixture(raw, () => {
    raw.prepare("INSERT INTO products(id,name,name_normalized,barcode,stock_quantity,is_active,selling_price_usd,cost_price_usd) VALUES(1,'Serum','serum','SER-1',0,1,5,2)").run()
    raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,991,0)').run()
  })
  const pending = []
  const env = {
    DB: db,
    ASSETS: { list: async () => ({ objects: [], truncated: false }), delete: async () => {} },
    IMPORT_QUEUE: { send: async message => { pending.push(message) } },
  }
  const f = { raw, db, env, pending }
  f.setGrants = (actor, grants) => raw.prepare('UPDATE users SET permissions=@grants WHERE id=@id').run({ id: actor.id, grants: JSON.stringify(grants) })
  f.seedJob = ({ id = 'job', type, row, status = 'queued', authorizedBy } = {}) => {
    const spec = JOBS[type]
    const policy = { ...spec.policy, ...(authorizedBy ? { apply_authorized_by_id: authorizedBy.id } : {}) }
    raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
      VALUES(@id,@type,@status,@status,@policy,1,0,'{}','2000-06-01')`).run({ id, type, status, policy: JSON.stringify(policy) })
    raw.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(@id,0,2,@row)').run({ id, row: JSON.stringify(row ?? spec.row) })
    return id
  }
  f.job = id => raw.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id })
  f.stock = () => Number(raw.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock WHERE product_id=1').get().n)
  f.business = () => JSON.stringify(['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'sales', 'sale_items']
    .map(t => raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
  f.snapshot = () => JSON.stringify([f.business(), raw.prepare('SELECT * FROM import_jobs ORDER BY id').all()])
  f.call = async (actor, method, url, body) => {
    const response = await world.routes.default.request('http://local.test' + url, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': String(actor.id) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env)
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* non-JSON body is reported through the status */ }
    return { status: response.status, body: json, text }
  }
  // Exactly what the real queue consumer runs: analyze or apply per message.
  f.drain = async () => {
    for (let n = 0; pending.length && n < 40; n++) {
      const message = pending.shift()
      await (message.kind === 'analyze' ? world.engine.runImportAnalyze(env, message.jobId) : world.engine.runImportApply(env, message.jobId))
    }
  }
  // Analyze for real, so the approval gate reads what analysis persisted rather than a hand-made plan.
  f.analyzed = async (options) => {
    const id = f.seedJob(options)
    pending.push({ jobId: id, kind: 'analyze' })
    await f.drain()
    assert.equal(f.job(id).status, 'awaiting_review', `analysis finished: ${f.job(id).status} ${f.job(id).last_error}`)
    return id
  }
  return f
}

function assertStockRefusal(result) {
  assert.equal(result.status, 403, `expected 403, got ${result.status}: ${result.text}`)
  assert.equal(result.body.code, 'product_import_stock_adjust_required', result.text)
  assert.equal(result.body.success, false)
}

// ------------------------------------------------------------------ cases ---
const cases = []
const add = (type, boundary, label, fn) => cases.push({ name: `${type}/${boundary}${label ? `/${label}` : ''}`, type, boundary, fn })

for (const type of Object.keys(JOBS)) {
  add(type, 'approve', 'caller-without-adjust', async world => {
    const f = fixture(world)
    const id = await f.analyzed({ type })
    const before = f.snapshot()
    assertStockRefusal(await f.call(ACTORS.noAdjust, 'POST', `/${id}/approve`, { confirm_stock_actions: true }))
    assert.equal(f.snapshot(), before, 'a refused approval leaves the job and the stock untouched')
    assert.equal(f.pending.length, 0, 'a refused approval queues nothing')
    assert.equal(f.job(id).status, 'awaiting_review')
  })

  add(type, 'retry', 'caller-without-adjust', async world => {
    const f = fixture(world)
    // Approved earlier by someone who held the grant, then stalled: the retry re-stamps the approver.
    const id = await f.analyzed({ type })
    assert.equal((await f.call(ACTORS.adjuster, 'POST', `/${id}/approve`, { confirm_stock_actions: true })).status, 200)
    f.pending.length = 0 // the queued apply was lost: the job sits 'approved'
    const before = f.snapshot()
    assertStockRefusal(await f.call(ACTORS.noAdjust, 'POST', `/${id}/retry`, {}))
    assert.equal(f.snapshot(), before, 'a refused retry does not re-stamp the approver or change the job')
    assert.equal(f.pending.length, 0, 'a refused retry queues nothing')
    assert.equal(JSON.parse(f.job(id).policy_json).apply_authorized_by_id, ACTORS.adjuster.id)
  })

  add(type, 'apply', 'revoked-after-queue', async world => {
    const f = fixture(world)
    const id = await f.analyzed({ type })
    assert.equal((await f.call(ACTORS.adjuster, 'POST', `/${id}/approve`, { confirm_stock_actions: true })).status, 200)
    assert.ok(f.pending.length >= 1, 'the authorized approval queued the apply')
    f.setGrants(ACTORS.adjuster, { ...IMPORTER, 'inventory:adjust': false })
    const before = f.business()
    await assert.rejects(() => f.drain(), error => {
      assert.equal(error.code, 'import_apply_permission_revoked', error.stack)
      assert.equal(error.permission, 'inventory:adjust')
      return true
    })
    assert.equal(f.stock(), 0, 'no stock moved')
    assert.equal(f.business(), before, 'no product, stock, lot, movement or sale row changed')
    assert.equal(f.job(id).status, 'failed')
    assert.ok(String(f.job(id).last_error).includes('adjust stock'), f.job(id).last_error)
  })

  add(type, 'apply', 'approved-before-the-rule-by-a-caller-without-adjust', async world => {
    const f = fixture(world)
    // A job already approved by a user who never held the grant (approved before this rule existed).
    const id = await f.analyzed({ type })
    f.raw.prepare("UPDATE import_jobs SET status='approved',phase='approved',policy_json=json_set(policy_json,'$.apply_authorized_by_id',@actor) WHERE id=@id").run({ id, actor: ACTORS.noAdjust.id })
    f.pending.push({ jobId: id, kind: 'apply' })
    const before = f.business()
    await assert.rejects(() => f.drain(), error => error.code === 'import_apply_permission_revoked' && error.permission === 'inventory:adjust')
    assert.equal(f.stock(), 0)
    assert.equal(f.business(), before)
    assert.equal(f.job(id).status, 'failed')
  })

  for (const [label, actor] of [['adjuster', ACTORS.adjuster], ['admin', ACTORS.admin]]) {
    add(type, 'control', `${label}-completes`, async world => {
      const f = fixture(world)
      const id = await f.analyzed({ type })
      const approved = await f.call(actor, 'POST', `/${id}/approve`, { confirm_stock_actions: true })
      assert.equal(approved.status, 200, approved.text)
      await f.drain()
      assert.match(f.job(id).status, /^completed/, `${f.job(id).status}: ${f.job(id).last_error}`)
      assert.equal(f.stock(), 3, 'the three units landed')
    })
  }

  if (JOBS[type].quiet) {
    add(type, 'control', 'a-file-that-moves-no-stock-is-not-refused', async world => {
      const f = fixture(world)
      const id = await f.analyzed({ type, row: JOBS[type].quiet })
      const approved = await f.call(ACTORS.noAdjust, 'POST', `/${id}/approve`, { confirm_stock_actions: true })
      assert.equal(approved.status, 200, approved.text)
      await f.drain()
      assert.match(f.job(id).status, /^completed/, `${f.job(id).status}: ${f.job(id).last_error}`)
      assert.equal(f.stock(), 0)
    })
  }
}

// The same one-definition table, exercised directly: which classified rows count as a stock change.
add('helper', 'definition', 'rows-that-move-stock', async world => {
  const { importResultsChangeStock, isStockAdjustImportType } = world.engine
  assert.equal(typeof importResultsChangeStock, 'function', 'importEngine exports the shared stock-change predicate')
  const none = { prepare() { throw new Error('no read expected') } }
  const row = (action, data) => ({ rowNumber: 2, action, existingId: 1, changes: {}, data })
  const plan = (kind, ...actions) => ({ kind, saleGroupKey: null, conflicts: [], branchActions: actions.map(([direction, quantity]) => ({ branchId: 991, direction, quantity })) })
  assert.deepEqual(['products', 'inventory', 'stock_actions', 'sales', 'customers'].map(isStockAdjustImportType), [true, true, true, false, false])
  assert.equal(await importResultsChangeStock(none, 'inventory', [row('create', { quantity: 3 })], null), true)
  assert.equal(await importResultsChangeStock(none, 'inventory', [row('update', { quantity: 3 })], null), true)
  assert.equal(await importResultsChangeStock(none, 'inventory', [row('skip', { quantity: 3 }), row('error', { quantity: 3 })], null), false, 'skipped and refused rows move nothing')
  assert.equal(await importResultsChangeStock(none, 'inventory', [row('create', { quantity: 0 })], null), false)
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('update', { plan: plan('add', ['add', 3]) })], null), true)
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('create', { plan: plan('create', ['add', 2]) })], null), true, 'a new product with a starting quantity')
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('update', { plan: plan('sale', ['sale', 1]) })], null), true, 'a sale deducts stock')
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('update', { plan: plan('noop', ['none', 0]) })], null), false)
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('update', { plan: plan('add', ['add', 0], ['none', 5]) })], null), false, 'a zero or "none" branch action moves nothing')
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('error', { plan: plan('add', ['add', 3]) })], null), false)
  assert.equal(await importResultsChangeStock(none, 'stock_actions', [row('update', { plan: null })], null), false)
  assert.equal(await importResultsChangeStock(none, 'customers', [row('create', { quantity: 3 })], null), false)
})

async function main() {
  prepareTemplate()
  // The engine narrates every chunk; only this test's own verdict lines matter.
  const log = console.log
  console.log = (...args) => { if (!String(args[0]).startsWith('[import')) log(...args) }
  let failed = 0
  try {
    const world = makeWorld()
    for (const c of cases) {
      try { await c.fn(world); log(`PASS ${c.name}`) } catch (error) {
        failed += 1
        log(`FAIL ${c.name}\n     ${String(error?.message || error).split('\n').slice(0, 3).join('\n     ')}`)
      }
    }
  } finally {
    for (const sqlite of opened) { try { sqlite.close() } catch { /* already closed */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort temp cleanup */ }
  }
  log(`${failed ? 'RED' : 'GREEN'} import stock-adjust gate${BASE ? ` (importEngine.ts / importJobs.ts as ${BASE})` : ''}: ${cases.length - failed}/${cases.length} cases hold`)
  if (failed) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
