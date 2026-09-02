const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const cascade = loadReal('lib/renameCascade.ts', { './db': {} })
let passed = 0

async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function run() {
  const migrationNames = fs.readdirSync(path.join(cloudflareRoot, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
  const historicalCostIndex = migrationNames.indexOf('0101_legacy_inventory_effect_historical_cost.sql')
  const lookupUniqueIndex = migrationNames.indexOf('0102_lookup_normalized_unique.sql')
  assert.ok(historicalCostIndex >= 0 && lookupUniqueIndex === historicalCostIndex + 1, '0102 must follow 0101 in the full migration chain')
  const db = openDb(loadAll())

  await check('full migration chain applies 0101 then 0102 and creates both unique indexes', async () => {
    const indexes = await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name IN ('idx_categories_name_normalized_unique','idx_units_name_normalized_unique')
      ORDER BY name
    `).all()
    assert.deepEqual(indexes.map((row) => row.name), ['idx_categories_name_normalized_unique', 'idx_units_name_normalized_unique'])
  })

  await check('0102 enforces normalized category/unit identity under concurrent attempts', async () => {
    const categoryAttempts = await Promise.allSettled([
      Promise.resolve().then(() => db.prepare(`INSERT INTO categories (name) VALUES ('Set')`).run()),
      Promise.resolve().then(() => db.prepare(`INSERT INTO categories (name) VALUES ('  set  ')`).run()),
    ])
    assert.equal(categoryAttempts.filter((entry) => entry.status === 'fulfilled').length, 1)
    assert.equal(categoryAttempts.filter((entry) => entry.status === 'rejected').length, 1)
    assert.equal(Number((await db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE lower(trim(name))='set'`).get()).n), 1)

    await db.prepare(`INSERT INTO units (name) VALUES ('Bottle')`).run()
    assert.throws(() => db.prepare(`INSERT INTO units (name) VALUES (' bottle ')`).run(), /UNIQUE constraint failed/i)
  })

  await db.prepare(`INSERT INTO categories (name) VALUES ('Lips')`).run()
  await db.prepare(`
    INSERT INTO products (name, barcode, category, categories, brand, brands, unit, cost_price_usd, is_active)
    VALUES ('Rouge A','ra','Lips','Lips||Gift Set','KIKO','KIKO||Luxury','pcs',7.25,1),
           ('Rouge B','rb','Skincare','Skincare||Lips','Other','Other','pcs',8.50,1)
  `).run()

  await check('a failed lookup batch rolls back lookup, primary and secondary product writes', async () => {
    const plan = await cascade.buildLiveLookupMutationPlan(db, 'category', ['Lips'], 'Lip Care', '2026-09-02T00:00:00Z')
    await assert.rejects(
      db.batch([
        { sql: `UPDATE categories SET name='Lip Care' WHERE lower(trim(name))='lips'` },
        ...plan.statements,
        { sql: `INSERT INTO categories (name) VALUES (' lip care ')` },
      ]),
      /UNIQUE constraint failed/i,
    )
    assert.equal((await db.prepare(`SELECT name FROM categories WHERE lower(trim(name))='lips'`).get()).name, 'Lips')
    const rows = await db.prepare(`SELECT barcode, category, categories, cost_price_usd FROM products WHERE barcode IN ('ra','rb') ORDER BY barcode`).all()
    assert.deepEqual(rows.map((row) => [row.barcode, row.category, row.categories, row.cost_price_usd]), [
      ['ra', 'Lips', 'Lips||Gift Set', 7.25],
      ['rb', 'Skincare', 'Skincare||Lips', 8.5],
    ])
  })

  await check('lookup row and every category membership commit in one successful batch', async () => {
    const plan = await cascade.buildLiveLookupMutationPlan(db, 'category', ['Lips'], 'Lip Care', '2026-09-02T00:01:00Z')
    await db.batch([
      { sql: `UPDATE categories SET name='Lip Care' WHERE lower(trim(name))='lips'` },
      ...plan.statements,
    ])
    assert.equal(plan.products, 2)
    assert.equal((await db.prepare(`SELECT name FROM categories WHERE lower(trim(name))='lip care'`).get()).name, 'Lip Care')
    const a = await db.prepare(`SELECT category, categories, cost_price_usd FROM products WHERE barcode='ra'`).get()
    const b = await db.prepare(`SELECT category, categories, cost_price_usd FROM products WHERE barcode='rb'`).get()
    assert.deepEqual([a.category, a.categories, a.cost_price_usd], ['Lip Care', 'Lip Care||Gift Set', 7.25])
    assert.deepEqual([b.category, b.categories, b.cost_price_usd], ['Skincare', 'Skincare||Lip Care', 8.5])
  })

  await check('brand product carry and saved brand library/color map commit together', async () => {
    await db.prepare(`INSERT INTO settings (key,value) VALUES ('product_brand_options','["KIKO","Other"]')`).run()
    await db.prepare(`INSERT INTO settings (key,value) VALUES ('product_brand_color_map','{"kiko":"#123456","other":"#abcdef"}')`).run()
    const products = await cascade.buildLiveLookupMutationPlan(db, 'brand', ['KIKO', 'Kiko'], 'Kiko', '2026-09-02T00:02:00Z')
    const library = await cascade.buildBrandLibraryMutationPlan(db, ['KIKO', 'Kiko'], 'Kiko')
    await db.batch([...products.statements, ...library.statements])
    const product = await db.prepare(`SELECT brand, brands, cost_price_usd FROM products WHERE barcode='ra'`).get()
    assert.deepEqual([product.brand, product.brands, product.cost_price_usd], ['Kiko', 'Kiko||Luxury', 7.25])
    const options = JSON.parse((await db.prepare(`SELECT value FROM settings WHERE key='product_brand_options'`).get()).value)
    const colors = JSON.parse((await db.prepare(`SELECT value FROM settings WHERE key='product_brand_color_map'`).get()).value)
    assert.deepEqual(options, ['Kiko', 'Other'])
    assert.deepEqual(colors, { other: '#abcdef', kiko: '#123456' })
  })

  console.log(`\n${passed} reference atomicity checks passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
