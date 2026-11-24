// G38 S1: after migration 0321 rebuilt portal_accounts, every statement that filters it still uses an index.
//
// The membership lookups in lib/membershipNumber.ts and lib/importEngine.ts filter on lower(trim(membership_id)) and do not repeat
// a partial index's predicate, so a `WHERE membership_id IS NOT NULL` index is never chosen for them (SQLite uses a partial index
// only when the query implies its WHERE): that was 0321's first draft, and it turned SEARCH into SCAN. The index is now plain UNIQUE
// (many NULLs are allowed anyway). This runs EXPLAIN QUERY PLAN for the real statements on the fully migrated schema, prints the
// plan line of each statement that filters portal_accounts, and shows with a partial-index mutant that the check goes red.
//
// Run (from cloudflare/): node scripts/test-portal-accounts-index-plans-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

function loadMembershipNumber() {
  const sourcePath = path.join(SRC, 'lib', 'membershipNumber.ts')
  const { outputText } = ts.transpileModule(readSrc('lib/membershipNumber.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  return moduleObj.exports
}
const { membershipGlob } = loadMembershipNumber()

const MEMBERSHIP_NEEDLE = 'SELECT membership_id FROM portal_accounts WHERE ${membershipGlob(\'membership_id\')}'
const statements = [
  { label: 'LC allocator (lib/membershipNumber.ts)', file: 'lib/membershipNumber.ts', needle: MEMBERSHIP_NEEDLE,
    sql: `SELECT membership_id FROM portal_accounts WHERE ${membershipGlob('membership_id')}`, expect: /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_membership/, membership: true },
  { label: 'import seed (lib/importEngine.ts)', file: 'lib/importEngine.ts', needle: MEMBERSHIP_NEEDLE,
    sql: `SELECT membership_id FROM portal_accounts WHERE ${membershipGlob('membership_id')}`, expect: /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_membership/, membership: true },
  { label: 'sign-in by phone (lib/portalAccounts.ts)', file: 'lib/portalAccounts.ts', needle: 'WHERE a.phone = @p',
    sql: 'SELECT a.id, a.name, a.membership_id, a.password_hash, a.consent_version, a.status, a.contact_id, c.id AS contact_exists, c.is_anonymous FROM portal_accounts a LEFT JOIN customers c ON c.id = a.contact_id WHERE a.phone = @p LIMIT 1',
    expect: /SEARCH a USING INDEX idx_portal_accounts_phone \(phone=\?\)/ },
  { label: 'Contacts badge, many contacts (routes/contacts.ts)', file: 'routes/contacts.ts', needle: 'FROM portal_accounts WHERE contact_id IN (${placeholders})',
    sql: 'SELECT contact_id, membership_id, member_code, created_at FROM portal_accounts WHERE contact_id IN (?, ?, ?)', expect: /SEARCH portal_accounts USING INDEX idx_portal_accounts_contact \(contact_id=\?\)/ },
  { label: 'staff reset, one contact (routes/contacts.ts)', file: 'routes/contacts.ts', needle: 'SELECT id FROM portal_accounts WHERE contact_id = @id LIMIT 1',
    sql: 'SELECT id FROM portal_accounts WHERE contact_id = @id LIMIT 1', expect: /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_contact \(contact_id=\?\)/ },
  { label: 'merge, holders of the merged contacts (routes/contacts.ts)', file: 'routes/contacts.ts', needle: 'FROM portal_accounts WHERE contact_id IN (${idList}) ORDER BY id',
    sql: 'SELECT id, contact_id, membership_id, name FROM portal_accounts WHERE contact_id IN (?, ?) ORDER BY id', expect: /SEARCH portal_accounts USING INDEX idx_portal_accounts_contact \(contact_id=\?\)/ },
  { label: 'merge move (lib/contactMerge.ts)', file: 'lib/contactMerge.ts', needle: 'UPDATE portal_accounts SET contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE contact_id = @mergeId',
    sql: 'UPDATE portal_accounts SET contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE contact_id = @mergeId', expect: /SEARCH portal_accounts USING INDEX idx_portal_accounts_contact \(contact_id=\?\)/ },
  { label: 'member code lookup (a later slice; the index must serve an equality)', file: null, needle: null,
    sql: 'SELECT id FROM portal_accounts WHERE member_code = @code', expect: /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_member_code \(member_code=\?\)/ },
  { label: 'member code mint, compare-and-set (lib/portalAccounts.ts)', file: 'lib/portalAccounts.ts', needle: 'UPDATE portal_accounts SET member_code = @code WHERE id = @id AND member_code IS NULL',
    sql: 'UPDATE portal_accounts SET member_code = @code WHERE id = @id AND member_code IS NULL', expect: /SEARCH portal_accounts USING INTEGER PRIMARY KEY \(rowid=\?\)/ },
  { label: 'session read, account side (lib/portalSession.ts)', file: 'lib/portalSession.ts', needle: "AND a.status = 'active'",
    sql: "SELECT a.id FROM portal_sessions s JOIN portal_accounts a ON a.id = s.account_id LEFT JOIN customers c ON c.id = a.contact_id WHERE s.token_hash = @t AND s.revoked_at IS NULL AND s.expires_at > @now AND a.status = 'active' LIMIT 1",
    expect: /SEARCH a USING INTEGER PRIMARY KEY \(rowid=\?\)/ },
  { label: 'status filter (retention and the staff list use idx_portal_accounts_status_seen)', file: null, needle: null,
    sql: "SELECT id FROM portal_accounts WHERE status = 'active' ORDER BY last_seen_at", expect: /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_status_seen \(status=\?\)/ },
]

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

function migrated() {
  const raw = openDb(loadAll()).db
  const insert = raw.prepare('INSERT INTO portal_accounts (name, phone, membership_id, contact_id) VALUES (?, ?, ?, ?)')
  for (let i = 1; i <= 60; i += 1) insert.run(`A${i}`, i % 5 === 0 ? null : `0129${String(i).padStart(5, '0')}`, i % 3 === 0 ? null : `LC-${String(i).padStart(5, '0')}`, i % 4 === 0 ? null : i + 100)
  return raw
}
function planFor(raw, statement) {
  const sql = statement.sql.replace(/@\w+/g, '?')
  const marks = (sql.match(/\?/g) || []).length
  return raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(marks).fill('x')).map((row) => row.detail).join(' / ')
}

const raw = migrated()

check('each statement named here is still the one in the source (a changed statement must be re-planned)', () => {
  for (const statement of statements.filter((s) => s.file)) {
    assert.ok(readSrc(statement.file).includes(statement.needle), `${statement.label}: ${statement.needle} not found in ${statement.file}`)
  }
})

check('the membership lookups SEARCH idx_portal_accounts_membership (a partial index would SCAN); the = lookup too', () => {
  for (const statement of statements.filter((s) => s.membership)) {
    const plan = planFor(raw, statement)
    assert.match(plan, statement.expect, `${statement.label}: ${plan}`)
  }
  assert.match(planFor(raw, { sql: 'SELECT id FROM portal_accounts WHERE lower(trim(membership_id)) = lower(trim(@m)) LIMIT 1' }), /SEARCH portal_accounts USING (COVERING )?INDEX idx_portal_accounts_membership/)
  const sqlOfIndex = raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_portal_accounts_membership'").get().sql
  assert.ok(!/WHERE/i.test(sqlOfIndex), sqlOfIndex)
})

check('mutant: the partial membership index makes the same statements SCAN, so the plan check above would be red', () => {
  const mutant = migrated()
  mutant.exec('DROP INDEX idx_portal_accounts_membership')
  mutant.exec('CREATE UNIQUE INDEX idx_portal_accounts_membership ON portal_accounts (lower(trim(membership_id))) WHERE membership_id IS NOT NULL')
  for (const statement of statements.filter((s) => s.membership)) {
    const plan = planFor(mutant, statement)
    assert.match(plan, /SCAN portal_accounts/, `${statement.label}: ${plan}`)
    assert.doesNotMatch(plan, statement.expect)
  }
})

check('every other statement that filters portal_accounts (phone, contact, member code, status, id) still uses its index', () => {
  const lines = []
  for (const statement of statements.filter((s) => !s.membership)) {
    const plan = planFor(raw, statement)
    lines.push(`${statement.label}\n      ${plan}`)
    assert.match(plan, statement.expect, `${statement.label}: ${plan}`)
    assert.doesNotMatch(plan, /SCAN portal_accounts|SCAN a\b/, `${statement.label}: ${plan}`)
  }
  console.log(`  plans:\n    ${lines.join('\n    ')}`)
})

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
