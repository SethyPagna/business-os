// A destructive products import (import_mode replace_all / replace_columns) is
// authorised at four boundaries, and all four must apply ONE definition of
// "destructive": the actual Hono routes (POST /, /:id/approve, /:id/retry) and
// the apply-start authority check in the real importEngine, on a real migrated
// database. Only the unrelated edges (session lookup, audit sink, cache,
// broadcast, image queue) are stubbed.
//
// This is the step-1 subset of the root-chain 6.0.5 fix (84ce5e073): the
// approve / retry / apply-start boundaries. The commit-guard re-check inside the
// final-deactivate transaction depends on stockActorGuard.ts and
// import_stock_action_guards, which do not exist on this chain, and is NOT
// covered here.
//
// Discrimination: after the real implementation passes every case, the same
// cases are re-run against deliberately wrong implementations (source-patched
// copies of the real route/engine). Each wrong implementation must fail EXACTLY
// the cases that probe the boundary or rule it removed -- so an implementation
// that checks only at approve is rejected by the retry and apply cases, and a
// green run proves the cases can tell the difference.
// Scope of this revision: the shared definition and POST / (create). Approve, retry and
// apply-start are added by the following commits.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const MODES = ['replace_all', 'replace_columns']
const PERMISSIONS = ['destructive_delete', 'products:import_replace_all']
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'destructive-import-authority-'))
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

