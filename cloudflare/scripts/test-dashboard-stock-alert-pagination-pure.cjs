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

async function run() {
  const db = openDb(loadAll())
  const familyPagination = loadReal('lib/familyPagination.ts', { './db': {} })
  const lowStockSettings = loadReal('lib/lowStockSettings.ts', { './db': {} })
  const familyStockStats = loadReal('lib/familyStockStats.ts', {
    './familyPagination': familyPagination,
    './lowStockSettings': lowStockSettings,
  })

  const insert = async (name, quantity, low = 10, out = 0) => db.prepare(`
    INSERT INTO products (name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
    VALUES (@name, 'Test', 'pcs', @quantity, @low, @out, 1)
  `).run({ name, quantity, low, out })

  // A low-looking row in a family with a healthy sibling must disappear:
  // family classification happens before filtering and pagination.
  await insert('Healthy Family', 4)
  await insert('Healthy Family', 20)
  await insert('Low Family A', 3)
  await insert('Low Family A', 4)
  await insert('Low Family B', 2)
  await insert('Out Family A', 0)
  await insert('Out Family A', -1)
  await insert('Out Family B', 0)

  const lowStock = { enabled: true, mode: 'product', threshold: 10 }
  const low1 = await familyStockStats.getFamilyStockAlertPage({ db, lowStock, state: 'low', page: 1, pageSize: 1 })
  const low2 = await familyStockStats.getFamilyStockAlertPage({ db, lowStock, state: 'low', page: 2, pageSize: 1 })
  assert.equal(low1.total, 2)
  assert.equal(low1.totalPages, 2)
  assert.equal(low1.hasMore, true)
  assert.equal(low2.hasMore, false)
  assert.equal(new Set([...low1.items, ...low2.items].map((row) => row.name)).size, 2, 'pages append distinct family representatives')
  assert.ok(![...low1.items, ...low2.items].some((row) => row.name === 'Healthy Family'), 'best-status-wins excludes a low member of a healthy family')

  const out = await familyStockStats.getFamilyStockAlertPage({ db, lowStock, state: 'out', page: 1, pageSize: 10 })
  assert.equal(out.total, 2)
  assert.equal(out.items.length, 2)
  assert.deepEqual(out.items.map((row) => row.name).sort(), ['Out Family A', 'Out Family B'])

  const compat = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'compat.ts'), 'utf8')
  assert.match(compat, /app\.get\('\/dashboard\/stock-alerts'/)
  assert.match(compat, /denyUnless\(c, 'dashboard'\)/, 'stock paging remains available to dashboard-only users')
  assert.match(compat, /app\.get\('\/dashboard\/stock-alerts'[\s\S]*getFamilyStockAlertPage\(\{[\s\S]*state: rawState as FamilyStockAlertState,[\s\S]*page,[\s\S]*pageSize,/s)
  console.log('PASS dashboard stock alerts classify families before stable pagination')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
