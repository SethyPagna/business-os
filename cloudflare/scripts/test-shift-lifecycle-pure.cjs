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
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
    async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
    async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
  })
  return {
    prepare: statement,
    async batch(items) {
      return sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values)
        return { meta: { changes: info.changes } }
      }))()
    },
  }
}

function database() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_active INTEGER DEFAULT 1);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0089_system_flags.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0119_shift_restore_guard.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0123_shift_reopen_segments.sql'), 'utf8'))
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Shop')
  return db
}

function restoreRows(db, table, rows) {
  if (!rows.length) return
  const columns = Object.keys(rows[0])
  const placeholders = columns.map(() => '?').join(',')
  const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`)
  for (const row of rows) insert.run(...columns.map((column) => row[column]))
}

async function main() {
  const sqlite = database()
  let user = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }
  const sent = []; const waited = []
  const permissions = loadReal('lib/permissions.ts')
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } },
    '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => { throw new Error('lifecycle audit must be in the D1 batch') } },
    '../lib/telegram': { sendTelegramShiftReport: async (_env, shiftId) => { sent.push(shiftId); return true } },
  })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil(promise) { waited.push(promise) }, passThroughOnException() {} })

  const opened = await call('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 10000 })
  assert.equal(opened.status, 201)
  const rootShift = (await opened.json()).shift
  assert.equal(rootShift.parent_shift_id, null)
  assert.deepEqual(rootShift.capabilities, { can_edit: true, can_close: true, can_reopen: false, can_cancel: false })
  assert.deepEqual(sent, [rootShift.id], 'winning root open schedules one open-state report')

  const rootCloseInput = {
    expected_revision: rootShift.revision, closed_at: new Date().toISOString(),
    closing_counted_usd: 12, closing_counted_khr: 12000,
  }
  const [rootCloseA, rootCloseB] = await Promise.all([
    call('POST', `/${rootShift.id}/close`, rootCloseInput),
    call('POST', `/${rootShift.id}/close`, rootCloseInput),
  ])
  assert.deepEqual([rootCloseA.status, rootCloseB.status].sort(), [200, 409], 'concurrent exact close has one winner')
  const rootClose = rootCloseA.status === 200 ? rootCloseA : rootCloseB
  const closedRoot = (await rootClose.json()).shift
  assert.equal(closedRoot.capabilities.can_reopen, true)
  assert.equal(sent.filter((id) => id === rootShift.id).length, 2,
    'root has one opening and one winning close notification')
  const parentBeforeReopen = sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(rootShift.id)

  const ordinarySameDay = await call('POST', '/open', { branch_id: 1, opening_float_usd: 99, opening_float_khr: 99 })
  assert.equal(ordinarySameDay.status, 200)
  assert.equal((await ordinarySameDay.json()).already_registered, true, 'ordinary same-day open returns the closed root and does not create a row')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_sessions WHERE parent_shift_id IS NULL').get().n, 1)

  assert.equal((await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: closedRoot.revision, opening_float_usd: 3, opening_float_khr: 3000,
  })).status, 400, 'reopen requires a reason')
  assert.equal((await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: closedRoot.revision, reason: 'Recount', opening_float_usd: 3,
  })).status, 400, 'reopen requires both native opening counts')

  user = { id: 8, name: 'Other', username: 'other', permissions: JSON.stringify({ pos: true }) }
  assert.equal((await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: closedRoot.revision, reason: 'Not owner', opening_float_usd: 3, opening_float_khr: 3000,
  })).status, 403, 'another POS user cannot reopen the owner shift')
  user = { id: 9, name: 'Settings', username: 'settings', permissions: JSON.stringify({ settings: true }) }
  assert.equal((await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: closedRoot.revision, reason: 'Settings', opening_float_usd: 3, opening_float_khr: 3000,
  })).status, 403, 'Settings permission does not elevate reopen')

  user = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }
  assert.equal((await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: 0, reason: 'Stale', opening_float_usd: 3, opening_float_khr: 3000,
  })).status, 409, 'reopen requires the exact parent revision')
  const reopen = await call('POST', `/${rootShift.id}/reopen`, {
    expected_revision: closedRoot.revision, reason: 'Recount drawer', opening_float_usd: 3, opening_float_khr: 3000,
  })
  assert.equal(reopen.status, 201)
  const child = (await reopen.json()).shift
  assert.equal(child.parent_shift_id, rootShift.id)
  assert.equal(child.reopen_reason, 'Recount drawer')
  assert.equal(child.user_id, rootShift.user_id, 'reopen copies canonical owner rather than the actor request body')
  assert.equal(child.business_date, rootShift.business_date)
  assert.equal(child.opening_float_usd, 3)
  assert.equal(child.opening_float_khr, 3000)
  assert.deepEqual(sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(rootShift.id), parentBeforeReopen,
    'reopen leaves every stored parent field unchanged')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.reopen'").get().n, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_session_amendments WHERE shift_session_id=?').get(child.id).n, 1,
    'reopen reason/provenance commits with the child')
  assert.equal(sent.at(-1), child.id, 'winning reopen schedules one open-state report for the child')

  const current = await call('GET', '/current?branch_id=1')
  assert.equal((await current.json()).shift.id, child.id, 'current resolves the latest linked segment')
  const rootDetail = await call('GET', `/${rootShift.id}/history`)
  assert.equal((await rootDetail.json()).shift.capabilities.can_reopen, false, 'parent loses reopen capability after a child exists')
  assert.equal((await call('PATCH', `/${child.id}`, {
    expected_revision: child.revision, reason: 'Invalid money', opening_float_usd: 'NaN',
  })).status, 400, 'amendment never converts invalid money to zero')
  assert.equal((await call('PATCH', `/${child.id}`, {
    expected_revision: child.revision, reason: 'x'.repeat(501), opening_float_usd: 4,
  })).status, 400, 'amendment reason is bounded')
  assert.equal((await call('PATCH', `/${child.id}`, {
    expected_revision: child.revision, reason: 'Overlap parent', opened_at: new Date(new Date(closedRoot.closed_at).getTime() - 1).toISOString(),
  })).status, 400, 'child amendment cannot overlap its parent')
  assert.equal((await call('PATCH', `/${rootShift.id}`, {
    expected_revision: closedRoot.revision, reason: 'Overlap child', closed_at: new Date(new Date(child.opened_at).getTime() + 1).toISOString(),
  })).status, 400, 'parent amendment cannot overlap its child')

  assert.equal((await call('PATCH', `/${child.id}`, {
    reason: 'Missing revision', opening_note: 'must not save',
  })).status, 400, 'amendment requires a caller-supplied expected revision')
  const firstAmendResponse = await call('PATCH', `/${child.id}`, {
    expected_revision: child.revision, reason: 'Verified opening note', opening_note: 'First accepted value',
  })
  assert.equal(firstAmendResponse.status, 200)
  const amendedChild = (await firstAmendResponse.json()).shift
  const staleAmendResponse = await call('PATCH', `/${child.id}`, {
    expected_revision: child.revision, reason: 'Stale overwrite', opening_note: 'Stale second value',
  })
  assert.equal(staleAmendResponse.status, 409, 'sequential stale amendment is rejected')
  assert.equal(sqlite.prepare('SELECT opening_note FROM shift_sessions WHERE id=?').get(child.id).opening_note, 'First accepted value',
    'stale amendment cannot overwrite the accepted value')

  const childClose = await call('POST', `/${child.id}/close`, {
    expected_revision: amendedChild.revision, closed_at: new Date().toISOString(),
    closing_counted_usd: 4, closing_counted_khr: 4000,
  })
  assert.equal(childClose.status, 200)
  const closedChild = (await childClose.json()).shift
  sent.length = 0
  user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: '{}' }
  const reopenBody = { expected_revision: closedChild.revision, reason: 'Second count', opening_float_usd: 5, opening_float_khr: 5000 }
  const [raceA, raceB] = await Promise.all([
    call('POST', `/${child.id}/reopen`, reopenBody),
    call('POST', `/${child.id}/reopen`, reopenBody),
  ])
  assert.deepEqual([raceA.status, raceB.status].sort(), [201, 409], 'concurrent reopen has one winner')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_sessions WHERE parent_shift_id=?').get(child.id).n, 1)
  assert.equal(sqlite.prepare('SELECT user_id,reopened_by_user_id FROM shift_sessions WHERE parent_shift_id=?').get(child.id).user_id, 7,
    'admin reopen preserves the original owner')
  assert.equal(sqlite.prepare('SELECT user_id,reopened_by_user_id FROM shift_sessions WHERE parent_shift_id=?').get(child.id).reopened_by_user_id, 1,
    'admin override is recorded as the reopen actor')
  assert.equal(sent.length, 1, 'only the winning concurrent reopen schedules Telegram')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.reopen'").get().n, 2,
    'only winning reopen transitions have audit rows')

  const grandchild = sqlite.prepare('SELECT * FROM shift_sessions WHERE parent_shift_id=?').get(child.id)
  const notificationsBeforeRejectedCancels = sent.length
  const waitsBeforeRejectedCancels = waited.length
  user = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }
  assert.equal((await call('POST', `/${grandchild.id}/cancel`, {
    expected_revision: grandchild.revision, reason: 'Owner cannot cancel',
  })).status, 403, 'owner nonadmin cannot cancel a shift')
  user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: '{}' }
  const grandchildDetail = await call('GET', `/${grandchild.id}/history`)
  assert.equal((await grandchildDetail.json()).shift.capabilities.can_cancel, true, 'latest leaf exposes admin-only cancel capability')
  assert.equal((await call('POST', `/${grandchild.id}/cancel`, {
    expected_revision: grandchild.revision, reason: 'x'.repeat(501),
  })).status, 400, 'cancel reason is bounded')
  assert.equal(sent.length, notificationsBeforeRejectedCancels, 'rejected cancellation attempts do not schedule Telegram')
  assert.equal(waited.length, waitsBeforeRejectedCancels, 'rejected cancellation attempts do not register background work')
  const beforeCancel = sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(grandchild.id)
  sent.length = 0
  const waitsBeforeCancelRace = waited.length
  const cancelBody = { expected_revision: grandchild.revision, reason: 'Opening was registered against the wrong drawer' }
  const [cancelA, cancelB] = await Promise.all([
    call('POST', `/${grandchild.id}/cancel`, cancelBody),
    call('POST', `/${grandchild.id}/cancel`, cancelBody),
  ])
  assert.deepEqual([cancelA.status, cancelB.status].sort(), [200, 409], 'concurrent cancellation has one winner')
  const cancel = cancelA.status === 200 ? cancelA : cancelB
  assert.equal(cancel.status, 200)
  const cancelled = (await cancel.json()).shift
  assert.equal(cancelled.cancel_reason, 'Opening was registered against the wrong drawer')
  assert.equal(cancelled.cancelled_by_user_id, 1)
  assert.equal(cancelled.closed_at, beforeCancel.closed_at, 'cancelling open does not invent a close time')
  assert.equal(cancelled.closing_counted_usd, beforeCancel.closing_counted_usd, 'cancelling never invents USD closing cash')
  assert.equal(cancelled.closing_counted_khr, beforeCancel.closing_counted_khr, 'cancelling never invents KHR closing cash')
  assert.equal(cancelled.opening_float_usd, beforeCancel.opening_float_usd, 'cancellation retains original figures')
  assert.deepEqual(cancelled.capabilities, { can_edit: false, can_close: false, can_reopen: false, can_cancel: false })
  assert.deepEqual(sent, [grandchild.id], 'only the winning cancellation schedules its cancellation-aware Telegram report')
  assert.equal(waited.length, waitsBeforeCancelRace + 1, 'only the winning cancellation registers background work')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.cancel'").get().n, 1,
    'cancel and audit commit together')
  assert.equal((await call('POST', `/${grandchild.id}/cancel`, cancelBody)).status, 409,
    'retrying a completed cancellation is rejected')
  assert.deepEqual(sent, [grandchild.id], 'retrying a completed cancellation does not schedule Telegram again')
  assert.equal(waited.length, waitsBeforeCancelRace + 1, 'retrying a completed cancellation registers no background work')
  assert.throws(() => sqlite.prepare('UPDATE shift_sessions SET cancel_reason=? WHERE id=?').run('rewrite', grandchild.id), /immutable/)

  user = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }
  const cancelledCurrent = await call('GET', '/current?branch_id=1')
  const cancelledState = await cancelledCurrent.json()
  assert.equal(cancelledState.shift.id, grandchild.id)
  assert.equal(cancelledState.needs_registration, true)
  assert.equal(cancelledState.is_open, false)
  assert.equal(cancelledState.can_end, false)
  assert.equal((await call('POST', '/open', {
    branch_id: 1, opening_float_usd: 'NaN', opening_float_khr: 1,
  })).status, 400, 'replacement opening requires finite native counts')
  const cancelledBeforeReplacement = sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(grandchild.id)
  const replacementResponse = await call('POST', '/open', {
    branch_id: 1, opening_float_usd: 6, opening_float_khr: 6000,
  })
  assert.equal(replacementResponse.status, 201)
  const replacement = (await replacementResponse.json()).shift
  assert.equal(replacement.parent_shift_id, grandchild.id, 'same-day replacement is linked to the cancelled leaf')
  assert.equal(replacement.opening_float_usd, 6)
  assert.deepEqual(sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(grandchild.id), cancelledBeforeReplacement,
    'replacement opening leaves cancelled history unchanged')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.open_after_cancel'").get().n, 1)
  const replacementAmendResponse = await call('PATCH', `/${replacement.id}`, {
    expected_revision: replacement.revision,
    reason: 'Correct replacement opening note',
    opening_note: 'Replacement float verified',
  })
  assert.equal(replacementAmendResponse.status, 200,
    'a child opened after a cancelled parent remains amendable')
  const replacementAmended = (await replacementAmendResponse.json()).shift
  assert.equal(replacementAmended.opening_note, 'Replacement float verified')
  assert.equal(replacementAmended.revision, replacement.revision + 1)
  assert.deepEqual(sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(grandchild.id), cancelledBeforeReplacement,
    'amending the replacement leaves its cancelled parent unchanged')

  user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: '{}' }
  assert.equal((await call('POST', `/${grandchild.id}/cancel`, {
    expected_revision: cancelled.revision, reason: 'Cannot cancel ancestor again',
  })).status, 409, 'cancelled or non-leaf history cannot be cancelled again')

  sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at)
    VALUES ('OLD-OPEN','per_account',20,'Old cashier',1,'Shop','2026-01-01','2026-01-01T01:00:00.000Z')`).run()
  const bounded = await call('GET', '/?branch_id=1&limit=1')
  const boundedRows = (await bounded.json()).shifts
  assert.equal(boundedRows.some((shift) => shift.shift_code === 'OLD-OPEN'), true,
    'historic unresolved shifts remain visible outside the closed-row limit')
  assert.equal(boundedRows[0].closed_at, null, 'unresolved shifts are ordered before bounded closed rows')

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  assert.doesNotThrow(() => sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at)
    VALUES ('NEXT-DAY','per_account',7,'Owner',1,'Shop',?,?)`).run(tomorrow, `${tomorrow}T01:00:00.000Z`),
  'a new root remains valid on the next business day')
  assert.throws(() => sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at)
    VALUES ('DUP-ROOT','per_account',7,'Owner',1,'Shop',?,?)`).run(rootShift.business_date, new Date().toISOString()), /UNIQUE/,
  'linked children do not weaken same-day root uniqueness')

  sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at)
    VALUES ('HIST-OPEN','per_account',30,'Historic',1,'Shop','2026-02-01','2026-02-01T01:00:00.000Z'),
      ('HIST-NEXT','per_account',30,'Historic',1,'Shop','2026-02-02','2026-02-02T01:00:00.000Z')`).run()
  const historic = sqlite.prepare("SELECT id,revision FROM shift_sessions WHERE shift_code='HIST-OPEN'").get()
  assert.equal((await call('POST', `/${historic.id}/close`, {
    expected_revision: historic.revision, closed_at: '2026-02-02T02:00:00.000Z',
    closing_counted_usd: 1, closing_counted_khr: 1,
  })).status, 409, 'historic close cannot overlap the next existing shift')

  const backupSource = fs.readFileSync(path.join(root, 'src', 'lib', 'backup.ts'), 'utf8')
  assert.match(backupSource, /'shift_sessions'/)
  assert.match(backupSource, /SELECT \* FROM \$\{qid\(table\)\}/,
    'dynamic SELECT-star backup includes appended lineage columns without a backup.ts write')
  const backedUpShifts = sqlite.prepare('SELECT * FROM shift_sessions ORDER BY id').all()
  const backedUpAmendments = sqlite.prepare('SELECT * FROM shift_session_amendments ORDER BY id').all()
  sqlite.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES ('maintenance',?)").run(JSON.stringify({ mode: 'restore' }))
  sqlite.prepare('DELETE FROM shift_session_amendments').run()
  assert.doesNotThrow(() => sqlite.prepare('DELETE FROM shift_sessions').run(),
    'maintenance restore can delete a self-referenced root/child table with foreign keys enabled')
  restoreRows(sqlite, 'shift_sessions', backedUpShifts)
  restoreRows(sqlite, 'shift_session_amendments', backedUpAmendments)
  assert.equal(sqlite.prepare('SELECT parent_shift_id FROM shift_sessions WHERE id=?').get(replacement.id).parent_shift_id, grandchild.id)
  assert.equal(sqlite.prepare('SELECT cancel_reason FROM shift_sessions WHERE id=?').get(grandchild.id).cancel_reason,
    'Opening was registered against the wrong drawer')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_session_amendments').get().n, backedUpAmendments.length,
    'full restore retains append-only amendments')

  const legacyRestore = database()
  legacyRestore.prepare(`INSERT INTO shift_sessions
    (id,shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,
      opening_float_usd,opening_float_khr,opening_note,closed_at,closing_counted_usd,closing_counted_khr,closing_note,revision)
    VALUES (91,'LEGACY','per_account',44,'Legacy',1,'Shop','2025-12-01','2025-12-01T01:00:00.000Z',
      8,8000,'old backup',NULL,NULL,NULL,NULL,0)`).run()
  const legacyRow = legacyRestore.prepare('SELECT * FROM shift_sessions WHERE id=91').get()
  assert.equal(legacyRow.opening_float_usd, 8)
  assert.equal(legacyRow.opening_float_khr, 8000)
  assert.equal(legacyRow.parent_shift_id, null)
  assert.equal(legacyRow.cancelled_at, null, 'pre-0123 scoped rows restore as unchanged roots with nullable new metadata')
  assert.equal(waited.every((promise) => typeof promise.then === 'function'), true)
  console.log('OK shift lifecycle: linked reopen/cancel, permissions, intervals, atomic audit, backup restore and Telegram scheduling')
}

main().catch((error) => { console.error(error); process.exit(1) })
