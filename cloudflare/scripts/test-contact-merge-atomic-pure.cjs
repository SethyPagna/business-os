const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const libDir = path.join(__dirname, '..', 'src', 'lib')

function loadTs(file, stubs = {}) {
  const source = fs.readFileSync(path.join(libDir, file), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(
    mod.exports,
    (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request),
    mod,
  )
  return mod.exports
}

const contactOptions = loadTs('contactOptions.ts')
const subject = loadTs('contactMerge.ts', { './contactOptions': contactOptions })

const CONFIG = {
  customers: { entity: 'customer', columns: ['name', 'phone', 'email', 'address', 'notes', 'membership_number', 'gender', 'created_at'] },
  suppliers: { entity: 'supplier', columns: ['name', 'phone', 'email', 'address', 'company', 'contact_person', 'notes', 'gender'] },
  delivery_contacts: { entity: 'delivery_contact', columns: ['name', 'phone', 'area', 'address', 'notes', 'gender'] },
}

function row(db, table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get([id])
}

function plan(db, table, keepId, mergeId, operationId) {
  const keeper = row(db, table, keepId)
  const merged = row(db, table, mergeId)
  assert.ok(keeper, `${table} keeper fixture ${keepId} is missing`)
  assert.ok(merged, `${table} merged fixture ${mergeId} is missing`)
  return subject.buildContactMergePlan({
    table,
    entity: CONFIG[table].entity,
    editableColumns: CONFIG[table].columns,
    keeper,
    merged,
    hasCustomerReceivables: table === 'customers',
    hasSupplierInvoices: table === 'suppliers',
    audit: { operationId, userId: 7, userName: 'operator', deviceName: 'Browser', deviceTz: 'Asia/Phnom_Penh' },
  })
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function successfulMerges() {
  const db = openDb(loadAll())
  const run = (sql, params) => db.prepare(sql).run(params)
  run("INSERT INTO customers(id,name,phone,address,membership_number) VALUES(1,'Same Customer',NULL,'',''),(2,'Same Customer','012 222 222','Loser address','LC-00002')")
  run("INSERT INTO sales(id,customer_id,customer_name) VALUES(1,2,'Same Customer')")
  run("INSERT INTO returns(id,customer_id,customer_name,return_scope) VALUES(1,2,'Same Customer','customer')")
  run("INSERT INTO customer_share_submissions(id,customer_id,customer_name) VALUES(1,2,'Same Customer')")
  run('INSERT INTO loyalty_point_adjustments(id,customer_id,points) VALUES(1,2,5)')
  run("INSERT INTO portal_accounts(id,membership_id,name,phone,password_hash,contact_id) VALUES(1,'PORTAL-2','Same Customer','012222222','hash',2)")
  run("INSERT INTO customer_receivables(id,legacy_id,customer_id,customer_name,invoice_date,status,source_file,source_row) VALUES(1,1,2,'Same Customer','2026-01-01','outstanding','ar.csv',1)")

  run("INSERT INTO suppliers(id,name,phone) VALUES(11,'Same Supplier',NULL),(12,'Same Supplier','012 333 333')")
  run("INSERT INTO returns(id,supplier_id,supplier_name,return_scope) VALUES(2,12,'Same Supplier','supplier')")
  run("INSERT INTO products(id,name,supplier) VALUES(100,'Stock','Same Supplier')")
  run("INSERT INTO product_batches(id,variant_product_id,batch_key,supplier_id,supplier_name) VALUES(100,100,'lot',12,'Same Supplier')")
  run("INSERT INTO supplier_invoices(id,source_branch,legacy_id,supplier_id,supplier_name,invoice_date,status,source_file,source_row) VALUES(1,'Shop',1,12,'Same Supplier','2026-01-01','outstanding','ap.csv',1)")

  run("INSERT INTO delivery_contacts(id,name,phone) VALUES(21,'Same Driver',NULL),(22,'Same Driver','012 444 444')")
  run("INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES(2,22,'Same Driver')")
  run("INSERT INTO fees(id,fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES(9001,'delivery',2,8200,'2026-09-07',22)")

  for (const [table, keepId, mergeId, operationId] of [
    ['customers', 1, 2, 'contact-merge-customer'],
    ['suppliers', 11, 12, 'contact-merge-supplier'],
    ['delivery_contacts', 21, 22, 'contact-merge-delivery'],
  ]) {
    const built = plan(db, table, keepId, mergeId, operationId)
    assert.ok(built.statements.length <= subject.CONTACT_MERGE_MAX_STATEMENTS)
    for (const statement of built.statements) {
      assert.ok(Object.keys(statement.params || {}).length <= subject.CONTACT_MERGE_MAX_BINDS_PER_STATEMENT)
    }
    await db.batch(built.statements)
  }

  assert.equal(row(db, 'customers', 2), undefined)
  assert.equal(row(db, 'customers', 1).membership_number, 'LC-00002')
  assert.equal(row(db, 'customers', 1).phone, '012 222 222')
  assert.equal(db.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id, 1)
  assert.equal(db.prepare('SELECT customer_id FROM loyalty_point_adjustments WHERE id=1').get().customer_id, 1)
  assert.equal(db.prepare('SELECT contact_id FROM portal_accounts WHERE id=1').get().contact_id, 1)
  assert.equal(db.prepare('SELECT customer_id FROM customer_receivables WHERE id=1').get().customer_id, 1)

  assert.equal(row(db, 'suppliers', 12), undefined)
  assert.equal(row(db, 'suppliers', 11).phone, '012 333 333')
  assert.equal(db.prepare('SELECT supplier_id FROM returns WHERE id=2').get().supplier_id, 11)
  assert.equal(db.prepare('SELECT supplier_id FROM product_batches WHERE id=100').get().supplier_id, 11)
  assert.equal(db.prepare('SELECT supplier_id FROM supplier_invoices WHERE id=1').get().supplier_id, 11)

  assert.equal(row(db, 'delivery_contacts', 22), undefined)
  assert.equal(row(db, 'delivery_contacts', 21).phone, '012 444 444')
  assert.equal(db.prepare('SELECT delivery_contact_id FROM sales WHERE id=2').get().delivery_contact_id, 21)
  assert.equal(db.prepare('SELECT delivery_contact_id FROM fees WHERE id=9001').get().delivery_contact_id, 21)

  const audits = db.prepare("SELECT entity,entity_id,details,device_name,device_tz FROM audit_logs WHERE action='merge' ORDER BY id").all()
  assert.equal(audits.length, 3)
  assert.deepEqual(audits.map((audit) => JSON.parse(audit.details).operationId), [
    'contact-merge-customer', 'contact-merge-supplier', 'contact-merge-delivery',
  ])
  assert.ok(audits.every((audit) => audit.device_name === 'Browser' && audit.device_tz === 'Asia/Phnom_Penh'))
}

async function staleSnapshotRollsBack() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO customers(id,name,phone) VALUES(1,'Same',NULL),(2,'Same','012 222 222')").run()
  db.prepare("INSERT INTO sales(id,customer_id,customer_name) VALUES(1,2,'Same')").run()
  const built = plan(db, 'customers', 1, 2, 'stale-contact-merge')
  // Simulates an edit racing after the route's duplicate review read. It need
  // not tick updated_at for the full identity guard to detect the new phone.
  db.prepare("UPDATE customers SET phone='012 999 999' WHERE id=2").run()
  await assert.rejects(db.batch(built.statements), /malformed JSON/)
  assert.equal(row(db, 'customers', 2).phone, '012 999 999')
  assert.equal(row(db, 'customers', 1).phone, null)
  assert.equal(db.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id, 2)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge'").get().n, 0)
}

async function auditFailureRollsBack() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO suppliers(id,name,phone) VALUES(1,'Same Supplier',NULL),(2,'Same Supplier','012 555 555')").run()
  db.prepare("INSERT INTO returns(id,supplier_id,supplier_name,return_scope) VALUES(1,2,'Same Supplier','supplier')").run()
  db.prepare(`CREATE TRIGGER reject_contact_merge_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action='merge' BEGIN SELECT RAISE(ABORT,'audit failure'); END`).run()
  const built = plan(db, 'suppliers', 1, 2, 'audit-failure-contact-merge')
  await assert.rejects(db.batch(built.statements), /audit failure/)
  assert.equal(row(db, 'suppliers', 1).phone, null)
  assert.equal(row(db, 'suppliers', 2).phone, '012 555 555')
  assert.equal(db.prepare('SELECT supplier_id FROM returns WHERE id=1').get().supplier_id, 2)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge'").get().n, 0)
}

