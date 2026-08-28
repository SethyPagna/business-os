// D6: the rename-cascade engine (lib/renameCascade.ts) against a REAL
// sqlite database with the REAL migrations -- name_key is maintained by
// migration 0010's triggers, so a hand-built fixture would test this
// file's idea of grouping rather than the database's. Covers:
//   - impact counts split primary vs multi-value membership (0033)
//   - carry rewrites BOTH, including the multi-value '||' membership
//   - supplier carry follows products AND batches; history untouched
//   - product-name carry renames the whole active group (9.1's regroup)
//     and the trigger keeps name_key in step
//   - route wiring pins: impact + brand endpoints, group-scope hook,
//     lookup copy mode, supplier cascade flag
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

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

const engine = loadReal('lib/renameCascade.ts', { './db': {} })

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function seed(db) {
  const rows = [
    // primary category 'Lips'; secondary membership via categories
    { name: 'Rouge A', barcode: 'a1', category: 'Lips', categories: 'Lips||Gift Set', brand: 'Dior', supplier: 'Old Trading' },
    { name: 'Rouge B', barcode: 'b1', category: 'Skincare', categories: 'Skincare||Lips', brand: 'Dior', supplier: 'Old Trading' },
    { name: 'Serum One', barcode: 'c1', category: 'Skincare', categories: '', brand: 'Chanel', supplier: 'Other Co' },
    // a 2-row name group for the product_name carry
    { name: 'Twin Cream', barcode: 'd1', category: 'Skincare', categories: '', brand: 'Chanel', supplier: '' },
    { name: 'Twin Cream', barcode: 'd2', category: 'Skincare', categories: '', brand: 'Chanel', supplier: '' },
  ]
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO products (name, barcode, category, categories, brand, supplier, is_active, stock_quantity, out_of_stock_threshold)
      VALUES (@name, @barcode, @category, @categories, @brand, @supplier, 1, 5, 0)
    `).run(row)
  }
  const productId = (await db.prepare(`SELECT id FROM products WHERE barcode = 'a1'`).get()).id
  await db.prepare(`
    INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_name)
    VALUES (@id, 'k1', '08282026', '2026-08-28', 1, 1, 'Old Trading')
  `).run({ id: productId })
}

async function run() {
  const db = openDb(MIGRATION_SQLS)
  await seed(db)

  await check('impact splits primary vs multi-value membership, and flags an existing target', async () => {
    const impact = await engine.computeRenameImpact(db, 'category', 'Lips', 'Lip Care')
    assert.equal(impact.products_primary, 1, 'Rouge A holds Lips as primary')
    assert.equal(impact.products_secondary, 1, 'Rouge B holds Lips only as a secondary member')
    assert.equal(impact.target_exists, false)
    const clash = await engine.computeRenameImpact(db, 'category', 'Lips', 'Skincare')
    assert.equal(clash.target_exists, true, 'renaming INTO an existing category flags a merge')
  })

  await check('category carry rewrites the primary column AND the || membership, deduping', async () => {
    const changed = await engine.applyRenameCarry(db, 'category', 'Lips', 'Lip Care', '2026-08-28T10:00:00Z')
    assert.equal(changed.products, 2, 'one primary rewrite + one membership rewrite')
    const a = await db.prepare(`SELECT category, categories FROM products WHERE barcode = 'a1'`).get()
    assert.equal(a.category, 'Lip Care')
    assert.equal(a.categories, 'Lip Care||Gift Set')
    const b = await db.prepare(`SELECT category, categories FROM products WHERE barcode = 'b1'`).get()
    assert.equal(b.category, 'Skincare', 'primary untouched where Lips was only secondary')
    assert.equal(b.categories, 'Skincare||Lip Care')
  })

  await check('supplier impact + carry follow products and batches', async () => {
    const impact = await engine.computeRenameImpact(db, 'supplier', 'Old Trading', 'New Trading')
    assert.equal(impact.products_primary, 2)
    assert.equal(impact.batches, 1)
    const changed = await engine.applyRenameCarry(db, 'supplier', 'Old Trading', 'New Trading', '2026-08-28T10:00:00Z')
    assert.equal(changed.products, 2)
    assert.equal(changed.batches, 1)
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE supplier = 'Old Trading'`).get()
    assert.equal(Number(left.n), 0)
    const batch = await db.prepare(`SELECT supplier_name FROM product_batches WHERE batch_key = 'k1'`).get()
    assert.equal(batch.supplier_name, 'New Trading')
  })

  await check('product-name carry renames the whole active group and the trigger keeps name_key in step (9.1)', async () => {
    const impact = await engine.computeRenameImpact(db, 'product_name', 'twin cream', 'Twin Cream Pro')
    assert.equal(impact.group_rows, 2)
    const changed = await engine.applyRenameCarry(db, 'product_name', 'twin cream', 'Twin Cream Pro', '2026-08-28T10:00:00Z')
    assert.equal(changed.products, 2)
    const rows = await db.prepare(`SELECT name, name_key FROM products WHERE barcode IN ('d1', 'd2')`).all()
    for (const row of rows) {
      assert.equal(row.name, 'Twin Cream Pro')
      assert.equal(row.name_key, 'twin cream pro', 'the 0010 trigger recomputed name_key')
    }
  })

  await check('route wiring pins: endpoints, group-scope hook, lookup copy mode, supplier flag', async () => {
    const products = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
    assert.match(products, /app\.get\('\/rename-impact'/, 'impact endpoint exists')
    assert.match(products, /app\.post\('\/rename-brand'/, 'brand carry endpoint exists')
    assert.match(products, /__rename_scope === 'group'/, 'PUT /:id honours the carry-the-group choice')
    const lookups = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'lookups.ts'), 'utf8')
    assert.match(lookups, /body\.cascade === 'copy'/, "lookup rename supports 'keep a copy, new is new'")
    assert.match(lookups, /applyRenameCarry\(db, 'category'/, 'lookup rename carries the multi-value membership too')
    const contacts = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'contacts.ts'), 'utf8')
    assert.match(contacts, /__rename_cascade === 'carry'/, 'supplier rename carries on request')
  })

  console.log(`\n${passed} checks passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
