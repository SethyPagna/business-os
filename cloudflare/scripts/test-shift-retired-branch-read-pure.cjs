// CUTOVER-LC item 5 (N7): after the branch consolidation Shop is "Old Shop" (inactive, successor LC Store).
// A till tab that still carries X-Branch-Id=<Old Shop> must READ its shift state and history (200), not get a
// 400; the list must keep showing the retired branch's shifts. Every WRITE still refuses a retired branch.
// Both states are exercised: before the cutover (both branches active, NULL roles) nothing changes.
// The last block swaps the read lookup back to the write lookup and must reproduce the defect.
process.env.TZ = 'Asia/Phnom_Penh'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function loadReal(relPath, overrides = {}, mutate = (s) => s) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(mutate(fs.readFileSync(sourcePath, 'utf8')), {
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

function database({ retired }) {
  const db = new Database(':memory:')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, role TEXT, canonical_key TEXT, successor_branch_id INTEGER);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  for (const m of ['0089_system_flags', '0118_shift_policy_and_amendments', '0119_shift_restore_guard', '0123_shift_reopen_segments', '0132_shift_opening_count_presence', '0147_shift_additional_cash']) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', `${m}.sql`), 'utf8'))
  }
  // Names deliberately differ from the roles: the guard under test is existence, never a name.
  if (retired) {
    db.exec(`INSERT INTO branches(id,name,is_active,role,canonical_key,successor_branch_id) VALUES
      (1,'LC Store',1,'shop','warehouse',NULL), (2,'Old Shop',0,'shop','shop',1)`)
  } else {
    db.exec(`INSERT INTO branches(id,name,is_active,role,canonical_key,successor_branch_id) VALUES
      (1,'Warehouse',1,NULL,NULL,NULL), (2,'Shop',1,NULL,NULL,NULL)`)
  }
  return db
}

async function scenario({ retired, mutate }) {
  const sqlite = database({ retired }); const user = { id: 7, name: 'Cashier', permissions: JSON.stringify({ pos: true }) }
  const route = loadReal('routes/shifts.ts', {
    '../lib/branchRedirectWrite': require('./harness/branch_redirect_write.cjs'), // CUTOVER-LR: shift open may land at the redirect target
    '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'), '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'), '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } }, '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/audit': { audit: async () => { throw new Error('shift writes must use the atomic audit batch') } },
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
    '../lib/shiftReconciliation': { loadShiftReconciliation: async () => { throw new Error('no sales tables in this fixture') } },
  }, mutate)
  const app = route.default || route
  const call = (method, url, body, headers = {}) => app.fetch(new Request(`http://test${url}`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })

  // The cashier has no shift yet: the till asks what to do. A retired branch must not ask it to register one.
  const current = await call('GET', '/current', undefined, { 'X-Branch-Id': '2' })
  // The cashier's closed shift at branch 2 (the Shop till), recorded before the cutover.
  sqlite.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,opening_float_usd,opening_float_khr)
    VALUES ('S-OLD','per_account',7,'Cashier',2,'Shop',date(datetime('now','-3 hour'),'+7 hours'),datetime('now','-3 hour'),datetime('now','-2 hour'),5,1000)`).run()
  const shiftId = sqlite.prepare("SELECT id FROM shift_sessions WHERE shift_code='S-OLD'").get().id
  const out = {}
  out.currentStatus = current.status
  const currentBody = current.status === 200 ? await current.json() : null
  out.currentNeedsRegistration = currentBody?.needs_registration
  out.currentRetiredFlag = currentBody?.code === 'branch_inactive' && currentBody?.branch_inactive != null
  const list = await call('GET', '/?branch_id=2')
  out.listStatus = list.status
  out.listHasShift = list.status === 200 && (await list.json()).shifts.some((s) => s.id === shiftId)
  const history = await call('GET', `/${shiftId}/history`)
  out.historyStatus = history.status
  out.unknownBranchStatus = (await call('GET', '/current', undefined, { 'X-Branch-Id': '999' })).status
  out.patchStatus = (await call('PATCH', `/${shiftId}`, { expected_revision: 0, reason: 'recount', opening_float_usd: 6 })).status
  out.patchWrote = sqlite.prepare('SELECT opening_float_usd FROM shift_sessions WHERE id=?').get(shiftId).opening_float_usd !== 5
  out.openStatus = (await call('POST', '/open', { branch_id: 2, opening_float_usd: 1, opening_float_khr: 0 })).status
  return out
}

;(async () => {
  // AFTER the cutover (Old Shop retired, successor LC Store).
  const after = await scenario({ retired: true })
  assert.equal(after.currentStatus, 200, 'GET /shifts/current for the retired branch answers instead of 400')
  assert.equal(after.currentNeedsRegistration, false, 'a retired branch never asks the till to register a shift (open would refuse it)')
  assert.equal(after.currentRetiredFlag, true, 'the response says why')
  assert.equal(after.listStatus, 200, 'GET /shifts for the retired branch answers')
  assert.equal(after.listHasShift, true, 'and still lists the retired branch shift history')
  assert.equal(after.historyStatus, 200, 'the history of a shift at the retired branch stays readable')
  assert.equal(after.unknownBranchStatus, 400, 'an unknown branch id is still refused')
  assert.equal(after.openStatus, 400, 'opening a shift at a retired branch is still refused')
  assert.equal(after.patchStatus, 409, 'amending a retired branch shift is still refused (N7 inactiveBranchRefusal)')
  assert.equal(after.patchWrote, false, 'the refused amend wrote nothing')

  // BEFORE the cutover (both active, NULL roles): nothing about the answers changes.
  const before = await scenario({ retired: false })
  assert.equal(before.currentStatus, 200)
  assert.equal(before.currentNeedsRegistration, true, 'an active branch with no current shift still asks the till to register')
  assert.equal(before.currentRetiredFlag, false, 'no retired flag while the branch is active')
  assert.equal(before.listStatus, 200); assert.equal(before.listHasShift, true); assert.equal(before.historyStatus, 200)
  assert.equal(before.unknownBranchStatus, 400)
  assert.equal(before.patchStatus, 200, 'amend works while the branch is active')
  assert.ok([200, 201].includes(before.openStatus), 'an active Shop opens (or resumes) a shift exactly as before, never a 400')

  // Wrong implementation: the read lookup still requires an active branch (the N7 defect).
  const wrong = await scenario({
    retired: true,
    mutate: (s) => s.split("FROM branches WHERE id=@id'").join("FROM branches WHERE id=@id AND is_active=1'"),
  })
  assert.equal(wrong.currentStatus, 400, 'control: an active-only read lookup reproduces the N7 400, so the fixture discriminates')
  assert.equal(wrong.listStatus, 400, 'control: and refuses the retired branch history list')
  console.log('PASS shifts read a retired branch (history, list, current) and still refuse every write to it, before and after the cutover')
})().catch((error) => { console.error(error); process.exit(1) })
