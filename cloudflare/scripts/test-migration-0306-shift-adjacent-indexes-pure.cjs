'use strict'
// Pins migration 0306 and the rewritten readAdjacentShift (routes/shifts.ts) on the REAL migration chain:
//   - the file is LF-only, keeps rowid, carries PRE / POST / RECOVERY, adds exactly two indexes and changes no row, and aborts on a second run;
//   - DIFFERENTIAL: the rewritten function (compiled from the route's source) returns exactly the row the old statement returned, for every shift of a fixture with
//     several users, branches, a NULL branch, both scope modes, cancelled shifts and identical opened_at (id tie-break), in both directions, with and without the indexes;
//   - PLAN: every statement the route really emits (both directions, shop-wide and per-account, a named and a NULL branch) SEEKs the new index with no sort, and reads the
//     wide row by id; the old statement SCANs shift_sessions (the control that proves the indexes are what changed);
//   - HISTORY: the rows an index range holds for one lookup grow with history while the plan stays a LIMIT-1 seek (the lookup stops at its first entry).
//
// Run (from cloudflare/): node scripts/test-migration-0306-shift-adjacent-indexes-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0306_shift_adjacent_indexes.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = (withMigration) => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); if (withMigration) db.exec(sql); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`)
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('the file is LF-only, numbered 0306 once, keeps rowid, and carries PRE / POST / recovery notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  assert.match(sql, /RECOVERY:/); assert.match(sql, /PRE:/); assert.match(sql, /POST:/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0306_')), [migration])
})

const db = chain(false)
db.exec("INSERT INTO shift_sessions(shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr) VALUES ('S-1',7,'cashier',1,'Shop','2026-10-20','2026-10-20T01:00:00.000Z',0,0)")
const before = objects(db), rowsBefore = JSON.stringify(db.prepare('SELECT * FROM shift_sessions ORDER BY id').all())
check('applies on a fresh chain, adds exactly the two indexes and changes no row; a second run aborts on its PRE check', () => {
  db.exec(sql)
  assert.deepEqual(objects(db).filter((o) => !before.includes(o)), ['index:idx_shift_sessions_scope_branch_opened', 'index:idx_shift_sessions_scope_user_branch_opened'])
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM shift_sessions ORDER BY id').all()), rowsBefore)
  const cols = (name) => db.prepare(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).all().map((r) => r.name).join(',')
  assert.equal(cols('idx_shift_sessions_scope_branch_opened'), 'scope_mode,branch_id,opened_at')
  assert.equal(cols('idx_shift_sessions_scope_user_branch_opened'), 'scope_mode,user_id,branch_id,opened_at')
  assert.throws(() => db.exec(sql), /bad JSON path|already exists/i)
})

// ---- the route's function, compiled from its source, over node:sqlite ---------------------------------------------------------------------------------------
const source = fs.readFileSync(path.join(__dirname, '../src/routes/shifts.ts'), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('async function readAdjacentShift'), end = source.indexOf('async function intervalError')
assert.ok(start > 0 && end > start, 'readAdjacentShift found')
const fnSource = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } }).outputText
const COLS = 'id, shift_code, scope_mode, user_id, branch_id, opened_at, cancelled_at'
const make = (database, capture) => new Function('SHIFT_COLUMNS', `${fnSource}; return readAdjacentShift`)(COLS).bind(null, {
  prepare: (text) => ({ get: async (params) => { if (capture) capture.push({ text, params }); return database.prepare(text).get(params) } }),
})
const OLD = (comparison, ordering) => `SELECT ${COLS} FROM shift_sessions
    WHERE id != @id AND scope_mode=@scopeMode
      AND ((@branchId IS NULL AND branch_id IS NULL) OR branch_id=@branchId)
      AND (@scopeMode='shop_wide' OR user_id=@userId)
      AND cancelled_at IS NULL
      AND opened_at ${comparison} @openedAt
    ORDER BY opened_at ${ordering}, id ${ordering} LIMIT 1`
const oldRead = (database, shift, openedAt, direction) => database.prepare(direction === 'previous' ? OLD('<', 'DESC') : OLD('>=', 'ASC'))
  .get({ id: shift.id, scopeMode: shift.scope_mode, branchId: shift.branch_id, userId: shift.user_id, openedAt })
const pad = (n) => String(n).padStart(2, '0')

