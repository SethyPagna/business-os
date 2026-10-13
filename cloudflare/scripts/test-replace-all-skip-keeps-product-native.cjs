// Owner ruling 17 (13 Oct 2026): "Replace-all import 'skip' keeps the product. A
// skipped row is never deactivated."
//
// Drives the real Hono routes and the real importEngine on a fully migrated
// in-memory database (same harness shape as
// test-destructive-import-authority-route-native.cjs; only auth, audit, cache
// and broadcast are stubbed). A replace_all products job is approved, the queue
// is drained, and the final replace step is judged by what it did to the catalog.
//
// Discrimination: after the real implementation passes, the same cases run
// against deliberately wrong source-patched copies. Each must fail EXACTLY the
// cases for the rule it dropped:
//   keeps-nothing        (the pre-6.0.131 behaviour) -> every "keeps" case
//   deactivates-nothing                              -> every case that expects an omitted product to go
//   guard-ignores-keep   (stock refusal still counts the kept product)
//                                                    -> only the stocked-skip case
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
// Every product predates the job's own start, which is the replace_all cutoff.
const OLD = '2000-01-01'
const STARTED = '2000-06-01'

// ---------------------------------------------------------------- loader ----
const transpiled = new Map()
function makeWorld(patches = []) {
  const cache = new Map()
  const audits = []
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
    'lib/audit': () => ({ audit: async (...args) => { audits.push(args) } }),
    'lib/cache': () => ({ bumpVersion: async () => {} }),
    'durable-objects/broadcastHub': () => ({ broadcast: async () => {} }),
    'lib/imageAudit': () => ({ enqueueImageNormalization: async () => {} }),
  }
  function source(file) {
    let text = fs.readFileSync(file, 'utf8')
    for (const patch of patches) {
      if (patch.file !== rel(file)) continue
      const next = patch.apply(text)
      assert.notEqual(next, text, `wrong-implementation patch "${patch.name}" must change ${patch.file}`)
      text = next
    }
    return text
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
    audits,
    engine: load(path.join(SRC, 'lib', 'importEngine.ts')),
    routes: load(path.join(SRC, 'routes', 'importJobs.ts')),
  }
}

// ---------------------------------------------------------------- fixture ---
let template
let tmp
function prepareTemplate() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-all-skip-keeps-'))
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

const ADMIN = { id: 95 }
const SHOP = 991

// Product ids: 1 matched and updated, 2 and 3 skipped by the file, 4 an optional
// skipped product that holds stock, 99 never mentioned by the file.
const CATALOG = [
  [1, 'Serum', 'SER-1'],
  [2, 'Keeper A', 'KEEP-A'],
  [3, 'Keeper B', 'KEEP-B'],
  [99, 'Omitted', 'OMITTED'],
]