async function whitespaceMembershipPreservesLoserIdentity() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO customers(id,name,membership_number) VALUES(1,'Same','   '),(2,'Same','LEGACY-IDENTITY')").run()
  const built = plan(db, 'customers', 1, 2, 'whitespace-membership-contact-merge')
  await db.batch(built.statements)
  assert.equal(row(db, 'customers', 2), undefined)
  assert.equal(row(db, 'customers', 1).membership_number, 'LEGACY-IDENTITY')
  const audit = db.prepare("SELECT details FROM audit_logs WHERE action='merge'").get()
  assert.equal(JSON.parse(audit.details).operationId, 'whitespace-membership-contact-merge')
}

async function main() {
  await check('all three contact merges commit backfill, every repoint, delete and audit atomically within bounds', successfulMerges)
  await check('a stale contact identity fails the in-batch CAS without any partial write', staleSnapshotRollsBack)
  await check('an audit write failure rolls back backfill, repoints and delete', auditFailureRollsBack)
  await check('an all-whitespace keeper membership preserves the loser exact identity', whitespaceMembershipPreservesLoserIdentity)
  await check('distinct nonblank membership identities are refused byte-exact, including legacy case variants', async () => {
    assert.equal(subject.contactMergeHasDistinctMemberships({ membership_number: 'LC-00001' }, { membership_number: 'LC-00002' }), true)
    assert.equal(subject.contactMergeHasDistinctMemberships({ membership_number: 'LC-00001' }, { membership_number: 'lc-00001' }), true)
    assert.equal(subject.contactMergeHasDistinctMemberships({ membership_number: ' LC-00001 ' }, { membership_number: 'LC-00001' }), true)
    assert.equal(subject.contactMergeHasDistinctMemberships({ membership_number: 'LC-00001' }, { membership_number: 'LC-00001' }), false)
    assert.throws(() => subject.buildContactMergePlan({
      table: 'customers', entity: 'customer', editableColumns: CONFIG.customers.columns,
      keeper: { id: 1, name: 'Same', membership_number: 'LC-00001' },
      merged: { id: 2, name: 'Same', membership_number: 'LEGACY-A' },
      hasCustomerReceivables: false, hasSupplierInvoices: false,
      audit: { operationId: 'blocked', userId: 7, userName: 'operator', deviceName: null, deviceTz: null },
    }), /contact_merge_membership_lineage_required/)
  })

  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
  await check('the route re-proves duplicate identity and executes only the planned atomic write batch', async () => {
    const start = route.indexOf('app.post(`${config.path}/merge`')
    const end = route.indexOf('app.post(config.path', start)
    const handler = route.slice(start, end)
    assert.match(handler, /findContactDuplicates\(db, config\.table/)
    assert.match(handler, /duplicateMatches\.some/)
    assert.match(handler, /await db\.batch\(plan\.statements\)/)
    assert.match(handler, /contact_merge_status_unknown/)
    assert.doesNotMatch(handler, /await audit\(/)
  })
  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
