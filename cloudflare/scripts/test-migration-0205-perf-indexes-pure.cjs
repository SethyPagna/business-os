// Pins migration 0205 (read-path indexes) on the real migration chain in
// node:sqlite, without ANALYZE: production has no sqlite_stat1, so every plan
// must win on the schema alone.
//
// Every reader's SQL is quoted live from its source file
// (harness/perf_index_readers_0205.cjs), so a reader that changes shape or
// moves re-proves itself here.
//
// Run: node scripts/test-migration-0205-perf-indexes-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { CONTROLS, MIGRATION_FILE, NEW_INDEXES, READERS, normalizeSql, renderReader } = require('./harness/perf_index_readers_0205.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const MIGRATION_NUMBER = Number(MIGRATION_FILE.slice(0, 4))
const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort()
const migrationPath = path.join(MIGRATIONS_DIR, MIGRATION_FILE)
const INDEXED_TABLES = [...new Set(NEW_INDEXES.map((index) => index.table))]

let passed = 0
const failures = []
function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ok  ${label}`)
    return
  }
  failures.push(label)
  console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`)
}

function applyMigrations(db, keep) {
  for (const file of migrationFiles.filter((name) => keep(Number(name.slice(0, 4))))) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
  }
}

const DAY_MS = 86400000
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)

