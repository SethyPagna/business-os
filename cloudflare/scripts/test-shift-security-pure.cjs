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
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER DEFAULT 1);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0089_system_flags.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0119_shift_restore_guard.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0123_shift_reopen_segments.sql'), 'utf8'))
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1),(2,?,0)').run('Canonical Shop', 'Inactive')
  return db
}

async function main() {
  const sqlite = database(); let user = { id: 7, name: 'Cashier', permissions: '{}' }
  const permissions = loadReal('lib/permissions.ts')
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'), '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } }, '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => { throw new Error('shift writes must use the atomic audit batch') } },
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
  })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })

  for (const [method, url] of [['GET', '/current'], ['GET', '/'], ['POST', '/open'], ['POST', '/close']]) {
    assert.equal((await call(method, url, method === 'GET' ? undefined : {})).status, 403, `${method} ${url} requires POS/sales permission`)
  }
  user = { ...user, permissions: JSON.stringify({ pos: true }) }
  assert.equal((await call('GET', '/current?branch_id=999')).status, 400, 'current rejects an unknown branch')
  assert.equal((await call('POST', '/open', { branch_id: 2 })).status, 400, 'open rejects an inactive branch')
  const opened = await call('POST', '/open', { branch_id: 1, branch_name: 'Spoofed', opening_float_usd: 10, opening_float_khr: 0 })
  assert.equal(opened.status, 201)
  const openedBody = await opened.json()
  assert.equal(openedBody.shift.branch_name, 'Canonical Shop', 'branch name is derived from the database')
  assert.deepEqual(openedBody.shift.capabilities, { can_edit: true, can_close: true, can_reopen: false, can_cancel: false })
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.open'").get().n, 1, 'open and audit commit together')

  sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr)
    VALUES ('S-FOREIGN','per_account',8,'Other cashier',1,'Canonical Shop',date('now','+7 hours'),datetime('now','-1 hour'),5,1000)`).run()
  const foreignId = sqlite.prepare("SELECT id FROM shift_sessions WHERE shift_code='S-FOREIGN'").get().id
  const visible = await call('GET', '/?branch_id=1')
  const visibleBody = await visible.json()
  assert.equal(visible.status, 200)
  assert.equal(visibleBody.scope, 'all')
  assert.equal(visibleBody.shifts.some((shift) => shift.id === foreignId), true, 'POS user can view another cashier in active branch context')
  assert.equal((await call('GET', `/${foreignId}/history`)).status, 200, 'POS user can view another shift detail')
  assert.equal((await call('PATCH', `/${foreignId}`, { reason: 'not mine', opening_float_usd: 6 })).status, 403,
    'POS user cannot amend another cashier shift')

  user = { id: 9, name: 'Settings only', permissions: JSON.stringify({ settings: true }) }
  assert.equal((await call('GET', '/?branch_id=1')).status, 403, 'Settings permission does not grant shift list access')
  assert.equal((await call('GET', `/${foreignId}/history`)).status, 403, 'Settings permission does not grant shift detail access')
  assert.equal((await call('PATCH', `/${foreignId}`, { reason: 'settings elevation', opening_float_usd: 7 })).status, 403,
    'Settings permission does not grant foreign amendment')

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
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.amend'").get().n, 1,
    'only the winning amendment is audited')

  user = { id: 7, name: 'Cashier', permissions: JSON.stringify({ pos: true }) }
  const ownAmendment = await call('PATCH', `/${id}`, { reason: 'owner correction', opening_float_khr: 2500 })
  assert.equal(ownAmendment.status, 200, 'owner can amend own shift without Settings permission')
  assert.equal((await call('POST', `/${foreignId}/close`, { expected_revision: 0,
    closed_at: new Date().toISOString(), closing_counted_usd: 1, closing_counted_khr: 1 })).status, 403,
  'non-owner cannot close another cashier shift by id')
  const historicBadRevision = await call('POST', `/${id}/close`, { expected_revision: 0,
    closed_at: new Date().toISOString(), closing_counted_usd: 20, closing_counted_khr: 3000 })
  assert.equal(historicBadRevision.status, 409, 'historic close requires the current revision')
  const currentRevision = (await ownAmendment.json()).shift.revision
  assert.equal((await call('POST', `/${id}/close`, { expected_revision: currentRevision,
    closed_at: new Date(Date.now() + 60_000).toISOString(), closing_counted_usd: 20, closing_counted_khr: 3000 })).status, 400,
  'historic close rejects a future timestamp')
  assert.equal((await call('POST', `/${id}/close`, { expected_revision: currentRevision,
    closed_at: new Date(Date.now() - 60_000).toISOString(), closing_counted_usd: 20, closing_counted_khr: 3000 })).status, 400,
  'historic close rejects a timestamp before opening')
  const historicClose = await call('POST', `/${id}/close`, { expected_revision: currentRevision,
    closed_at: new Date().toISOString(), closing_counted_usd: 20, closing_counted_khr: 3000 })
  assert.equal(historicClose.status, 200, 'owner can close own historic shift by exact id and revision')
  const storedClose = sqlite.prepare('SELECT closed_at,closing_counted_usd,closing_counted_khr FROM shift_sessions WHERE id=?').get(id)
  assert.equal(storedClose.closing_counted_usd, 20)
  assert.equal(storedClose.closing_counted_khr, 3000)
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.close'").get().n, 1,
    'winning exact close is audited in the same batch')

  sqlite.prepare("UPDATE settings SET value='shop_wide' WHERE key='shift_scope_mode'").run()
  sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr)
    VALUES ('S-SHOP','shop_wide',8,'Shop opener',1,'Canonical Shop',date('now','+7 hours'),datetime('now','-2 hours'),9,9000)`).run()
  assert.equal((await call('POST', '/close', { branch_id: 1, closing_counted_usd: 10, closing_counted_khr: 10000 })).status, 403,
    'shop-wide current close no longer lets another POS user close the opener shift')
  user = { id: 1, username: 'admin', role_code: 'admin' }
  const adminShopClose = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 10, closing_counted_khr: 10000 })
  assert.equal(adminShopClose.status, 200, 'admin override can close a shop-wide shift even when admin-exempt')
  assert.throws(() => sqlite.prepare('DELETE FROM shift_session_amendments').run(), /immutable/, 'ordinary code cannot delete amendment history')
  sqlite.prepare("INSERT INTO system_flags(key,value) VALUES ('maintenance', ?)").run(JSON.stringify({ mode: 'restore', token: 'test' }))
  assert.doesNotThrow(() => sqlite.prepare('DELETE FROM shift_session_amendments').run(), 'authorized restore maintenance can replace amendment history')
  console.log('OK shift security/integrity: permissions, canonical branch, lifecycle, concurrent amendment')
}
main().catch((error) => { console.error(error); process.exit(1) })
