'use strict'
// Pins migration 0270 (permission extras materialize, lane 6.0.967) on the real chain of every earlier migration.
//
// The owner's question (23 Oct 2026): "if we apply the permission update ... it doesn't make anything different or cause any
// conflict. double check." This is the double check. harness/permission_extras_oracle.cjs holds the OLD rules frozen and the
// REAL new modules; for every principal (named fixtures and a deterministic fuzz of thousands) it asserts
//     OLD(before data)  ===  NEW(after data)  ===  OLD(after data)
// over every capability the removed fallbacks could change, plus every unrelated key. Controls prove the test can fail.
//
// Run: node scripts/test-migration-0270-permission-extras-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const oracle = require('./harness/permission_extras_oracle.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0270_permission_extras_materialize.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')

const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()
const open = () => new Database(schema)

const real = oracle.loadRealRules()
const OLD = oracle.oldRules(real)
const NEW = oracle.newRules(real)

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }

const snapshot = (db, rules) => new Map(oracle.readPrincipals(db).map((p) => [p.key, { raw: p.raw, caps: oracle.capabilities(rules, p.user), user: p.user }]))

function expectEqual(label, a, b, names) {
  const problems = []
  for (const [key, entry] of a) {
    const other = b.get(key)
    if (!other) { problems.push(`${key} vanished`); continue }
    const d = oracle.diff(entry.caps, other.caps)
    if (d.length) problems.push(`${names.get(key) || key}\n    ${d.join('\n    ')}`)
    if (problems.length > 12) break
  }
  assert.deepEqual(problems, [], `${label}\n${problems.join('\n')}`)
  assert.equal(b.size, a.size, 'principal count changed')
}

const migrated = open()
const seeded = oracle.seed(migrated)
const beforeOld = snapshot(migrated, OLD)
const beforeNew = snapshot(migrated, NEW)
migrated.exec(sql)
const afterNew = snapshot(migrated, NEW)
const afterOld = snapshot(migrated, OLD)

check('the fixture is wide: roles, users, admins, dormant grants and junk text are all present', () => {
  assert.ok(beforeOld.size > 3000, `only ${beforeOld.size} principals`)
  const tally = { admin: 0, settingsFull: 0, inventoryOnly: 0, invalid: 0 }
  for (const entry of beforeOld.values()) {
    if (entry.caps['has:all']) tally.admin++
    if (entry.caps['has:settings']) tally.settingsFull++
    if (entry.caps['count:view']) tally.inventoryOnly++
  }
  assert.ok(tally.admin > 100 && tally.settingsFull > 300 && tally.inventoryOnly > 300, JSON.stringify(tally))
})

check('PROOF 1: the new rules on the migrated data grant every principal exactly what the old rules granted before', () => {
  expectEqual('new(after) differs from old(before)', beforeOld, afterNew, seeded.names)
})

check('PROOF 2: the OLD rules on the migrated data still agree, so rolling the Worker back keeps every principal as it was', () => {
  expectEqual('old(after) differs from old(before)', beforeOld, afterOld, seeded.names)
})

check('control: the new rules on the UNMIGRATED data lose access (the oracle can fail)', () => {
  const lost = [...beforeOld].filter(([key, entry]) => oracle.diff(entry.caps, beforeNew.get(key).caps).length)
  assert.ok(lost.length > 500, `only ${lost.length} principals differ, so the oracle would not notice a missing migration`)
  const settingsFull = [...beforeOld].find(([key]) => seeded.names.get(key) === 'role settings_full')
  const d = oracle.diff(settingsFull[1].caps, beforeNew.get(settingsFull[0]).caps)
  for (const capability of ['drive_control', 'ai_providers', 'library_manage', 'bucket:receipt_settings', 'bucket:business_identity', 'bucket:sales_policy',
    'bucket:portal_posts', 'bucket:portal_faq', 'bucket:portal_about', 'bucket:customer_portal', 'portal_moderation', 'announcement_strip_write', 'payment_method_write']) {
    assert.ok(d.some((line) => line.startsWith(`${capability}:`)), `${capability} should be lost without the migration: ${d.join(' | ')}`)
  }
})

