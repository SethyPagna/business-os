// Explicit anonymous-customer identity and Contacts boundary regression.
// Run from cloudflare/: node scripts/test-anonymous-customer-guard-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function loadHelper() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'anonymousCustomer.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
  return mod.exports
}

const helper = loadHelper()
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0141_customers_anonymous_marker.sql'), 'utf8')
const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
let passed = 0

async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function ordered(segment, ...patterns) {
  let cursor = -1
  for (const pattern of patterns) {
    const next = segment.indexOf(pattern, cursor + 1)
    assert.notEqual(next, -1, `missing ordered source marker: ${pattern}`)
    assert.ok(next > cursor, `out-of-order source marker: ${pattern}`)
    cursor = next
  }
}

async function main() {
  await check('migration adds a constrained zero-default marker and performs no identity inference or backfill', () => {
    const sqlOnly = migration.replace(/^--.*$/gm, '')
    assert.match(migration, /ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0/)
    assert.match(migration, /CHECK \(is_anonymous IN \(0, 1\)\)/)
    assert.doesNotMatch(sqlOnly, /\b(?:UPDATE|INSERT|DELETE)\b/i)
    assert.doesNotMatch(sqlOnly, /\bGeneral\b|24969|22305/i)
  })

  await check('real SQLite preserves named General profiles and filters only explicitly marked identities', () => {
    const db = openDb(loadAll())
    db.prepare("INSERT INTO customers(id,name,phone,membership_number) VALUES(1,'General','086 897 171','LC-00001')").run()
    db.prepare("INSERT INTO customers(id,name,phone,membership_number,is_anonymous) VALUES(2,'general','', 'LC-04971',1)").run()
    assert.equal(db.prepare('SELECT is_anonymous FROM customers WHERE id=1').get().is_anonymous, 0)
    assert.deepEqual(
      db.prepare(`SELECT id FROM customers WHERE ${helper.customerIsProfileSql()} ORDER BY id`).all().map((row) => Number(row.id)),
      [1],
    )
    assert.deepEqual(
      db.prepare(`SELECT id FROM customers WHERE ${helper.customerIsAnonymousSql()} ORDER BY id`).all().map((row) => Number(row.id)),
      [2],
    )
    assert.throws(() => db.prepare("INSERT INTO customers(id,name,is_anonymous) VALUES(3,'Bad',2)").run(), /CHECK constraint failed/)
  })

  await check('runtime helper trusts only the stored marker, never name phone membership or id', () => {
    assert.equal(helper.isAnonymousCustomer({ id: 24969, name: 'general', phone: '', membership_number: 'LC-04971' }), false)
    assert.equal(helper.isAnonymousCustomer({ id: 22305, name: 'General', phone: '086897171', is_anonymous: 0 }), false)
    assert.equal(helper.isAnonymousCustomer({ id: 7, name: 'A real person', phone: '012345678', is_anonymous: 1 }), true)
    assert.throws(() => helper.customerIsAnonymousSql('c;DELETE'), /Invalid SQL alias/)
  })

  await check('generic customer writes cannot set the authority marker and marked profiles are refused before mutation', () => {
    const customerColumns = route.match(/const CUSTOMERS:[\s\S]*?columns: \[([^\]]+)\]/)?.[1] || ''
    assert.doesNotMatch(customerColumns, /is_anonymous/)
    const put = route.slice(route.indexOf('app.put(`${config.path}/:id`'), route.indexOf('app.delete(`${config.path}/:id`'))
    ordered(put, 'SELECT * FROM ${config.table} WHERE id = @id', 'isAnonymousCustomer(current)', 'const payload = pickColumns', 'UPDATE ${config.table}')
    const del = route.slice(route.indexOf('app.delete(`${config.path}/:id`'), route.indexOf('app.post(`${config.path}/bulk-delete-jobs`'))
    ordered(del, 'SELECT * FROM ${config.table} WHERE id = @id', 'isAnonymousCustomer(current)', 'DELETE FROM ${config.table}')
    const bulk = route.slice(route.indexOf('app.post(`${config.path}/bulk-delete-jobs`'), route.indexOf('app.get(`${config.path}/bulk-delete-jobs/:id`'))
    ordered(bulk, 'anonymousCustomerIds(getDb(c.env), rawIds', 'createBulkDeleteJob(')
  })

  await check('merge, portal reset, and points refuse a marked profile before any write', () => {
    const merge = route.slice(route.indexOf('app.post(`${config.path}/merge`'), route.indexOf('app.post(config.path'))
    ordered(merge, 'isAnonymousCustomer(keeper)', 'buildContactMergePlan(', 'await db.batch(plan.statements)')
    const reset = route.slice(route.indexOf('app.post(`${config.path}/:id/portal-reset`'), route.indexOf('app.put(`${config.path}/:id`'))
    ordered(reset, 'isAnonymousCustomer(customer)', 'UPDATE portal_accounts SET password_hash')
    const points = route.slice(route.indexOf("app.post('/customers/:id/points'"), route.indexOf("app.get('/customers/points-summary'"))
    ordered(points, 'isAnonymousCustomer(customer)', 'INSERT INTO loyalty_point_adjustments')
  })

  await check('customer pickers, membership, duplicate review, and points views exclude only marked profiles', () => {
    assert.match(route, /fields \|\| ''\) === 'names'[\s\S]{0,500}customerIsProfileSql\(\)/)
    assert.match(route, /fields \|\| ''\) === 'picker'[\s\S]{0,1100}customerIsAnonymousSql\(\)[\s\S]{0,600}filter\(\(row\) => !excluded\.has/)
    assert.match(route, /const baseWhere: string\[\] = \[\][\s\S]{0,180}customerIsProfileSql\(\)/)
    assert.match(route, /customers\/membership\/:membershipNumber[\s\S]{0,500}customerIsProfileSql\(\)/)
    assert.match(route, /excludeAnonymousCustomerDuplicateState\(/)
    assert.match(route, /customers\/points-summary[\s\S]{0,500}where\.push\(customerIsProfileSql\(\)\)/)
  })

  await check('conflict relinking can move away from a marker but cannot target one', () => {
    const relink = route.slice(route.indexOf("app.post('/customers/link-conflicts/relink'"), route.indexOf("app.post('/customers/link-conflicts/resolve-missing'"))
    assert.doesNotMatch(relink, /isAnonymousCustomer\([^)]*current/)
    ordered(relink, 'isAnonymousCustomer(target)', 'UPDATE sales SET customer_id = @targetId')
    const resolve = route.slice(route.indexOf("app.post('/customers/link-conflicts/resolve-missing'"), route.indexOf("app.post('/customers/link-conflicts/dismiss'"))
    ordered(resolve, 'isAnonymousCustomer(target)', 'UPDATE sales SET customer_id = @targetId')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
