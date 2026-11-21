// G38 S1: migration 0321 (portal_accounts rebuild) on the real chain through 0320.
//
// What it pins: the rebuild carries every column of today's table (15, age_confirmed_at included) and every
// value; the in-file guards stop a rebuild that would lose data; ids and the AUTOINCREMENT mark survive;
// a member may have no phone, password or LC number; one member per customer; the member_code shape check;
// the file is LF only. Each new rule has a mutant that the same check turns red.
//
// D1 applies a migration file as one unit; node:sqlite does not, so a failing file runs inside BEGIN..ROLLBACK.
//
// Run: node scripts/test-migration-0321-portal-members-separation-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const dir = path.join(__dirname, '..', 'migrations')
const NAME = '0321_portal_members_separation.sql'
const SQL = fs.readFileSync(path.join(dir, NAME), 'utf8')

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

const OLD_COLUMNS = ['id', 'membership_id', 'name', 'phone', 'password_hash', 'email', 'contact_id', 'cart_json', 'wishlist_json',
  'created_at', 'updated_at', 'consent_version', 'consent_at', 'consent_locale', 'age_confirmed_at']
const OLD_LIST = OLD_COLUMNS.join(', ')

function beforeMigration() {
  const raw = openDb(loadAll({ through: 320 })).db
  raw.exec(`
    INSERT INTO customers (id, name, phone, phone_normalized, membership_number, created_at) VALUES
      (10, 'Signup Made', '012 100 100', '012100100', 'LC-00010', '2026-09-01 08:00:00'),
      (20, 'Old Buyer',   '012 200 200', '012200200', 'LC-00020', '2025-01-01 08:00:00'),
      (30, 'Unrelated',   '012 300 300', '012300300', 'LC-00030', '2025-01-01 08:00:00');
    INSERT INTO portal_accounts (id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
      created_at, updated_at, consent_version, consent_at, consent_locale, age_confirmed_at) VALUES
      (1, 'LC-00010', 'Signup Made', '012100100', '$pbkdf2-sha256$a', NULL, 10, '[{"id":"p1","qty":2}]', NULL,
        '2026-09-01 08:00:02', '2026-09-02 09:00:00', 'portal-legal-2026-10-20', '2026-10-21 08:00:02', 'km', '2026-10-21 08:00:02'),
      (2, 'LC-00020', 'Old Buyer', '012200200', '$2b$10$legacy', 'b@example.com', 20, NULL, '[{"id":"p9"}]',
        '2026-09-03 10:00:00', '2026-09-03 10:00:00', NULL, NULL, NULL, NULL),
      (3, 'LC-00031', 'Unlinked', '012300301', '$pbkdf2-sha256$c', NULL, NULL, NULL, NULL,
        '2026-09-04 10:00:00', '2026-09-04 10:00:00', 'portal-legal-2026-10-20', '2026-10-22 10:00:00', 'en', '2026-10-22 10:00:00'),
      (5, 'LC-00050', 'Top Row', '012500500', '$pbkdf2-sha256$e', NULL, NULL, NULL, NULL,
        '2026-09-05 10:00:00', '2026-09-05 10:00:00', NULL, NULL, NULL, NULL),
      (6, 'LC-00060', 'Removed Later', '012600600', '$pbkdf2-sha256$f', NULL, NULL, NULL, NULL,
        '2026-09-06 10:00:00', '2026-09-06 10:00:00', NULL, NULL, NULL, NULL);
    DELETE FROM portal_accounts WHERE id = 6;
    INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at) VALUES
      (3, 'old-session', '2027-01-01T00:00:00.000Z', '2026-09-20 08:00:00', '2026-10-01 12:00:00'),
      (3, 'older-session', '2027-01-01T00:00:00.000Z', '2026-09-10 08:00:00', NULL);
  `)
  return raw
}

