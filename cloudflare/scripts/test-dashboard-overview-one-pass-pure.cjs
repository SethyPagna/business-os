// The one-pass Dashboard stock overview (familyStockOverviewSql): one grouped scan computes every family aggregate over the non-header rows and over all rows and picks by nh_count, and the previewed
// families' representatives are read by key through familyPagination.pageCandidatesSql. It must equal the three helpers the Dashboard used (getFamilyStockStats + the low and out alert pages) on the
// seeded catalogue PLUS the fixtures below, at previews 1, 3, 10 and 50 and on every low-stock config: exact rows, and the money sums to 1e-9 as a fallback that cannot flap if a future planner change
// adds the same floats in another order.
//
// Fixtures (refuter list): a mixed family (header with stock, children low / 0 / NULL); a header-only family at -100; headers with parent_id 0 and with parent_id NULL; a group row that is itself a child;
// a header whose only children are inactive; a standalone sharing the header's name; a blank-named parent + child and a product literally named id:<parent id>; a dangling parent; NULL cost with
// stock and a KHR-only cost; stock 2.5 x cost 1.0001 and stock -3; NULL, custom and zero thresholds; an inactive product kept visible by its stock; and FAMILY X: a header at -70 that the representative
// rule must skip, whose only member is a differently named child at -65, reachable only through the parent seek.
//
// Required reds (each mutant must differ from the helpers at a preview of 3 or more): the header rule removed from the aggregates; representatives that keep header rows; a candidate set without the
// child-of-name_key seek.
//
// Run: node scripts/test-dashboard-overview-one-pass-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { SRC, load, counting, fixtureWrite, seedCatalog, LOW_CONFIGS } = require('./harness/dashboard_overview_world.cjs')

