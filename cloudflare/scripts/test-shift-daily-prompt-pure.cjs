// The daily shift prompt (owner rule, 2026-09-06): "for shift, I want it to
// always prompt in each new day... this is automated... don't remove it."
//
// The mechanism has two halves and this file pins both:
//   1. shifts.ts readCurrent() only counts a shift as "current" when its
//      business_date equals TODAY in the business timezone (UTC+7), through
//      the same localTodayExpr() every report uses. A shift opened on a
//      previous business day is therefore not current, /current answers
//      needs_registration, and the POS prompts again.
//   2. That predicate is exercised for real below on an in-memory SQLite
//      copy of the shift_sessions migration, with the SQL lifted out of the
//      source rather than retyped, so a rewrite of readCurrent that drops or
//      widens the business_date clause turns this red.
//
// Run: node scripts/test-shift-daily-prompt-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))
const shifts = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')
const window = fs.readFileSync(path.join(root, 'src', 'lib', 'businessDateWindow.ts'), 'utf8')

// --- 1. source shape -------------------------------------------------------
const fnStart = shifts.indexOf('async function readCurrent(')
assert.ok(fnStart > -1, 'shifts.ts still has readCurrent()')
const fnEnd = shifts.indexOf('\n}', fnStart)
const readCurrent = shifts.slice(fnStart, fnEnd)
assert.match(readCurrent, /AND business_date = \$\{localTodayExpr\(\)\}/, 'readCurrent scopes the current shift to TODAY\'s business date through localTodayExpr()')
assert.match(window, /export const BUSINESS_TZ_FORWARD = '\+7 hours'/, 'the business day is UTC+7')
assert.match(window, /export function localTodayExpr\(\): string \{\s*return `date\('now', '\$\{BUSINESS_TZ_FORWARD\}'\)`/, 'localTodayExpr() is date(now, +7 hours)')
assert.match(shifts, /needs_registration: /, 'the /current route reports needs_registration to the POS')

// --- 2. behaviour on the real DDL -----------------------------------------
// Every shift migration in order: 0116 creates the table, 0118 adds scope_mode
// (the column readCurrent filters on), later ones add reopen segments.
const migrationsDir = path.join(root, 'migrations')
const shiftMigrations = fs.readdirSync(migrationsDir).filter((f) => /^[0-9]{4}_shift/.test(f)).sort()
assert.ok(shiftMigrations.includes('0116_shift_sessions.sql') && shiftMigrations.includes('0118_shift_policy_and_amendments.sql'), `shift migrations found: ${shiftMigrations.join(', ')}`)
const db = new Database(':memory:')
// 0118 seeds the shift policy rows into settings; the rest of 0001_init is
// not needed for the predicate under test.
db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
// 0119's restore-guard trigger reads system_flags (migration 0089).
db.exec('CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
for (const file of shiftMigrations) {
  const ddl = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  try { db.exec(ddl) } catch (e) { throw new Error(`applying ${file} to the in-memory copy failed: ${e.message}`) }
}
// Later migrations may add columns readCurrent's SHIFT_COLUMNS selects; the
// pin below only needs the predicate, so select the key columns instead.
const sqlMatch = readCurrent.match(/db\.prepare\(`([\s\S]*?)`\)/)
assert.ok(sqlMatch, 'readCurrent builds one SQL template')
const sql = sqlMatch[1]
  .replace('${SHIFT_COLUMNS}', 'id, business_date')
  .replace('${accountClause}', 'AND user_id = @userId')
  .replace('${localTodayExpr()}', "date('now', '+7 hours')")
assert.ok(!sql.includes('${'), `every template hole was filled: ${sql}`)
const current = db.prepare(sql)

const today = db.prepare("SELECT date('now', '+7 hours') AS d").get().d
const yesterday = db.prepare("SELECT date('now', '+7 hours', '-1 day') AS d").get().d
assert.notEqual(today, yesterday)

const insert = db.prepare(`INSERT INTO shift_sessions (shift_code, scope_mode, user_id, user_name, branch_id, business_date, opened_at)
  VALUES (@shift_code, @scope_mode, @user_id, 'cashier', @branch_id, @business_date, @opened_at)`)
const cols = db.prepare('PRAGMA table_info(shift_sessions)').all().map((c) => c.name)
const params = { shift_code: 'S-YESTERDAY', scope_mode: 'per_account', user_id: 7, branch_id: 1, business_date: yesterday, opened_at: `${yesterday}T01:05:00.000Z` }
try {
  insert.run(params)
} catch (e) {
  // The columns above track migration 0116; if a later migration renamed
  // them, fail loudly with the real column list instead of a vague error.
  throw new Error(`insert into shift_sessions failed (${e.message}); columns are ${cols.join(', ')}`)
}
// Positive control: yesterday's shift IS there and IS still open...
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shift_sessions WHERE closed_at IS NULL').get().n, 1)
// ...and is NOT today's current shift, so the POS prompts again.
assert.equal(current.get({ scopeMode: 'per_account', userId: 7, branchId: 1 }), undefined, 'a shift opened on the previous business day is not current today')

// Register today's shift: now it is current and the prompt stops.
insert.run({ ...params, shift_code: 'S-TODAY', business_date: today, opened_at: new Date().toISOString() })
const row = current.get({ scopeMode: 'per_account', userId: 7, branchId: 1 })
assert.ok(row, 'today\'s shift is current')
assert.equal(row.business_date, today)

// The same account on another branch still prompts (branch identity kept).
assert.equal(current.get({ scopeMode: 'per_account', userId: 7, branchId: 2 }), undefined)

console.log('PASS the daily shift prompt: a previous-business-day shift is never current, today\'s is')
