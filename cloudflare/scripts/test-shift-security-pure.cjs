const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}

function d1(sqlite) {
  const translate = (sql, params = {}) => {
    const values = []; return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
    async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
    async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
  })
  return {
    prepare: statement,
    async batch(items) {
      const run = sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values)
        return { meta: { changes: info.changes } }
      }))
      return run()
    },
  }
}

function database() {
  const db = new Database(':memory:')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER DEFAULT 1)')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0089_system_flags.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0119_shift_restore_guard.sql'), 'utf8'))
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1),(2,?,0)').run('Canonical Shop', 'Inactive')
  return db
}

async function main() {
  const sqlite = database(); let user = { id: 7, name: 'Cashier', permissions: '{}' }; let audits = 0
  const permissions = loadReal('lib/permissions.ts')
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'), '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } }, '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => { audits += 1 } }, '../lib/telegram': { sendTelegramShiftReport: async () => true },
  })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })

  for (const [method, url] of [['GET', '/current'], ['POST', '/open'], ['POST', '/close']]) {
    assert.equal((await call(method, url, method === 'GET' ? undefined : {})).status, 403, `${method} ${url} requires POS/sales permission`)
  }
  user = { ...user, permissions: JSON.stringify({ pos: true }) }
  assert.equal((await call('GET', '/current?branch_id=999')).status, 400, 'current rejects an unknown branch')
  assert.equal((await call('POST', '/open', { branch_id: 2 })).status, 400, 'open rejects an inactive branch')
  const opened = await call('POST', '/open', { branch_id: 1, branch_name: 'Spoofed', opening_float_usd: 10 })
  assert.equal(opened.status, 201)
  const openedBody = await opened.json()
  assert.equal(openedBody.shift.branch_name, 'Canonical Shop', 'branch name is derived from the database')

  user = { id: 1, username: 'admin', role_code: 'admin' }
  const id = openedBody.shift.id
  const crossDay = await call('PATCH', `/${id}`, { reason: 'wrong day', opened_at: '2000-01-01T00:00:00.000Z' })
  assert.equal(crossDay.status, 400, 'amendment cannot desynchronise business_date')
  const lifecycle = await call('PATCH', `/${id}`, { reason: 'close indirectly', closed_at: new Date().toISOString() })
  assert.equal(lifecycle.status, 400, 'amendment cannot close an open shift')

  const [a, b] = await Promise.all([
    call('PATCH', `/${id}`, { reason: 'race A', opening_float_usd: 11 }),
    call('PATCH', `/${id}`, { reason: 'race B', opening_float_usd: 12 }),
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'only one concurrent amendment reports success')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_session_amendments').get().n, 1, 'loser writes no false amendment')
  assert.equal(audits, 2, 'only open and the winning amendment are audited')
  assert.throws(() => sqlite.prepare('DELETE FROM shift_session_amendments').run(), /immutable/, 'ordinary code cannot delete amendment history')
  sqlite.prepare("INSERT INTO system_flags(key,value) VALUES ('maintenance', ?)").run(JSON.stringify({ mode: 'restore', token: 'test' }))
  assert.doesNotThrow(() => sqlite.prepare('DELETE FROM shift_session_amendments').run(), 'authorized restore maintenance can replace amendment history')
  console.log('OK shift security/integrity: permissions, canonical branch, lifecycle, concurrent amendment')
}
main().catch((error) => { console.error(error); process.exit(1) })
