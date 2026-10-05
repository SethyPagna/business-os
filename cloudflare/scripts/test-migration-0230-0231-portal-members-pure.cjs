// G38 Phase 1: migrations 0230 (M1, portal_accounts rebuild) and 0231 (M2,
// link history + link requests), exactly as written, on the real chain.
//
//   "Migration M1/M2 pure tests: row/id/sequence parity, duplicate-contact
//    pre-assertion stops on a seeded duplicate."
//
// Plus: LF only (wrangler's remote splitter breaks a CRLF trigger body),
// header sections present, the rebuild keeps every old column value, the
// sign-up-created customer is recognised, one member per customer is enforced
// afterwards, 0231 writes one legacy_import per linked account, its history is
// append-only, and re-running 0231 after staff have linked changes nothing.
//
// D1 applies a migration file as one unit; node:sqlite does not, so a failing
// file is run inside BEGIN ... ROLLBACK here to model that.
//
// Run: node scripts/test-migration-0230-0231-portal-members-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const dir = path.join(__dirname, '..', 'migrations')
const M1_NAME = '0230_portal_members_separation.sql'
const M2_NAME = '0231_portal_member_links.sql'
const M1 = fs.readFileSync(path.join(dir, M1_NAME), 'utf8')
const M2 = fs.readFileSync(path.join(dir, M2_NAME), 'utf8')

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

const OLD_COLUMNS = 'id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json, created_at, updated_at, consent_version, consent_at, consent_locale'

// The chain as production has it before G38 (0229 is not used).
function preG38() {
  const db = openDb(loadAll({ through: 229 }))
  const raw = db.db
  raw.exec(`
    INSERT INTO customers (id, name, phone, phone_normalized, membership_number, created_at) VALUES
      (10, 'Signup Made', '012 100 100', '012100100', 'LC-00010', '2026-09-01 08:00:00'),
      (20, 'Old Buyer',   '012 200 200', '012200200', 'LC-00020', '2025-01-01 08:00:00'),
      (30, 'Unrelated',   '012 300 300', '012300300', 'LC-00030', '2025-01-01 08:00:00');
    INSERT INTO portal_accounts (id, membership_id, name, phone, password_hash, email, contact_id, cart_json, wishlist_json,
      created_at, updated_at, consent_version, consent_at, consent_locale) VALUES
      (1, 'LC-00010', 'Signup Made', '012100100', '$pbkdf2-sha256$a', NULL, 10, '[{"id":"p1","qty":2}]', NULL,
        '2026-09-01 08:00:02', '2026-09-02 09:00:00', 'portal-legal-2026-09-07', '2026-09-01 08:00:02', 'km'),
      (2, 'LC-00020', 'Old Buyer', '012200200', '$2b$10$legacy', 'b@example.com', 20, NULL, '[{"id":"p9"}]',
        '2026-09-03 10:00:00', '2026-09-03 10:00:00', NULL, NULL, NULL),
      (3, 'LC-00031', 'Unlinked', '012300301', '$pbkdf2-sha256$c', NULL, NULL, NULL, NULL,
        '2026-09-04 10:00:00', '2026-09-04 10:00:00', 'portal-legal-2026-09-30', '2026-09-04 10:00:00', 'en'),
      (5, 'LC-00050', 'Top Row', '012500500', '$pbkdf2-sha256$e', NULL, NULL, NULL, NULL,
        '2026-09-05 10:00:00', '2026-09-05 10:00:00', NULL, NULL, NULL),
      (6, 'LC-00060', 'Removed Later', '012600600', '$pbkdf2-sha256$f', NULL, NULL, NULL, NULL,
        '2026-09-06 10:00:00', '2026-09-06 10:00:00', NULL, NULL, NULL);
    DELETE FROM portal_accounts WHERE id = 6;
    INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at) VALUES
      (3, 'old-session', '2027-01-01T00:00:00.000Z', '2026-09-20 08:00:00', '2026-10-01 12:00:00'),
      (3, 'older-session', '2027-01-01T00:00:00.000Z', '2026-09-10 08:00:00', NULL);
  `)
  return raw
}