function applyAtomically(raw, sql) {
  raw.exec('BEGIN')
  try { raw.exec(sql); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
}

const columnsOf = (raw) => raw.prepare("SELECT name FROM pragma_table_info('portal_accounts')").all().map((r) => r.name)
const ageValues = (raw) => raw.prepare('SELECT id, age_confirmed_at FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r }))

check('the file is LF only, numbered once, and carries purpose, assertions and recovery', () => {
  assert.equal(Buffer.from(SQL, 'utf8').includes(0x0d), false, 'CR byte in the migration')
  for (const section of ['PURPOSE', 'PRE-ASSERTIONS', 'POST-ASSERTIONS', 'RECOVERY']) assert.ok(SQL.includes(section), `lacks ${section}`)
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('0321')), [NAME])
  assert.ok(!/WITHOUT ROWID/i.test(SQL))
})

check('the table at 0320 has exactly the 15 columns this file carries (a new column elsewhere turns this red)', () => {
  assert.deepEqual(columnsOf(beforeMigration()), OLD_COLUMNS)
})

check('same rows, ids, every old column value (age_confirmed_at too); sequence preserved; new columns at their defaults', () => {
  const raw = beforeMigration()
  const before = raw.prepare(`SELECT ${OLD_LIST} FROM portal_accounts ORDER BY id`).all().map((r) => ({ ...r }))
  const seqBefore = raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get().seq
  assert.equal(seqBefore, 6, 'fixture: the high-water mark is above MAX(id)')
  assert.equal(before.filter((r) => r.age_confirmed_at).length, 2, 'fixture: two accounts hold an age confirmation')
  applyAtomically(raw, SQL)
  assert.deepEqual(raw.prepare(`SELECT ${OLD_LIST} FROM portal_accounts ORDER BY id`).all().map((r) => ({ ...r })), before)
  assert.equal(columnsOf(raw).length, 21)
  assert.equal(raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get().seq, seqBefore)
  assert.equal(Number(raw.prepare("INSERT INTO portal_accounts (name) VALUES ('After')").run().lastInsertRowid), 7, 'a removed id (6) is never issued again')
  const added = raw.prepare('SELECT id, member_code, status, link_version, created_contact_id, last_seen_at, closed_at FROM portal_accounts WHERE id <= 5 ORDER BY id').all()
  assert.deepEqual(added.map((r) => ({ ...r })), [
    { id: 1, member_code: null, status: 'active', link_version: 0, created_contact_id: 10, last_seen_at: '2026-10-21 08:00:02', closed_at: null },
    { id: 2, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-09-03 10:00:00', closed_at: null },
    { id: 3, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-10-22 10:00:00', closed_at: null },
    { id: 5, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-09-05 10:00:00', closed_at: null },
  ])
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions s JOIN portal_accounts a ON a.id = s.account_id WHERE a.id = 3').get().n, 2, 'sessions still reach their account')
  const objects = raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'portal_accounts%' OR name LIKE 'idx_portal_accounts%' OR name LIKE 'portal_members_guard%' ORDER BY name").all().map((r) => r.name)
  assert.deepEqual(objects, ['idx_portal_accounts_contact', 'idx_portal_accounts_member_code', 'idx_portal_accounts_membership', 'idx_portal_accounts_phone', 'idx_portal_accounts_status_seen', 'portal_accounts'])
})

// The lane's first draft of this file (0230) had no age_confirmed_at anywhere. The mutant removes it from the
// table, the copy and both guards, which is what that draft did.
function withoutAgeColumn(sql) {
  return sql
    .replace(/\n  age_confirmed_at TEXT,/, '')
    .replace(/, o\.age_confirmed_at,\n/, ',\n')
    .replace(/consent_locale, age_confirmed_at,\n  created_contact_id/, 'consent_locale,\n  created_contact_id')
    .replace(/, age_confirmed_at FROM/g, ' FROM')
    .replace(/INSERT INTO portal_members_guard_0321 \(check_name, ok\)\nSELECT 'age_confirmed_count_equal'[\s\S]*?THEN 1 ELSE 0 END;\n\n/, '')
}

check('age_confirmed_at survives the rebuild; the mutant that omits it loses every confirmation and this check sees it', () => {
  const raw = beforeMigration()
  const before = ageValues(raw)
  applyAtomically(raw, SQL)
  assert.deepEqual(ageValues(raw), before)

  const mutantSql = withoutAgeColumn(SQL)
  assert.notEqual(mutantSql, SQL)
  assert.ok(!/age_confirmed/.test(mutantSql.replace(/--.*$/gm, '')), 'the mutant has no age_confirmed_at left outside comments')
  const mutant = beforeMigration()
  applyAtomically(mutant, mutantSql)
  assert.ok(!columnsOf(mutant).includes('age_confirmed_at'), 'the mutant lost the column')
  assert.throws(() => ageValues(mutant), /age_confirmed_at/, 'the survival check turns red on the mutant')
})

check('a rebuild that copied everything but age_confirmed_at values is stopped by the in-file guards', () => {
  const copyNothing = SQL.replace('o.consent_locale, o.age_confirmed_at,', 'o.consent_locale, NULL,')
  assert.notEqual(copyNothing, SQL)
  const raw = beforeMigration()
  assert.throws(() => applyAtomically(raw, copyNothing), /CHECK constraint failed/)
  assert.deepEqual(columnsOf(raw), OLD_COLUMNS, 'rolled back: the table is untouched')
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM portal_accounts WHERE age_confirmed_at IS NOT NULL").get().n, 2)
})

check('a column added to the table later is refused, not dropped; the guard-less mutant would drop it', () => {
  const raw = beforeMigration()
  raw.exec('ALTER TABLE portal_accounts ADD COLUMN extra_note TEXT')
  raw.prepare("UPDATE portal_accounts SET extra_note = 'keep me' WHERE id = 3").run()
  assert.throws(() => applyAtomically(raw, SQL), /CHECK constraint failed/)
  assert.ok(columnsOf(raw).includes('extra_note'), 'rolled back')
  assert.equal(raw.prepare('SELECT extra_note FROM portal_accounts WHERE id = 3').get().extra_note, 'keep me')

  const mutantSql = SQL.replace(/INSERT INTO portal_members_guard_0321 \(check_name, ok\)\nSELECT 'columns_known_15'[^\n]*\n\n/, '')
  assert.notEqual(mutantSql, SQL)
  const mutant = beforeMigration()
  mutant.exec('ALTER TABLE portal_accounts ADD COLUMN extra_note TEXT')
  mutant.prepare("UPDATE portal_accounts SET extra_note = 'keep me' WHERE id = 3").run()
  applyAtomically(mutant, mutantSql)
  assert.ok(!columnsOf(mutant).includes('extra_note'), 'without the guard the column is silently gone')
})

check('running it twice is refused cleanly, nothing changes', () => {
  const raw = beforeMigration()
  applyAtomically(raw, SQL)
  const snapshot = raw.prepare('SELECT * FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r }))
  assert.throws(() => applyAtomically(raw, SQL), /CHECK constraint failed/)
  assert.deepEqual(raw.prepare('SELECT * FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r })), snapshot)
})

function cutBetween(sql, startMarker, endMarker) {
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `markers found: ${startMarker}`)
  return sql.slice(0, start) + sql.slice(end + endMarker.length)
}

check('a removed id is never reissued; without the placeholder the guard stops the file, and without both the id comes back', () => {
  const noPlaceholder = cutBetween(SQL, 'INSERT INTO portal_accounts_0321_new (id, name, status)', 'AND id > (SELECT COALESCE(MAX(id), 0) FROM portal_accounts);\n')
  assert.notEqual(noPlaceholder, SQL)
  assert.throws(() => applyAtomically(beforeMigration(), noPlaceholder), /CHECK constraint failed/)
  const noGuard = cutBetween(noPlaceholder, "INSERT INTO portal_members_guard_0321 (check_name, ok)\nSELECT 'sequence_preserved'", 'THEN 1 ELSE 0 END;\n')
  assert.notEqual(noGuard, noPlaceholder)
  const mutant = beforeMigration()
  applyAtomically(mutant, noGuard)
  assert.equal(Number(mutant.prepare("INSERT INTO portal_accounts (name) VALUES ('After')").run().lastInsertRowid), 6, 'the mutant hands out id 6 again')
  const real = beforeMigration()
  applyAtomically(real, SQL)
  assert.equal(Number(real.prepare("INSERT INTO portal_accounts (name) VALUES ('After')").run().lastInsertRowid), 7)
})

check('every LIKE/GLOB pattern in the rebuilt table fits native D1\'s 50 bytes; the shape CHECK still refuses bad codes', () => {
  const raw = beforeMigration()
  applyAtomically(raw, SQL)
  for (const object of raw.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name = 'portal_accounts'").all()) {
    for (const match of object.sql.matchAll(/(?:LIKE|GLOB)\s+'([^']*)'/gi)) assert.ok(Buffer.byteLength(match[1]) <= 50, `${object.name}: ${Buffer.byteLength(match[1])}-byte pattern`)
  }
  const bad = ['W-0000-000I', 'W-0000-000', 'w-0000-0000', 'W-0000_0000', 'X-0000-0000', 'W-0000-00000', 'W-00O0-0000', 'W-0000-0U00']
  for (const value of bad) assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('x', @c)").run({ c: value }), /CHECK/, value)
  raw.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('ok', 'W-7KQ4-M9XD')").run()
  assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('dup', 'W-7KQ4-M9XD')").run(), /UNIQUE/)
})

check('afterwards: one member per customer; no phone, password or LC id needed; phone and LC id still unique; status checked', () => {
  const raw = beforeMigration()
  applyAtomically(raw, SQL)
  assert.throws(() => raw.prepare('UPDATE portal_accounts SET contact_id = 10 WHERE id = 3').run(), /UNIQUE constraint failed: portal_accounts.contact_id/)
  raw.prepare("INSERT INTO portal_accounts (name) VALUES ('No Phone')").run()
  raw.prepare("INSERT INTO portal_accounts (name) VALUES ('No Phone 2')").run()
  assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, phone) VALUES ('Dup', '012100100')").run(), /UNIQUE/)
  assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, membership_id) VALUES ('Dup', ' lc-00010 ')").run(), /UNIQUE/)
  assert.throws(() => raw.prepare("UPDATE portal_accounts SET status = 'deleted' WHERE id = 1").run(), /CHECK/)
  assert.throws(() => raw.prepare("UPDATE portal_accounts SET link_version = -1 WHERE id = 1").run(), /CHECK/)
})

check('two accounts on one customer stop the file and leave the table untouched; the same fixture without the duplicate applies', () => {
  const raw = beforeMigration()
  raw.exec('DROP INDEX idx_portal_accounts_contact')
  raw.prepare('UPDATE portal_accounts SET contact_id = 10 WHERE id = 3').run()
  const before = raw.prepare(`SELECT ${OLD_LIST} FROM portal_accounts ORDER BY id`).all().map((r) => ({ ...r }))
  assert.throws(() => applyAtomically(raw, SQL), /CHECK constraint failed/)
  assert.deepEqual(raw.prepare(`SELECT ${OLD_LIST} FROM portal_accounts ORDER BY id`).all().map((r) => ({ ...r })), before)
  assert.ok(!columnsOf(raw).includes('member_code'), 'the rebuild did not happen')
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'portal_members_guard_0321'").get().n, 0)
  raw.prepare('UPDATE portal_accounts SET contact_id = NULL WHERE id = 3').run()
  applyAtomically(raw, SQL)
})

check('an empty table (production today) rebuilds to the new shape with no rows', () => {
  const raw = openDb(loadAll({ through: 320 })).db
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0)
  applyAtomically(raw, SQL)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0)
  assert.equal(columnsOf(raw).length, 21)
  assert.equal(Number(raw.prepare("INSERT INTO portal_accounts (name) VALUES ('First')").run().lastInsertRowid), 1)
})

// ---- worst case: remote D1 may not apply the file as one unit, so a stop between statements leaves that state ----
function statementsOf(sql) {
  const body = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n')
  return body.split(/;[ \t]*\n/).map((s) => s.trim()).filter(Boolean).map((s) => `${s};`)
}
const STATEMENTS = statementsOf(SQL)
const DROP_OLD = 'DROP TABLE portal_accounts;'
const DROP_INDEX = STATEMENTS.indexOf(DROP_OLD)
const INDEX_STATEMENTS = STATEMENTS.filter((s) => /^CREATE (UNIQUE )?INDEX IF NOT EXISTS/.test(s))
const RENAME_NEW = 'ALTER TABLE portal_accounts_0321_new RENAME TO portal_accounts;'
const DROP_GUARD = 'DROP TABLE IF EXISTS portal_members_guard_0321;'

// Every guard that can fire must run before the first statement that removes or renames portal_accounts; every
// statement after it must be one that cannot fail on valid data (rename of the new table, IF NOT EXISTS index, IF EXISTS drop).
function orderViolations(sql) {
  const statements = statementsOf(sql)
  const first = statements.findIndex((s) => /^DROP TABLE portal_accounts;$/.test(s) || /^ALTER TABLE portal_accounts RENAME/.test(s))
  if (first < 0) return ['no statement removes the old table']
  const problems = []
  statements.forEach((statement, index) => {
    if (index < first) return
    const allowed = index === first || statement === RENAME_NEW || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS/.test(statement) || statement === DROP_GUARD
    if (!allowed) problems.push(`after the old table is removed: ${statement.slice(0, 70)}`)
  })
  return problems
}

function applyStatements(raw, statements) { for (const statement of statements) raw.exec(statement) }
function signature(raw) {
  const sqlOf = (type) => raw.prepare('SELECT name, sql FROM sqlite_master WHERE tbl_name = ? AND type = ? ORDER BY name').all('portal_accounts', type).map((r) => `${r.name}: ${String(r.sql).replace(/\s+/g, ' ')}`)
  return JSON.stringify({
    columns: columnsOf(raw),
    rows: raw.prepare('SELECT * FROM portal_accounts ORDER BY id').all().map((r) => ({ ...r })),
    tables: sqlOf('table'),
    indexes: sqlOf('index'),
    seq: raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get()?.seq ?? null,
    leftovers: raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('portal_accounts_0321_new', 'portal_accounts_0321_old', 'portal_members_guard_0321') ORDER BY name").all().map((r) => r.name),
  })
}
const cleanRun = beforeMigration()
applyStatements(cleanRun, STATEMENTS)
const CLEAN = signature(cleanRun)
const BEFORE_ROWS = beforeMigration().prepare(`SELECT ${OLD_LIST} FROM portal_accounts ORDER BY id`).all().map((r) => ({ ...r }))
const rowsOf = (raw, table) => raw.prepare(`SELECT ${OLD_LIST} FROM ${table} ORDER BY id`).all().map((r) => ({ ...r }))

check('the order: every guard runs before the first statement that removes the old table, and only statements that cannot fail follow it', () => {
  assert.ok(DROP_INDEX > 0)
  assert.deepEqual(orderViolations(SQL), [])
  const guards = STATEMENTS.map((s, i) => [s, i]).filter(([s]) => /^INSERT INTO portal_members_guard_0321/.test(s))
  assert.equal(guards.length, 7)
  assert.ok(guards.every(([, i]) => i < DROP_INDEX), 'all seven guards precede the DROP')
  assert.ok(!STATEMENTS.slice(0, DROP_INDEX).some((s) => /^ALTER TABLE portal_accounts /.test(s) || /^DROP TABLE portal_accounts\b/.test(s)))
  const lastGuard = STATEMENTS.findIndex((s) => s.includes("'member_codes_unminted'"))
  const moved = STATEMENTS.slice()
  const [guard] = moved.splice(lastGuard, 1)
  moved.push(guard)
  assert.notDeepEqual(orderViolations(moved.join('\n')), [], 'the mutant that runs a guard after the DROP is reported')
  const renameFirst = [STATEMENTS[0], 'ALTER TABLE portal_accounts RENAME TO portal_accounts_0321_old;', 'CREATE TABLE portal_accounts (id INTEGER);', STATEMENTS.find((s) => s.includes("'row_count_equal'")), 'DROP TABLE portal_accounts_0321_old;'].join('\n')
  assert.notDeepEqual(orderViolations(renameFirst), [], 'the mutant with the old rename-first order is reported')
})

check('a stop before any statement before the DROP leaves portal_accounts exactly as it was; running the file again from there ends in the clean result', () => {
  for (let stopAt = 0; stopAt <= DROP_INDEX; stopAt += 1) {
    const raw = beforeMigration()
    applyStatements(raw, STATEMENTS.slice(0, stopAt))
    assert.deepEqual(columnsOf(raw), OLD_COLUMNS, `stop ${stopAt}`)
    assert.deepEqual(rowsOf(raw, 'portal_accounts'), BEFORE_ROWS, `stop ${stopAt}`)
    for (const index of ['idx_portal_accounts_phone', 'idx_portal_accounts_membership', 'idx_portal_accounts_contact']) {
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(index).n, 1, `stop ${stopAt}: ${index}`)
    }
    assert.equal(raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get().seq, 6, `stop ${stopAt}`)
    applyStatements(raw, STATEMENTS)
    assert.equal(signature(raw), CLEAN, `rerun after a stop before statement ${stopAt}`)
  }
})