function seed(db) {
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  db.exec('BEGIN')
  run("INSERT INTO customers (id, name) VALUES (1, 'Dara'), (2, 'Sokha')")
  run("INSERT INTO delivery_contacts (id, name) VALUES (7, 'Courier A'), (8, 'Courier B')")
  run("INSERT INTO suppliers (id, name) VALUES (5, 'Supplier Five'), (6, 'Supplier Six')")
  const sale = db.prepare(`INSERT INTO sales (id, receipt_number, customer_id, sale_status, total_usd, is_delivery, delivery_contact_id, delivery_contact_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  sale.run(1, 'R1', 1, 'awaiting_payment', 12, 0, null, null, '2026-09-20T03:00:00.000Z')
  sale.run(2, 'R2', 1, 'awaiting_payment', 8, 0, null, null, '2026-09-20T04:00:00.000Z')
  sale.run(3, 'R3', 2, 'completed', 5, 1, 7, 'Courier A', '2026-09-12T05:00:00.000Z')
  sale.run(4, 'R4', 2, 'completed', 6, 1, 7, 'Courier A', '2026-08-02T05:00:00.000Z')
  sale.run(5, 'R5', null, 'completed', 7, 1, 8, 'Courier B', '2026-09-12T06:00:00.000Z')
  for (let id = 6; id <= 60; id++) sale.run(id, `R${id}`, id % 3 === 0 ? 1 : null, 'completed', 1, 0, null, null, '2026-09-15T01:00:00.000Z')
  sale.run(61, 'R61', 2, 'awaiting_payment', 9, 0, null, null, '2026-09-20T05:00:00.000Z')

  const audit = db.prepare('INSERT INTO audit_logs (action, entity, entity_id, table_name, record_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const reopen = JSON.stringify({ oldStatus: 'completed', newStatus: 'awaiting_payment' })
  audit.run('sale_settlement', 'sale', '1', null, null, '{}', '2026-09-20 03:10:00')
  audit.run('update', 'sale', '1', null, null, reopen, '2026-09-20 03:20:00')
  audit.run('sale_settlement', null, null, 'sale', '2', '{}', '2026-09-20 04:10:00')
  audit.run('update', null, null, 'sale', '2', reopen, '2026-09-20 04:20:00')
  audit.run('update', 'sale', '61', null, null, reopen, '2026-09-20 05:10:00')
  audit.run('sale_settlement', 'sale', '61', null, null, '{}', '2026-09-20 05:20:00')
  audit.run('update', 'product', '42', 'products', null, '{}', '2026-09-21 01:00:00')
  audit.run('merge', 'product', 'RC-9', 'products', '42', '{}', '2026-09-21 02:00:00')
  audit.run('create', 'return', '7', null, null, '{}', '2026-09-22 01:00:00')
  audit.run('create', 'return_create', 'RC-7', null, '7', '{}', '2026-09-22 01:00:01')
  for (let i = 0; i < 400; i++) {
    audit.run(['update', 'sale_settlement', 'login'][i % 3], ['sale', 'product', 'user'][i % 3], String(1000 + (i % 40)), null, null, '{}', '2026-09-01 00:00:00')
  }

  const product = db.prepare('INSERT INTO products (id, name, is_active, expiry_date) VALUES (?, ?, ?, ?)')
  const expiries = [[-3, 1], [5, 1], [20, 1], [90, 1], [10, 0], [null, 1], ['', 1], [25, 1]]
  expiries.forEach(([offset, active], index) => product.run(100 + index, `P${index}`, active, offset === null ? null : offset === '' ? '' : isoDay(offset)))
  for (let id = 200; id < 260; id++) product.run(id, `Filler ${id}`, 1, null)

  const lot = db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, supplier_id, supplier_name, payment_status, credit_due_date, received_quantity, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
  lot.run(1, 100, 'k1', 5, 'Supplier Five', 'credit', isoDay(-2), 3)
  lot.run(2, 101, 'k2', 5, 'Supplier Five', 'credit', isoDay(12), 4)
  lot.run(3, 102, 'k3', 6, 'Supplier Six', 'paid', isoDay(1), 5)
  lot.run(4, 103, 'k4', null, 'Supplier Five', 'credit', isoDay(3), 2)
  lot.run(5, 104, 'k5', null, 'supplier five', null, null, 1)
  for (let id = 6; id < 80; id++) lot.run(id, 200 + (id % 60), `f${id}`, null, null, null, null, 1)

  const ret = db.prepare(`INSERT INTO returns (id, return_number, sale_id, customer_id, supplier_id, status, return_scope, total_refund_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  ret.run(7, 'RET-20260922-080000', 3, 1, null, 'completed', 'customer', 2)
  ret.run(8, 'RET-20260922-090000', 1, 1, null, 'cancelled', 'customer', 3)
  ret.run(9, 'SRET-20260923-100000', null, null, 5, 'completed', 'supplier', 4)
  ret.run(10, 'RET-20260924-100000', 6, 2, null, 'completed', 'customer', 1)

  const submission = db.prepare('INSERT INTO customer_share_submissions (id, customer_id, status, reward_points, created_at) VALUES (?, ?, ?, ?, ?)')
  submission.run(1, 1, 'approved', 10, '2026-09-20 00:00:00')
  submission.run(2, 1, 'pending', 0, '2026-09-29 00:00:00')
  submission.run(3, 2, 'approved', 4, '2026-09-21 00:00:00')
  db.exec('COMMIT')
}

const PARAMS = {
  saleId: '1', status: 'awaiting_payment', entity0: 'product', entityId: '42', idText: '7', days: 30,
  customer: 1, basis: 'usd', usd: 1, khr: 0, settings: '[["exchange_rate",null]]', points: 0, enabled: 1,
  accounts: '[1,2]', id: 1, cid: 1, cutoff: '2026-09-01 00:00:00', contactId: 7,
  startDate: '2026-09-01', endDate: '2026-09-30', pageSize: 50, limit: 50, offset: 0,
}
const POSITIONAL = { '?': [1, 2, 7] }

function bindFor(sql) {
  const names = [...new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))]
  const named = Object.fromEntries(names.map((name) => [name, name in PARAMS ? PARAMS[name] : null]))
  const positional = (sql.match(/\?(?!\d)/g) || []).length
  if (positional && names.length) throw new Error('reader mixes ? and @name parameters')
  return positional ? POSITIONAL['?'].slice(0, positional).concat(Array(Math.max(0, positional - 3)).fill(null)) : [named]
}

const planOf = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(' | ')
const isRead = (sql) => /^\s*(SELECT|WITH)\b/i.test(sql)
const rowsOf = (db, sql) => db.prepare(sql).all(...bindFor(sql)).map((row) => JSON.stringify(row)).sort()
function tableDigest(db, table) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  return `${rows.length}:${crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`
}

