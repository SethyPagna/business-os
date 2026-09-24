// A NEW SHIFT'S ID IS ITS DATE, ITS MINUTE AND ITS CASHIER.
//
// Owner, 23 Sep 2026: "ID សម្គាល់: S-20260922-0807-Za ... for ID make it
// format after time -cashier... no need other things."
//
// routes/shifts.ts now writes S-<business yyyymmdd>-<HHMM>-<cashier> for a new
// row and for a continuation; a cashier who starts a second row in the same
// minute gets the lowest free -2, -3, ... by exact membership; stored IDs are
// never rewritten. This file pins:
//
//   1. shiftCodeBase -- the owner's own example, whitespace, the 24-code-point
//      cap (whole characters: a Khmer sign, a flag, an emoji), the U<id>
//      fallback, the business-day rollover, and a bare D1 timestamp read on a
//      non-UTC host;
//   2. freeShiftCode -- base free, -2, -3, the lowest gap, and codes that only
//      LOOK like suffixes (cashier "Za-2", a case variant, LIKE wildcards);
//   3. the real route over real SQLite with its clock frozen to one instant:
//      open, a second branch in the same minute, another cashier named "Za-2",
//      a reopen by an administrator (the child names the PARENT's cashier), the
//      U<id> fallback, a Khmer name with a space, the audit row quoting the ID,
//      and the Edited badge still not counting a reopen;
//   4. the races keep today's answers when a peer takes the same ID between the
//      read and the write: open -> already_registered, reopen -> 409, and the
//      replacement after a cancellation -> already_registered.
//
// Discriminating: at a39a3cbb the route exported neither function and ended
// every ID with six random hex characters (crypto.randomUUID), so parts 1-3
// fail there, and part 4's hook never fires because nothing read the taken IDs.
//
// Run (from cloudflare/): node scripts/test-shift-code-format-pure.cjs

// A non-UTC host, before any Date exists: the deployed Worker runs UTC, so only
// a harness like this one can show a bare D1 timestamp being read as local time.
process.env.TZ = 'Asia/Phnom_Penh'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

// One instant for the whole route run, taken from the real clock so SQLite's
// own date('now') (the /current and "today" checks) agrees with it.
const FIXED = Date.now()
class FrozenDate extends Date {
  constructor(...args) { if (args.length) super(...args); else super(FIXED) }
  static now() { return FIXED }
}

function loadReal(relPath, overrides = {}, globals = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  const names = Object.keys(globals)
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', ...names, outputText)(
      mod.exports, require, mod, sourcePath, path.dirname(sourcePath), ...names.map((name) => globals[name]))
  } finally { Module._load = original }
  return mod.exports
}

function d1(sqlite, hooks) {
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); const result = sqlite.prepare(q.sql).get(...q.values); hooks.afterRead(sql, params, result); return result },
    async all(params) { const q = translate(sql, params); const result = sqlite.prepare(q.sql).all(...q.values); hooks.afterRead(sql, params, result); return result },
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
  for (const file of ['0089_system_flags.sql', '0118_shift_policy_and_amendments.sql', '0119_shift_restore_guard.sql',
    '0123_shift_reopen_segments.sql', '0132_shift_opening_count_presence.sql', '0147_shift_additional_cash.sql']) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1),(2,?,1)').run('Shop', 'Second')
  return db
}

const pos = JSON.stringify({ pos: true })
const ZA = { id: 7, username: 'Za', name: 'Za Display', permissions: pos }
const ZA_2 = { id: 8, username: 'Za-2', name: 'Another cashier', permissions: pos }
const BOSS = { id: 1, username: 'boss', role_code: 'admin', permissions: pos }
const NO_NAME = { id: 12, permissions: pos }
const KHMER = { id: 13, username: 'សុខ ដារ៉ា', permissions: pos }

