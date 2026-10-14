// Release 3, slice S7 -- the cost-entry writers of lib/catalogCostRecompute.ts keep "unknown" apart from "$0".
// product_cost_entries.cost_usd is NOT NULL: the table records COSTS THAT WERE TYPED. So
//   a typed 0 is a recorded $0 and has its entry (the proof Q1 will read);
//   a write that leaves the USD cost unknown (NULL) has NO entry (base: an entry of 0, i.e. a lie that says "free").
//
// Real lib/catalogCostRecompute.ts on the full migrated SQLite schema; no route, no auth.
//
// Run (from cloudflare/scripts): node test-cost-s7-cost-entries-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.resolve(__dirname, '../src')
const raw = openDb(loadAll(path.resolve(__dirname, '../migrations'))).db
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = path.join(src, relative)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  const localRequire = (request) => (request.startsWith('.') ? load(`lib/${request.split('/').pop()}.ts`) : require(request))
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  cache.set(relative, mod.exports); return mod.exports
}
const costs = load('lib/catalogCostRecompute.ts')

function bindNamed(sql, params) {
  const values = []
  const translated = sql.replace(/@(\w+)/g, (_match, name) => { values.push((params || {})[name] ?? null); return '?' })
  return { values, translated }
}
const runStatement = (statement) => { const { translated, values } = bindNamed(statement.sql, statement.params); return raw.prepare(translated).run(...values) }
const db = {
  prepare(sql) {
    return {
      async get(params) { const { translated, values } = bindNamed(sql, params); return raw.prepare(translated).get(...values) },
      async run(params) { const { translated, values } = bindNamed(sql, params); const r = raw.prepare(translated).run(...values); return { changes: Number(r.changes) } },
    }
  },
}
const actor = { id: 7, name: 'Entry Tester' }
const product = (name, usd, khr) => Number(raw.prepare('INSERT INTO products(name,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,1)').run(name, usd, khr).lastInsertRowid)
const entries = (id) => raw.prepare('SELECT cost_usd, cost_khr, previous_cost_usd FROM product_cost_entries WHERE product_id=? ORDER BY id').all(id).map((entry) => ({ ...entry }))
const setCost = (id, usd, khr) => raw.prepare('UPDATE products SET cost_price_usd=?, cost_price_khr=? WHERE id=?').run(usd, khr, id)

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 8).join('\n  ')}`) }
}

async function main() {
  await check('typedCostEntryBeforeWriteStatement: a write of an unknown USD cost records no entry (base: an entry of 0)', async () => {
    const id = product('Before Unknown', 4, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(id, { usd: null }, actor))
    assert.deepEqual(entries(id), [])
  })

  await check('typedCostEntryBeforeWriteStatement: a typed 0 is recorded as 0 with its previous cost; a real cost as itself', async () => {
    const zero = product('Before Zero', null, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(zero, { usd: 0 }, actor))
    assert.deepEqual(entries(zero), [{ cost_usd: 0, cost_khr: null, previous_cost_usd: null }])
    const real = product('Before Real', 4, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(real, { usd: 6.5, khr: 26650 }, actor))
    assert.deepEqual(entries(real), [{ cost_usd: 6.5, cost_khr: 26650, previous_cost_usd: 4 }])
  })

  await check('typedCostEntryBeforeWriteStatement: a KHR-only write records the existing USD cost, and nothing when that is unknown (base: 0)', async () => {
    const known = product('Khr Only Known', 3, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(known, { khr: 12000 }, actor))
    assert.deepEqual(entries(known), [{ cost_usd: 3, cost_khr: 12000, previous_cost_usd: 3 }])
    const unknown = product('Khr Only Unknown', null, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(unknown, { khr: 12000 }, actor))
    assert.deepEqual(entries(unknown), [])
  })

  await check('typedCostEntryBeforeWriteStatement: an unmoved cost writes nothing, unknown or 0 (control)', async () => {
    const unknown = product('Same Unknown', null, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(unknown, { usd: null }, actor))
    const zero = product('Same Zero', 0, null)
    runStatement(costs.typedCostEntryBeforeWriteStatement(zero, { usd: 0 }, actor))
    assert.deepEqual([entries(unknown), entries(zero)], [[], []])
  })

  await check('typedCostEntriesBeforeWriteSql (bulk adjust, import): the set form skips an unknown cost and records a 0', async () => {
    const unknown = product('Set Unknown', 4, null)
    const zero = product('Set Zero', 2, null)
    const sql = costs.typedCostEntriesBeforeWriteSql({ nextUsdSql: 'CASE WHEN products.name = \'Set Zero\' THEN 0 ELSE NULL END', nextKhrSql: null, whereSql: 'products.id IN (@a, @b)' })
    runStatement({ sql, params: { a: unknown, b: zero, ...costs.costEntryActorParams(actor) } })
    assert.deepEqual(entries(unknown), [])
    assert.deepEqual(entries(zero), [{ cost_usd: 0, cost_khr: null, previous_cost_usd: 2 }])
  })

  await check('typedCostEntryAfterWriteStatement (review queue, plan-less rows): an unknown written cost records no entry, a written 0 does', async () => {
    const cleared = product('After Cleared', null, null)
    runStatement(costs.typedCostEntryAfterWriteStatement(cleared, { cost_price_usd: 5, cost_price_khr: null }, { usd: true, khr: false }, actor))
    assert.deepEqual(entries(cleared), [], 'the product now holds NULL: base recorded 0')
    const zeroed = product('After Zero', 0, null)
    runStatement(costs.typedCostEntryAfterWriteStatement(zeroed, { cost_price_usd: 5, cost_price_khr: null }, { usd: true, khr: false }, actor))
    assert.deepEqual(entries(zeroed), [{ cost_usd: 0, cost_khr: null, previous_cost_usd: 5 }])
  })

  await check('planManualCostChange / planManualCostEntry: unknown after-cost has no entry but is still a change; a typed 0 has its entry', async () => {
    const clear = costs.planManualCostChange(1, { cost_price_usd: 4, cost_price_khr: null }, { cost_price_usd: null }, actor)
    assert.deepEqual(clear, { entry: null })
    assert.equal(costs.planManualCostEntry(1, { cost_price_usd: 4, cost_price_khr: null }, { cost_price_usd: null }, actor), null)
    const zero = costs.planManualCostChange(1, { cost_price_usd: 4, cost_price_khr: null }, { cost_price_usd: 0 }, actor)
    assert.equal(zero.entry.params.costUsd, 0)
    assert.equal(zero.entry.params.previousCostUsd, 4)
    assert.equal(costs.planManualCostChange(1, { cost_price_usd: null, cost_price_khr: null }, { cost_price_usd: null }, actor), null, 'unknown -> unknown is no change')
    assert.deepEqual(costs.planManualCostChange(1, { cost_price_usd: null, cost_price_khr: null }, { cost_price_khr: 9000 }, actor), { entry: null }, 'a KHR-only change on an unknown USD cost cannot be an entry')
    assert.equal(costs.planManualCostChange(1, { cost_price_usd: 4, cost_price_khr: null }, { cost_price_khr: 9000 }, actor).entry.params.costUsd, 4)
  })

  await check('recomputeCatalogCost reports an unknown cost as null before and after, and a recorded 0 as 0 (base: both 0)', async () => {
    const unknown = product('Recompute Unknown', null, null)
    const result = await costs.recomputeCatalogCost(db, unknown)
    assert.deepEqual([result.before, result.after, result.changed], [{ usd: null, khr: null }, { usd: null, khr: null }, false])
    const zero = product('Recompute Zero', 0, 0)
    const zeroResult = await costs.recomputeCatalogCost(db, zero)
    assert.deepEqual([zeroResult.before, zeroResult.after, zeroResult.changed], [{ usd: 0, khr: 0 }, { usd: 0, khr: 0 }, false])
  })

  await check('recomputeCatalogCost: an unknown catalog cost with a costed lot on hand becomes the lot cost, and says it changed', async () => {
    const id = product('Recompute Lot', null, null)
    raw.prepare('INSERT INTO branches(id,name,is_active) VALUES(1,\'S7\',1) ON CONFLICT(id) DO NOTHING').run()
    const lot = Number(raw.prepare('INSERT INTO product_batches(variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(?,?,1,3.25)').run(id, 'k-recompute').lastInsertRowid)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,2)').run(lot)
    setCost(id, null, null)
    const result = await costs.recomputeCatalogCost(db, id)
    assert.deepEqual([result.before.usd, result.after.usd, result.changed], [null, 3.25, true])
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