check('a Settings Full role now holds each extra explicitly; Settings View holds none', () => {
  const role = (name) => JSON.parse(migrated.prepare('SELECT permissions FROM roles WHERE id = ?').get(seeded.roleIds[name]).permissions)
  const full = role('settings_full')
  for (const key of ['business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'library', 'drive_credentials', 'ai_providers']) {
    assert.equal(full[key], true, key)
  }
  assert.equal(full.settings, true)
  assert.deepEqual(role('settings_view'), { settings: 'view' })
  assert.deepEqual(role('settings_numeric'), { settings: 1 }, 'settings:1 is not true, so nothing was implied')
})

check('an explicit false on an implied key never won under the old rules, so it is overwritten with true (effective access kept)', () => {
  const role = JSON.parse(migrated.prepare('SELECT permissions FROM roles WHERE id = ?').get(seeded.roleIds.settings_explicit_off).permissions)
  assert.equal(role.drive_credentials, true)
  assert.equal(role.library, true)
})

check('count sessions: Inventory Full and Review are written out; inventory_checks:false stays false; inventory:view false is kept as no access', () => {
  const role = (name) => JSON.parse(migrated.prepare('SELECT permissions FROM roles WHERE id = ?').get(seeded.roleIds[name]).permissions)
  const full = role('inventory_full')
  assert.equal(full.inventory_checks, true)
  assert.equal(full.inventory_check_show_price, true)
  assert.equal(full.inventory_check_show_cost, true)
  const review = role('inventory_review')
  assert.equal(review.inventory_checks, true, 'Review counted, so the grant is written')
  assert.equal(Object.hasOwn(review, 'inventory_check_show_price'), false, 'Review never showed fields by default')
  assert.equal(role('inventory_checks_false').inventory_checks, false)
  assert.equal(Object.hasOwn(role('inventory_no_view'), 'inventory_checks'), false, 'inventory:view false meant no counting, and absent is none now')
  assert.equal(role('inventory_no_check')['inventory_checks:check'], false)
  assert.equal(role('inventory_fields').inventory_check_show_price, false, 'an explicit false field is kept')
  assert.equal(role('inventory_fields').inventory_check_show_stock, true, 'a junk field value is replaced by what Inventory Full implied')
})

check('no administrator row was written, and every unfixed row is byte-identical', () => {
  const touched = new Set(migrated.prepare('SELECT principal || \':\' || id AS k FROM permission_extras_0270_fix').all().map((r) => r.k))
  let admins = 0
  for (const [key, entry] of beforeOld) {
    const after = afterOld.get(key)
    if (entry.caps['has:all']) { admins++; assert.ok(!touched.has(key), `${key} is an administrator and was written`); assert.equal(after.raw, entry.raw) }
    else if (!touched.has(key)) assert.equal(after.raw, entry.raw, `${key} changed without a fix row`)
  }
  assert.ok(admins > 100)
})

check('dormant grants (drive_credentials without Settings Full, any ai_providers key) are neutralised, recorded, and change no access', () => {
  const dormant = migrated.prepare("SELECT principal, id, raw FROM permission_extras_0270_state WHERE phase = 'before' AND dormant = 1 AND admin = 0").all()
  assert.ok(dormant.length > 20, `${dormant.length} dormant rows`)
  const after = (p) => migrated.prepare("SELECT raw FROM permission_extras_0270_state WHERE phase = 'after' AND principal = ? AND id = ?").get(p.principal, p.id).raw
  for (const row of dormant.slice(0, 200)) {
    const key = `${row.principal}:${row.id}`
    assert.deepEqual(oracle.diff(beforeOld.get(key).caps, afterNew.get(key).caps), [], key)
    assert.notEqual(after(row), undefined)
  }
  const dd = JSON.parse(migrated.prepare('SELECT permissions FROM roles WHERE id = ?').get(seeded.roleIds.dormant_drive).permissions)
  assert.equal(dd.drive_credentials, false)
  const dai = JSON.parse(migrated.prepare('SELECT permissions FROM roles WHERE id = ?').get(seeded.roleIds.dormant_ai).permissions)
  assert.equal(dai.ai_providers, false)
})

check('ledgers: one before and one after row per principal, the three-phase state is internally consistent', () => {
  const count = (phase) => migrated.prepare('SELECT COUNT(*) AS n FROM permission_extras_0270_state WHERE phase = ?').get(phase).n
  const principals = migrated.prepare('SELECT (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM users) AS n').get().n
  assert.equal(count('before'), principals)
  assert.equal(count('after'), principals)
  assert.equal(count('mid'), migrated.prepare('SELECT COUNT(*) AS n FROM users').get().n)
  assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'permission_extras_0270_principal'").get().n, 0, 'the working view is dropped')
})

check('control: dropping the user step makes the file abort on its own POST check', () => {
  const begin = sql.indexOf('-- user fixes: begin')
  const end = sql.indexOf('-- user fixes: end')
  assert.ok(begin > 0 && end > begin, 'the user fix block is no longer marked')
  const withoutUserStep = sql.slice(0, begin) + sql.slice(end)
  assert.notEqual(withoutUserStep, sql)
  const db = open()
  oracle.seed(db, { fuzz: false })
  assert.throws(() => db.exec(withoutUserStep), /perm_extras_0270_post_matrix|JSON path/i)
})

check('control: a second application, a backslash, and a duplicate member each abort before any write', () => {
  const again = open()
  oracle.seed(again, { fuzz: false })
  again.exec(sql)
  assert.throws(() => again.exec(sql), /already exists/i)

  const slash = open()
  slash.prepare("INSERT INTO roles(name, code, permissions) VALUES('s', 'x', ?)").run('{"a\\"b":true}')
  assert.throws(() => slash.exec(sql), /perm_extras_0270_pre_backslash|JSON path/i)
  assert.equal(slash.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'permission_extras_0270%'").get().n, 0, 'nothing was created')

  const dup = open()
  dup.prepare("INSERT INTO roles(name, code, permissions) VALUES('d', 'x', ?)").run('{"settings":true,"settings":false}')
  assert.throws(() => dup.exec(sql), /perm_extras_0270_pre_duplicate_keys|JSON path/i)
})

check('an empty database (a new client) migrates to empty ledgers and nothing else', () => {
  const db = open()
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM permission_extras_0270_fix').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM permission_extras_0270_state').get().n, db.prepare('SELECT COUNT(*) AS n FROM roles').get().n * 2 + db.prepare('SELECT COUNT(*) AS n FROM users').get().n * 3)
})

check('the file is LF only, holds no literal row, id or client name, and every CASE inside an expression is parenthesised', () => {
  assert.equal(sql.includes('\r'), false)
  assert.doesNotMatch(sql, /INSERT INTO \w+[^;]*\bVALUES\b/i, 'no literal rows')
  assert.doesNotMatch(sql, /\b(?:leang|cosmetics)\b/i)
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  const opens = [...code.matchAll(/(^|\s)CASE\b/g)].length
  const closes = [...code.matchAll(/\bEND(?=[\s;])/g)].length
  assert.equal(opens, closes, 'whitespace+CASE opens a compound in the splitter and END+space/; closes it: the counts must match')
})

console.log(`\n${passed} checks passed; ${beforeOld.size} principals proven`)
const fixed = migrated.prepare('SELECT name, COUNT(*) AS n FROM permission_extras_0270_fix GROUP BY name ORDER BY n DESC').all()
console.log('fix rows by key:', fixed.map((r) => `${r.name}=${r.n}`).join(' '))
