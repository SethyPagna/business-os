const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const libRoot = path.resolve(__dirname, '../src/lib')
const importSource = fs.readFileSync(path.join(libRoot, 'importEngine.ts'), 'utf8')

function compileNamedFunctions(source, names) {
  const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  assert.equal(declarations.length, names.length, `expected declarations: ${names.join(', ')}`)
  const output = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
  return mod.exports
}

function loadProductWrites(db) {
  const sourcePath = path.join(libRoot, 'productWrites.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './db') return { getDb: () => db }
    if (request === './media') return { sanitizeMediaList: (value) => Array.isArray(value) ? value : [] }
    if (request === './batchCode') return { dateToBatchCode: () => '11092026' }
    if (request === './searchMatch') return { normalizeSearchText: String, compactSearchText: String }
    if (request === './importImageMatch') return { MAX_IMAGES_PER_PRODUCT: 3 }
    if (request === '../index') return {}
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      mod.exports, require, mod, sourcePath, path.dirname(sourcePath),
    )
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

function extractMatchedImportStatements(source) {
  const start = source.indexOf('const matchedBatch = findImportRestockBatch(')
  const end = source.indexOf('\n              } else {', start)
  assert.ok(start >= 0 && end > start, 'matched import-restock branch must exist')
  const block = source.slice(start, end)
  const statements = [...block.matchAll(/sql: `([\s\S]*?)`/g)].map((match) => match[1])
  assert.equal(statements.length, 2, 'matched restock branch should contain metadata activation then lot-stock top-up')
  assert.match(statements[0], /UPDATE product_batches SET received_at = COALESCE\(NULLIF\(received_at,''\), @receivedAt\), is_active = 1/)
  assert.match(statements[0], /unit_cost_usd = COALESCE\(unit_cost_usd, @unitCostUsd\)/)
  assert.match(statements[1], /INSERT INTO branch_batch_stock/)
  return statements
}

function installPositiveLotGuard(db) {
  db.exec(`
    CREATE TRIGGER test_positive_lot_requires_active_parent_insert
    BEFORE INSERT ON branch_batch_stock
    WHEN NEW.quantity > 0 AND NOT EXISTS (
      SELECT 1 FROM product_batches pb WHERE pb.id = NEW.batch_id AND pb.is_active = 1
    )
    BEGIN SELECT RAISE(ABORT, 'positive lot stock requires active parent'); END;

    CREATE TRIGGER test_positive_lot_requires_active_parent_update
    BEFORE UPDATE OF quantity ON branch_batch_stock
    WHEN NEW.quantity > 0 AND NOT EXISTS (
      SELECT 1 FROM product_batches pb WHERE pb.id = NEW.batch_id AND pb.is_active = 1
    )
    BEGIN SELECT RAISE(ABORT, 'positive lot stock requires active parent'); END;
  `)
}

async function main() {
  const { indexImportRestockBatches, findImportRestockBatch } = compileNamedFunctions(
    importSource,
    ['str', 'lower', 'indexImportRestockBatches', 'findImportRestockBatch'],
  )
  const inactiveExact = { id: 9, variant_product_id: 1, batch_key: 'LOT-1', lot_code: 'lot-1', received_at: '2025-01-02', is_active: 0 }
  const activeDisplayTwin = { id: 5, variant_product_id: 1, batch_key: 'legacy-active', lot_code: 'Lot-1', received_at: '2026-02-03', is_active: 1 }
  const inactiveFallback = { id: 3, variant_product_id: 2, batch_key: 'legacy-three', lot_code: 'Same Lot', received_at: '2024-04-05', is_active: 0 }
  const inactiveFallbackLater = { id: 8, variant_product_id: 2, batch_key: 'legacy-eight', lot_code: 'same lot', received_at: '2024-04-06', is_active: 0 }
  const index = indexImportRestockBatches([inactiveExact, activeDisplayTwin, inactiveFallbackLater, inactiveFallback])
  assert.equal(findImportRestockBatch(index, 1, 'LOT-1').id, 9, 'exact inactive UNIQUE owner must win over an active display-equivalent row')
  assert.equal(findImportRestockBatch(index, 1, 'lot-1').id, 5, 'normalized fallback should prefer the active representative')
  assert.equal(findImportRestockBatch(index, 2, ' SAME LOT ').id, 3, 'inactive-only normalized fallback should choose the stable lowest id')
  assert.equal(findImportRestockBatch(index, 2, ''), null)
  assert.match(importSource, /SELECT id, variant_product_id, batch_key, lot_code, received_at, is_active FROM product_batches`/,
    'additive import lookup must include inactive rows rather than filtering is_active=1')

  const db = openDb(loadAll())
  db.exec(`
    INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO products(id,name,stock_quantity,is_active) VALUES(1,'Import item',0,1),(2,'Create item',3,1),(3,'Rollback item',2,1);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,notes,batch_number,unit_cost_usd,received_quantity,received_cost_usd,received_branch_id)
    VALUES
      (90,1,'LOT-1','Original label','2025-01-02',0,'Original import receipt',4,7.5,4,30,1),
      (91,2,'initial:2','Original initial','2025-03-04',0,'Original initial receipt',7,6.5,3,19.5,1),
      (92,3,'initial:3','Rollback initial','2025-05-06',0,'Rollback receipt',8,4.5,2,9,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(90,1,0);
  `)
  installPositiveLotGuard(db)

  const [metadataSql, lotStockSql] = extractMatchedImportStatements(importSource)
  const importParams = {
    id: 90, receivedAt: '2026-09-11', updatedAt: '2026-09-11T07:00:00.000Z',
    unitCostUsd: 99, qty: 2, branchId: 1, batchId: 90,
  }
  await db.batch([{ sql: metadataSql, params: importParams }, { sql: lotStockSql, params: importParams }])
  const importedLot = { ...db.prepare(`SELECT lot_code,received_at,is_active,notes,batch_number,unit_cost_usd,received_quantity,received_cost_usd,received_branch_id FROM product_batches WHERE id=90`).get() }
  assert.deepEqual(importedLot, {
    lot_code: 'Original label', received_at: '2025-01-02', is_active: 1, notes: 'Original import receipt',
    batch_number: 4, unit_cost_usd: 7.5, received_quantity: 6, received_cost_usd: 228, received_branch_id: 1,
  }, 'reactivation must preserve the original date, label, notes, number and established unit cost')
  assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=90 AND branch_id=1').get().quantity, 2)

  const productWrites = loadProductWrites(db)
  await productWrites.seedInitialBatchForNewProduct({ DB: {} }, 2, 1, 3)
  const initialLot = { ...db.prepare(`SELECT lot_code,received_at,is_active,notes,batch_number,unit_cost_usd,received_quantity,received_cost_usd FROM product_batches WHERE id=91`).get() }
  assert.deepEqual(initialLot, {
    lot_code: 'Original initial', received_at: '2025-03-04', is_active: 1, notes: 'Original initial receipt',
    batch_number: 7, unit_cost_usd: 6.5, received_quantity: 3, received_cost_usd: 19.5,
  }, 'initial-lot retry must reactivate without rewriting receipt/date/cost identity')
  assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=91 AND branch_id=1').get().quantity, 3)
  await productWrites.seedInitialBatchForNewProduct({ DB: {} }, 2, 1, 3)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id=2 AND batch_key=\'initial:2\'').get().n, 1)
  assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=91 AND branch_id=1').get().quantity, 3,
    'retry must not double the original initial quantity')

  db.exec(`
    CREATE TRIGGER test_force_initial_lot_stock_failure
    BEFORE INSERT ON branch_batch_stock WHEN NEW.batch_id=92
    BEGIN SELECT RAISE(ABORT, 'forced initial lot failure'); END;
  `)
  await assert.rejects(
    productWrites.seedInitialBatchForNewProduct({ DB: {} }, 3, 1, 2),
    /forced initial lot failure/,
  )
  assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=92').get().is_active, 0,
    'failed lot-stock insert must roll back the preceding reactivation')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_batch_stock WHERE batch_id=92').get().n, 0)

  console.log('PASS inactive additive-import lot selection, atomic reactivation/top-up, initial-lot retry identity, idempotency and rollback')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