function fixture(world, { stockedOmitted = false, stockedKeeper = false } = {}) {
  world.audits.length = 0
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
  raw.prepare(`INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(${SHOP},'Probe','shop','shop',1,1)`).run()
  raw.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(98,'Administrator','admin','{}',1)").run()
  raw.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(@id,'admin','admin','hash',98,'{}',1)").run({ id: ADMIN.id })
  const catalog = [...CATALOG, ...(stockedKeeper ? [[4, 'Keeper Stocked', 'KEEP-S']] : [])]
  for (const [id, name, barcode] of catalog) {
    const held = (id === 99 && stockedOmitted ? 3 : 0) + (id === 4 ? 5 : 0)
    raw.prepare('INSERT INTO products(id,name,barcode,stock_quantity,is_active,updated_at) VALUES(@id,@name,@barcode,@stock,1,@old)')
      .run({ id, name, barcode, stock: held, old: OLD })
    if (held) raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(@id,@branch,@stock)').run({ id, branch: SHOP, stock: held })
  }
  const pending = []
  const env = {
    DB: db,
    ASSETS: { list: async () => ({ objects: [], truncated: false }), delete: async () => {} },
    IMPORT_QUEUE: { send: async message => { pending.push(message) } },
  }
  const f = { world, raw, db, env, pending }
  // rows: [{ row, name, barcode, mode? }]; decisions: { '<row>': { action } }
  f.seedJob = ({ id = 'job', policy = {}, rows = [], decisions } = {}) => {
    const stored = { import_mode: 'replace_all', ...policy, ...(decisions ? { decisionsByRowNumber: decisions } : {}) }
    raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
      VALUES(@id,'products','awaiting_review','awaiting_review',@policy,1,0,'{}',@started)`).run({ id, policy: JSON.stringify(stored), started: STARTED })
    rows.forEach((r, sequence) => {
      const data = { _rowNumber: r.row, name: r.name, barcode: r.barcode, description: 'from file', ...(r.mode ? { _action: r.mode } : {}) }
      raw.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(@id,@sequence,@row,@data)')
        .run({ id, sequence, row: r.row, data: JSON.stringify(data) })
    })
    return id
  }
  f.job = id => raw.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id })
  f.summary = id => JSON.parse(f.job(id).summary_json || '{}')
  f.active = id => { const row = raw.prepare('SELECT is_active FROM products WHERE id=@id').get({ id }); return row ? Number(row.is_active) : null }
  f.stock = id => Number(raw.prepare('SELECT stock_quantity q FROM products WHERE id=@id').get({ id }).q)
  f.description = id => raw.prepare('SELECT description FROM products WHERE id=@id').get({ id }).description
  f.productCount = () => Number(raw.prepare('SELECT COUNT(*) n FROM products').get().n)
  f.deleteAudits = () => raw.prepare("SELECT entity_id FROM audit_logs WHERE action='delete' AND entity='product' ORDER BY entity_id").all().map(r => Number(r.entity_id))
  f.run = async jobId => {
    const approved = await world.routes.default.request(`http://local.test/${jobId}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': String(ADMIN.id) }, body: '{}',
    }, env)
    assert.equal(approved.status, 200, await approved.text())
    for (let n = 0; pending.length && n < 25; n++) await world.engine.runImportApply(env, pending.shift().jobId)
  }
  return f
}

// ------------------------------------------------------------------ cases ---
const cases = []
function add(tag, label, fn) { cases.push({ name: `${tag}/${label}`, tag, fn }) }

const MATCHED = { row: 2, name: 'Serum', barcode: 'SER-1' }
const SKIP_A = { row: 3, name: 'Keeper A', barcode: 'KEEP-A' } // skipped by a reviewer decision on row 3
const SKIP_B_MODE = { row: 4, name: 'Keeper B', barcode: 'KEEP-B', mode: 'skip_row' }
const SKIP_STOCKED = { row: 3, name: 'Keeper Stocked', barcode: 'KEEP-S' }
const DECIDE_ROW_3 = { 3: { action: 'skip' } }

add('keeps', 'reviewer-skip-decision-keeps-the-matched-product', async world => {
  const f = fixture(world)
  const id = f.seedJob({ rows: [MATCHED, SKIP_A], decisions: DECIDE_ROW_3 })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.equal(f.active(2), 1, "the skipped row's product stays active")
  assert.equal(f.description(2), null, 'a skipped row writes nothing to its product')
  assert.deepEqual([f.active(3), f.active(99)], [0, 0], 'products the file never mentions are still deactivated')
  assert.equal(f.description(1), 'from file', 'the matched, applied row still updates')
  assert.deepEqual(f.deleteAudits(), [3, 99], 'only the genuinely untouched products get a delete audit row')
  assert.equal(f.summary(id).skippedKept, 1)
  assert.equal(f.summary(id).deactivated, 2)
  assert.equal(f.summary(id).skipped, 1)
})

add('keeps', 'skip-row-mode-keeps-the-matched-product', async world => {
  const f = fixture(world)
  const id = f.seedJob({ rows: [MATCHED, SKIP_B_MODE] })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.equal(f.active(3), 1, 'a row marked skip_row keeps its product too')
  assert.equal(f.description(3), null)
  assert.deepEqual([f.active(2), f.active(99)], [0, 0])
  assert.deepEqual(f.deleteAudits(), [2, 99])
  assert.equal(f.summary(id).skippedKept, 1)
})

add('keeps', 'both-ways-of-skipping-in-one-job', async world => {
  const f = fixture(world)
  const id = f.seedJob({ rows: [MATCHED, SKIP_A, SKIP_B_MODE], decisions: DECIDE_ROW_3 })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.deepEqual([f.active(1), f.active(2), f.active(3), f.active(99)], [1, 1, 1, 0])
  assert.deepEqual(f.deleteAudits(), [99])
  assert.equal(f.summary(id).skippedKept, 2)
})