const fixture = (database, extra = 0) => {
  const ins = database.prepare('INSERT INTO shift_sessions(shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,cancelled_at,cancelled_by_user_id,cancelled_by_user_name,cancel_reason,opening_float_usd,opening_float_khr) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0)')
  let n = 0
  const add = (scope, user, branch, openedAt, cancelled = null) => { n += 1; ins.run(`F-${n}`, scope, user, 'u', branch, branch == null ? null : 'b', `d-${n}`, openedAt, cancelled, cancelled ? 1 : null, cancelled ? 'admin' : null, cancelled ? 'test' : null) }
  for (let i = 0; i < 30 + extra; i++) {
    for (const user of [3, 4]) for (const branch of [1, 2, null]) add('per_account', user, branch, `2026-${pad(1 + (i % 9))}-${pad(1 + ((i * 7) % 28))}T${pad(user)}:${pad(i % 60)}:00.000Z`, i % 11 === 0 ? '2026-09-30T00:00:00.000Z' : null)
    for (const branch of [1, null]) add('shop_wide', (i % 3) + 3, branch, `2026-${pad(1 + (i % 9))}-${pad(1 + ((i * 5) % 28))}T08:${pad(i % 60)}:00.000Z`, i % 13 === 0 ? '2026-09-30T00:00:00.000Z' : null)
  }
  const tied = '2026-09-04T05:00:00.000Z'
  add('shop_wide', 3, 1, tied); add('shop_wide', 4, 1, tied); add('shop_wide', 5, 1, tied) // identical opened_at: the id decides
  add('per_account', 3, 1, tied); add('per_account', 3, 1, tied)
}
const withIdx = chain(true); fixture(withIdx)
const without = chain(false); fixture(without)

const plan = (database, text, params) => database.prepare(`EXPLAIN QUERY PLAN ${text}`).all(params).map((r) => r.detail).join(' | ')

;(async () => {
  let compared = 0, nonNull = 0
  for (const database of [withIdx, without]) {
    const read = make(database)
    for (const shift of database.prepare('SELECT * FROM shift_sessions').all()) {
      for (const direction of ['previous', 'next']) for (const at of [shift.opened_at, '2026-05-15T00:00:00.000Z']) {
        const got = await read(shift, at, direction), want = oldRead(database, shift, at, direction)
        assert.deepEqual(got ?? null, want ?? null, `${shift.id} ${direction} ${at}`)
        compared += 1; if (want) nonNull += 1
      }
    }
  }
  assert.ok(compared > 1500 && nonNull > 1000 && compared > nonNull, `${compared} compared, ${nonNull} with a row`)
  check(`DIFFERENTIAL: ${compared} lookups (${nonNull} with a row) return the old statement's row, id tie-break included, with and without the indexes`, () => {})

  for (const [scope, branch] of [['shop_wide', 1], ['shop_wide', null], ['per_account', 1], ['per_account', null]]) {
    for (const direction of ['previous', 'next']) {
      const seen = []
      await make(withIdx, seen)({ id: 999999, scope_mode: scope, branch_id: branch, user_id: 3 }, '2026-05-15T00:00:00.000Z', direction)
      const p = plan(withIdx, seen[0].text, seen[0].params)
      const index = scope === 'shop_wide' ? 'idx_shift_sessions_scope_branch_opened' : 'idx_shift_sessions_scope_user_branch_opened'
      const eq = scope === 'shop_wide' ? 'scope_mode=\\? AND branch_id' : 'scope_mode=\\? AND user_id=\\? AND branch_id'
      assert.match(p, new RegExp(`SEARCH shift_sessions USING INDEX ${index} \\(${eq}(?:=|IS)`), `${scope}/${branch}/${direction}: ${p}`)
      assert.match(p, /opened_at[<>]/, `the range is part of the seek: ${p}`)
      assert.doesNotMatch(p, /USE TEMP B-TREE/, `no sort: ${p}`)
      assert.doesNotMatch(p, /SCAN shift_sessions/, `no scan: ${p}`)
      assert.match(p, /SEARCH shift_sessions USING INTEGER PRIMARY KEY \(rowid=\?\)/, `the wide row is read by id: ${p}`)
    }
  }
  check('PLAN: all 8 emitted statements SEEK the new index (range included), sort nothing, scan nothing, and read the wide row by id', () => {})
  const oldPlan = plan(without, OLD('<', 'DESC'), { id: 1, scopeMode: 'shop_wide', branchId: 1, userId: 3, openedAt: 'x' })
  assert.match(oldPlan, /SCAN shift_sessions/, `control: the old statement scans: ${oldPlan}`)
  check('CONTROL: the old statement SCANs shift_sessions (no opened_at index existed)', () => {})

  const small = chain(true), big = chain(true); fixture(small, 0); fixture(big, 370)
  const rangeRows = (database) => database.prepare("SELECT COUNT(*) AS n FROM shift_sessions WHERE scope_mode = 'per_account' AND user_id = 3 AND branch_id = 1 AND opened_at < '2026-09-30T23:00:00.000Z'").get().n
  const [a, b] = [rangeRows(small), rangeRows(big)]
  assert.ok(b > a * 5, `fixture grows: ${a} -> ${b}`)
  for (const database of [small, big]) {
    const seen = []
    await make(database, seen)({ id: 999999, scope_mode: 'per_account', branch_id: 1, user_id: 3 }, '2026-09-30T23:00:00.000Z', 'previous')
    assert.match(plan(database, seen[0].text, seen[0].params), /SEARCH shift_sessions USING INDEX idx_shift_sessions_scope_user_branch_opened/)
    assert.match(seen[0].text, /LIMIT 1\)/, 'the inner SELECT stops at its first entry')
  }
  check(`HISTORY: the index range holds ${a} then ${b} entries as shifts accumulate and the plan stays a LIMIT-1 seek`, () => {})
  console.log(`${passed} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