check('a stop right after the old table is dropped keeps every row in portal_accounts_0321_new; applying the file again is refused and drops nothing; the recorded recovery restores the clean result', () => {
  const raw = beforeMigration()
  applyStatements(raw, STATEMENTS.slice(0, DROP_INDEX + 1))
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'portal_accounts'").get().n, 0)
  assert.deepEqual(rowsOf(raw, 'portal_accounts_0321_new'), BEFORE_ROWS)
  assert.throws(() => applyStatements(raw, STATEMENTS), /CHECK constraint failed/)
  assert.deepEqual(rowsOf(raw, 'portal_accounts_0321_new'), BEFORE_ROWS, 'the only copy of the data is still there')
  assert.ok(SQL.includes(`--       ${RENAME_NEW}`), 'the note records the rename')
  assert.ok(SQL.includes(`--       ${DROP_GUARD}`), 'the note records the guard clean-up')
  raw.exec(RENAME_NEW)
  for (const statement of INDEX_STATEMENTS) raw.exec(statement)
  raw.exec(DROP_GUARD)
  assert.equal(signature(raw), CLEAN)
})

check('a stop after the rename, at any index, is repaired by the CREATE INDEX IF NOT EXISTS statements and the guard drop; applying the file again is refused', () => {
  const renameIndex = STATEMENTS.indexOf(RENAME_NEW)
  assert.equal(renameIndex, DROP_INDEX + 1)
  for (let stopAt = renameIndex + 1; stopAt < STATEMENTS.length; stopAt += 1) {
    const raw = beforeMigration()
    applyStatements(raw, STATEMENTS.slice(0, stopAt))
    assert.deepEqual(rowsOf(raw, 'portal_accounts'), BEFORE_ROWS, `stop ${stopAt}`)
    assert.throws(() => applyStatements(raw, STATEMENTS), /CHECK constraint failed/, `stop ${stopAt}`)
    for (const statement of INDEX_STATEMENTS) raw.exec(statement)
    raw.exec(DROP_GUARD)
    assert.equal(signature(raw), CLEAN, `repair after a stop before statement ${stopAt}`)
  }
})

