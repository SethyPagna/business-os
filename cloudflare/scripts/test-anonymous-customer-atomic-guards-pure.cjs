const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath))
    return mod.exports
  } finally { Module._load = originalLoad }
}

const anonymous = loadReal('lib/anonymousCustomer.ts')
const contactOptions = loadReal('lib/contactOptions.ts')
const merge = loadReal('lib/contactMerge.ts', { './contactOptions': contactOptions })

function seedPair() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO customers (id,name,phone,membership_number,is_anonymous) VALUES (1,'Keeper','011','LC-1',0),(2,'Merged','022',NULL,0)").run()
  db.prepare("INSERT INTO sales (id,receipt_number,customer_id,customer_name,total_usd,total_khr) VALUES (11,'F72-RACE',2,'Merged',1,4000)").run()
  return db
}

;(async () => {
{
  const db = seedPair()
  const guard = { sql: anonymous.customerProfileMutationGuardSql('customerId'), params: { customerId: 1 } }
  db.prepare('UPDATE customers SET is_anonymous=1, updated_at=CURRENT_TIMESTAMP WHERE id=1').run()
  await assert.rejects(() => db.batch([
    guard,
    { sql: "UPDATE customers SET name='Wrong' WHERE id=@customerId", params: { customerId: 1 } },
    { sql: "INSERT INTO audit_logs (action,entity,entity_id) VALUES ('update','customer',@customerId)", params: { customerId: 1 } },
  ]), /malformed JSON|anonymous_customer_immutable/)
  assert.equal(db.prepare('SELECT name FROM customers WHERE id=1').get().name, 'Keeper')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='customer' AND entity_id=1").get().n, 0)
}

{
  const db = seedPair()
  db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  await assert.rejects(() => db.batch([
    { sql: anonymous.customerProfileMutationGuardSql('customerId'), params: { customerId: 1 } },
    { sql: 'DELETE FROM customers WHERE id=@customerId', params: { customerId: 1 } },
  ]), /malformed JSON/)
  assert.ok(db.prepare('SELECT id FROM customers WHERE id=1').get(), 'post-plan marker blocks delete')
}

{
  const db = seedPair()
  db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  await assert.rejects(() => db.batch([
    { sql: anonymous.customerProfileMutationGuardSql('customerId'), params: { customerId: 1 } },
    { sql: "INSERT INTO loyalty_point_adjustments (customer_id,points,note) VALUES (@customerId,10,'wrong')", params: { customerId: 1 } },
  ]), /malformed JSON/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_point_adjustments WHERE customer_id=1').get().n, 0)
}

{
  const db = seedPair()
  const guard = { sql: anonymous.customerProfileMutationGuardSql('targetId'), params: { targetId: 1 } }
  db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  await assert.rejects(() => db.batch([
    guard,
    { sql: 'UPDATE sales SET customer_id=@targetId WHERE id=11', params: { targetId: 1 } },
  ]), /malformed JSON|anonymous_customer_immutable/)
  assert.equal(db.prepare('SELECT customer_id FROM sales WHERE id=11').get().customer_id, 2)
}

{
  const db = seedPair()
  const keeper = db.prepare('SELECT * FROM customers WHERE id=1').get()
  const merged = db.prepare('SELECT * FROM customers WHERE id=2').get()
  const plan = merge.buildContactMergePlan({
    table: 'customers', entity: 'customer', editableColumns: ['name','phone','email','address','membership_number','gender'],
    keeper, merged, hasCustomerReceivables: false, hasSupplierInvoices: false,
    audit: { operationId: 'f72-race', userId: 1, userName: 'reviewer', deviceName: null, deviceTz: null },
  })
  db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=2').run()
  await assert.rejects(() => db.batch(plan.statements), /malformed JSON|contact_merge_conflict/)
  assert.ok(db.prepare('SELECT id FROM customers WHERE id=2').get(), 'marked merged source survives')
  assert.equal(db.prepare('SELECT customer_id FROM sales WHERE id=11').get().customer_id, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='merge'").get().n, 0)
}

const contactsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
for (const required of [
  /statements\.push\(anonymousCustomerGuardStatement\(id\)\)/,
  /db\.batch\(\[\s*anonymousCustomerGuardStatement\(id\),\s*\{ sql: 'DELETE FROM customers/,
  /anonymousCustomerGuardStatement\(targetId, 'targetId'\)/,
  /anonymousCustomerGuardStatement\(customerId\)/,
]) assert.match(contactsSource, required)

console.log('anonymous customer atomic guards: 14 checks passed')
})().catch((error) => { console.error(error); process.exitCode = 1 })