function scenario() {
  const sqlite = database()
  let actor = ZA
  const hooks = { afterRead() {} }
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': { getDb: () => d1(sqlite, hooks) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
    // No sales tables here: the ID is under test, not the drawer arithmetic.
    '../lib/shiftReconciliation': { loadShiftReconciliation: async () => null, loadShiftFigures: async () => null },
  }, { Date: FrozenDate })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })
  const open = async (branchId) => {
    const res = await call('POST', '/open', { branch_id: branchId, opening_float_usd: 10, opening_float_khr: 0 })
    assert.equal(res.status, 201, `open for branch ${branchId} as ${actor.username ?? actor.id}`)
    return (await res.json()).shift
  }
  // A peer request that commits between this request's read of the taken IDs
  // and its own write. It computed the same pick from the same read.
  const racePeerAfterTakenRead = (insertPeer) => {
    const state = { fired: false }
    hooks.afterRead = (sql, params, result) => {
      if (state.fired || !/SELECT shift_code FROM shift_sessions\s+WHERE shift_code = @base/.test(sql)) return
      state.fired = true
      insertPeer(route.freeShiftCode(params.base, result.map((row) => row.shift_code)))
    }
    return state
  }
  return { sqlite, route, call, open, actAs: (next) => { actor = next }, racePeerAfterTakenRead }
}

// The expected stamp, from the frozen instant by independent arithmetic.
const two = (n) => String(n).padStart(2, '0')
const localFixed = new Date(FIXED + 7 * 60 * 60 * 1000)
const STAMP = `S-${localFixed.getUTCFullYear()}${two(localFixed.getUTCMonth() + 1)}${two(localFixed.getUTCDate())}`
  + `-${two(localFixed.getUTCHours())}${two(localFixed.getUTCMinutes())}`
const FIXED_ISO = new Date(FIXED).toISOString()

