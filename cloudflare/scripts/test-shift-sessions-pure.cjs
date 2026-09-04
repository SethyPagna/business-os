// S4R4-5 -- the cash-drawer shift rules, proved against the REAL migration.
//
// The owner's sentence carries four promises: prompt on first POS use each
// day, keep prompting until registered, register only once, and end manually
// exactly once. Three of them are meant to be enforced by migration 0116's
// schema rather than by checks in routes/shifts.ts, because a check-then-write
// in the route is something two POS tabs can both pass on the same morning.
//
// So this suite runs the migration verbatim and drives it with the route's OWN
// SQL, lifted out of the source rather than retyped -- a copy of a query proves
// the copy works. If someone drops the UNIQUE index or rewrites the close to
// stop filtering on `closed_at IS NULL`, these go red.
//
// Run: node scripts/test-shift-sessions-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const Database = require(path.join(cloudflareRoot, 'node_modules', 'better-sqlite3'))
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- the real migration, verbatim ----------------------------------------
const migrationPath = path.join(cloudflareRoot, 'migrations', '0116_shift_sessions.sql')
const migrationSql = fs.readFileSync(migrationPath, 'utf8')
const db = new Database(':memory:')
db.exec(migrationSql)
ok(true, 'migration 0116 applies cleanly')

// ---- the route's own SQL, lifted from source ------------------------------
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'shifts.ts'), 'utf8')

const SHIFT_COLUMNS = (routeSrc.match(/const SHIFT_COLUMNS = `([\s\S]*?)`/) || [])[1]
ok(!!SHIFT_COLUMNS && /shift_code/.test(SHIFT_COLUMNS), 'SHIFT_COLUMNS lifted from the route')

// businessDateWindow's helpers, as the route interpolates them.
const dateWindow = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
const FORWARD = (dateWindow.match(/BUSINESS_TZ_FORWARD = '([^']+)'/) || [])[1]
ok(FORWARD === '+7 hours', `the business offset is the shared one (${FORWARD})`)
const localToday = `date('now', '${FORWARD}')`

const lift = (label, re) => {
  const m = routeSrc.match(re)
  assert.ok(m, `${label}: SQL not found in routes/shifts.ts -- the guard is now blind, re-derive it`)
  return m[1]
    .replace(/\$\{SHIFT_COLUMNS\}/g, SHIFT_COLUMNS)
    .replace(/\$\{localTodayExpr\(\)\}/g, localToday)
    .replace(/\$\{BUSINESS_TZ_FORWARD\}/g, FORWARD)
}

