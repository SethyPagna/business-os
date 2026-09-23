// SEARCH THE SHIFT LIST BY CASHIER OR ID.
//
// Owner, 23 Sep 2026: "also make sure when entering shift, i can search the
// cashier, or id."
//
// GET /api/shifts?q=<text>&page=&page_size= (and the unpaged open + closed
// read) takes `q`: trimmed, blank means no filter, more than 80 characters
// (code points) is a 400. It matches a substring of the cashier name the row
// records or of the shift ID, ignoring ASCII case, with the caller's %, _ and
// \ taken literally. This drives the real routes/shifts.ts over real SQLite and
// pins:
//
//   1. cashier and ID matches, ASCII case folding, an old-format ID, a row
//      with no cashier name (U<id>), and a reopened record found by the ID of
//      its FIRST segment (the list shows only the last one);
//   2. wildcards and the escape character are literal: '%', '_' and '\' each
//      find only the row that really contains one;
//   3. it composes with visibility (a cashier who may see only their own
//      shifts still sees only their own), branch, user_id and the date range;
//   4. paging: total, has_more and the page clamp count only matching rows;
//      the unpaged read filters its open and its closed halves;
//   5. the 80-character bound counts code points, and blank/whitespace q is
//      no filter at all.
//
// Discriminating: at a39a3cbb the route ignored `q`, so every search returned
// the whole visible list and an 81-character search was a 200.
//
// Run (from cloudflare/): node scripts/test-shift-list-search-pure.cjs
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
  for (const file of ['0089_system_flags.sql', '0118_shift_policy_and_amendments.sql', '0119_shift_restore_guard.sql',
    '0123_shift_reopen_segments.sql', '0132_shift_opening_count_presence.sql', '0147_shift_additional_cash.sql']) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1),(2,?,1)').run('Shop', 'Second')
  return db
}

const pos = JSON.stringify({ pos: true })
const ZA = { id: 7, username: 'Za', permissions: pos }
const BOSS = { id: 1, username: 'boss', role_code: 'admin', permissions: pos }