add('keeps', 'two-skipped-rows-on-one-product-count-as-two-skipped-rows', async world => {
  const f = fixture(world)
  const again = { row: 5, name: 'Keeper A', barcode: 'KEEP-A', mode: 'skip_row' }
  const id = f.seedJob({ rows: [MATCHED, SKIP_A, again], decisions: DECIDE_ROW_3 })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.equal(f.active(2), 1)
  assert.equal(f.summary(id).skippedKept, 2, 'a count of skipped rows, so it is always a subset of skipped')
  assert.equal(f.summary(id).skipped, 2)
})

add('keeps', 'skipped-product-holding-stock-is-kept-and-never-refuses', async world => {
  const f = fixture(world, { stockedKeeper: true })
  const id = f.seedJob({ rows: [MATCHED, SKIP_STOCKED], decisions: DECIDE_ROW_3 })
  await f.run(id).catch(error => assert.fail('the replacement was refused although only a kept product holds stock: ' + (error.code || error.message)))
  assert.match(f.job(id).status, /^completed/, `${f.job(id).status}: ${f.job(id).last_error}`)
  assert.equal(f.active(4), 1)
  assert.equal(f.stock(4), 5, "the kept product's stock is untouched")
  assert.deepEqual([f.active(2), f.active(3), f.active(99)], [0, 0, 0], 'the unstocked omitted products are still deactivated')
  assert.equal(f.summary(id).skippedKept, 1)
})

add('control', 'skip-that-matches-nothing-keeps-nothing-and-creates-nothing', async world => {
  const f = fixture(world)
  const fresh = { row: 3, name: 'Brand New', barcode: 'NEW-1' }
  const id = f.seedJob({ rows: [MATCHED, fresh], decisions: DECIDE_ROW_3 })
  const before = f.productCount()
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.equal(f.productCount(), before, 'a skipped create writes no product')
  assert.deepEqual([f.active(2), f.active(3), f.active(99)], [0, 0, 0])
  assert.equal(f.summary(id).skippedKept, undefined, 'nothing was kept, so nothing is reported')
})

add('control', 'merge-mode-skip-reports-no-kept-count', async world => {
  const f = fixture(world)
  const id = f.seedJob({ policy: { import_mode: 'merge' }, rows: [MATCHED, SKIP_A], decisions: DECIDE_ROW_3 })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.deepEqual([f.active(2), f.active(3), f.active(99)], [1, 1, 1], 'merge mode never deactivates anything')
  assert.equal(f.summary(id).skippedKept, undefined, 'the count is replace-all only')
})

add('keeps', 'finalizer-takes-a-keep-list-and-ignores-junk-ids', async world => {
  const f = fixture(world)
  const keep = [2, 2, 'x', -4, 1.5, null, 0, '3; DROP TABLE products']
  assert.equal(await world.engine.finalizeProductReplacement(f.db, STARTED, { keepProductIds: keep }), 3, 'products 1, 3 and 99 go; only the real id 2 is spared')
  assert.deepEqual([f.active(1), f.active(2), f.active(3), f.active(99)], [0, 1, 0, 0])
  assert.equal(f.productCount(), 4, 'junk ids never reach the SQL text')
})

add('deactivates', 'untouched-products-are-still-deactivated', async world => {
  const f = fixture(world)
  const id = f.seedJob({ rows: [MATCHED] })
  await f.run(id)
  assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
  assert.deepEqual([f.active(1), f.active(2), f.active(3), f.active(99)], [1, 0, 0, 0])
  assert.deepEqual(f.deleteAudits(), [2, 3, 99])
  assert.equal(f.summary(id).deactivated, 3)
  assert.equal(f.summary(id).skippedKept, undefined)
})