const selectSql = lift('readCurrent', /const row = await db\.prepare\(`([\s\S]*?)`\)\.get\(/)
const insertSql = lift('open', /await db\.prepare\(`(\s*INSERT INTO shift_sessions[\s\S]*?)`\)\.run\(row\)/)
const closeSql = lift('close', /const result = await db\.prepare\(`([\s\S]*?)`\)\.run\(patch\)/)
ok(/INSERT INTO shift_sessions/.test(insertSql) && /UPDATE shift_sessions/.test(closeSql),
  'the open and close statements were lifted, not retyped')

const select = db.prepare(selectSql)
const insert = db.prepare(insertSql)
const close = db.prepare(closeSql)

const OPENED = new Date().toISOString()
const base = {
  shiftCode: 'S-20260904-0800', userId: 7, userName: 'Rath',
  branchId: null, branchName: null, openedAt: OPENED,
  floatUsd: 50, floatKhr: 200000, note: null, deviceName: 'till-1',
}

// ---- 1. Before anything, POS must prompt ----------------------------------
ok(select.get({ userId: 7, branchId: null }) === undefined,
  'PROMPT: with no row for today, readCurrent finds nothing -- needs_registration is true')

// ---- 2. Register once ------------------------------------------------------
insert.run(base)
const registered = select.get({ userId: 7, branchId: null })
ok(!!registered, 'REGISTERED: the shift is found back for a NULL-branch till')
// This is the trap the route spells the branch term out to avoid: `branch_id =
// @branchId` is NULL = NULL, never true, and the till would prompt forever.
ok(/@branchId IS NULL AND branch_id IS NULL/.test(selectSql),
  'the NULL-branch case is matched explicitly, not with `branch_id = @branchId`')
ok(registered.opening_float_usd === 50 && registered.opening_float_khr === 200000,
  'both currencies are stored side by side, unconverted')
ok(registered.business_date === db.prepare(`SELECT ${localToday} AS d`).get().d,
  `business_date is the LOCAL day (${registered.business_date}), not the UTC one`)

// ---- 3. "only need registered once" ----------------------------------------
let secondInsertFailed = false
try { insert.run({ ...base, shiftCode: 'S-20260904-0805' }) } catch { secondInsertFailed = true }
ok(secondInsertFailed,
  'ONCE A DAY: a second registration for the same user/branch/day is refused by the UNIQUE index')
ok(db.prepare('SELECT COUNT(*) AS n FROM shift_sessions').get().n === 1,
  'and nothing was written -- the race cannot produce two floats for one drawer')

// ---- 4. A second branch is a second drawer, not a duplicate ---------------
insert.run({ ...base, shiftCode: 'S-20260904-0810', branchId: 2, branchName: 'Shop' })
ok(!!select.get({ userId: 7, branchId: 2 }),
  'SECOND DRAWER: the same employee may register a different branch the same day')
ok(select.get({ userId: 7, branchId: null }).id === registered.id,
  'and the two do not shadow each other -- the NULL-branch till still reads its own row')

// ---- 5. Ending is manual, and happens once ---------------------------------
const patch = { id: registered.id, closedAt: new Date().toISOString(), countedUsd: 412.5, countedKhr: 350000, note: 'counted by Rath', deviceName: 'till-1' }
ok(close.run(patch).changes === 1, 'END: the first close writes exactly one row')
const closed = select.get({ userId: 7, branchId: null })
ok(closed.closed_at != null && closed.closing_counted_usd === 412.5,
  'the counted amounts are stored against the shift')
const second = close.run({ ...patch, closedAt: new Date(Date.now() + 60000).toISOString(), countedUsd: 999, countedKhr: 1, note: 'oops', deviceName: 'till-2' })
ok(second.changes === 0,
  'END ONCE: a second close matches no row -- a double-tap cannot overwrite the count')
const after = select.get({ userId: 7, branchId: null })
ok(after.closing_counted_usd === 412.5 && after.closing_note === 'counted by Rath',
  'and the first count survives the second attempt untouched')
ok(/AND closed_at IS NULL/.test(closeSql),
  'the close filters on closed_at IS NULL -- the guard is in the statement, not in a prior read')

// ---- 6. Nothing closes a shift on its own ---------------------------------
ok(!/TRIGGER/i.test(migrationSql) && !/closed_at\s*=\s*(datetime|CURRENT)/i.test(migrationSql),
  'MANUAL ONLY: no trigger or default ever closes a shift by itself')

// ---- 7. Tomorrow prompts again --------------------------------------------
// The daily key includes business_date, so a new local day has no row and the
// employee is prompted -- the same mechanism as the very first check, one day on.
insert.run({ ...base, shiftCode: 'S-20260905-0800', openedAt: new Date(Date.now() + 36 * 3600 * 1000).toISOString() })
const tomorrow = db.prepare('SELECT COUNT(*) AS n FROM shift_sessions WHERE user_id = 7 AND branch_id IS NULL').get().n
ok(tomorrow === 2, 'NEXT DAY: a new business_date registers separately, so the till prompts again')

// ---- 8. The house session-id format ----------------------------------------
const codeFn = routeSrc.match(/function shiftCode\(nowIso: string\): string \{([\s\S]*?)\n\}/)
ok(!!codeFn && /S-\$\{local\.getUTCFullYear\(\)\}/.test(codeFn[1]),
  'shift_code is built as S-YYYYMMDD-HHMM from the +7 local clock')
ok(/getTime\(\) \+ 7 \* 60 \* 60 \* 1000/.test(codeFn[1]),
  'and it shifts by the business offset first, so an 08:00 local open never carries yesterday')

console.log(`\nALL ${checks} CHECKS PASSED`)
