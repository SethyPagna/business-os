const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const root = path.join(__dirname, '../src')
const indexPath = path.join(root, 'index.ts')
const indexSource = fs.readFileSync(indexPath, 'utf8')
const indexAst = ts.createSourceFile(indexPath, indexSource, ts.ScriptTarget.Latest, true)
const middleware = indexAst.statements.filter(statement => ts.isExpressionStatement(statement)
  && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(indexAst) === 'app.use'
  && statement.expression.arguments[0]?.text === '/api/*'
  && /ensureCoreDataInvariantsForRequest|isMaintenanceGatedRequest/.test(statement.getText(indexAst)))
assert.equal(middleware.length, 2)
const middlewareSource = middleware.map(statement => statement.getText(indexAst)).join('\n')
const guard = "      AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance')\n"
const options = { buildKey: 'maintenance-regression:660', reverifyAfterMs: 86400000 }
const password = 'Fixture-660-valid-password!'
const marker = { mode: 'restore', token: 'test-restore-token', backupKey: 'synthetic-backup', phase: 'failed',
  startedAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', startedBy: 'fixture' }
const count = (f, key) => Number(f.raw.prepare('SELECT COUNT(*) AS n FROM system_flags WHERE key=?').get(key).n)
const stock = f => f.raw.prepare('SELECT * FROM branch_stock WHERE product_id=100').all()
const noPermit = f => assert.equal(count(f, 'stock_transaction_permit'), 0)
function hold(f) {
  seedStockFixture(f.raw, () => f.raw.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('maintenance', JSON.stringify(marker)))
  noPermit(f)
}

function isolate(f, original = false) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }; cache.set(rel, mod)
    if (rel === 'lib/auth.ts') {
      mod.exports = { requireAuth: async (c, next) => {
        if (!f.user) return c.json({ error: 'Unauthenticated' }, 401)
        c.set('user', f.user); return next()
      }, currentSessionLimitFamily: async () => null }
      return mod.exports
    }
    if (rel === 'lib/backup.ts') {
      mod.exports = new Proxy({}, { get: (_target, name) => {
        if (name === '__esModule') return true
        return () => { throw new Error(`Unexercised backup service called: ${String(name)}`) }
      } })
      return mod.exports
    }
    let source = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
    if (original && rel === 'lib/coreDataInvariants.ts') {
      const start = source.indexOf('const activeDefaultBranch = await db.prepare(')
      assert.ok(start > 0)
      const at = source.indexOf(guard, start)
      assert.ok(at > start)
      source = source.slice(0, at) + source.slice(at + guard.length)
    }
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: rel }).outputText
    new Function('require', 'module', 'exports', '__WORKER_BUILD_REVISION__', '__WORKER_BUILD_HASH__', '__WORKER_BUILT_AT__', output)(request => {
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }, mod, mod.exports, 'maintenance-regression', '660', '2026-10-15T00:00:00Z')
    return mod.exports
  }
  const core = load('lib/coreDataInvariants.ts')
  const maintenance = load('lib/maintenance.ts')
  const gate = load('lib/coreInvariantsGate.ts')
  const app = new Hono()
  app.onError((error, c) => c.json({ error: error.message, code: error.code || 'unexpected' }, 503))
  new Function('app', 'ensureCoreDataInvariantsForRequest', 'getMaintenance', 'isBranchCutoverOperatorPath', 'isMaintenanceGatedRequest', middlewareSource)(
    app, gate.ensureCoreDataInvariantsForRequest, maintenance.getMaintenance, maintenance.isBranchCutoverOperatorPath, maintenance.isMaintenanceGatedRequest)
  app.route('/api/backups', load('routes/backups.ts').default)
  app.post('/api/ordinary-write', c => { f.ordinaryWrites++; return c.json({ written: true }) })
  return { core, maintenance, app }
}

