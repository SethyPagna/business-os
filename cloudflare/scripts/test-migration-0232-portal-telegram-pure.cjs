// Migration 0232 (G38 Telegram): portal_login_identities + portal_telegram_challenges.
//
// Runs the file's own header against the real chain (node:sqlite, every
// migration through 0231, then 0232):
//   - LF only; PURPOSE / PRE-ASSERTIONS / POST-ASSERTIONS / IDEMPOTENCE / RECOVERY present;
//   - every PRE-ASSERTION query returns the value the header promises, before;
//   - every POST-ASSERTION query returns the value the header promises, after;
//   - re-running the file changes nothing and raises nothing;
//   - the constraints the Worker relies on hold (one member per Telegram
//     account, one Telegram account per member, an attach names its account,
//     only 64-hex hashes fit, provider and status are closed sets);
//   - no LIKE/GLOB pattern over 50 bytes (native D1's limit) and no statement
//     with more than 100 bound parameters (D1's limit; the file binds none);
//   - the documented RECOVERY statements drop exactly what 0232 created.
// Mutant control: the same file without the partial UNIQUE index lets a
// member hold two Telegram accounts, and the constraint check catches it.
// The Worker flows on these tables are test-portal-telegram-signin-pure.cjs
// (node SQLite, 19 scenarios with mutants) and test-portal-telegram-native.cjs
// (workerd D1).
//
// Run (from cloudflare/): node scripts/test-migration-0232-portal-telegram-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const dir = path.join(__dirname, '..', 'migrations')
const NAME = '0232_portal_telegram_identities.sql'
const SQL = fs.readFileSync(path.join(dir, NAME), 'utf8')
const TABLES = ['portal_login_identities', 'portal_telegram_challenges']
const INDEXES = ['idx_portal_login_identities_account', 'idx_portal_login_identities_one_telegram',
  'idx_portal_telegram_challenges_user', 'idx_portal_telegram_challenges_expires']

let passed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

const before0232 = () => openDb(loadAll({ through: 231 }))
const scalar = (db, sql) => Object.values(db.prepare(sql).get({}))[0]

// "-- <query>;  -- <expected>" lines of one header section, joined across
// continuation lines (a query may span two comment lines).
function headerAssertions(section) {
  const start = SQL.indexOf(`-- ${section}`)
  assert.ok(start >= 0, `header lacks ${section}`)
  const lines = []
  for (const line of SQL.slice(start).split('\n').slice(1)) {
    if (!line.startsWith('--   ')) break
    lines.push(line.slice(5))
  }
  const out = []
  let buffer = ''
  for (const line of lines) {
    buffer = buffer ? `${buffer} ${line.trim()}` : line.trim()
    const match = /^(.*;)\s*--\s*(\d+)\b/.exec(buffer)
    if (match) { out.push({ sql: match[1], expected: Number(match[2]) }); buffer = '' }
  }
  assert.ok(out.length >= 3, `${section}: found ${out.length} assertions`)
  return out
}

check('LF only, numbered once, with purpose, assertions, idempotence and recovery', () => {
  assert.equal(Buffer.from(SQL, 'utf8').includes(0x0d), false, 'a CR byte')
  for (const section of ['PURPOSE', 'PRE-ASSERTIONS', 'POST-ASSERTIONS', 'IDEMPOTENCE', 'RECOVERY']) assert.ok(SQL.includes(section), section)
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('0232')), [NAME])
})

check('the header PRE-ASSERTIONS hold on the chain through 0231', () => {
  const db = before0232()
  for (const { sql, expected } of headerAssertions('PRE-ASSERTIONS')) assert.equal(Number(scalar(db, sql)), expected, sql)
})

check('apply: both tables and all four indexes; the header POST-ASSERTIONS hold; no row written', () => {
  const db = before0232()
  db.exec(SQL)
  for (const { sql, expected } of headerAssertions('POST-ASSERTIONS')) assert.equal(Number(scalar(db, sql)), expected, sql)
  const names = db.prepare("SELECT name FROM sqlite_master WHERE tbl_name IN ('portal_login_identities', 'portal_telegram_challenges') AND name NOT LIKE 'sqlite_%' ORDER BY name").all({}).map((r) => r.name)
  assert.deepEqual(names, [...INDEXES, ...TABLES].sort())
})