check('a guard that fires BEFORE the drop, run without any transaction, leaves the live table untouched (duplicate contact link, and a copy that loses a value)', () => {
  const dup = beforeMigration()
  dup.exec('DROP INDEX idx_portal_accounts_contact')
  dup.prepare('UPDATE portal_accounts SET contact_id = 10 WHERE id = 3').run()
  assert.throws(() => applyStatements(dup, STATEMENTS), /CHECK constraint failed/)
  assert.deepEqual(columnsOf(dup), OLD_COLUMNS)
  assert.equal(dup.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 4)
  assert.equal(dup.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'portal_accounts_0321_new'").get().n, 0, 'refused before anything was created')
  const lossy = beforeMigration()
  assert.throws(() => applyStatements(lossy, statementsOf(SQL.replace('o.consent_locale, o.age_confirmed_at,', 'o.consent_locale, NULL,'))), /CHECK constraint failed/)
  assert.deepEqual(columnsOf(lossy), OLD_COLUMNS, 'the verification guard fired while the live table was still whole')
  assert.deepEqual(rowsOf(lossy, 'portal_accounts'), BEFORE_ROWS)
})

check('a real account named like the placeholder survives; the mutant that deletes by name alone removes it', () => {
  const NAME_SQL = "__portal_members_0321_sequence__"
  const withReal = () => {
    const raw = beforeMigration()
    raw.prepare("INSERT INTO portal_accounts (id, membership_id, name, phone, password_hash) VALUES (4, 'LC-00040', ?, '012400400', '$pbkdf2-sha256$d')").run(NAME_SQL)
    return raw
  }
  const raw = withReal()
  applyAtomically(raw, SQL)
  assert.deepEqual({ ...raw.prepare('SELECT id, name, phone, status FROM portal_accounts WHERE id = 4').get() }, { id: 4, name: NAME_SQL, phone: '012400400', status: 'active' })
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts WHERE name = ?').get(NAME_SQL).n, 1)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts WHERE id > 6').get().n, 0, 'the placeholder at id 6 is gone')
  assert.equal(Number(raw.prepare("INSERT INTO portal_accounts (name) VALUES ('After')").run().lastInsertRowid), 7)

  const deleteStatement = STATEMENTS.find((s) => s.startsWith('DELETE FROM portal_accounts_0321_new'))
  assert.ok(deleteStatement)
  const mutantSql = SQL.replace(/DELETE FROM portal_accounts_0321_new\nWHERE name = '__portal_members_0321_sequence__'[\s\S]*?FROM portal_accounts\);\n/, "DELETE FROM portal_accounts_0321_new WHERE name = '__portal_members_0321_sequence__';\n")
  assert.notEqual(mutantSql, SQL)
  const mutant = withReal()
  assert.throws(() => applyAtomically(mutant, mutantSql), /CHECK constraint failed/, 'the name-only delete removes a real account, which the row-count guard turns into a refused migration')
  assert.equal(mutant.prepare('SELECT COUNT(*) AS n FROM portal_accounts WHERE id = 4').get().n, 1)
  assert.ok(columnsOf(mutant).length === 15, 'and the live table stays whole')
})