add('refuses', 'untouched-stocked-product-still-refuses-with-product_has_stock', async world => {
  const f = fixture(world, { stockedOmitted: true })
  const id = f.seedJob({ rows: [MATCHED, SKIP_A], decisions: DECIDE_ROW_3 })
  await assert.rejects(() => f.run(id), error => error.code === 'product_has_stock' && error.status === 409, 'the 409 protection is unchanged')
  assert.equal(f.job(id).status, 'failed')
  assert.deepEqual([f.active(1), f.active(2), f.active(3), f.active(99)], [1, 1, 1, 1], 'a refused replacement deactivates nothing')
  assert.deepEqual(f.deleteAudits(), [], 'and leaves no delete audit rows')
})

// ---------------------------------------------------------- wrong versions --
const WRONG = [
  {
    name: 'keeps-nothing', fails: c => c.tag === 'keeps',
    patches: [
      { name: 'keeps-nothing', file: 'lib/importEngine.ts', apply: text => text.replace(/const skippedProductIds = await readSkippedProductIds\(db, jobId\)/, 'const skippedProductIds: number[] = []') },
      { name: 'keeps-nothing-finalizer', file: 'lib/importEngine.ts', apply: text => text.replace(/const keepIds = JSON\.stringify\(\[[^\n]*\)\]\)/, "const keepIds = '[]'") },
    ],
  },
  {
    // Every case that asserts an omitted product goes. Not the merge-mode control (nothing goes by design), the one-product count case (asserts no deactivation) or the refusal (throws before the UPDATE).
    name: 'deactivates-nothing', fails: c => !['control/merge-mode-skip-reports-no-kept-count', 'keeps/two-skipped-rows-on-one-product-count-as-two-skipped-rows'].includes(c.name) && c.tag !== 'refuses',
    patches: [{ name: 'deactivates-nothing', file: 'lib/importEngine.ts', apply: text => text.replace(/WHERE is_active=1 AND \(updated_at IS NULL OR updated_at < @cutoff\) AND id NOT IN/, 'WHERE is_active=2 AND (updated_at IS NULL OR updated_at < @cutoff) AND id NOT IN') }],
  },
  {
    name: 'guard-ignores-keep', fails: c => c.name === 'keeps/skipped-product-holding-stock-is-kept-and-never-refuses',
    patches: [{ name: 'guard-ignores-keep', file: 'lib/importEngine.ts', apply: text => text.replace(/SELECT 1 FROM products p WHERE \$\{candidates\} AND \$\{productHasStockSql\(\)\}/, 'SELECT 1 FROM products p WHERE p.is_active=1 AND (p.updated_at IS NULL OR p.updated_at < @cutoff) AND ${productHasStockSql()}') }],
  },
]

async function runAll(world) {
  const failed = new Map()
  for (const c of cases) {
    try { await c.fn(world) } catch (error) { failed.set(c.name, error) }
  }
  return failed
}

async function main() {
  prepareTemplate()
  // The engine narrates every chunk; only this test's own verdict lines matter.
  const log = console.log
  console.log = (...args) => { if (!String(args[0]).startsWith('[import')) log(...args) }
  try {
    const failed = await runAll(makeWorld())
    for (const c of cases) {
      const error = failed.get(c.name)
      console.log(error ? `FAIL ${c.name}\n     ${String(error?.message || error).split('\n').slice(0, 4).join('\n     ')}` : `PASS ${c.name}`)
    }
    if (failed.size) {
      console.log(`\nRED: ${failed.size} of ${cases.length} cases fail on the real implementation`)
      process.exitCode = 1
      return
    }
    console.log(`GREEN real implementation: ${cases.length} cases`)
    for (const wrong of WRONG) {
      const failures = await runAll(makeWorld(wrong.patches))
      const expected = cases.filter(wrong.fails).map(c => c.name).sort()
      const actual = [...failures.keys()].sort()
      for (const [name, error] of failures) {
        assert.ok(error instanceof assert.AssertionError || error?.code === 'ERR_ASSERTION', `wrong implementation "${wrong.name}" must fail "${name}" by assertion, not by crashing: ${error?.stack}`)
      }
      assert.deepEqual(actual, expected, `wrong implementation "${wrong.name}" must fail exactly the cases for the rule it dropped`)
      console.log(`GREEN wrong implementation "${wrong.name}" rejected by exactly ${actual.length} case(s)`)
    }
  } finally {
    for (const sqlite of opened) { try { sqlite.close() } catch { /* already closed */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort temp cleanup */ }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