function expectedIndexSql(index) {
  return normalizeSql(`CREATE INDEX ${index.name} ON ${index.table}(${index.keys.join(', ')})${index.where ? ` WHERE ${index.where}` : ''}`)
}

function compactSql(sql) {
  return normalizeSql(sql).toLowerCase()
    .replace(/\b[a-z_][a-z0-9_]*\.(?=[a-z_])/g, '')
    .replace(/\s*([=(),<>!])\s*/g, '$1')
}

function impliedTerm(reader, term) {
  const compactTerm = compactSql(term)
  if (reader.includes(compactTerm)) return true
  const notNull = /^(.+) is not null$/.exec(compactTerm)
  return !!notNull && new RegExp(`(^|[^a-z0-9_])${notNull[1].replace(/[()]/g, '\\$&')}(=|>|<| in\\(|in\\()`).test(reader)
}

function keyIsPredicate(reader, key) {
  const compactKey = compactSql(key).replace(/[()]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9_])${compactKey}(=|>|<| in\\(|in\\(| is )`).test(reader)
}

function orderedByIndexKey(reader, index) {
  const orderBy = / order by ([a-z_]+)/.exec(reader)
  return !!orderBy && index.keys.map((key) => compactSql(key)).includes(orderBy[1])
}

console.log('0205 read-path indexes: node:sqlite, migration chain to HEAD, no ANALYZE')

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = OFF')
applyMigrations(db, (number) => number < MIGRATION_NUMBER)
seed(db)

const readers = READERS.map((reader) => ({ reader, ...renderReader(reader) }))
const controls = CONTROLS.map((reader) => ({ reader, ...renderReader(reader) }))
for (const { reader, line } of [...readers, ...controls]) console.log(`  quote ${reader.file}:${line}  ${reader.id}`)

const indexNames = new Set(NEW_INDEXES.map((index) => index.name))
const indexCount = () => db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (${[...indexNames].map(() => '?').join(', ')})`).get(...indexNames).n
check(`none of the ${indexNames.size} indexes exists before ${MIGRATION_FILE}`, indexCount() === 0)

const before = new Map()
for (const entry of [...readers, ...controls]) {
  before.set(entry, { plan: planOf(db, entry.sql), rows: isRead(entry.sql) ? rowsOf(db, entry.sql) : null })
}
const digestsBefore = INDEXED_TABLES.map((table) => tableDigest(db, table))

for (const { reader } of readers) {
  const plan = before.get(readers.find((entry) => entry.reader === reader)).plan
  const wanted = [].concat(reader.index)
  check(`POSITIVE CONTROL ${reader.id}: without ${MIGRATION_FILE} the plan uses none of ${wanted.join(', ')}`, wanted.every((name) => !plan.includes(name)), plan)
}

const migrationExists = fs.existsSync(migrationPath)
check(`${MIGRATION_FILE} exists`, migrationExists)
const migration = migrationExists ? fs.readFileSync(migrationPath, 'utf8') : ''
db.exec(migration)
applyMigrations(db, (number) => number > MIGRATION_NUMBER)

check(`all ${indexNames.size} indexes exist at HEAD`, indexCount() === indexNames.size, `found ${indexCount()}`)
for (const index of NEW_INDEXES) {
  const row = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name)
  check(`${index.name} is exactly ${expectedIndexSql(index)}`, !!row && normalizeSql(row.sql) === expectedIndexSql(index), row ? normalizeSql(row.sql) : 'missing')
}

