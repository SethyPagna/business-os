const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const sourceRoot = path.join(__dirname, '../src/lib')
const modules = new Map()
function load(name) {
  if (name === './db') return { getDb: () => adapter }
  if (name === './passwordHash') return {}
  if (modules.has(name)) return modules.get(name)
  const source = fs.readFileSync(path.join(sourceRoot, name + '.ts'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', output)(load, exports)
  modules.set(name, exports)
  return exports
}
const db = new Database(':memory:')
const directory = path.join(__dirname, '../migrations')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < '0242').sort()) {
  db.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
}
db.exec(`INSERT INTO branches(id,name,is_active) VALUES(900001,'Retired branch',0);
  INSERT INTO products(id,name,name_key,is_active,stock_quantity) VALUES
  (900001,'Cache','cache',0,1),(900002,'Branch','branch',0,0),(900003,'Lot','lot',0,0),
  (900004,'Damaged','damaged',0,0),(900005,'Active empty','active empty',1,0),(900006,'Inactive empty','inactive empty',0,0);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900002,900001,2);
  INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at) VALUES(900001,900003,'lot',1,'2026-10-01');
  INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,3);
  INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(900004,900001,4);`)
const adapter = { prepare(sql) { const stmt = db.prepare(sql); return { all: async params => stmt.all(params ?? {}), get: async params => stmt.get(params ?? {}) } } }
function functionsFrom(relative, names, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8')
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  assert.equal(functions.length, names.length)
  const output = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(dependencies), `${output}; return {${names.join(',')}}`)(...Object.values(dependencies))
}
async function main() {
  const family = load('./familyStockStats')
  const lowStock = { enabled: true, threshold: 10, scope: 'global' }
  const overview = await family.getFamilyStockOverview({ db: adapter, lowStock, previewSize: 20 })
  assert.equal(overview.stats.total_products, 5, 'four inactive stocked products remain visible, empty inactive excluded')
  const alerts = [...overview.low.items, ...overview.out.items].map(row => row.id).sort()
  assert.deepEqual(alerts, [900001,900002,900003,900004,900005])
  db.exec("UPDATE products SET expiry_date=date('now'),expiry_alert_days=30")
  const dashboard = await load('./dashboardStockOverview').computeDashboardStockOverview({}, lowStock)
  assert.equal(dashboard.expiringCount, 5)
  assert.deepEqual(dashboard.expiring.map(row => row.id).sort(), [900001,900002,900003,900004,900005])
  const settings = load('./lowStockSettings')
  const guard = load('./productStockGuard')
  const deps = { getDb: () => adapter, ...settings, ...guard }
  const insights = functionsFrom('routes/compat.ts', ['dashboardInsightList'], {
    ...deps, ...load('./dashboardStockOverview'), dateRange: () => ({}), DASHBOARD_INSIGHT_LIST_LIMIT: 300,
  })
  assert.equal((await insights.dashboardInsightList({}, {}, 'expiring_products')).items.length, 5)
  const notifications = functionsFrom('routes/notifications.ts', ['buildInventorySection', 'buildExpirySection'], {
    ...deps, joinSummary: items => items.filter(Boolean).join(', '),
  })
  assert.equal((await notifications.buildInventorySection({}, lowStock, 20)).count, 5)
  assert.equal((await notifications.buildExpirySection({}, 30)).count, 5)
  const search = load('./productSearchQuery')
  const rankedParams = {}
  const ranked = search.buildProductSearchQuery('', rankedParams, { rankedIds: { ids: [900001,900002,900003,900004,900005,900006], tiers: [] } })
  const listed = db.prepare(`SELECT id FROM products p WHERE ${ranked.activeWhereSql} AND ${ranked.whereClause} ORDER BY id`).all({ rankIdList: rankedParams.rankIdList })
  assert.deepEqual(listed.map(row => row.id), [900001,900002,900003,900004,900005])
  const catalogParams = {}
  const catalog = search.buildProductSearchQuery('', catalogParams, { catalogOnly: true, rankedIds: { ids: [900001,900002,900003,900004,900005,900006], tiers: [] } })
  assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${catalog.activeWhereSql} AND ${catalog.whereClause} ORDER BY id`).all({ rankIdList: catalogParams.rankIdList }).map(row => row.id), [900005], 'catalog excludes removal identities even when physical diagnostics retain their stock')
  const branch = functionsFrom('routes/branches.ts', ['buildBranchStockWhere'], { ...deps, ...search })
  for (const query of [{}, { rankIds: '900001,900002,900003,900004,900005,900006' }]) {
    const where = branch.buildBranchStockWhere({ req: { query: key => query[key] } }, 900001, lowStock, { includeStockState: false })
    const params = query.rankIds ? { rankIdList: where.params.rankIdList } : {}
    assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${where.where.join(' AND ')} ORDER BY id`).all(params).map(row => row.id), [900001,900002,900003,900004,900005])
  }
  const telegram = functionsFrom('lib/telegram.ts', ['inventorySummaryReport'], {
    ...deps, loadLowStockConfig: async () => lowStock, withLanguage: (_language, render) => render(),
    reportTitle: () => '', sectionHeader: () => '', labeled: (key, value) => `${key}:${value}`,
    REPORT_SECTION_EDGE: '', EMPTY_SECTION: '',
  })
  assert.match(await telegram.inventorySummaryReport({}, 'en'), /activeProducts:5/)
  const health = load('./coreDataInvariants')
  assert.equal(db.prepare(health.INACTIVE_PRODUCT_STOCK_COUNT_SQL).get().count, 4)
  const query = fs.readFileSync(path.join(__dirname, '../../ops/queries/inactive-products-with-stock.sql'), 'utf8')
  const findings = db.prepare(query).all()
  assert.deepEqual(findings.map(row => row.product_id), [900001,900002,900003,900004])
  for (const row of findings) {
    assert.equal(row.cache_has_stock + row.branch_has_stock + row.lot_has_stock + row.damaged_has_stock, 1)
  }
  console.log('PASS family overview and alerts retain each stock ledger independently')
  console.log('PASS health and Ops query diagnose every independent ledger without mutations')
  console.log('PASS dashboard, notifications, Telegram and ordinary/ranked branch readers retain all four ledgers')
  db.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