async function fixture() {
  const raw = openDb(loadAll()).db
  const f = { raw, user: null, ordinaryWrites: 0, afterDiscovery: null, discoveries: 0 }
  const DB = {
    prepare(sql) {
      const prepared = values => ({ sql, values,
        async first() {
          const row = raw.prepare(sql).get(...values) ?? null
          if (/SELECT id FROM branches WHERE is_active = 1/.test(sql) && /AND EXISTS \(SELECT 1 FROM products p/.test(sql)) {
            f.discoveries++
            if (f.afterDiscovery) { const hook = f.afterDiscovery; f.afterDiscovery = null; hook() }
          }
          return row
        },
        async all() {
          const results = raw.prepare(sql).all(...values)
          if (/SELECT id FROM branches WHERE is_active = 1/.test(sql) && /AND EXISTS \(SELECT 1 FROM products p/.test(sql)) {
            f.discoveries++
            if (f.afterDiscovery) { const hook = f.afterDiscovery; f.afterDiscovery = null; hook() }
          }
          return { results }
        },
        async run() { const r = raw.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } },
      })
      return { ...prepared([]), bind: (...values) => prepared(values) }
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        raw.exec('COMMIT'); return results
      } catch (error) { raw.exec('ROLLBACK'); throw error }
    },
  }
  f.env = { DB, PLAN_TIER: 'paid', BUSINESS_OS_ORGANIZATION_NAME: 'Test OS', BUSINESS_OS_ORGANIZATION_SLUG: 'test-os', BUSINESS_OS_ADMIN_PASSWORD: password }
  await isolate(f).core.ensureCoreDataInvariants(f.env)
  const user = raw.prepare("SELECT id,username,role_id,password FROM users WHERE username='admin'").get()
  f.user = { ...user, role_code: 'admin', permissions: '{"all":true}' }
  seedStockFixture(raw, () => raw.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(100,'Uncovered',1,7)"))
  assert.throws(() => raw.exec('UPDATE products SET stock_quantity=8 WHERE id=100'), /stock_transaction_required/)
  return f
}

async function request(f, worker, method, endpoint, body) {
  noPermit(f)
  const response = await worker.app.request(endpoint, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env, { waitUntil: p => p?.catch?.(() => {}), passThroughOnException() {} })
  const result = { status: response.status, body: await response.json() }
  noPermit(f)
  return result
}

async function main() {
  {
    const f = await fixture(); hold(f)
    const old = isolate(f, true)
    for (const [method, endpoint, body] of [['GET', '/api/backups/maintenance'], ['POST', '/api/backups/maintenance/clear', { force: true, currentPassword: password }]]) {
      const response = await request(f, old, method, endpoint, body)
      assert.equal(response.status, 503)
      assert.equal(response.body.code, 'stock_schema_unavailable')
    }
    assert.equal(count(f, 'maintenance'), 1); assert.deepEqual(stock(f), [])
    assert.equal(count(f, 'core_invariants_build'), 0)
    console.log('PASS original discovery control blocks actual API read and authorized clear')
  }
  {
    const f = await fixture(); hold(f)
    const worker = isolate(f)
    assert.equal((await request(f, worker, 'GET', '/api/backups/maintenance')).status, 200)
    assert.equal((await request(f, worker, 'POST', '/api/ordinary-write', {})).status, 503)
    assert.equal(f.ordinaryWrites, 0)
    const admin = f.user
    f.user = null
    assert.equal((await request(f, worker, 'POST', '/api/backups/maintenance/clear', { force: true, currentPassword: password })).status, 401)
    f.user = { ...admin, role_code: 'employee', permissions: '{"backup":true}' }
    assert.equal((await request(f, worker, 'POST', '/api/backups/maintenance/clear', { force: true, currentPassword: password })).status, 403)
    f.user = admin
    assert.equal((await request(f, worker, 'POST', '/api/backups/maintenance/clear', { currentPassword: password })).status, 400)
    assert.equal((await request(f, worker, 'POST', '/api/backups/maintenance/clear', { force: true, currentPassword: 'wrong' })).status, 403)
    assert.equal(count(f, 'maintenance'), 1); assert.deepEqual(stock(f), [])
    const cleared = await request(f, worker, 'POST', '/api/backups/maintenance/clear', { force: true, currentPassword: password })
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body)); assert.equal(cleared.body.cleared, true)
    assert.equal(count(f, 'maintenance'), 0); assert.deepEqual(stock(f), [])
    assert.equal(count(f, 'core_invariants_build'), 0)
    assert.equal(await isolate(f).core.ensureCoreDataInvariantsForBuildOnce(f.env, options), 'repaired')
    assert.equal(stock(f)[0].quantity, 7); assert.equal(count(f, 'core_invariants_build'), 0)
    assert.equal(await isolate(f).core.ensureCoreDataInvariantsForBuildOnce(f.env, options), 'checked')
    assert.equal(JSON.parse(f.raw.prepare("SELECT value FROM system_flags WHERE key='core_invariants_build'").get().value).status, 'verified')
    noPermit(f)
    console.log('PASS actual middleware and clear route preserve permissions, password, maintenance and fresh-isolate recovery')
  }
  {
    const f = await fixture(), worker = isolate(f)
    f.afterDiscovery = () => hold(f)
    await assert.rejects(worker.core.ensureCoreDataInvariantsForBuildOnce(f.env, options), error => error.code === 'stock_schema_unavailable')
    assert.deepEqual(stock(f), []); noPermit(f)
    assert.equal(count(f, 'maintenance'), 1); assert.equal(count(f, 'core_invariants_build'), 0)
    const before = f.discoveries
    assert.equal(await worker.core.ensureCoreDataInvariantsForBuildOnce(f.env, options), 'repaired')
    assert.ok(f.discoveries > before, 'rejected memo is evicted and retry executes discovery')
    assert.deepEqual(stock(f), []); assert.equal(count(f, 'core_invariants_build'), 0); noPermit(f)
    console.log('PASS post-discovery maintenance race refuses atomically and evicts rejected retry memo')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