function scenario() {
  const sqlite = database()
  let actor = BOSS
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
    '../lib/shiftReconciliation': { loadShiftReconciliation: async () => null, loadShiftFigures: async () => null },
  })
  const app = route.default || route
  const get = async (query) => {
    const res = await app.fetch(new Request(`http://test/?${query}`), {}, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  const insert = (row) => {
    const full = { scope_mode: 'per_account', branch_id: 1, branch_name: 'Shop', parent_shift_id: null,
      reopen_reason: null, reopened_by_user_id: null, closed_at: `${row.business_date}T09:00:00.000Z`,
      opened_at: `${row.business_date}T01:00:00.000Z`, ...row }
    // A continuation must be inserted open (migration 0123), then closed.
    const id = Number(sqlite.prepare(`INSERT INTO shift_sessions (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,
      business_date,opened_at,closed_at,parent_shift_id,reopen_reason,reopened_by_user_id)
      VALUES (@shift_code,@scope_mode,@user_id,@user_name,@branch_id,@branch_name,@business_date,@opened_at,@initial_closed_at,
        @parent_shift_id,@reopen_reason,@reopened_by_user_id)`)
      .run({ ...full, initial_closed_at: full.parent_shift_id == null ? full.closed_at : null }).lastInsertRowid)
    if (full.parent_shift_id != null && full.closed_at) {
      sqlite.prepare('UPDATE shift_sessions SET closed_at=?, revision=revision+1 WHERE id=?').run(full.closed_at, id)
    }
    return id
  }
  return { sqlite, get, insert, actAs: (next) => { actor = next } }
}

const codesOf = (body) => body.shifts.map((row) => row.shift_code).sort()
const q = (text) => `q=${encodeURIComponent(text)}`

async function main() {
  const { get, insert, actAs } = scenario()
  insert({ shift_code: 'S-20260922-0807-Za', user_id: 7, user_name: 'Za', business_date: '2026-09-22' })
  insert({ shift_code: 'S-20260922-0900-Sok', user_id: 8, user_name: 'Sok', business_date: '2026-09-22' })
  insert({ shift_code: 'S-20260921-0800-Za', user_id: 7, user_name: 'Za', business_date: '2026-09-21', branch_id: 2, branch_name: 'Second' })
  insert({ shift_code: 'S-20260920-0800-abc123', user_id: 7, user_name: 'Za', business_date: '2026-09-20' })
  insert({ shift_code: 'S-20260919-0800-x_y%z', user_id: 9, user_name: 'x_y%z', business_date: '2026-09-19' })
  insert({ shift_code: 'S-20260917-0800-back\\slash', user_id: 10, user_name: 'back\\slash', business_date: '2026-09-17' })
  insert({ shift_code: 'S-20260916-0800-U12', user_id: 12, user_name: null, business_date: '2026-09-16' })
  // A reopened record: the list shows only its last segment.
  const parentId = insert({ shift_code: 'S-20260918-0800-Sok', user_id: 8, user_name: 'Sok', business_date: '2026-09-18' })
  insert({ shift_code: 'S-20260918-0930-Sok', user_id: 8, user_name: 'Sok', business_date: '2026-09-18',
    opened_at: '2026-09-18T09:30:00.000Z', closed_at: '2026-09-18T11:00:00.000Z',
    parent_shift_id: parentId, reopen_reason: 'Recount drawer', reopened_by_user_id: 8 })

  const everything = await get('page=1&page_size=50')
  assert.equal(everything.status, 200)
  assert.equal(everything.body.total, 8, 'eight records without a search (the reopened pair lists once)')

  // ---- 1. cashier and ID ---------------------------------------------------
  const byCashier = await get(`${q('Sok')}&page=1&page_size=50`)
  assert.equal(byCashier.status, 200)
  assert.deepEqual(codesOf(byCashier.body), ['S-20260918-0930-Sok', 'S-20260922-0900-Sok'], 'a cashier name finds that cashier')
  assert.equal(byCashier.body.total, 2)
  assert.deepEqual(codesOf((await get(`${q('za')}&page=1&page_size=50`)).body),
    ['S-20260920-0800-abc123', 'S-20260921-0800-Za', 'S-20260922-0807-Za'], 'the cashier half ignores ASCII case')
  assert.deepEqual(codesOf((await get(`${q('S-20260922-0807-Za')}&page=1&page_size=50`)).body), ['S-20260922-0807-Za'],
    "the owner's example ID finds exactly its shift")
  assert.deepEqual(codesOf((await get(`${q('s-20260922')}&page=1&page_size=50`)).body), ['S-20260922-0807-Za', 'S-20260922-0900-Sok'],
    'part of an ID, in lower case, finds every shift of that day')
  assert.deepEqual(codesOf((await get(`${q('0807')}&page=1&page_size=50`)).body), ['S-20260922-0807-Za'], 'the time alone is a substring too')
  assert.deepEqual(codesOf((await get(`${q('abc123')}&page=1&page_size=50`)).body), ['S-20260920-0800-abc123'],
    'an ID in the old random-suffix form is still found')
  assert.deepEqual(codesOf((await get(`${q('u12')}&page=1&page_size=50`)).body), ['S-20260916-0800-U12'],
    'a row with no cashier name is found by its U<id>')
  assert.deepEqual(codesOf((await get(`${q('S-20260918-0800')}&page=1&page_size=50`)).body), ['S-20260918-0930-Sok'],
    "the ID of a reopened record's FIRST segment finds the record (listed as its last segment)")
  assert.deepEqual(codesOf((await get(`${q('0930')}&page=1&page_size=50`)).body), ['S-20260918-0930-Sok'],
    'the listed segment is found by its own ID')
  assert.equal((await get(`${q('nobody')}&page=1&page_size=50`)).body.total, 0, 'no match is an empty page, not everything')

  // ---- 2. wildcards are literal ---------------------------------------------
  assert.deepEqual(codesOf((await get(`${q('%')}&page=1&page_size=50`)).body), ['S-20260919-0800-x_y%z'],
    "'%' finds only the row that contains a percent sign")
  assert.deepEqual(codesOf((await get(`${q('_')}&page=1&page_size=50`)).body), ['S-20260919-0800-x_y%z'],
    "'_' finds only the row that contains an underscore")
  assert.deepEqual(codesOf((await get(`${q('x_y%z')}&page=1&page_size=50`)).body), ['S-20260919-0800-x_y%z'])
  assert.deepEqual(codesOf((await get(`${q('\\')}&page=1&page_size=50`)).body), ['S-20260917-0800-back\\slash'],
    'the escape character itself is literal')
  assert.equal((await get(`${q('\\%')}&page=1&page_size=50`)).body.total, 0,
    "'\\%' is a backslash followed by a percent sign, which no row contains")

  // ---- 3. composes with the other filters -----------------------------------
  assert.deepEqual(codesOf((await get(`${q('Za')}&branch_id=2&page=1&page_size=50`)).body), ['S-20260921-0800-Za'], 'branch')
  assert.deepEqual(codesOf((await get(`${q('S-2026092')}&user_id=8&page=1&page_size=50`)).body), ['S-20260922-0900-Sok'], 'user_id')
  assert.deepEqual(codesOf((await get(`${q('Za')}&from=2026-09-21&to=2026-09-21&page=1&page_size=50`)).body), ['S-20260921-0800-Za'], 'date range')
  actAs(ZA)
  const own = await get(`${q('S-20260922')}&page=1&page_size=50`)
  assert.equal(own.body.scope, 'own')
  assert.deepEqual(codesOf(own.body), ['S-20260922-0807-Za'], "a cashier's search never reaches another cashier's shift")
  assert.equal((await get(`${q('Sok')}&page=1&page_size=50`)).body.total, 0, 'searching a colleague by name finds nothing hidden')
  actAs(BOSS)

  // ---- 4. paging and the unpaged read ----------------------------------------
  {
    const { get: getPaged, insert: insertPaged } = scenario()
    for (let i = 0; i < 25; i++) {
      const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10)
      insertPaged({ shift_code: `S-${date.replace(/-/g, '')}-0800-Pagey`, user_id: 11, user_name: 'Pagey', business_date: date })
      insertPaged({ shift_code: `S-${date.replace(/-/g, '')}-0800-Other`, user_id: 12, user_name: 'Other', business_date: date })
    }
    assert.equal((await getPaged('page=1&page_size=10')).body.total, 50)
    const seen = []
    for (const [page, size, hasMore] of [[1, 10, true], [2, 10, true], [3, 5, false]]) {
      const { body } = await getPaged(`${q('pagey')}&page=${page}&page_size=10`)
      assert.equal(body.total, 25, 'the count is the matching rows only')
      assert.equal(body.page, page)
      assert.equal(body.shifts.length, size)
      assert.equal(body.has_more, hasMore)
      assert.ok(body.shifts.every((row) => row.user_name === 'Pagey'))
      seen.push(...body.shifts.map((row) => row.id))
    }
    assert.equal(new Set(seen).size, 25, 'every match is reachable exactly once across the pages')
    assert.equal((await getPaged(`${q('pagey')}&page=99&page_size=10`)).body.page, 3, 'the page clamps to the matching pages')

    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    insertPaged({ shift_code: 'S-OPEN-Pagey', user_id: 11, user_name: 'Pagey', business_date: today, closed_at: null })
    insertPaged({ shift_code: 'S-OPEN-Other', user_id: 12, user_name: 'Other', business_date: today, closed_at: null })
    const unpaged = await getPaged(`${q('pagey')}&limit=200`)
    assert.equal(unpaged.status, 200)
    assert.equal(unpaged.body.shifts.length, 26, "the unpaged read filters both halves: Pagey's one open and 25 closed")
    assert.ok(unpaged.body.shifts.every((row) => row.user_name === 'Pagey'))
    assert.equal(unpaged.body.shifts[0].shift_code, 'S-OPEN-Pagey', 'the open half still leads')
  }

  // ---- 5. bounds and blanks ---------------------------------------------------
  const tooLong = await get(`${q('a'.repeat(81))}&page=1&page_size=20`)
  assert.equal(tooLong.status, 400)
  assert.equal(tooLong.body.error, 'Shift search must be 80 characters or fewer.')
  assert.equal((await get(q('a'.repeat(81)))).status, 400, 'the unpaged read has the same bound')
  assert.equal((await get(`${q('a'.repeat(80))}&page=1&page_size=20`)).status, 200, 'exactly 80 is accepted')
  assert.equal((await get(`${q('ក'.repeat(80))}&page=1&page_size=20`)).status, 200, '80 Khmer characters are accepted')
  assert.equal((await get(`${q('😀'.repeat(41))}&page=1&page_size=20`)).status, 200,
    '41 emoji are 82 UTF-16 units but 41 characters, so the bound counts characters')
  assert.equal((await get(`${q('😀'.repeat(81))}&page=1&page_size=20`)).status, 400)
  assert.equal((await get(`${q(` ${'a'.repeat(80)} `)}&page=1&page_size=20`)).status, 200, 'the bound applies after trimming')
  for (const blank of ['', '   ']) {
    const { status, body } = await get(`${q(blank)}&page=1&page_size=50`)
    assert.equal(status, 200)
    assert.equal(body.total, 8, `q=${JSON.stringify(blank)} is no filter`)
  }
  assert.deepEqual(codesOf((await get(`${q('  Sok  ')}&page=1&page_size=50`)).body), ['S-20260918-0930-Sok', 'S-20260922-0900-Sok'],
    'the search text is trimmed')
  console.log('test-shift-list-search-pure: OK')
}

main().catch((error) => { console.error(error); process.exit(1) })