async function main() {
  const { route: pure } = scenario()
  const { shiftCodeBase, freeShiftCode } = pure
  assert.equal(typeof shiftCodeBase, 'function', 'routes/shifts.ts exports shiftCodeBase')
  assert.equal(typeof freeShiftCode, 'function', 'routes/shifts.ts exports freeShiftCode')

  // ---- 1. the format ------------------------------------------------------
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'Za', 7), 'S-20260922-0807-Za', "the owner's own example")
  assert.equal(shiftCodeBase('2026-09-22T01:07:00.000Z', 'Za', 7), 'S-20260922-0807-Za', 'milliseconds change nothing')
  assert.equal(shiftCodeBase('2026-09-22T17:30:00Z', 'Za', 7), 'S-20260923-0030-Za',
    'the date and time are the business day (UTC+7), so half past midnight is already the next day')
  assert.equal(shiftCodeBase('2026-09-22 01:07:00', 'Za', 7), 'S-20260922-0807-Za',
    'a bare D1 timestamp is UTC even on a non-UTC host')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', '  Sok   Dara  ', 7), 'S-20260922-0807-Sok-Dara',
    'the name is trimmed and each whitespace run becomes one hyphen')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'Sok\tDara\nChan', 7), 'S-20260922-0807-Sok-Dara-Chan',
    'tabs and line breaks are whitespace too')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'za-2', 7), 'S-20260922-0807-za-2', 'a hyphen in a name is kept')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'a'.repeat(30), 7), `S-20260922-0807-${'a'.repeat(24)}`,
    'a long name is capped at 24 characters')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'b'.repeat(24), 7), `S-20260922-0807-${'b'.repeat(24)}`,
    'exactly 24 characters is not cut')
  for (const empty of [null, '', '   ', '\t\n']) {
    assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', empty, 12), 'S-20260922-0807-U12',
      `no cashier name (${JSON.stringify(empty)}) falls back to U<user id>`)
  }
  const khmer24 = 'សុខ'.repeat(8) // 24 code points
  assert.equal(Array.from(khmer24).length, 24)
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', khmer24, 7), `S-20260922-0807-${khmer24}`,
    'a 24-code-point Khmer username stays whole')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'សុខ'.repeat(9), 7), `S-20260922-0807-${khmer24}`,
    'a longer Khmer username keeps its first 24 code points')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'សុខ ដារ៉ា', 7), 'S-20260922-0807-សុខ-ដារ៉ា',
    'a Khmer name with a space reads as one hyphenated word')
  const emojiName = shiftCodeBase('2026-09-22T01:07:00Z', '😀'.repeat(30), 7).slice('S-20260922-0807-'.length)
  assert.equal(emojiName, '😀'.repeat(24), 'the cap counts code points, so 24 emoji survive, not 12')
  assert.ok(emojiName.isWellFormed(), 'no character is cut in half (no lone surrogate)')
  // The ID is stored once and never rewritten, so a cut by code points would
  // freeze another word into it: "ស្រស់" cut after its fourth reads "ស្រស".
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', 'ស្រស់'.repeat(5), 7), `S-20260922-0807-${'ស្រស់'.repeat(4)}ស្រ`,
    'a long Khmer name drops a whole last character, never its final sign')
  assert.equal(shiftCodeBase('2026-09-22T01:07:00Z', `a${'🇰🇭'.repeat(12)}`, 7), `S-20260922-0807-a${'🇰🇭'.repeat(11)}`,
    'a flag is never cut in half')

  // ---- 2. the free suffix -------------------------------------------------
  const base = 'S-20260922-0807-Za'
  assert.equal(freeShiftCode(base, []), base, 'nothing taken: the plain ID')
  assert.equal(freeShiftCode(base, [`${base}-2`]), base,
    'a "-2" that belongs to another cashier named "Za-2" does not take the plain ID')
  assert.equal(freeShiftCode(base, ['S-20260922-0807-ZA', 'S-20260922-0807-zA-2', 'S-20260922-0807-Z_', 'S-20260922-0807-Za%']), base,
    "rows LIKE returns only by its case folding or wildcards never block the plain ID")
  assert.equal(freeShiftCode(base, [base]), `${base}-2`, 'plain ID taken: -2')
  assert.equal(freeShiftCode(base, [base, `${base}-2`]), `${base}-3`,
    'plain ID taken and -2 taken (by the cashier "Za-2"): -3')
  assert.equal(freeShiftCode(base, [base, `${base}-3`]), `${base}-2`, 'the lowest free suffix, not one past the highest')
  assert.equal(freeShiftCode(base, [base, `${base}-2`, `${base}-3`, `${base}-2-2`]), `${base}-4`,
    "a suffix on the other cashier's own suffixed ID does not confuse the count")

  // ---- 3. the route writes it ---------------------------------------------
  {
    const { sqlite, call, open, actAs } = scenario()
    actAs(ZA_2)
    const otherCashier = await open(1)
    assert.equal(otherCashier.shift_code, `${STAMP}-Za-2`, 'cashier "Za-2" gets the plain ID of their own name')
    actAs(ZA)
    const first = await open(1)
    assert.equal(first.shift_code, `${STAMP}-Za`, "S-<date>-<time>-<cashier>, and \"Za-2\"'s ID does not push Za to a suffix")
    assert.equal(first.user_name, 'Za', 'the cashier in the ID is the username the row records')
    const second = await open(2)
    assert.equal(second.shift_code, `${STAMP}-Za-3`,
      'the same cashier in the same minute on a second branch: -2 is already "Za-2", so -3')
    const audit = sqlite.prepare("SELECT details, new_value FROM audit_logs WHERE action='shift.open' AND entity_id=?").get(String(first.id))
    assert.equal(JSON.parse(audit.details).shift_code, first.shift_code, 'the open audit row quotes the ID it wrote')
    assert.equal(JSON.parse(audit.new_value).shift_code, first.shift_code)

    const closed = await call('POST', `/${first.id}/close`, { expected_revision: first.revision })
    assert.equal(closed.status, 200)
    actAs(BOSS)
    const reopened = await call('POST', `/${first.id}/reopen`, { expected_revision: first.revision + 1, reason: 'Recount drawer' })
    assert.equal(reopened.status, 201)
    const child = (await reopened.json()).shift
    assert.equal(child.shift_code, `${STAMP}-Za-4`,
      "a reopen by an administrator names the parent's cashier, not the administrator, and takes the next free suffix")
    assert.equal(child.user_name, 'Za')
    assert.equal(child.reopened_by_user_name, 'boss')
    assert.equal(sqlite.prepare('SELECT shift_code FROM shift_sessions WHERE id=?').get(first.id).shift_code, first.shift_code,
      'the parent keeps its stored ID')
    const listed = await (await call('GET', '/?page=1&page_size=20')).json()
    assert.equal(listed.shifts.find((row) => row.id === child.id).amendment_count, 0,
      'a reopen still differs in shift_code before/after, so it never lights the Edited badge')

    actAs(NO_NAME)
    const unnamed = await open(1)
    assert.equal(unnamed.shift_code, `${STAMP}-U12`, 'an account with no username and no name is U<id>')
    assert.equal(unnamed.user_name, null)
    actAs(KHMER)
    const khmer = await open(1)
    assert.equal(khmer.shift_code, `${STAMP}-សុខ-ដារ៉ា`, 'a Khmer username with a space')
    assert.equal(khmer.user_name, 'សុខ ដារ៉ា', 'the stored cashier name itself is untouched')
  }

  // ---- 4. a peer that takes the same ID first ------------------------------
  {
    // Open: the same cashier's other device registers the same till first.
    const { sqlite, call, actAs, racePeerAfterTakenRead } = scenario()
    actAs(ZA)
    let peerId = null
    const race = racePeerAfterTakenRead((code) => {
      peerId = sqlite.prepare(`INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at)
        VALUES (?,'per_account',7,'Za',1,'Shop',date(?, '+7 hours'),?)`).run(code, FIXED_ISO, FIXED_ISO).lastInsertRowid
    })
    const res = await call('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
    assert.equal(race.fired, true, 'the peer really commits between the read of the taken IDs and the write')
    assert.equal(res.status, 200, 'the loser of the UNIQUE index is answered, not a 500')
    const body = await res.json()
    assert.equal(body.already_registered, true)
    assert.equal(body.shift.id, Number(peerId), "the answer is the peer's registration")
    assert.equal(body.shift.shift_code, `${STAMP}-Za`)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_sessions').get().n, 1, 'no second row')
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.open'").get().n, 0,
      'the losing write left no audit row behind')
  }
  {
    // Reopen: another request reopens the same segment first.
    const { sqlite, call, open, actAs, racePeerAfterTakenRead } = scenario()
    actAs(ZA)
    const parent = await open(1)
    assert.equal((await call('POST', `/${parent.id}/close`, { expected_revision: parent.revision })).status, 200)
    const race = racePeerAfterTakenRead((code) => {
      sqlite.prepare(`INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,
        parent_shift_id,reopen_reason,reopened_by_user_id,reopened_by_user_name)
        VALUES (?,'per_account',7,'Za',1,'Shop',?,?,?,'Peer reopen',7,'Za')`).run(code, parent.business_date, FIXED_ISO, parent.id)
    })
    const res = await call('POST', `/${parent.id}/reopen`, { expected_revision: parent.revision + 1, reason: 'Recount drawer' })
    assert.equal(race.fired, true)
    assert.equal(res.status, 409, 'the reopen that lost keeps its concurrency conflict')
    assert.equal((await res.json()).error, 'This shift segment was already reopened or changed concurrently.')
    assert.deepEqual(sqlite.prepare('SELECT shift_code, reopen_reason FROM shift_sessions WHERE parent_shift_id=?').all(parent.id),
      [{ shift_code: `${STAMP}-Za-2`, reopen_reason: 'Peer reopen' }], "exactly one continuation: the peer's")
  }
  {
    // Replacement after a cancellation: the cashier's other device opens it first.
    const { sqlite, call, open, actAs, racePeerAfterTakenRead } = scenario()
    actAs(ZA)
    const cancelledShift = await open(1)
    actAs(BOSS)
    assert.equal((await call('POST', `/${cancelledShift.id}/cancel`, { expected_revision: cancelledShift.revision, reason: 'Wrong float' })).status, 200)
    actAs(ZA)
    let peerId = null
    const race = racePeerAfterTakenRead((code) => {
      peerId = sqlite.prepare(`INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,
        parent_shift_id,reopen_reason,reopened_by_user_id,reopened_by_user_name)
        VALUES (?,'per_account',7,'Za',1,'Shop',?,?,?,'Replacement after cancellation: Wrong float',7,'Za')`)
        .run(code, cancelledShift.business_date, FIXED_ISO, cancelledShift.id).lastInsertRowid
    })
    const res = await call('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
    assert.equal(race.fired, true)
    assert.equal(res.status, 200, 'the replacement that lost is answered with the winning one')
    const body = await res.json()
    assert.equal(body.already_registered, true)
    assert.equal(body.shift.id, Number(peerId))
    assert.equal(body.shift.shift_code, `${STAMP}-Za-2`, "the replacement's ID follows the cancelled one's")
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shift_sessions WHERE parent_shift_id=?').get(cancelledShift.id).n, 1)
  }
  console.log('test-shift-code-format-pure: OK')
}

main().catch((error) => { console.error(error); process.exit(1) })