function loadEdited(rel, overrides, edit) {
  const output = ts.transpileModule(edit(fs.readFileSync(path.join(SRC, rel), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10))), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name === './productStockGuard') return load('lib/productStockGuard.ts')
    throw new Error(`${rel}: unexpected dependency ${name}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const seam = (text, from, to) => { assert.equal(text.split(from).length, 2, `mutant anchor must occur once: ${from.slice(0, 60)}`); return text.replace(from, () => to) }

function modulesWith({ statsEdit = (t) => t, paginationEdit = (t) => t } = {}) {
  const dbStub = { getDb: () => null }
  const familyPagination = loadEdited('lib/familyPagination.ts', { './db': dbStub }, paginationEdit)
  const lowStockSettings = load('lib/lowStockSettings.ts', { './db': dbStub })
  return loadEdited('lib/familyStockStats.ts', { './familyPagination': familyPagination, './lowStockSettings': lowStockSettings }, statsEdit)
}
const MUTANTS = {
  'header-rule-removed': { statsEdit: (t) => seam(t, "`${agg}(CASE WHEN NOT ${header} THEN ${expr} END) AS nh_${name}, ${agg}(${expr}) AS all_${name}`", "`${agg}(${expr}) AS nh_${name}, ${agg}(${expr}) AS all_${name}`") },
  'representatives-keep-headers': { statsEdit: (t) => seam(t, '      WHERE NOT (m.is_group = 1 AND m.parent_id = 0) OR v.nh_count = 0\n', '') },
  'no-child-of-name-key-candidates': { paginationEdit: (t) => seam(t, '      UNION SELECT c.id FROM ${familiesTable} pf CROSS JOIN products r ON r.name_key = pf.family_root_id CROSS JOIN products c INDEXED BY idx_products_parent_pg ON c.parent_id = r.id\n', '') },
}

const COLS = 'name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, cost_price_usd, cost_price_khr, is_active, is_group, parent_id'
function addFixtures(db) {
  const ins = db.prepare(`INSERT INTO products (${COLS}) VALUES (@name, 'FX', 'pcs', @qty, @low, @out, @usd, @khr, @active, @isGroup, @parent)`)
  const add = (row) => Number(ins.run({ low: null, out: null, usd: 1.5, khr: 6000, active: 1, isGroup: 0, parent: null, ...row }).meta.last_row_id)
  const ids = {}
  fixtureWrite(db, () => {
    // mixed family: a header with stock and three children low / 0 / NULL, plus a standalone sharing the header's name
    ids.mix = add({ name: 'Mix Fam', qty: 4, isGroup: 1, parent: 0 })
    add({ name: 'Mix Fam', qty: 1, parent: ids.mix }); add({ name: 'Mix Fam', qty: 0, parent: ids.mix }); add({ name: 'Mix Fam', qty: null, parent: ids.mix })
    add({ name: 'Mix Fam', qty: 1 })
    // header-only at -100; headers with parent_id 0 and NULL; a group row that is itself a child
    add({ name: 'Solo Hdr', qty: -100, isGroup: 1, parent: 0 })
    add({ name: 'Hdr Zero', qty: 0, isGroup: 1, parent: 0 }); add({ name: 'Hdr Null', qty: 0, isGroup: 1, parent: null })
    ids.gc = add({ name: 'Grp Parent', qty: 2, isGroup: 1, parent: 0 }); add({ name: 'Group Child', qty: 0, isGroup: 1, parent: ids.gc })
    // a header whose only children are inactive
    ids.inact = add({ name: 'Inact Hdr', qty: 0, isGroup: 1, parent: 0 }); add({ name: 'Inact Hdr', qty: 0, active: 0, parent: ids.inact }); add({ name: 'Inact Hdr', qty: 0, active: 0, parent: ids.inact })
    // blank-named parent + child, and a product literally named id:<parent id>
    ids.blank = add({ name: '', qty: 2, isGroup: 1, parent: 0 }); add({ name: 'Blank Child', qty: 0, parent: ids.blank }); add({ name: 'id:' + ids.blank, qty: 1 })
    // a dangling parent
    add({ name: 'Dangling', qty: 0, parent: 99999999 })
    // costs: NULL with stock, KHR-only, 2.5 x 1.0001, negative stock
    add({ name: 'No Cost', qty: 7, usd: null, khr: null }); add({ name: 'Riel Only', qty: 3, usd: null, khr: 8000 })
    add({ name: 'Fraction', qty: 2.5, usd: 1.0001, khr: 4000.5 }); add({ name: 'Negative', qty: -3 })
    // thresholds: NULL, custom, zero
    add({ name: 'Thr Null', qty: 5 }); add({ name: 'Thr Custom', qty: 5, low: 20, out: 2 }); add({ name: 'Thr Zero', qty: 0, low: 0, out: 0 }); add({ name: 'Thr Edge', qty: 3, low: 3, out: 3 })
    // an inactive product kept visible by its stock
    const retired = add({ name: 'Retired Stock', qty: 0, active: 0 })
    try { db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 6)').run(retired) } catch { /* a guarded database refuses it: the invariant keeps an inactive product from holding stock */ }
    // FAMILY X: a header at -70 and its only member, a differently named child at -65 (key = the header's name key)
    ids.x = add({ name: 'Fam X Hdr', qty: -70, isGroup: 1, parent: 0 }); add({ name: 'Fam X Kid', qty: -65, parent: ids.x })
  })
  return ids
}

const stripPage = (page) => ({ ...page, items: page.items.map((item) => ({ ...item })) })
async function oracle(fs_, db, lowStock, previewSize) {
  const stats = await fs_.getFamilyStockStats({ db, lowStock, joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, qtyExpr: 'COALESCE(p.stock_quantity, 0)' })
  return { stats, low: await fs_.getFamilyStockAlertPage({ db, lowStock, state: 'low', page: 1, pageSize: previewSize }), out: await fs_.getFamilyStockAlertPage({ db, lowStock, state: 'out', page: 1, pageSize: previewSize }) }
}
const MONEY = ['stock_value_usd', 'stock_value_khr']
// null when the overview matches the oracle; otherwise a description of the first difference
function difference(one, ref) {
  for (const key of Object.keys(ref.stats)) {
    if (MONEY.includes(key)) { if (Math.abs(one.stats[key] - ref.stats[key]) > 1e-9) return `stats.${key} ${one.stats[key]} vs ${ref.stats[key]}`; continue }
    if (one.stats[key] !== ref.stats[key]) return `stats.${key} ${one.stats[key]} vs ${ref.stats[key]}`
  }
  try { assert.deepEqual(stripPage(one.low), stripPage(ref.low)) } catch { return 'low page' }
  try { assert.deepEqual(stripPage(one.out), stripPage(ref.out)) } catch { return 'out page' }
  return null
}

async function main() {
  const migrations = loadAll()
  const real = modulesWith()
  let checks = 0
  const seeded = (seed) => { const db = openDb(migrations); seedCatalog(db, seed); const ids = addFixtures(db); return { db, cdb: counting(db), ids } }

  // 1. parity with the three helpers on every fixture, preview and config
  for (const seed of [11, 42]) {
    const { db, cdb, ids } = seeded(seed)
    for (const lowStock of LOW_CONFIGS) {
      for (const previewSize of [1, 3, 10, 50]) {
        const one = await real.getFamilyStockOverview({ db: cdb, lowStock, previewSize })
        const ref = await oracle(real, cdb, lowStock, previewSize)
        assert.equal(difference(one, ref), null, `seed ${seed} ${JSON.stringify(lowStock)} preview ${previewSize}`)
        checks += 1
      }
    }
    // family X is in the out preview at 3 and 10 (its minimum is -65 among the non-header rows), the header row never represents it
    const x = (await real.getFamilyStockOverview({ db: cdb, lowStock: LOW_CONFIGS[0], previewSize: 10 })).out.items.find((item) => item.name === 'Fam X Kid')
    assert.ok(x && x.stock_quantity === -65 && x.family_size === 1 && x.family_stock_quantity === -65, 'family X is represented by its child, and the header counts for nothing')
    const solo = (await real.getFamilyStockOverview({ db: cdb, lowStock: LOW_CONFIGS[0], previewSize: 10 })).out.items.find((item) => item.name === 'Solo Hdr')
    assert.ok(solo && solo.stock_quantity === -100 && solo.family_size === 1, 'a header-only family is represented by its header')
    void db; void ids
  }
  console.log('PASS parity with the three helpers: 2 seeds x 3 configs x 4 previews, exact rows and money to 1e-9, family X represented by its child')

  // 2. explicit numbers (not only the equality): negative and NULL stock, NULL cost
  {
    const db = openDb(migrations)
    fixtureWrite(db, () => {
      const ins = db.prepare(`INSERT INTO products (${COLS}) VALUES (@name, 'FX', 'pcs', @qty, NULL, NULL, @usd, @khr, 1, 0, NULL)`)
      ins.run({ name: 'a', qty: -3, usd: 2, khr: 8000 }); ins.run({ name: 'b', qty: null, usd: 2, khr: 8000 }); ins.run({ name: 'c', qty: 7, usd: null, khr: null }); ins.run({ name: 'd', qty: 2.5, usd: 1.0001, khr: 4000 })
    })
    const one = await real.getFamilyStockOverview({ db: counting(db), lowStock: LOW_CONFIGS[0], previewSize: 10 })
    assert.equal(one.stats.total_products, 4)
    assert.equal(one.stats.stock_quantity, -3 + 0 + 7 + 2.5, 'negative and NULL stock add as -3 and 0')
    assert.equal(one.stats.stock_value_unknown_products, 1, 'one product with stock and no cost')
    assert.equal(one.stats.stock_value_unknown_quantity, 7)
    assert.ok(Math.abs(one.stats.stock_value_usd - 2.5 * 1.0001) < 1e-9, 'a negative quantity is worth nothing; 2.5 x 1.0001 counts')
    checks += 5
    console.log('PASS explicit sums: negative stock, NULL stock and NULL cost')
  }

  // 3. required reds
  for (const [name, edits] of Object.entries(MUTANTS)) {
    const mutated = modulesWith(edits)
    let redAt = null
    for (const previewSize of [3, 10, 50]) {
      for (const seed of [11, 42]) {
        const { cdb } = seeded(seed)
        for (const lowStock of LOW_CONFIGS) {
          let diff
          try { diff = difference(await mutated.getFamilyStockOverview({ db: cdb, lowStock, previewSize }), await oracle(real, cdb, lowStock, previewSize)) } catch (error) { diff = `threw ${String(error.message).slice(0, 60)}` }
          if (diff && !redAt) redAt = `preview ${previewSize}, ${diff}`
        }
      }
    }
    assert.ok(redAt, `mutant ${name} must differ from the helpers at a preview of 3 or more`)
    console.log(`PASS mutant ${name} red at ${redAt}`)
    checks += 1
  }
  // the two mutants the old fixtures could not see are invisible without family X: control that the fixture, not the preview size, is what catches them
  {
    const mutated = modulesWith(MUTANTS['representatives-keep-headers'])
    const db = openDb(migrations); seedCatalog(db, 11); const cdb = counting(db)
    for (const previewSize of [1, 3, 10, 50]) assert.equal(difference(await mutated.getFamilyStockOverview({ db: cdb, lowStock: LOW_CONFIGS[0], previewSize }), await oracle(real, cdb, LOW_CONFIGS[0], previewSize)), null, 'control: on the plain seed (no family X) this mutant is invisible')
    checks += 1
    console.log('PASS control: without family X the keep-headers mutant is invisible, so the fixture is what catches it')
  }
  // one statement, one call
  {
    const { cdb } = seeded(11)
    await real.getFamilyStockOverview({ db: cdb, lowStock: LOW_CONFIGS[0], previewSize: 10 })
    assert.equal(cdb.log.length, 1, 'one statement')
    assert.ok(/idx_products_parent_pg/.test(cdb.log[0]), 'the candidate seeks use the parent index')
    checks += 2
  }
  console.log(`${checks} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