const statements = migration.replace(/^\s*--.*$/gm, '').split(';').map((statement) => statement.trim()).filter(Boolean)
check(`${MIGRATION_FILE} holds only CREATE INDEX IF NOT EXISTS statements, one per index`,
  statements.length === NEW_INDEXES.length && statements.every((statement) => /^CREATE INDEX IF NOT EXISTS \w+ ON \w+\(/i.test(normalizeSql(statement))),
  statements.map((statement) => statement.slice(0, 60)).join(' / '))
check(`${MIGRATION_FILE} is LF-only`, !migration.includes('\r'))

for (const entry of readers) {
  const { reader, sql } = entry
  const plan = planOf(db, sql)
  check(`${reader.id} uses ${[].concat(reader.index).join(' + ')}`, reader.plan.test(plan), plan)
  if (reader.noTempSort) check(`${reader.id} needs no temp sort`, !/TEMP B-TREE/.test(plan), plan)
  const compact = compactSql(sql)
  for (const name of [].concat(reader.index)) {
    const index = NEW_INDEXES.find((candidate) => candidate.name === name)
    check(`${reader.id}: ${name}'s leading key ${index.keys[0]} is a predicate of the reader`, keyIsPredicate(compact, index.keys[0]))
    if (index.where) {
      const terms = index.where.split(/ AND /i)
      check(`${reader.id}: the reader's WHERE implies ${name}'s WHERE ${index.where}`, terms.every((term) => impliedTerm(compact, term)))
    }
    if (reader.orderBy) check(`${reader.id}: its ORDER BY column is a key of ${name}`, orderedByIndexKey(compact, index))
  }
}

for (const entry of controls) {
  const { reader, sql } = entry
  const plan = planOf(db, sql)
  const was = before.get(entry).plan
  const allowed = plan === was || (reader.accept && reader.accept.plan.test(plan))
  check(`control ${reader.id}: plan unchanged${reader.accept ? ` or ${reader.accept.why}` : ''}`, allowed, `before: ${was}\n         after:  ${plan}`)
}

for (const entry of [...readers, ...controls].filter((candidate) => isRead(candidate.sql))) {
  const rows = rowsOf(db, entry.sql)
  check(`${entry.reader.id}: same rows with the indexes`, JSON.stringify(rows) === JSON.stringify(before.get(entry).rows))
}
const read = (id) => before.get(readers.find((entry) => entry.reader.id === id)).rows.map((row) => JSON.parse(row))
function fixture(label, actual, expected) {
  check(`fixture discriminates ${label}`, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
fixture('the settle reader: sale 1 was reopened after its settlement', read('settle: saleAllowsPaymentCorrection').map((row) => row.action), ['update'])
fixture('the Not-paid page: reopened sales 1 (entity_id rows) and 2 (legacy record_id rows) allow a correction, sale 61 (settled last) does not',
  read('sales list: payment_correction_allowed (Not-paid page)').map((row) => [row.id, row.payment_correction_allowed]).sort((a, b) => a[0] - b[0]), [[1, 1], [2, 1], [61, 0]])
fixture('the record trail: product 42 by entity_id and by record_id', read('audit float: COUNT for one record (entity + entityId)').map((row) => row.count), [2])
fixture('the return detail: return 7 by entity_id and its create row by record_id', read('return detail: audit rows (return + return_create)').length, 2)
fixture('the bell expiry list: expired, 5, 20 and 25 days out; not inactive, far, empty or NULL',
  read('bell: expiry section').map((row) => row.id).sort(), [100, 101, 102, 107])
fixture('the credit list: unpaid credit lots only', read('bell: supplier credit section').map((row) => row.id).sort(), [1, 2, 4])
fixture("the one-contact delivery totals: courier 7's September delivery only",
  read('reports: delivery totals for one contact').map((row) => [row.delivery_contact_id, row.deliveries]), [[7, 1]])

const digestsAfter = INDEXED_TABLES.map((table) => tableDigest(db, table))
check(`${MIGRATION_FILE} changed no row of ${INDEXED_TABLES.join(', ')}`, JSON.stringify(digestsAfter) === JSON.stringify(digestsBefore))

db.exec(migration)
check(`re-applying ${MIGRATION_FILE} is idempotent`, indexCount() === indexNames.size)

db.exec(NEW_INDEXES.map((index) => `DROP INDEX IF EXISTS ${index.name};`).join('\n'))
check('recovery (DROP INDEX IF EXISTS each name) removes every index', indexCount() === 0)
for (const entry of [...readers, ...controls]) {
  check(`after recovery ${entry.reader.id} is back on its pre-0205 plan`, planOf(db, entry.sql) === before.get(entry).plan)
}

console.log(`\n${passed} checks passed, ${failures.length} failed`)
assert.deepEqual(failures, [], `${failures.length} check(s) failed`)
