const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const realLibModules = new Map()
function loadRealLib(relName) {
  relName = path.posix.normalize(relName)
  if (realLibModules.has(relName)) return realLibModules.get(relName).exports
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', `${relName}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const mod = { exports: {} }
  realLibModules.set(relName, mod)
  const localRequire = (id) => {
    // queueDispatch is pure and is what runBulkDeleteJob's self-continuation
    // enqueues through now; a {} stub makes dispatchImportWork undefined.
    if (id === './queueDispatch') return loadRealLib('queueDispatch')
    if (id === './planTier') return loadRealLib('planTier')
    if (id === './sqlBinding') return loadRealLib('sqlBinding')
    if (id === './anonymousCustomer') return loadRealLib('anonymousCustomer')
    if (id === './actorSnapshot') return loadRealLib('actorSnapshot')
    if (id === './importEngine') return { runD1BatchInChunks: async () => { throw new Error('unused') } }
    if (id === './cache') return { bumpVersion: async () => { throw new Error('unused') } }
    if (id === '../durable-objects/broadcastHub') return { broadcast: async () => { throw new Error('unused') } }
    if (id.startsWith('.')) return loadRealLib(path.posix.join(path.posix.dirname(relName), id).replace(/\.ts$/, ''))
    return require(id)
  }
  try { new Function('exports','require','module', outputText)(mod.exports, localRequire, mod) }
  catch (error) { realLibModules.delete(relName); throw error }
  return mod.exports
}

;(async () => {
const bulk = loadRealLib('bulkDeleteEngine')
const db = openDb(loadAll())
db.prepare("INSERT INTO customers (id,name,is_anonymous) VALUES (1,'Profile',0),(2,'Marker',1)").run()

const markerDelete = bulk.buildCoreDeleteStatements(bulk.ENTITY_CONFIGS.customers, [2])
assert.equal(markerDelete.length, 1)
assert.match(markerDelete[0].sql, /NOT \(COALESCE\(is_anonymous, 0\) = 1\)/)
assert.equal(db.prepare(markerDelete[0].sql).bind(...markerDelete[0].params).run().meta.changes, 0)
assert.ok(db.prepare('SELECT id FROM customers WHERE id=2').get())

const guard = bulk.buildAnonymousCustomerBulkDeleteGuard([1])
db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
await assert.rejects(() => db.batch([guard, ...bulk.buildCoreDeleteStatements(bulk.ENTITY_CONFIGS.customers, [1])]), /malformed JSON|anonymous_customer_immutable/)
assert.ok(db.prepare('SELECT id FROM customers WHERE id=1').get(), 'post-plan marker survives the queue execution batch')

assert.equal(guard.params.customerIds, '[1]')
assert.equal(Object.keys(guard.params).length, 1, 'guard uses one JSON bind regardless of chunk size')
assert.match(guard.sql, /json_each\(@customerIds\)/)

console.log('anonymous customer bulk delete: 8 checks passed')
})().catch((error) => { console.error(error); process.exitCode = 1 })