check('idempotent: a second run changes nothing and raises nothing', () => {
  const db = before0232()
  db.exec(SQL)
  const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all({})
  const once = schema()
  db.exec(SQL)
  assert.deepEqual(schema(), once)
})

function constraintsHold(db) {
  const identity = (account, provider, subject) => db.prepare('INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at) VALUES (@a, @p, @s, CURRENT_TIMESTAMP)').run({ a: account, p: provider, s: subject })
  identity(1, 'telegram', '111')
  assert.throws(() => identity(2, 'telegram', '111'), /UNIQUE/, 'one member per Telegram account')
  assert.throws(() => identity(1, 'telegram', '222'), /UNIQUE/, 'one Telegram account per member')
  identity(1, 'email', 'k1') // the provider CHECK already admits later methods
  assert.throws(() => identity(3, 'sms', 'x'), /CHECK/, 'provider is a closed set')
  assert.throws(() => identity(3, 'telegram', ''), /CHECK/, 'an empty subject')
  const challenge = (fields) => db.prepare(`INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, account_id, status, expires_at)
    VALUES (@n, @b, @purpose, @account, @status, '2999-01-01 00:00:00.000')`).run({ n: 'a'.repeat(64), b: 'b'.repeat(64), purpose: 'signin', account: null, status: 'pending', ...fields })
  assert.throws(() => challenge({ purpose: 'attach' }), /CHECK/, 'an attach names its account')
  assert.throws(() => challenge({ account: 5 }), /CHECK/, 'a sign-in names no account')
  assert.throws(() => challenge({ n: 'the-raw-nonce' }), /CHECK/, 'only a 64-hex hash fits')
  assert.throws(() => challenge({ status: 'done' }), /CHECK/, 'status is a closed set')
  challenge({})
  assert.throws(() => challenge({}), /UNIQUE/, 'a nonce hash is used once')
}

check('constraints: one Telegram per member and per account, closed sets, hash-only challenges', () => {
  const db = before0232()
  db.exec(SQL)
  constraintsHold(db)
})

check('mutant control: without the partial UNIQUE index a member could hold two Telegram accounts', () => {
  const mutant = SQL.replace(/CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_login_identities_one_telegram[\s\S]*?;\n/, '')
  assert.notEqual(mutant, SQL, 'the mutant edit applied')
  const db = before0232()
  db.exec(mutant)
  assert.throws(() => constraintsHold(db), /one Telegram account per member/)
})

check('native D1 limits: no LIKE/GLOB pattern over 50 bytes, no bound parameter at all', () => {
  const db = before0232()
  db.exec(SQL)
  for (const row of db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name IN ('portal_login_identities', 'portal_telegram_challenges') AND sql IS NOT NULL").all({})) {
    for (const match of row.sql.matchAll(/\b(?:LIKE|GLOB)\s+'([^']*)'/gi)) assert.ok(Buffer.byteLength(match[1]) <= 50, `${row.name}: ${match[1]}`)
  }
  const statements = SQL.split('\n').filter((line) => !line.startsWith('--')).join('\n')
  assert.equal(/[?]|@\w|:\w+\b(?!\))|\$\w/.test(statements.replace(/'[^']*'/g, "''")), false, 'the migration binds no parameter')
})

check('RECOVERY: the documented drops remove exactly what 0232 created', () => {
  const db = before0232()
  const objects = () => db.prepare("SELECT name FROM sqlite_master ORDER BY name").all({}).map((r) => r.name)
  const pre = objects()
  db.exec(SQL)
  const drops = [...SQL.matchAll(/^--\s+(DROP TABLE IF EXISTS \w+;)/gm)].map((m) => m[1])
  assert.equal(drops.length, 2)
  for (const drop of drops) db.exec(drop)
  assert.deepEqual(objects(), pre)
})

console.log(`\n${passed} checks passed${process.exitCode ? ', FAILURES above' : ''}`)
