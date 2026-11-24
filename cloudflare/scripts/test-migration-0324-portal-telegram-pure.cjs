// G38 S3b: migration 0324 (Telegram sign-in columns, the pending table, the close trigger) on the real chain through 0323.
//
// T-B1 applies on a fresh chain and on a database holding accounts (one closed with a phone); T-B2 one member per Telegram id;
// T-B3 the id and time shape checks; T-B4 the close trigger; T-B5 the pending table; T-B6 a later rebuild of portal_accounts
// must carry the new objects; T-B8 the pre and post assertions in the file header. Each rule has a mutant of the SQL (or of the
// scanner) that the same assertion turns red.
//
// Run: node scripts/test-migration-0324-portal-telegram-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const dir = path.join(__dirname, '..', 'migrations')
const NAME = '0324_portal_telegram_lean.sql'
const SQL = fs.existsSync(path.join(dir, NAME)) ? fs.readFileSync(path.join(dir, NAME), 'utf8') : ''

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

const TG_MAX = 4503599627370495
const TICKET = `tg1:${'a'.repeat(64)}`
const T = '2026-11-21T01:02:03.456Z'

function at323() {
  const raw = openDb(loadAll({ through: 323 })).db
  raw.exec(`
    INSERT INTO customers (id, name, phone, phone_normalized, membership_number, created_at) VALUES
      (10, 'Linked Buyer', '012 100 100', '012100100', 'LC-00010', '2026-09-01 08:00:00'),
      (11, 'Joiner Buyer', '012 333 333', '012333333', 'LC-00011', '2026-09-01 08:00:00');
    INSERT INTO portal_accounts (id, name, phone, member_code, status, contact_id, created_at, updated_at) VALUES
      (1, 'Active One', '012111111', 'W-7KQ4-M9XD', 'active', NULL, '2026-10-01 08:00:00', '2026-10-01 08:00:00'),
      (2, 'Closed With Phone', '012222222', 'W-7KQ4-M9XE', 'closed', NULL, '2026-10-02 08:00:00', '2026-10-02 08:00:00'),
      (3, 'Linked', '012100100', 'W-7KQ4-M9XF', 'active', 10, '2026-10-03 08:00:00', '2026-10-03 08:00:00');
  `)
  return raw
}
function applied(sql, build = at323) {
  const raw = build()
  raw.exec(sql)
  return raw
}
const real = () => applied(SQL)
const mutate = (from, to) => {
  assert.ok(SQL.includes(from), `mutation anchor present: ${from.slice(0, 50)}`)
  const mutated = SQL.replace(from, to)
  assert.notEqual(mutated, SQL)
  return mutated
}
const fails = (fn, pattern, label) => assert.throws(fn, pattern, label)
const insertMember = (raw, fields) => {
  const row = { name: 'M', ...fields }
  const keys = Object.keys(row)
  return raw.prepare(`INSERT INTO portal_accounts (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(row)
}
const insertPending = (raw, fields) => {
  const row = { id: 5, ticket_hash: TICKET, flags: 0, attempts: 1, window_started_at: T, created_at: T, expires_at: T, ...fields }
  return raw.prepare('INSERT INTO portal_telegram_pending (id, ticket_hash, flags, attempts, window_started_at, created_at, expires_at) VALUES (@id, @ticket_hash, @flags, @attempts, @window_started_at, @created_at, @expires_at)').run(row)
}

function statementsOf(sql) {
  const lines = sql.split('\n').filter((line) => !/^\s*--/.test(line))
  const out = []
  let current = []
  let inTrigger = false
  for (const line of lines) {
    if (!current.length && !line.trim()) continue
    current.push(line)
    if (/^\s*CREATE TRIGGER\b/i.test(current.join('\n').trimStart().split('\n')[0]) ) inTrigger = true
    const text = current.join('\n').trim()
    if (inTrigger ? /^END;$/.test(line.trim()) : /;\s*$/.test(line)) { out.push(text); current = []; inTrigger = false }
  }
  assert.equal(current.join('').trim(), '', 'no text after the last statement')
  return out
}

// ------------------------------------------------------------------------------------------------ file shape
check('the file exists, is LF only, numbered once, carries purpose, assertions and recovery, and says 23 columns', () => {
  assert.ok(SQL.length > 0, `${NAME} exists`)
  assert.equal(Buffer.from(SQL, 'utf8').includes(0x0d), false, 'CR byte in the migration')
  for (const section of ['PURPOSE', 'PRE-ASSERTIONS', 'POST-ASSERTIONS', 'RECOVERY']) assert.ok(SQL.includes(section), `lacks ${section}`)
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('0324')), [NAME])
  assert.ok(!/WITHOUT ROWID/i.test(SQL))
  assert.match(SQL, /\b23\b[^\n]*columns|columns[^\n]*\b23\b/, 'the header carries the 23-column rule for later rebuilds')
})

check('five statements (the design text says six but lists five); no default, no LIKE or GLOB, no compound SELECT; the first statement is not a comment', () => {
  const statements = statementsOf(SQL)
  assert.deepEqual(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ')), ['ALTER TABLE', 'ALTER TABLE', 'CREATE UNIQUE', 'CREATE TABLE', 'CREATE TRIGGER'])
  const body = statements.join('\n')
  assert.ok(!/\bDEFAULT\b/i.test(body), 'no column default anywhere')
  assert.ok(!/\b(LIKE|GLOB)\b/i.test(body))
  assert.ok(!/\bUNION\b|\bEXCEPT\b|\bINTERSECT\b/i.test(body))
})

// ------------------------------------------------------------------------------------------------ T-B1
function columnDefaults(raw) {
  const rows = []
  for (const table of ['portal_telegram_pending']) for (const c of raw.prepare(`SELECT name, dflt_value FROM pragma_table_info('${table}')`).all()) rows.push(`${table}.${c.name}=${c.dflt_value}`)
  for (const c of raw.prepare("SELECT name, dflt_value FROM pragma_table_info('portal_accounts') WHERE name IN ('telegram_user_id', 'telegram_verified_at')").all()) rows.push(`portal_accounts.${c.name}=${c.dflt_value}`)
  return rows
}
function assertNoDefaultsAndDefaultFormRefused(raw) {
  assert.ok(columnDefaults(raw).every((r) => r.endsWith('=null')), `no default: ${columnDefaults(raw).join(', ')}`)
  fails(() => raw.prepare('INSERT INTO portal_telegram_pending (id, ticket_hash, flags, attempts) VALUES (7, ?, 0, 1)').run(TICKET), /NOT NULL|CHECK/)
  fails(() => insertPending(raw, { created_at: '2026-11-21 01:02:03' }), /CHECK/)
}

check('T-B1 applies on the fresh chain, on a database holding accounts, and statement by statement with the same result', () => {
  const fresh = openDb(loadAll()).db
  assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('portal_telegram_pending', 'idx_portal_accounts_telegram', 'portal_accounts_close_clears_identity')").get().n, 3)
  assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('portal_accounts')").get().n, 23)

  const raw = real()
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('portal_accounts')").get().n, 23)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 3)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts WHERE telegram_user_id IS NOT NULL OR telegram_verified_at IS NOT NULL').get().n, 0)
  const closed = raw.prepare("SELECT phone FROM portal_accounts WHERE id = 2").get()
  assert.equal(closed.phone, '012222222', 'the trigger acts only on future UPDATEs')

  const each = at323()
  for (const statement of statementsOf(SQL)) each.exec(statement)
  const signature = (db) => JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%telegram%' OR name LIKE 'portal_accounts%' ORDER BY type, name").all().map((r) => ({ ...r })))
  assert.equal(signature(each), signature(raw))

  assertNoDefaultsAndDefaultFormRefused(raw)
  const mutant = applied(mutate('created_at TEXT NOT NULL CHECK', "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK"))
  assert.throws(() => assertNoDefaultsAndDefaultFormRefused(mutant), 'a default on a pending time column turns this red')
})

check('a second run is refused at the first ALTER and changes nothing', () => {
  const raw = real()
  const before = JSON.stringify(raw.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all().map((r) => ({ ...r })))
  fails(() => raw.exec(SQL), /duplicate column name/)
  assert.equal(JSON.stringify(raw.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all().map((r) => ({ ...r }))), before)
})

// ------------------------------------------------------------------------------------------------ T-B2
function assertTelegramIdUnique(raw) {
  insertMember(raw, { telegram_user_id: 777, telegram_verified_at: T })
  fails(() => insertMember(raw, { telegram_user_id: 777, telegram_verified_at: T }), /UNIQUE/)
  insertMember(raw, { name: 'NoTelegram A' })
  insertMember(raw, { name: 'NoTelegram B' })
}
check('T-B2 a second member with the same Telegram id is refused; members without one are not', () => {
  assertTelegramIdUnique(real())
  const plainIndex = applied(mutate('CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_telegram', 'CREATE INDEX IF NOT EXISTS idx_portal_accounts_telegram'))
  assert.throws(() => assertTelegramIdUnique(plainIndex), 'a non-unique index accepts the duplicate')
})

// ------------------------------------------------------------------------------------------------ T-B3
function assertTelegramIdShape(raw) {
  for (const bad of [0, -1, TG_MAX + 1, 5.5, 'x5', '5x', '']) fails(() => insertMember(raw, { telegram_user_id: bad }), /CHECK/, `refused: ${JSON.stringify(bad)}`)
  fails(() => insertMember(raw, { telegram_user_id: 9007199254740991n }), /CHECK/)
  insertMember(raw, { telegram_user_id: 1 })
  insertMember(raw, { telegram_user_id: TG_MAX })
  for (const bad of ['2026-11-21 01:02:03', '2026-11-21T01:02:03Z', '2026-11-21T01:02:03.456+0', '2026-11-21T01:02:03.456X', '2026-11-21 01:02:03.456Z', '2026/11/21T01:02:03.456Z']) {
    fails(() => insertMember(raw, { telegram_user_id: 99, telegram_verified_at: bad }), /CHECK/, `refused: ${bad}`)
  }
  insertMember(raw, { telegram_user_id: 99, telegram_verified_at: T })
}
check('T-B3 Telegram id 0, -1, 2^52, a fraction and non-numeric text are refused; 1 and 2^52 - 1 and the ISO time pass', () => {
  assertTelegramIdShape(real())
  const noUpper = applied(mutate('\n             AND telegram_user_id <= 4503599627370495', ''))
  assert.throws(() => assertTelegramIdShape(noUpper), 'without the upper bound 2^52 is accepted')
  const noLower = applied(mutate('AND telegram_user_id > 0', ''))
  assert.throws(() => assertTelegramIdShape(noLower), 'without the lower bound 0 is accepted')
  const noTime = applied(mutate("AND substr(telegram_verified_at, 24, 1) = 'Z'", ''))
  assert.throws(() => assertTelegramIdShape(noTime), 'without the Z check a 24-character text passes')
  const noDash = applied(mutate("AND substr(telegram_verified_at, 5, 1) = '-'", ''))
  assert.throws(() => assertTelegramIdShape(noDash), 'without the dash check a 24-character text with / at 5 passes')
  const noT = applied(mutate("AND substr(telegram_verified_at, 11, 1) = 'T'", ''))
  assert.throws(() => assertTelegramIdShape(noT), 'without the T check a 24-character text with a space at 11 passes')
})

check('T-B3 note: the digits-only text 5 is coerced to the integer 5 by the INTEGER column (affinity), and then passes; the design said refused', () => {
  const raw = real()
  insertMember(raw, { telegram_user_id: '5' })
  assert.equal(raw.prepare('SELECT typeof(telegram_user_id) AS t, telegram_user_id AS v FROM portal_accounts WHERE telegram_user_id = 5').get().t, 'integer')
})

// ------------------------------------------------------------------------------------------------ T-B4
function assertCloseTrigger(raw) {
  insertMember(raw, { name: 'Joiner', phone: '012333333', telegram_user_id: 4242, telegram_verified_at: T, contact_id: 11 })
  const id = Number(raw.prepare('SELECT id FROM portal_accounts WHERE telegram_user_id = 4242').get().id)
  raw.prepare("UPDATE portal_accounts SET status = 'closed', closed_at = ? WHERE id = ?").run(T, id)
  const row = raw.prepare('SELECT phone, telegram_user_id, telegram_verified_at, status FROM portal_accounts WHERE id = ?').get(id)
  assert.deepEqual({ ...row }, { phone: null, telegram_user_id: null, telegram_verified_at: T, status: 'closed' })
  assert.equal(raw.prepare('SELECT phone FROM customers WHERE id = 11').get().phone, '012 333 333', 'the customer record keeps its own phone')

  insertMember(raw, { name: 'Closed Insert', phone: '012444444', status: 'closed' })
  assert.equal(raw.prepare("SELECT phone FROM portal_accounts WHERE name = 'Closed Insert'").get().phone, '012444444', 'an INSERT of a closed member keeps its phone (S1 fixtures)')

  insertMember(raw, { name: 'Same Person Again', phone: '012333333', telegram_user_id: 4242, telegram_verified_at: T })

  raw.prepare("UPDATE portal_accounts SET phone = '012555555' WHERE name = 'Closed Insert'").run()
  assert.equal(raw.prepare("SELECT phone FROM portal_accounts WHERE name = 'Closed Insert'").get().phone, null, 'a phone written to an already closed row is cleared')
  raw.prepare("UPDATE portal_accounts SET telegram_user_id = 8484 WHERE name = 'Closed Insert'").run()
  assert.equal(raw.prepare("SELECT telegram_user_id FROM portal_accounts WHERE name = 'Closed Insert'").get().telegram_user_id, null, 'so is a Telegram id')

  raw.prepare("UPDATE portal_accounts SET name = 'Renamed' WHERE id = 1").run()
  assert.equal(raw.prepare('SELECT phone FROM portal_accounts WHERE id = 1').get().phone, '012111111', 'an active member keeps its phone')
  raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = 1").run()
  assert.equal(raw.prepare('SELECT phone FROM portal_accounts WHERE id = 1').get().phone, '012111111', 'a suspended member keeps its phone')
}
check('T-B4 closing clears phone and Telegram id and keeps the proof date; a closed INSERT keeps its phone; the person can join again; a phone on a closed row is cleared', () => {
  assertCloseTrigger(real())
  const statusOnly = applied(mutate('AFTER UPDATE OF status, phone, telegram_user_id ON', 'AFTER UPDATE OF status ON'))
  assert.throws(() => assertCloseTrigger(statusOnly), 'a trigger on status alone leaves a phone written later')
  const phoneOnly = applied(mutate('SET phone = NULL, telegram_user_id = NULL WHERE id = NEW.id', 'SET phone = NULL WHERE id = NEW.id'))
  assert.throws(() => assertCloseTrigger(phoneOnly), 'a trigger that clears only the phone leaves the Telegram id')
  const noPhoneClause = applied(mutate('WHEN NEW.status = \'closed\' AND (NEW.phone IS NOT NULL OR NEW.telegram_user_id IS NOT NULL)', "WHEN NEW.status = 'closed' AND NEW.telegram_user_id IS NOT NULL"))
  assert.throws(() => assertCloseTrigger(noPhoneClause), 'a guard that ignores the phone leaves a phone-only closed row')
})

check('the trigger fires once (no recursion even with recursive_triggers on)', () => {
  const raw = real()
  raw.exec('PRAGMA recursive_triggers = ON')
  insertMember(raw, { name: 'Loop', phone: '012666666', telegram_user_id: 31, telegram_verified_at: T })
  raw.prepare("UPDATE portal_accounts SET status = 'closed' WHERE telegram_user_id = 31").run()
  assert.equal(raw.prepare("SELECT phone FROM portal_accounts WHERE name = 'Loop'").get().phone, null)
})

// ------------------------------------------------------------------------------------------------ T-B5
const PENDING_TIME_COLUMNS = ['window_started_at', 'created_at', 'expires_at']
function assertPendingTable(raw) {
  assert.ok(!/WITHOUT ROWID/i.test(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'portal_telegram_pending'").get().sql))
  insertPending(raw, { id: 11 })
  assert.equal(raw.prepare('SELECT rowid AS r FROM portal_telegram_pending WHERE id = 11').get().r, 11, 'id is the rowid')
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_sequence WHERE name = 'portal_telegram_pending'").get().n, 0, 'no sequence row')
  insertPending(raw, { id: 12, flags: 65535 })
  fails(() => insertPending(raw, { id: 13, flags: 65536 }), /CHECK/, 'flags 65536')
  fails(() => insertPending(raw, { id: 14, flags: -1 }), /CHECK/, 'flags -1')
  fails(() => insertPending(raw, { id: 15, ticket_hash: 'a'.repeat(68) }), /CHECK/, 'no tg1: prefix')
  fails(() => insertPending(raw, { id: 16, ticket_hash: `tg1:${'a'.repeat(63)}` }), /CHECK/, '67 characters')
  fails(() => insertPending(raw, { id: 17, window_started_at: '2026-11-21 01:02:03' }), /CHECK/, '19-character time')
  fails(() => insertPending(raw, { id: 18, expires_at: '2026-11-21 01:02:03' }), /CHECK/, '19-character expiry')
  fails(() => insertPending(raw, { id: 19, attempts: 0 }), /CHECK/, 'attempts 0')
  for (const col of PENDING_TIME_COLUMNS) fails(() => insertPending(raw, { id: 20, [col]: '2026-11-21 01:02:03.456Z' }), /CHECK/, `${col}: 24 characters with a space at 11`)
  fails(() => insertPending(raw, { id: 21, flags: 5.5 }), /CHECK/, 'flags 5.5 stays a real and typeof refuses it')
  fails(() => insertPending(raw, { id: 0 }), /CHECK/, 'id 0')
  fails(() => insertPending(raw, { id: TG_MAX + 1 }), /CHECK/, 'id 2^52')
  fails(() => insertPending(raw, { id: 11 }), /UNIQUE|PRIMARY/, 'one row per Telegram user')
  raw.prepare('DELETE FROM portal_telegram_pending WHERE id = ?').run(11)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_telegram_pending').get().n, 1)
}
check('T-B5 pending: rowid table without a sequence row; flags 0 to 65535; ticket prefix and length; 24-character times', () => {
  assertPendingTable(real())
  const small = applied(mutate('flags INTEGER NOT NULL CHECK (typeof(flags) = \'integer\' AND flags BETWEEN 0 AND 65535)', "flags INTEGER NOT NULL CHECK (typeof(flags) = 'integer' AND flags BETWEEN 0 AND 255)"))
  assert.throws(() => assertPendingTable(small), 'with flags up to 255, 65535 is refused')
  const autoinc = applied(mutate('id INTEGER PRIMARY KEY CHECK', 'id INTEGER PRIMARY KEY AUTOINCREMENT CHECK'))
  assert.throws(() => assertPendingTable(autoinc), 'AUTOINCREMENT writes a sequence row')
  const noPrefix = applied(mutate("AND substr(ticket_hash, 1, 4) = 'tg1:'", ''))
  assert.throws(() => assertPendingTable(noPrefix), 'without the prefix check any 68 characters pass')
  for (const col of PENDING_TIME_COLUMNS) {
    const noT = applied(mutate(`substr(${col}, 11, 1) = 'T'`, '1 = 1'))
    assert.throws(() => assertPendingTable(noT), `without the T check on ${col} a space at 11 passes`)
  }
  const noType = applied(mutate("CHECK (typeof(flags) = 'integer' AND flags BETWEEN", 'CHECK (flags BETWEEN'))
  assert.throws(() => assertPendingTable(noType), 'without typeof(flags) the real 5.5 passes the range')
})

check('T-B5 note: flags given as the text 5 is coerced to the integer 5 by the INTEGER column (affinity) and passes; 5.5 stays a real and typeof refuses it', () => {
  const raw = real()
  insertPending(raw, { id: 30, flags: '5' })
  assert.deepEqual({ ...raw.prepare('SELECT typeof(flags) AS t, flags AS v FROM portal_telegram_pending WHERE id = 30').get() }, { t: 'integer', v: 5 })
  fails(() => insertPending(raw, { id: 31, flags: 'x5' }), /CHECK/, 'non-numeric text stays text and typeof refuses it')
})

// ------------------------------------------------------------------------------------------------ T-B6
const REQUIRED_AFTER_REBUILD = ['telegram_user_id', 'telegram_verified_at', 'idx_portal_accounts_telegram', 'portal_accounts_close_clears_identity']
function rebuildsOf(sql) {
  const body = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  return /CREATE TABLE\s+(IF NOT EXISTS\s+)?portal_accounts\b/i.test(body)
    || /CREATE TABLE\s+(IF NOT EXISTS\s+)?portal_accounts_\w+/i.test(body) && /RENAME TO portal_accounts\b/i.test(body)
    || /ALTER TABLE\s+portal_accounts\s+RENAME\s+TO\b/i.test(body)
}
function rebuildViolations(files, required = REQUIRED_AFTER_REBUILD) {
  const problems = []
  for (const { name, sql } of files) {
    if (!rebuildsOf(sql)) continue
    const body = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    for (const token of required) if (!body.includes(token)) problems.push(`${name}: rebuild of portal_accounts lacks ${token}`)
  }
  return problems
}
const laterFiles = () => fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && Number(f.slice(0, 4)) > 324).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))
const COMPLETE_REBUILD = `CREATE TABLE portal_accounts_9999_new (id INTEGER PRIMARY KEY, telegram_user_id INTEGER, telegram_verified_at TEXT);
ALTER TABLE portal_accounts_9999_new RENAME TO portal_accounts;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_telegram ON portal_accounts (telegram_user_id);
CREATE TRIGGER IF NOT EXISTS portal_accounts_close_clears_identity AFTER UPDATE ON portal_accounts BEGIN SELECT 1; END;`
check('T-B6 a migration after 0324 that rebuilds portal_accounts without the two columns, the index or the trigger is reported', () => {
  assert.deepEqual(rebuildViolations(laterFiles()), [], 'no later migration rebuilds portal_accounts without them')
  assert.deepEqual(rebuildViolations([{ name: 'ok', sql: COMPLETE_REBUILD }]), [])
  assert.deepEqual(rebuildViolations([{ name: 'unrelated', sql: 'ALTER TABLE portal_accounts ADD COLUMN x TEXT;' }]), [], 'an ADD COLUMN is not a rebuild')
  for (const token of REQUIRED_AFTER_REBUILD) {
    const without = COMPLETE_REBUILD.split(token).join('zz_removed')
    assert.equal(rebuildViolations([{ name: 'bad', sql: without }]).some((p) => p.includes(token)), true, `reports a rebuild lacking ${token}`)
  }
  const skipTriggers = REQUIRED_AFTER_REBUILD.filter((t) => t !== 'portal_accounts_close_clears_identity')
  const noTrigger = COMPLETE_REBUILD.split('portal_accounts_close_clears_identity').join('zz_removed')
  assert.deepEqual(rebuildViolations([{ name: 'bad', sql: noTrigger }], skipTriggers), [], 'a scan that skips triggers lets the rebuild through (the mutant)')
  assert.notDeepEqual(rebuildViolations([{ name: 'bad', sql: noTrigger }]), [], 'the real scan does not')
  assert.equal(rebuildsOf(fs.readFileSync(path.join(dir, '0321_portal_members_separation.sql'), 'utf8')), true, 'the scan recognises 0321 as a rebuild')
})

// ------------------------------------------------------------------------------------------------ T-B8
function headerAssertions(section) {
  const start = SQL.indexOf(section)
  assert.ok(start >= 0, `header has ${section}`)
  const next = SQL.slice(start + section.length).search(/\n-- [A-Z][A-Z-]+[ (:]/)
  const text = next < 0 ? SQL.slice(start) : SQL.slice(start, start + section.length + next)
  return text.split('\n').map((l) => /^--\s+(SELECT .*?;)\s*(?:--\s*(.*))?$/.exec(l)).filter(Boolean).map((m) => ({ sql: m[1], note: (m[2] || '').trim() }))
}
const one = (raw, sql) => Object.values(raw.prepare(sql).get())[0]

check('T-B8 the pre and post assertions in the header return the expected values; the closed-with-a-phone count is a stop; every LIKE is at most 50 bytes', () => {
  const pre = headerAssertions('PRE-ASSERTIONS')
  const post = headerAssertions('POST-ASSERTIONS')
  assert.equal(pre.length, 5)
  assert.equal(post.length, 5)
  for (const { sql } of [...pre, ...post]) for (const m of sql.matchAll(/LIKE\s+'([^']*)'/g)) assert.ok(Buffer.byteLength(m[1]) <= 50, `${m[1]}`)
  for (const { sql } of [...pre, ...post]) assert.ok(!/pragma/i.test(sql), 'no pragma function (the ops guard forbids it)')

  const clean = openDb(loadAll({ through: 323 })).db
  insertMember(clean, { name: 'Open', phone: '012900001' })
  assert.deepEqual(pre.map((p) => one(clean, p.sql)), [1, 0, 0, 1, 0])

  const dirty = at323()
  assert.deepEqual(pre.map((p) => one(dirty, p.sql)), [1, 0, 0, 3, 1], 'the T-B1 fixture: the closed-with-a-phone count is 1, which is a STOP')
  assert.match(pre[4].note, /STOP/i, 'the header says the last pre-assertion is a stop, not a record')
  assert.match(pre[4].note, /0/)

  const before = one(clean, 'SELECT COUNT(*) FROM portal_accounts')
  clean.exec(SQL)
  assert.deepEqual(post.map((p) => one(clean, p.sql)), [1, 3, before, 0, 0])
  const alreadyApplied = real()
  assert.deepEqual(pre.slice(0, 3).map((p) => one(alreadyApplied, p.sql)), [1, 1, 3], 'run after the file, the pre-assertions refuse a second apply')
})

check('the pre-assertion sees a closed member that kept its phone, and not one without', () => {
  const pre = headerAssertions('PRE-ASSERTIONS')
  const stop = pre[4].sql
  const raw = openDb(loadAll({ through: 323 })).db
  insertMember(raw, { name: 'Closed Clean', status: 'closed' })
  assert.equal(one(raw, stop), 0)
  insertMember(raw, { name: 'Closed Phone', status: 'closed', phone: '012900009' })
  assert.equal(one(raw, stop), 1)
})

console.log(`${passed} passed, ${failed} failed`)
