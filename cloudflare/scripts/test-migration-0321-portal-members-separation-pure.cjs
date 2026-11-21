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
  const noPlaceholder = cutBetween(SQL, 'INSERT INTO portal_accounts (id, name, status)', "WHERE name = '__portal_members_0321_sequence__';\n")
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

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
