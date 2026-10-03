const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function load(source, dependencies = {}) {
  const module = { exports: {} }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`)
    return dependencies[id]
  }, module, module.exports)
  return module.exports
}
const maintenance = load(read('src/lib/maintenance.ts'))
const wire = {
  mode: 'branch-cutover', operationId: '10000000-0000-4000-8000-000000000001',
  token: '20000000-0000-4000-8000-000000000002', actorId: 7, organizationId: 'organization-1',
  controlIncarnation: '30000000-0000-4000-8000-000000000003', beginRequestId: 'begin_request_1', intentDigest: 'a'.repeat(64),
}
function world() {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.exec('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT); CREATE TABLE import_jobs(status TEXT,lease_expires_at TEXT); CREATE TABLE bulk_delete_jobs(status TEXT)')
  const control = { beforeWrite: null }
  function prepare(sql, values = []) {
    return { bind: (...next) => prepare(sql, next),
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        if (control.beforeWrite) { const run = control.beforeWrite; control.beforeWrite = null; run(sql) }
        const result = raw.prepare(sql).run(...values)
        return { meta: { changes: Number(result.changes) } }
      } }
  }
  return { raw, control, env: { DB: { prepare } },
    set: value => raw.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance',?)").run(typeof value === 'string' ? value : JSON.stringify(value)),
    value: () => raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get()?.value }
}
function actualGate() {
  const source = ts.createSourceFile('index.ts', read('src/index.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'app.use'
    && node.expression.arguments[1]?.getText(source).includes('getMaintenance(c.env)'))
  assert.ok(statement)
  return new Function(...Object.keys(maintenance), `return ${statement.expression.arguments[1].getText(source)}`)(...Object.values(maintenance))
}
const backupCalls = []
function backups(user = { id: 7, username: 'owner', grants: ['backup', 'backup_restore'] }) {
  const backup = new Proxy({}, { get: (_, key) => key === 'CLOUDFLARE_BACKUP_KEEP' ? 2 : async () => { backupCalls.push(key); return [] } })
  return load(read('src/routes/backups.ts'), {
    hono: { Hono }, '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); return next() } },
    '../lib/audit': { audit: async () => backupCalls.push('audit') },
    '../lib/permissions': { hasPermission: (actor, key) => actor.grants.includes(key) },
    '../lib/acquisitionCostAccess': { canViewAcquisitionCosts: () => true, canEditAcquisitionCosts: () => true },
    '../lib/backup': backup, '../lib/maintenance': maintenance,
  }).default
}
let failures = 0
async function check(name, run) { try { await run(); console.log(`PASS ${name}`) } catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`) } }
async function main() {
  await check('typed cutover reads without 0224, rejects malformed identity and ignores injected extras', async () => {
    const w = world()
    try {
      assert.equal(await maintenance.getMaintenance(w.env), null)
      w.set({ extra: 'untrusted', ...wire })
      const state = await maintenance.getMaintenance(w.env)
      assert.equal(state.mode, 'branch-cutover'); assert.equal(state.token, wire.token); assert.equal(state.extra, undefined)
      for (const patch of [{ token: '' }, { actorId: 0 }, { organizationId: ' bad ' }, { organizationId: 'x'.repeat(129) }, { beginRequestId: 'short' }, { intentDigest: 'X'.repeat(64) }, { operationId: 'bad' }, { controlIncarnation: 'bad' }]) {
        w.set({ ...wire, ...patch })
        assert.equal((await maintenance.getMaintenance(w.env)).mode, 'corrupt')
        assert.equal(await maintenance.endMaintenance(w.env, null, { force: true }), false)
      }
    } finally { w.raw.close() }
  })
  await check('restore helpers cannot update or clear a cutover even with its correct token', async () => {
    const w = world()
    try {
      w.set(wire); const before = w.value()
      await maintenance.updateMaintenance(w.env, wire.token, { phase: 'failed', error: 'incorrect owner' })
      assert.equal(w.value(), before)
      for (const token of [wire.token, 'wrong', null]) for (const force of [false, true]) {
        assert.equal(await maintenance.endMaintenance(w.env, token, { force }), false); assert.equal(w.value(), before)
      }
      await assert.rejects(maintenance.beginMaintenance(w.env, { backupKey: 'backup', startedBy: 'owner' }))
    } finally { w.raw.close() }
  })
  await check('unknown raw state stays held while recognized corrupt restore retains explicit recovery', async () => {
    const w = world()
    try {
      for (const value of ['{', 'null', '[]', '{"mode":"future","token":"secret"}', '{"mode":"branch-cutover","token":"secret"}']) {
        w.set(value); const state = await maintenance.getMaintenance(w.env)
        assert.ok(['unknown', 'corrupt'].includes(state.mode)); assert.equal(state.token, '')
        assert.equal(await maintenance.endMaintenance(w.env, null, { force: true }), false); assert.equal(w.value(), value)
      }
      w.set('{"mode":"restore","token":3}')
      assert.equal(await maintenance.endMaintenance(w.env, null, { force: true }), true)
    } finally { w.raw.close() }
  })
  await check('actual index gate separates restore/cutover and exact path boundaries', async () => {
    const w = world(), handler = actualGate()
    try {
      for (const value of [wire, '{', { mode: 'future', token: 'secret' }]) {
        w.set(value)
        for (const endpoint of ['/api/backups', '/api/backups/maintenance/clear', '/api/backups-other', '/api/branches', '/api/branches/cutover', '/api/auth-other']) {
          const result = await handler({ req: { method: 'POST', path: endpoint }, env: w.env, json: (body, status) => ({ body, status }) }, async () => ({ status: 204 }))
          assert.equal(result.status, 503, endpoint)
          assert.ok(!JSON.stringify(result.body).includes(wire.token)); assert.ok(!JSON.stringify(result.body).includes(wire.intentDigest))
        }
        for (const [method, endpoint] of [['POST', '/api/auth/login'], ['GET', '/api/backups/maintenance'], ['GET', '/api/branches']]) {
          assert.equal((await handler({ req: { method, path: endpoint }, env: w.env }, async () => ({ status: 204 }))).status, 204)
        }
      }
      w.raw.exec("DELETE FROM system_flags")
      await maintenance.beginMaintenance(w.env, { backupKey: 'backup', startedBy: 'owner' })
      assert.equal((await handler({ req: { method: 'POST', path: '/api/backups/maintenance/clear' }, env: w.env }, async () => ({ status: 204 }))).status, 204)
      assert.equal(maintenance.isMaintenanceGatedRequest('POST', '/api/backups-other'), true)
    } finally { w.raw.close() }
  })
  await check('actual backup status redacts ownership and direct router refuses cutover writes with existing grants', async () => {
    const w = world()
    try {
      w.set(wire); backupCalls.length = 0
      const app = backups()
      const response = await app.request('http://local/maintenance', {}, w.env)
      assert.equal(response.status, 200)
      const text = await response.text()
      for (const value of [wire.token, wire.intentDigest, wire.beginRequestId, wire.controlIncarnation, wire.organizationId]) assert.ok(!text.includes(value))
      for (const endpoint of ['/', '/maintenance/clear']) {
        const response = await app.request(`http://local${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' }, w.env)
        assert.equal(response.status, 503)
      }
      assert.deepEqual(backupCalls, []); assert.equal(w.value(), JSON.stringify(wire))
      assert.equal((await backups({ id: 9, grants: [] }).request('http://local/maintenance', {}, w.env)).status, 403)
      for (const invalid of ['{', JSON.stringify({ mode: 'future', token: wire.token, intentDigest: wire.intentDigest })]) {
        w.set(invalid)
        const text = await (await app.request('http://local/maintenance', {}, w.env)).text()
        assert.ok(!text.includes(wire.token)); assert.ok(!text.includes(wire.intentDigest))
      }
    } finally { w.raw.close() }
  })
  await check('restore progress/clear, wrong token, stale CAS, missing-table and unavailable controls remain', async () => {
    const w = world()
    try {
      const state = await maintenance.beginMaintenance(w.env, { backupKey: 'backup', startedBy: 'owner' })
      await maintenance.updateMaintenance(w.env, 'wrong', { phase: 'assets' }); assert.equal((await maintenance.getMaintenance(w.env)).phase, 'deleting')
      await maintenance.updateMaintenance(w.env, state.token, { phase: 'assets' }); assert.equal((await maintenance.getMaintenance(w.env)).phase, 'assets')
      assert.equal(await maintenance.endMaintenance(w.env, 'wrong'), false)
      w.control.beforeWrite = () => w.set(wire)
      assert.equal(await maintenance.endMaintenance(w.env, state.token), false); assert.equal(w.value(), JSON.stringify(wire))
      w.raw.exec('DELETE FROM system_flags')
      const next = await maintenance.beginMaintenance(w.env, { backupKey: 'backup', startedBy: 'owner' })
      assert.equal(await maintenance.endMaintenance(w.env, next.token), true)
      w.raw.exec('DROP TABLE system_flags'); assert.equal(await maintenance.getMaintenance(w.env), null)
      await assert.rejects(maintenance.getMaintenance({ DB: { prepare() { throw Error('D1 unavailable') } } }), /unavailable/)
    } finally { w.raw.close() }
  })
  await check('stale restore progress and ordinary/force clear cannot replace a new cutover holder', async () => {
    for (const action of ['progress', 'end', 'force', 'corrupt-force']) {
      const w = world()
      try {
        const state = await maintenance.beginMaintenance(w.env, { backupKey: 'backup', startedBy: 'owner' })
        if (action === 'corrupt-force') w.set('{"mode":"restore","token":null}')
        w.control.beforeWrite = () => w.set(wire)
        if (action === 'progress') await maintenance.updateMaintenance(w.env, state.token, { phase: 'failed' })
        else assert.equal(await maintenance.endMaintenance(w.env, state.token, { force: action !== 'end' }), false)
        assert.equal(w.value(), JSON.stringify(wire), action)
      } finally { w.raw.close() }
    }
  })
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
