const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const cache = new Map()
function load(relative) {
  relative = path.posix.normalize(relative)
  if (!relative.endsWith('.ts')) relative += '.ts'
  if (cache.has(relative)) return cache.get(relative).exports
  const module = { exports: {} }
  cache.set(relative, module)
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', output)(request => {
    assert.ok(request.startsWith('.'), `unexpected dependency ${request}`)
    return load(path.posix.join(path.posix.dirname(relative), request))
  }, module, module.exports)
  return module.exports
}
const budget = load('lib/transferRunBudget')
const { planTransferOperation } = load('lib/transferOperation')
const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter(file => file.endsWith('.sql')).sort()
function fixture(input) {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of migrations) raw.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  raw.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0)")
  const products = raw.prepare('INSERT INTO products(id,name,sku,is_active,cost_price_usd,cost_price_khr) VALUES(?,?,?,1,2.5,10000)')
  for (const id of [1, 2, 3, 4]) products.run(id, `Product ${id}`, `P-${id}`)
  const lot = raw.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,?,?,1)')
  const stock = raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)')
  for (const [index, count] of input.lots.entries()) {
    const product = index * 2 + 1
    for (let n = 1; n <= count; n++) {
      const id = product * 1000 + n
      lot.run(id, product, `lot-${id}`, `lot-${id}`, '2026-01-01', n, 1 + n / 100)
      stock.run(id)
      if (input.matched && n === 1) lot.run(id + 5000, product + 1, `lot-${id}`, `lot-${id}`, '2026-01-01', n, 1 + n / 100)
    }
  }
  const stats = { reads: 0, maxBindings: 0 }
  function prepared(sql, values = []) {
    return {
      sql, values,
      bind: (...next) => prepared(sql, next),
      all: async () => {
        stats.reads++
        stats.maxBindings = Math.max(stats.maxBindings, values.length)
        const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
        return { success: true, results: raw.prepare(sql).all(...args), meta: { changes: 0 } }
      },
    }
  }
  return { raw, stats, db: load('lib/db').getDb({ DB: { prepare: prepared } }) }
}
const cases = [
  { name: 'same product untracked', lots: [0] },
  { name: 'same product one lot', lots: [1] },
  { name: 'same product two lots', lots: [2] },
  { name: 'same product 128 lots', lots: [128] },
  { name: 'two products with separate lots', lots: [1, 2] },
  { name: 'cross product one new lot', lots: [1], cross: true },
  { name: 'cross product two new lots', lots: [2], cross: true },
  { name: 'cross product 128 new lots', lots: [128], cross: true },
  { name: 'cross product matched and new lot', lots: [2], cross: true, matched: true },
]
async function main() {
  let failures = 0
  for (const input of cases) {
    const { raw, db, stats } = fixture(input)
    try {
      const before = raw.prepare('SELECT COUNT(*) n FROM product_batches').get().n
      const lines = input.lots.map((count, index) => ({ productId: index * 2 + 1,
        destProductId: index * 2 + 1 + (input.cross ? 1 : 0), quantity: Math.max(count, 1) }))
      const requestJson = JSON.stringify({ version: 1, lines })
      const result = await planTransferOperation(db, { user: { id: 7, username: 'fixture', name: 'Fixture' },
        requestId: 'budget-fixture', requestJson, digest: 'a'.repeat(64), scope: 'branches',
        fromBranchId: 1, toBranchId: 2, reason: 'Budget fixture', lines, response: { success: true } })
      const allocations = result.allocationSummaries.reduce((sum, row) => sum + row.takes.length, 0)
      const clones = result.statements.filter(statement => /^INSERT INTO product_batches\b/.test(statement.sql)).length
      assert.equal(allocations, input.lots.reduce((sum, count) => sum + count, 0))
      assert.equal(clones, input.cross ? allocations - (input.matched ? lines.length : 0) : 0)
      assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_batches').get().n, before)
      assert.equal(raw.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n, 0)
      assert.ok(stats.reads > 0)
      assert.ok(stats.maxBindings <= 100)
      const estimate = budget.transferStatementEstimate(lines.length, allocations, clones)
      console.log(`${input.name}: estimate=${estimate} generated=${result.statements.length} reads=${stats.reads} clones=${clones}`)
      assert.equal(estimate, result.statements.length, 'estimate must equal actual generated SQL, including authority guard')
      const exact = { tier: 'paid', alreadyUsed: 1000 - result.statements.length - stats.reads,
        remainingReads: stats.reads, completionQueries: 0, retryQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
      budget.assertTransferStatementsFit(exact, result.statements.length)
      assert.throws(() => budget.assertTransferStatementsFit({ ...exact, safetyQueries: 1 }, result.statements.length), /budget/)
      console.log(`PASS ${input.name}: generated parity and actual-read reserve boundary`)
    } catch (error) {
      failures++
      console.error(`FAIL ${input.name}: ${error.message}`)
    } finally {
      raw.close()
    }
  }
  const store = load('lib/transferRunStore')
  const owner = { actual: { actorId: 7, organizationId: null }, expected: { actorId: 7, organizationId: null },
    datasetGeneration: '00000000-0000-4000-8000-000000000001' }
  const registration = { ...owner, runId: 'budget-run', scope: 'branches', requestId: 'budget-request', digest: 'a'.repeat(64) }
  assert.equal(store.registerTransferRunStatements({ ...registration, requestJson: JSON.stringify('x'.repeat(131070)) }).length, 2)
  assert.throws(() => store.registerTransferRunStatements({ ...registration, requestJson: JSON.stringify('x'.repeat(131071)) }), /JSON exceeds limit/)
  const chunk = { ...registration, revision: 0, sequence: 0, cursorBefore: '{}', cursorAfter: '{}', final: false }
  const multibyte = JSON.stringify('ក'.repeat(21844) + 'xx')
  assert.equal(Buffer.byteLength(multibyte), 65536)
  assert.equal(store.sealTransferRunChunkStatements({ ...chunk, requestJson: multibyte }).length, 2)
  assert.throws(() => store.sealTransferRunChunkStatements({ ...chunk, requestJson: JSON.stringify('ក'.repeat(21844) + 'xxx') }), /JSON exceeds limit/)
  assert.throws(() => store.sealTransferRunChunkStatements({ ...chunk, requestJson: '{}' , cursorAfter: JSON.stringify('x'.repeat(4095)) }), /JSON exceeds limit/)
  console.log('PASS retained run/chunk/cursor byte limits including multibyte exact boundary')
  assert.equal(failures, 0, 'every generated operation must match its estimate')
  console.log(`PASS ${cases.length} generated-operation budget groups at native expression depth100`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