// A products import needs the cost-entry grants as well (acquisition-cost
// formats), so "a plain products-import user" holds them: the only thing the
// destructive modes add is destructive_delete.
const IMPORTER = { products: true, product_cost_view: true, product_cost_edit: true }
const ACTORS = {
  plain: { id: 91, grants: { ...IMPORTER } },
  full: { id: 92, grants: { ...IMPORTER, destructive_delete: true } },
  override: { id: 93, grants: { ...IMPORTER, destructive_delete: true, 'products:import_replace_all': false } },
  contacts: { id: 94, grants: { contacts: true } },
  admin: { id: 95, grants: {}, role: 98 },
}
const revoked = permission => ({ ...IMPORTER, destructive_delete: true, [permission]: false })

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
  for (const [id, name, barcode] of [[1, 'Serum', 'SER-1'], [99, 'Omitted', 'OMITTED']]) {
    raw.prepare('INSERT INTO products(id,name,barcode,stock_quantity,is_active,updated_at) VALUES(@id,@name,@barcode,0,1,@old)')
      .run({ id, name, barcode, old: OLD })
  }
  const pending = []
  const env = {
    DB: db,
    ASSETS: { list: async () => ({ objects: [], truncated: false }), delete: async () => {} },
    IMPORT_QUEUE: { send: async message => { pending.push(message) } },
  }
  const f = { world, raw, db, env, pending }
  f.setGrants = (actor, grants) => raw.prepare('UPDATE users SET permissions=@grants WHERE id=@id').run({ id: actor.id, grants: JSON.stringify(grants) })
  f.seedJob = ({ id = 'job', type = 'products', status = 'awaiting_review', policy = {}, authorizedBy } = {}) => {
    const stored = { ...policy, ...(authorizedBy ? { apply_authorized_by_id: authorizedBy.id } : {}) }
    raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
      VALUES(@id,@type,@status,@status,@policy,1,0,'{}',@started)`).run({ id, type, status, policy: JSON.stringify(stored), started: STARTED })
    const row = type === 'products'
      ? { _rowNumber: 2, name: 'Serum', barcode: 'SER-1', description: 'authorized replacement' }
      : { _rowNumber: 2, name: 'Contact' }
    raw.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(@id,0,2,@row)')
      .run({ id, row: JSON.stringify(row) })
    return id
  }
  f.job = id => raw.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id })
  f.snapshot = () => JSON.stringify(['import_jobs', 'import_job_source_rows', 'import_job_rows', 'products', 'branch_stock',
    'product_batches', 'inventory_movements', 'audit_logs', 'product_cost_entries'].map(t => raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
  f.business = () => JSON.stringify(['import_job_rows', 'products', 'branch_stock', 'product_batches', 'inventory_movements',
    'audit_logs', 'product_cost_entries'].map(t => raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
  f.omittedActive = () => raw.prepare('SELECT is_active FROM products WHERE id=99').get().is_active
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
  // Drain exactly what the real queue consumer would run: runImportApply per message.
  f.drain = async () => {
    for (let n = 0; pending.length && n < 25; n++) await world.engine.runImportApply(env, pending.shift().jobId)
  }
  return f
}

function assertForbidden(result, permission) {
  assert.equal(result.status, 403, `expected 403, got ${result.status}: ${result.text}`)
  assert.equal(result.body.code, 'forbidden', result.text)
  assert.equal(result.body.permission, permission, result.text)
}

// ------------------------------------------------------------------ cases ---
const cases = []
function add(boundary, mode, permission, label, fn) {
  cases.push({ name: [boundary, mode, permission, label].filter(Boolean).join('/'), boundary, mode, permission, fn })
}
const policyFor = mode => ({ import_mode: mode, replace_columns: ['description'] })
const lackingFor = permission => (permission === 'destructive_delete' ? ACTORS.plain : ACTORS.override)

// POST / : the original boundary, now through the shared definition.
function addCreateCases() {
  for (const mode of MODES) for (const permission of PERMISSIONS) {
    add('create', mode, permission, '', async world => {
      const f = fixture(world)
      const before = f.snapshot()
      assertForbidden(await f.call(lackingFor(permission), 'POST', '/', { type: 'products', policy: policyFor(mode) }), permission)
      assert.equal(f.snapshot(), before, 'a refused create writes nothing')
      assert.equal(f.pending.length, 0)
    })
  }
}

// Controls: the rule must not refuse what it should allow.
function addControlCases() {
  for (const mode of MODES) {
    for (const [label, actor] of [['full', ACTORS.full], ['admin', ACTORS.admin]]) {
      add('control', mode, '', `${label}-user-completes`, async world => {
        const f = fixture(world)
        const id = f.seedJob({ policy: policyFor(mode) })
        const approved = await f.call(actor, 'POST', `/${id}/approve`, {})
        assert.equal(approved.status, 200, approved.text)
        await f.drain()
        const job = f.job(id)
        assert.match(job.status, /^completed/, `${job.status}: ${job.last_error}`)
        assert.equal(f.raw.prepare('SELECT description FROM products WHERE id=1').get().description, 'authorized replacement')
        assert.equal(f.omittedActive(), mode === 'replace_all' ? 0 : 1, 'only replace_all deactivates omitted products')
      })
    }
    add('control', mode, '', 'full-user-retries-approved-job', async world => {
      const f = fixture(world)
      const id = f.seedJob({ status: 'approved', policy: policyFor(mode), authorizedBy: ACTORS.plain })
      const retried = await f.call(ACTORS.full, 'POST', `/${id}/retry`, {})
      assert.equal(retried.status, 200, retried.text)
      assert.deepEqual(f.pending.map(m => m.kind), ['apply'])
      assert.equal(JSON.parse(f.job(id).policy_json).apply_authorized_by_id, ACTORS.full.id)
      await f.drain()
      assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
    })
  }
  for (const policy of [{}, { import_mode: 'merge' }, { import_mode: 'fill_blank' }, { import_mode: ' REPLACE_ALL ' }, { import_mode: 'Replace_All' }]) {
    add('control', '', '', `plain-user-non-destructive-${JSON.stringify(policy.import_mode ?? 'none')}`, async world => {
      const f = fixture(world)
      const id = f.seedJob({ policy })
      const approved = await f.call(ACTORS.plain, 'POST', `/${id}/approve`, {})
      assert.equal(approved.status, 200, approved.text)
      await f.drain()
      assert.match(f.job(id).status, /^completed/, f.job(id).last_error)
      assert.equal(f.omittedActive(), 1, 'a non-destructive mode never deactivates omitted products')
      const retry = f.seedJob({ id: 'again', status: 'approved', policy, authorizedBy: ACTORS.full })
      assert.equal((await f.call(ACTORS.plain, 'POST', `/${retry}/retry`, {})).status, 200)
      assert.deepEqual(f.pending.map(m => m.kind), ['apply'])
    })
  }
  add('control', '', '', 'non-products-type-ignores-destructive-looking-policy', async world => {
    const f = fixture(world)
    // import_mode is a products-only switch: a contacts job carrying it must not
    // demand destructive_delete, at the route or at apply start.
    const policy = { import_mode: 'replace_all' }
    const id = f.seedJob({ type: 'customers', policy })
    const approved = await f.call(ACTORS.contacts, 'POST', `/${id}/approve`, {})
    assert.equal(approved.status, 200, approved.text)
    const authority = await world.engine.assertCurrentImportApplyAuthority(f.env, { id, type: 'customers', policy_json: f.job(id).policy_json }, f.db)
    assert.equal(authority.actor.id, ACTORS.contacts.id)
    const created = await f.call(ACTORS.contacts, 'POST', '/', { type: 'customers', policy })
    assert.equal(created.status, 200, created.text)
  })
}

// The one shared definition, exercised directly.
function addHelperCase() {
  add('helper', '', '', 'one-definition-table', async world => {
    const { missingDestructiveImportPermission: missing } = world.engine
    assert.equal(typeof missing, 'function', 'importEngine exports the shared destructive-authority helper')
    const actor = (grants, extra = {}) => ({ id: 10, username: 'u', name: 'U', organization_id: 1, role_id: 2, role_code: 'staff',
      role_permissions: null, permissions: JSON.stringify(grants), is_active: 1, ...extra })
    const inherited = JSON.stringify({ products: true, destructive_delete: true })
    for (const mode of MODES) {
      const policy = JSON.stringify({ import_mode: mode })
      assert.equal(missing(actor({ products: true }), 'products', policy), 'destructive_delete')
      assert.equal(missing(actor({ products: true, destructive_delete: true, 'products:import_replace_all': false }), 'products', policy), 'products:import_replace_all')
      assert.equal(missing(actor({}, { role_permissions: inherited }), 'products', policy), null, 'role grants count')
      assert.equal(missing(actor({ destructive_delete: false }, { role_permissions: inherited }), 'products', policy), 'destructive_delete', 'an explicit user denial beats the role')
      assert.equal(missing(actor({ 'products:import_replace_all': false }, { role_permissions: inherited }), 'products', policy), 'products:import_replace_all')
      assert.equal(missing(actor({ destructive_delete: false, 'products:import_replace_all': false }, { role_code: 'admin' }), 'products', policy), null, 'admin control passes')
      for (const type of ['customers', 'suppliers', 'delivery_contacts', 'inventory', 'sales', 'stock_actions']) {
        assert.equal(missing(actor({ products: true }), type, policy), null, `${type} is not a destructive products import`)
      }
    }
    for (const policy of [null, undefined, '', '{', 'null', '[]', '{}', '{"import_mode":"merge"}', '{"import_mode":"fill_blank"}', '{"import_mode":" REPLACE_ALL "}']) {
      assert.equal(missing(actor({ products: true }), 'products', policy), null, `non-destructive policy ${policy}`)
    }
  })
}

addHelperCase()
addCreateCases()
addControlCases()

// -------------------------------------------- deliberately wrong versions ----
// Each is a source-patched copy of the real route/engine that drops one rule.
// `fails` names the cases that must catch it: no more (the other boundaries
// still hold) and no fewer (the cases are not decorative).
const removeLine = re => text => text.replace(re, '')
const WRONG = []
WRONG.push({
  name: 'helper-ignores-per-action-override', fails: c => c.permission === 'products:import_replace_all' || c.boundary === 'helper',
  patches: [{ file: 'lib/importEngine.ts', apply: text => text.replace(/return isActionBlocked\(user, 'products', 'import_replace_all'\) \? 'products:import_replace_all' : null/, 'return null') }],
})
WRONG.push({
  name: 'helper-covers-replace-all-only', fails: c => (c.mode === 'replace_columns' && ['create', 'approve', 'retry', 'apply'].includes(c.boundary)) || c.boundary === 'helper',
  patches: [{ file: 'lib/importEngine.ts', apply: text => text.replace(/\(mode === 'replace_all' \|\| mode === 'replace_columns'\)/, "(mode === 'replace_all')") }],
})

async function runAll(world, label) {
  const failed = new Map()
  for (const c of cases) {
    try { await c.fn(world) } catch (error) { failed.set(c.name, error) }
  }
  if (label) return failed
  for (const c of cases) {
    const error = failed.get(c.name)
    console.log(error ? `FAIL ${c.name}\n     ${String(error?.message || error).split('\n').slice(0, 3).join('\n     ')}` : `PASS ${c.name}`)
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
    if (failed.size) {
      console.log(`\nRED: ${failed.size} of ${cases.length} cases fail on the real implementation`)
      process.exitCode = 1
      return
    }
    console.log(`PASS real implementation: ${cases.length} cases (${[...new Set(cases.map(c => c.boundary))].join(', ')})`)
    for (const wrong of WRONG) {
      const failures = await runAll(makeWorld(wrong.patches), wrong.name)
      const expected = cases.filter(wrong.fails).map(c => c.name).sort()
      const actual = [...failures.keys()].sort()
      for (const [name, error] of failures) {
        assert.ok(error instanceof assert.AssertionError || error?.code === 'ERR_ASSERTION', `wrong implementation "${wrong.name}" must fail "${name}" by assertion, not by crashing: ${error?.stack}`)
      }
      assert.deepEqual(actual, expected, `wrong implementation "${wrong.name}" must fail exactly the cases for the rule it dropped`)
      console.log(`PASS wrong implementation "${wrong.name}" rejected by exactly ${actual.length} case(s): ${actual.length > 4 ? actual.slice(0, 2).join(', ') + ', ...' : actual.join(', ')}`)
    }
  } finally {
    for (const sqlite of opened) { try { sqlite.close() } catch { /* already closed */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort temp cleanup */ }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