const SEQUENCE_DELETE = "DELETE FROM sqlite_sequence WHERE name = 'portal_accounts_0321_new' AND seq = 0;"
const withoutSeqFilter = SQL.replace(SEQUENCE_DELETE, "DELETE FROM sqlite_sequence WHERE name = 'portal_accounts_0321_new';")
const withoutNameFilter = SQL.replace(SEQUENCE_DELETE, 'DELETE FROM sqlite_sequence WHERE seq = 0;')
const withoutSequenceDelete = SQL.replace(SEQUENCE_DELETE, '')
check('fixture: the three sequence mutants differ from the file', () => {
  assert.ok(SQL.includes(SEQUENCE_DELETE), 'the statement is exactly this text')
  assert.equal(SQL.replace(/--.*$/gm, '').split('DELETE FROM sqlite_sequence').length - 1, 1, 'the file removes sequence rows in one statement only')
  for (const mutant of [withoutSeqFilter, withoutNameFilter, withoutSequenceDelete]) assert.notEqual(mutant, SQL)
})

const sequenceRows = (raw) => raw.prepare('SELECT rowid AS r, name, seq FROM sqlite_sequence ORDER BY rowid').all().map((r) => ({ ...r }))
const memberSequence = (raw) => raw.prepare("SELECT name, seq FROM sqlite_sequence WHERE name LIKE 'portal_accounts%'").all().map((r) => ({ ...r }))
function freshWithOtherZeroRow() {
  const raw = openDb(loadAll({ through: 320 })).db
  raw.exec('CREATE TABLE zz_other_autoinc (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
  raw.exec('INSERT INTO zz_other_autoinc (v) SELECT 1 WHERE 0')
  return raw
}
const nextMemberId = (raw) => Number(raw.prepare("INSERT INTO portal_accounts (name) VALUES ('Next')").run().lastInsertRowid)

function caseNeverUsed(sql) {
  const raw = freshWithOtherZeroRow()
  assert.deepEqual(memberSequence(raw), [], 'fixture: the member table has no sequence row')
  assert.ok(sequenceRows(raw).some((r) => r.name === 'zz_other_autoinc' && r.seq === 0), 'fixture: another table holds a zero sequence row')
  const before = sequenceRows(raw)
  applyAtomically(raw, sql)
  assert.deepEqual(memberSequence(raw), [], 'no sequence row for the member table')
  assert.deepEqual(sequenceRows(raw), before, 'every other sequence row is identical (name, seq, order)')
  assert.equal(nextMemberId(raw), 1)
}
function caseUsedThenEmptied(sql) {
  const raw = freshWithOtherZeroRow()
  raw.exec("INSERT INTO portal_accounts (id, membership_id, name, phone, password_hash) VALUES (7, 'LC-00070', 'Gone', '012700700', 'h'); DELETE FROM portal_accounts WHERE id = 7")
  assert.deepEqual(memberSequence(raw), [{ name: 'portal_accounts', seq: 7 }], 'fixture: mark 7, no rows')
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n, 0)
  applyAtomically(raw, sql)
  assert.deepEqual(memberSequence(raw), [{ name: 'portal_accounts', seq: 7 }], 'the mark survives')
  assert.equal(nextMemberId(raw), 8, 'the next account gets id 8')
}
function caseWithRows(sql) {
  const raw = freshWithOtherZeroRow()
  raw.exec("INSERT INTO portal_accounts (membership_id, name, phone, password_hash) VALUES ('LC-00001', 'A', '012000001', 'h'), ('LC-00002', 'B', '012000002', 'h'), ('LC-00003', 'C', '012000003', 'h')")
  assert.deepEqual(memberSequence(raw), [{ name: 'portal_accounts', seq: 3 }])
  applyAtomically(raw, sql)
  assert.deepEqual(memberSequence(raw), [{ name: 'portal_accounts', seq: 3 }], 'the mark is unchanged')
  assert.equal(nextMemberId(raw), 4)
}

check('sequence row, case 1: a member table never used and empty ends with no sequence row; every other sequence row is identical; mutants without the name filter or without the statement go red', () => {
  caseNeverUsed(SQL)
  assert.throws(() => caseNeverUsed(withoutNameFilter), /every other sequence row is identical/, 'without the name filter the other zero row is removed')
  assert.throws(() => caseNeverUsed(withoutSequenceDelete), /no sequence row for the member table/, 'without the statement a zero row is left')
})

check('sequence row, case 2: a table used and then emptied (mark 7) keeps the mark and issues 8; the mutant without AND seq = 0 loses the mark', () => {
  caseUsedThenEmptied(SQL)
  assert.throws(() => caseUsedThenEmptied(withoutSeqFilter), /the mark survives/)
})

check('sequence row, case 3: a table with rows keeps its mark unchanged', () => {
  caseWithRows(SQL)
})

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
