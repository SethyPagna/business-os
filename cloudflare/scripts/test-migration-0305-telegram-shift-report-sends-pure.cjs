'use strict'
// Pins migration 0305 (the Telegram shift report as its own send) on the REAL migration chain: LF-only, keeps rowid, applies on a fresh chain, adds exactly
// the table and its index, changes no existing row, passes its own PRE check, aborts on a second run, makes the send key UNIQUE (the one-send-per-write
// guarantee), refuses a status or dispatch outside the sets lib/telegram.ts writes, and the due index is the one the cron drain uses.
//
// Run (from cloudflare/): node scripts/test-migration-0305-telegram-shift-report-sends-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0305_telegram_shift_report_sends.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`)
const plan = (db, statement) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all().map((r) => r.detail).join(' | ')
const refuses = (db, statement) => { try { db.exec(statement); return false } catch { return true } }

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('the file is LF-only, numbered 0305 once, keeps rowid, and carries PRE / POST / recovery notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  assert.match(sql, /RECOVERY:/); assert.match(sql, /PRE:/); assert.match(sql, /POST:/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0305_')), [migration])
})

const db = chain()
db.exec("INSERT INTO shift_sessions(shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr) VALUES ('S-1',7,'cashier',1,'Shop','2026-10-20','2026-10-20T01:00:00.000Z',0,0)")
const before = objects(db)
const rowsBefore = JSON.stringify([db.prepare('SELECT * FROM shift_sessions ORDER BY id').all(), db.prepare('SELECT COUNT(*) n FROM telegram_scheduled_sends').get()])

check('applies on a fresh chain, adds exactly the table and the due index, and changes no existing row', () => {
  db.exec(sql)
  assert.deepEqual(objects(db).filter((o) => !before.includes(o)), ['index:idx_telegram_shift_report_sends_due', 'table:telegram_shift_report_sends'])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('telegram_shift_report_sends')").get().n, 12)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM telegram_shift_report_sends').get().n, 0)
  assert.equal(JSON.stringify([db.prepare('SELECT * FROM shift_sessions ORDER BY id').all(), db.prepare('SELECT COUNT(*) n FROM telegram_scheduled_sends').get()]), rowsBefore)
})
check('a second run aborts on its own PRE check (idempotent only through it)', () => {
  assert.throws(() => db.exec(sql), /telegram_shift_report_sends|bad JSON path|already exists/i)
})
check('the send key is UNIQUE: INSERT OR IGNORE of the same write changes nothing (the one-send guarantee), a different action or revision is a new row', () => {
  const insert = db.prepare("INSERT OR IGNORE INTO telegram_shift_report_sends (send_key, shift_id, payload_json, due_at, dispatch, created_at) VALUES (?, 1, '{}', '2026-10-20T10:00:00.000Z', 'queue', '2026-10-20T10:00:00.000Z')")
  assert.equal(insert.run('shift-report:1:r2:close').changes, 1)
  assert.equal(insert.run('shift-report:1:r2:close').changes, 0)
  assert.equal(insert.run('shift-report:1:r2:amend').changes, 1)
  assert.equal(insert.run('shift-report:1:r3:close').changes, 1)
  assert.equal(db.prepare("SELECT status, dispatch, attempts FROM telegram_shift_report_sends WHERE send_key = 'shift-report:1:r2:close'").get().status, 'pending')
})
check('the status and dispatch sets are the ones lib/telegram.ts writes; a payload is required', () => {
  const base = (status, dispatch) => `INSERT INTO telegram_shift_report_sends (send_key, shift_id, payload_json, due_at, status, dispatch, created_at) VALUES ('k-${status}-${dispatch}', 1, '{}', 'x', '${status}', '${dispatch}', 'x')`
  for (const status of ['pending', 'sending', 'sent', 'skipped', 'failed']) assert.equal(refuses(db, base(status, 'queue')), false, status)
  assert.equal(refuses(db, base('retrying', 'queue')), true)
  assert.equal(refuses(db, base('pending', 'cron')), true)
  assert.equal(refuses(db, "INSERT INTO telegram_shift_report_sends (send_key, shift_id, due_at, created_at) VALUES ('no-payload', 1, 'x', 'x')"), true)
})
check('the cron drain (pending, due, fallback or past the queue grace, oldest first, ONE row) is served by the due index', () => {
  const drain = "SELECT send_key FROM telegram_shift_report_sends WHERE status = 'pending' AND due_at <= '2026-10-20T10:05:00.000Z' AND (dispatch = 'fallback' OR due_at <= '2026-10-20T10:00:00.000Z') ORDER BY due_at LIMIT 1"
  assert.match(plan(db, drain), /idx_telegram_shift_report_sends_due/)
})
check('the table is not in the backup (a restore must not replay old reports), and 0194 was not touched', () => {
  const backup = fs.readFileSync(path.join(__dirname, '../src/lib/backup.ts'), 'utf8')
  assert.equal(backup.includes('telegram_shift_report_sends'), false)
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'telegram_scheduled_sends'").get().sql.includes("kind IN ('shift_overview')"), true)
})

check('the header says what the code does (REVIEW-w3-shift F4): at most once, no retries, and the shift row in the payload', () => {
  const comments = sql.split('\n').filter((line) => line.startsWith('--')).join('\n')
  assert.doesNotMatch(comments, /retried up to|a minute apart|up to 3 times/i, 'no retry is promised')
  assert.match(comments, /NOT retried/); assert.match(comments, /There are no retries/); assert.match(comments, /AT MOST ONCE/)
  assert.match(comments, /shift\s+row as the write read it back/i)
  const telegram = fs.readFileSync(path.join(__dirname, '../src/lib/telegram.ts'), 'utf8').replace(/\r\n/g, '\n')
  const deliver = telegram.slice(telegram.indexOf('export async function deliverTelegramShiftReport'), telegram.indexOf('export async function drainDueTelegramShiftReports'))
  assert.match(deliver, /settle\('failed', message\)/, 'the delivery records a failure')
  assert.doesNotMatch(deliver, /retry|attempts < /i, 'and does not retry it')
})

console.log(`${passed} checks passed.`)