// D1 applies a file as one unit.
function applyAtomically(raw, sql) {
  raw.exec('BEGIN')
  try { raw.exec(sql); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
}

check('both files are LF only, numbered once, and carry purpose, assertions and recovery', () => {
  for (const [name, text] of [[M1_NAME, M1], [M2_NAME, M2]]) {
    assert.equal(Buffer.from(text, 'utf8').includes(0x0d), false, `${name} contains a CR byte`)
    for (const section of ['PURPOSE', 'PRE-ASSERTIONS', 'POST-ASSERTIONS', 'RECOVERY']) assert.ok(text.includes(section), `${name} lacks ${section}`)
  }
  const numbers = fs.readdirSync(dir).filter((f) => /^023[01]_/.test(f))
  assert.deepEqual(numbers.sort(), [M1_NAME, M2_NAME])
  assert.equal(fs.readdirSync(dir).some((f) => f.startsWith('0232')), false, '0232 is reserved for Phase 2 email')
})

check('0230: same rows, ids and old column values; new columns at their defaults; sequence preserved', () => {
  const raw = preG38()
  const before = raw.prepare(`SELECT ${OLD_COLUMNS} FROM portal_accounts ORDER BY id`).all()
  const seqBefore = raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get().seq
  assert.equal(seqBefore, 6, 'fixture: the high-water mark is above MAX(id)')
  applyAtomically(raw, M1)
  const after = raw.prepare(`SELECT ${OLD_COLUMNS} FROM portal_accounts ORDER BY id`).all()
  assert.deepEqual(after, before)
  assert.equal(raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'portal_accounts'").get().seq, seqBefore)
  const fresh = raw.prepare("INSERT INTO portal_accounts (name) VALUES ('After')").run()
  assert.equal(Number(fresh.lastInsertRowid), 7, 'a removed id (6) is never issued again')
  const added = raw.prepare('SELECT id, member_code, status, link_version, created_contact_id, last_seen_at, closed_at FROM portal_accounts WHERE id <= 5 ORDER BY id').all()
  // last_seen_at is the latest evidence of activity: a session's last visit
  // when there is one (account 3), else the latest of consent/update/creation.
  assert.deepEqual(added.map((r) => ({ ...r })), [
    { id: 1, member_code: null, status: 'active', link_version: 0, created_contact_id: 10, last_seen_at: '2026-09-02 09:00:00', closed_at: null },
    { id: 2, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-09-03 10:00:00', closed_at: null },
    { id: 3, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-10-01 12:00:00', closed_at: null },
    { id: 5, member_code: null, status: 'active', link_version: 0, created_contact_id: null, last_seen_at: '2026-09-05 10:00:00', closed_at: null },
  ])
  const objects = raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'portal_accounts%' OR name LIKE 'idx_portal_accounts%' OR name LIKE 'portal_members_guard%' ORDER BY name").all().map((r) => r.name)
  assert.deepEqual(objects, ['idx_portal_accounts_contact', 'idx_portal_accounts_member_code', 'idx_portal_accounts_membership', 'idx_portal_accounts_phone', 'idx_portal_accounts_status_seen', 'portal_accounts'])
})

check('0230: every LIKE/GLOB pattern in the rebuilt table is within native D1\'s 50-byte limit', () => {
    const raw = preG38()
    applyAtomically(raw, M1)
    applyAtomically(raw, M2)
    const objects = raw.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (tbl_name LIKE 'portal_%')").all()
    for (const object of objects) {
      for (const match of object.sql.matchAll(/(?:LIKE|GLOB)\s+'([^']*)'/gi)) {
        assert.ok(Buffer.byteLength(match[1]) <= 50, `${object.name}: ${Buffer.byteLength(match[1])}-byte pattern`)
      }
    }
    // The shape CHECK still refuses what the one long GLOB refused.
    const bad = ['W-0000-000I', 'W-0000-000', 'w-0000-0000', 'W-0000_0000', 'X-0000-0000', 'W-0000-00000', 'W-00O0-0000', 'W-0000-0U00']
    for (const value of bad) assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('x', @c)").run({ c: value }), /CHECK/, value)
    raw.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('ok', 'W-7KQ4-M9XD')").run()
})

check('0230 afterwards: one member per customer, NULL phone/password allowed, phone and LC id still unique', () => {
  const raw = preG38()
  applyAtomically(raw, M1)
  assert.throws(() => raw.prepare('UPDATE portal_accounts SET contact_id = 10 WHERE id = 3').run(), /UNIQUE constraint failed: portal_accounts.contact_id/)
  raw.prepare("INSERT INTO portal_accounts (name, phone, password_hash) VALUES ('Email Only', NULL, NULL)").run()
  raw.prepare("INSERT INTO portal_accounts (name, phone, password_hash) VALUES ('Email Only 2', NULL, NULL)").run()
  assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, phone) VALUES ('Dup', '012100100')").run(), /UNIQUE/)
  assert.throws(() => raw.prepare("INSERT INTO portal_accounts (name, membership_id) VALUES ('Dup', ' lc-00010 ')").run(), /UNIQUE/)
  assert.throws(() => raw.prepare("UPDATE portal_accounts SET status = 'deleted' WHERE id = 1").run(), /CHECK/)
})

check('0230 duplicate-contact pre-assertion stops on a seeded duplicate and leaves the table untouched', () => {
  const raw = preG38()
  raw.prepare('UPDATE portal_accounts SET contact_id = 10 WHERE id = 3').run()
  const before = raw.prepare(`SELECT ${OLD_COLUMNS} FROM portal_accounts ORDER BY id`).all()
  assert.throws(() => applyAtomically(raw, M1), /CHECK constraint failed/)
  assert.deepEqual(raw.prepare(`SELECT ${OLD_COLUMNS} FROM portal_accounts ORDER BY id`).all(), before)
  const columns = raw.prepare("SELECT name FROM pragma_table_info('portal_accounts')").all().map((r) => r.name)
  assert.ok(!columns.includes('member_code'), 'the rebuild did not happen')
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'portal_members_guard_0230'").get().n, 0)
  // Positive control: the same fixture without the duplicate applies.
  raw.prepare('UPDATE portal_accounts SET contact_id = NULL WHERE id = 3').run()
  applyAtomically(raw, M1)
})

check('0231: one legacy_import per linked account, telling sign-up-made from claimed customers', () => {
  const raw = preG38()
  applyAtomically(raw, M1)
  applyAtomically(raw, M2)
  const events = raw.prepare('SELECT account_id, action, from_customer_id, to_customer_id, evidence, reason_code, link_version_after FROM portal_member_link_events ORDER BY account_id').all()
  assert.deepEqual(events.map((e) => ({ ...e })), [
    { account_id: 1, action: 'legacy_import', from_customer_id: null, to_customer_id: 10, evidence: 'system', reason_code: 'signup_created_customer', link_version_after: 0 },
    { account_id: 2, action: 'legacy_import', from_customer_id: null, to_customer_id: 20, evidence: 'system', reason_code: 'signup_claimed_customer', link_version_after: 0 },
  ])
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM portal_member_link_requests').get().n, 0)
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'portal_member_links_guard_0231'").get().n, 0)
})

check('0231: history is append-only; one pending request per member', () => {
  const raw = preG38()
  applyAtomically(raw, M1)
  applyAtomically(raw, M2)
  assert.throws(() => raw.prepare("UPDATE portal_member_link_events SET note = 'x'").run(), /member_link_events_append_only/)
  assert.throws(() => raw.prepare('DELETE FROM portal_member_link_events').run(), /member_link_events_append_only/)
  assert.throws(() => raw.prepare("INSERT INTO portal_member_link_events (account_id, action, link_version_after) VALUES (1, 'teleport', 0)").run(), /CHECK/)
  raw.prepare("INSERT INTO portal_member_link_requests (account_id) VALUES (3)").run()
  assert.throws(() => raw.prepare("INSERT INTO portal_member_link_requests (account_id) VALUES (3)").run(), /UNIQUE/)
  raw.prepare("UPDATE portal_member_link_requests SET status = 'withdrawn' WHERE account_id = 3").run()
  raw.prepare("INSERT INTO portal_member_link_requests (account_id) VALUES (3)").run()
  assert.throws(() => raw.prepare("INSERT INTO portal_member_link_events (account_id, action, link_version_after, client_request_id) VALUES (1, 'link', 1, 'r1'), (1, 'unlink', 2, 'r1')").run(), /UNIQUE/)
})

check('0231 re-run after staff changed links: nothing changes, no error', () => {
  const raw = preG38()
  applyAtomically(raw, M1)
  applyAtomically(raw, M2)
  raw.prepare('UPDATE portal_accounts SET contact_id = 30, link_version = 1 WHERE id = 3').run()
  raw.prepare("INSERT INTO portal_member_link_events (account_id, action, to_customer_id, evidence, link_version_after) VALUES (3, 'link', 30, 'in_person', 1)").run()
  raw.prepare('UPDATE portal_accounts SET contact_id = NULL, link_version = 1 WHERE id = 2').run()
  raw.prepare("INSERT INTO portal_member_link_events (account_id, action, from_customer_id, evidence, link_version_after) VALUES (2, 'unlink', 20, NULL, 1)").run()
  const before = raw.prepare('SELECT * FROM portal_member_link_events ORDER BY id').all()
  applyAtomically(raw, M2)
  assert.deepEqual(raw.prepare('SELECT * FROM portal_member_link_events ORDER BY id').all(), before)
})

check('mutant control: a 0231 whose data step ignored link_version would duplicate history on re-run', () => {
  const raw = preG38()
  applyAtomically(raw, M1)
  applyAtomically(raw, M2)
  raw.prepare('UPDATE portal_accounts SET contact_id = 30, link_version = 1 WHERE id = 3').run()
  const mutant = M2.replace('  AND a.link_version = 0\n  AND NOT EXISTS (', '  AND NOT EXISTS (')
  assert.notEqual(mutant, M2)
  assert.throws(() => applyAtomically(raw, mutant), /CHECK constraint failed/, 'the in-file guard catches the bogus legacy_import')
})

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
