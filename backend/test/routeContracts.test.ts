'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function getRoutePaths(router) {
  return (router.stack || [])
    .map((layer) => layer?.route?.path)
    .filter(Boolean)
}

runTest('product router registers required paged search routes', () => {
  const router = require('../src/routes/products.ts')
  const source = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/products.ts'), 'utf8')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/bootstrap'), 'missing /api/products/bootstrap')
  assert.ok(paths.includes('/search'), 'missing /api/products/search')
  assert.ok(paths.includes('/filters'), 'missing /api/products/filters')
  assert.ok(paths.indexOf('/bootstrap') < paths.indexOf('/'), '/bootstrap must be registered before root route')
  assert.ok(paths.indexOf('/search') < paths.indexOf('/'), '/search must be registered before root route')
  assert.match(source, /COALESCE\(p\.name,\s*''\)/, 'initial search must use a SQL string literal fallback')
  assert.doesNotMatch(source, /COALESCE\(p\.name,\s*""\)/, 'initial search must not use double-quoted identifiers')
  assert.match(source, /\['brand', 'category', 'unit', 'supplier'\]/, 'product search should support unit lookup filtering')
  assert.doesNotMatch(source, /if \(!resolvedKey\) return/, 'lookup usage must skip blank product values without aborting the whole usage scan')
})

runTest('inventory router registers required paged product search route', () => {
  const router = require('../src/routes/inventory.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/bootstrap'), 'missing /api/inventory/bootstrap')
  assert.ok(paths.includes('/products/search'), 'missing /api/inventory/products/search')
  assert.ok(paths.indexOf('/bootstrap') < paths.indexOf('/products/search'), '/bootstrap must be registered before product search')
  assert.ok(paths.includes('/rfid/status'), 'missing /api/inventory/rfid/status')
  assert.ok(paths.includes('/rfid/tags'), 'missing /api/inventory/rfid/tags')
  assert.ok(paths.includes('/rfid/tags/search'), 'missing /api/inventory/rfid/tags/search')
  assert.ok(paths.includes('/rfid/sessions'), 'missing /api/inventory/rfid/sessions')
  assert.ok(paths.includes('/rfid/sessions/:id/events'), 'missing /api/inventory/rfid/sessions/:id/events')
  assert.ok(paths.includes('/rfid/sessions/:id/review'), 'missing /api/inventory/rfid/sessions/:id/review')
  assert.ok(paths.includes('/rfid/sessions/:id/apply'), 'missing /api/inventory/rfid/sessions/:id/apply')
})

runTest('inventory movement history allows large import batches', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')
  assert.match(source, /req\.query\.limit \|\| '50000'/)
  assert.match(source, /normalizePositiveInt\(requestedPageSize,\s*50000,\s*\{\s*min:\s*1,\s*max:\s*50000\s*\}\)/)
})

runTest('portal router registers required public catalog search route', () => {
  const router = require('../src/routes/portal.ts')
  const source = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/portal.ts'), 'utf8')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/catalog/products/search'), 'missing /api/portal/catalog/products/search')
  assert.ok(paths.indexOf('/catalog/products/search') > paths.indexOf('/catalog/products'), 'public search route should be explicit and registered')
  assert.match(source, /COALESCE\(p\.name,\s*''\)/, 'public initial search must use a SQL string literal fallback')
  assert.doesNotMatch(source, /COALESCE\(p\.name,\s*""\)/, 'public initial search must not use double-quoted identifiers')
})

runTest('auth router registers Google OAuth start and completion routes', () => {
  const router = require('../src/routes/auth.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/oauth/start'), 'missing /api/auth/oauth/start')
  assert.ok(paths.includes('/oauth/complete'), 'missing /api/auth/oauth/complete')
})

runTest('organizations router registers bootstrap, search, and current context routes', () => {
  const router = require('../src/routes/organizations.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/bootstrap'), 'missing /api/organizations/bootstrap')
  assert.ok(paths.includes('/search'), 'missing /api/organizations/search')
  assert.ok(paths.includes('/current'), 'missing /api/organizations/current')
})

runTest('catalog router registers meta and product read routes', () => {
  const router = require('../src/routes/catalog.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/meta'), 'missing /api/catalog/meta')
  assert.ok(paths.includes('/products'), 'missing /api/catalog/products')
})

runTest('runtime router registers version and diagnostics routes', () => {
  const router = require('../src/routes/runtime.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/version'), 'missing /api/runtime/version')
  assert.ok(paths.includes('/queues/status'), 'missing /api/runtime/queues/status')
  assert.ok(paths.includes('/catalog-integrity'), 'missing /api/runtime/catalog-integrity')
})

runTest('notifications router registers summary route', () => {
  const router = require('../src/routes/notifications.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/summary'), 'missing /api/notifications/summary')
})

runTest('sales router registers combined dashboard startup route', () => {
  const router = require('../src/routes/sales.ts')
  const source = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/sales.ts'), 'utf8')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/dashboard'), 'missing /api/dashboard summary route')
  assert.ok(paths.includes('/analytics'), 'missing /api/analytics route')
  assert.ok(paths.includes('/dashboard/startup'), 'missing /api/dashboard/startup route')
  assert.match(source, /function buildDashboardSummary\(\)/)
  assert.match(source, /function buildDashboardAnalytics\(startDate, endDate, granularity = 'day'\)/)
  assert.match(source, /summary: buildDashboardSummary\(\)/)
  assert.match(source, /analytics: buildDashboardAnalytics\(startDate, endDate, granularity\)/)
})

runTest('SPA shell sends route-owned modulepreload hints for direct visits', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.ts'), 'utf8')
  assert.match(source, /const SPA_ADMIN_MODULE_PRELOAD_CHUNKS = \['app-bootstrap', 'app-auth'\]/)
  assert.match(source, /const SPA_ADMIN_FIRST_WINDOW_CHUNKS = \[[\s\S]*'AdminRoot'[\s\S]*'app-api'[\s\S]*'api-http-core'[\s\S]*'Sidebar'[\s\S]*\]/)
  assert.doesNotMatch(source.match(/const SPA_ADMIN_FIRST_WINDOW_CHUNKS = \[[\s\S]*?\]/)?.[0] || '', /'auth-login'|'catalog-icons'/)
  assert.match(source, /routePath\.startsWith\('\/login'\), chunks: \['auth-login'\]/)
  assert.match(source, /const isPublicPortalRoute = normalizedPath\.startsWith\('\/public'\) \|\| normalizedPath\.startsWith\('\/customer-portal'\)/)
  assert.match(source, /const baseChunks = isPublicPortalRoute \? \[\] : \[\.\.\.SPA_ADMIN_MODULE_PRELOAD_CHUNKS, \.\.\.SPA_ADMIN_FIRST_WINDOW_CHUNKS\]/)
  assert.match(source, /routePath\.startsWith\('\/pos'\), chunks: \['POS', 'product-read-api', 'product-shared', 'productDisplayHelpers', 'route-sync-utils', 'settings-refresh', 'app-api', 'shared-lazy-portal-menu', 'shared-ui'\]/)
  assert.match(source, /routePath\.startsWith\('\/products'\), chunks: \['Products', 'product-read-api', 'product-shared', 'productDisplayHelpers', 'shared-action-history', 'route-sync-utils', 'settings-refresh', 'app-api', 'shared-lazy-portal-menu', 'shared-ui'\]/)
  assert.match(source, /routePath\.startsWith\('\/inventory'\), chunks: \['Inventory', 'InventoryProductsSurface', 'inventory-api', 'product-shared', 'shared-action-history', 'shared-formatters', 'route-sync-utils', 'settings-refresh', 'app-api', 'shared-lazy-portal-menu', 'shared-ui'\]/)
  assert.match(source, /routePath\.startsWith\('\/branches'\), chunks: \['Branches', 'branch-api', 'product-shared', 'shared-action-history', 'shared-page-header', 'route-sync-utils', 'settings-refresh', 'app-api', 'api-local-cache', 'shared-lazy-portal-menu', 'shared-ui'\]/)
  assert.doesNotMatch(source, /routePath\.startsWith\('\/(?:pos|products|inventory|branches|audit-log)'\), chunks: \[[^\]]*'lang-en'/)
  assert.match(source, /routePath\.startsWith\('\/files'\), chunks: \['FilesPage', 'file-api', 'ai-api', 'multipart-headers-api', 'route-sync-utils', 'settings-refresh', 'shared-ui', 'shared-action-history', 'shared-page-header'/)
  assert.match(source, /routePath\.startsWith\('\/users'\), chunks: \['Users', 'user-admin-api', 'user-read-api', 'user-permission-definitions', 'route-sync-utils', 'shared-action-history', 'shared-formatters', 'shared-ui'/)
  assert.match(source, /routePath\.startsWith\('\/audit-log'\), chunks: \['AuditLog', 'audit-log-api', 'refresh-cw', 'monitor-smartphone', 'route-sync-utils', 'settings-refresh', 'shared-ui'/)
  assert.match(source, /routePath\.startsWith\('\/public'\)[\s\S]*chunks: \[[\s\S]*'app-portal'[\s\S]*'app-shell'[\s\S]*'shared-ui'[\s\S]*'shared-lazy-portal-menu'[\s\S]*'catalog-public-core'[\s\S]*'catalog-public-utils'[\s\S]*'catalog-public'[\s\S]*'catalog-icons'[\s\S]*'catalog-products'[\s\S]*\]/)
  assert.match(source, /'catalog-products-',[\s\S]*'catalog-public-',[\s\S]*'catalog-secondary-tabs-',[\s\S]*'catalog-'/)
  assert.match(source, /'app-api': \['methods'\]/)
  assert.match(source, /catalog: \['context', 'display', 'editor', 'icons', 'preview', 'products', 'public', 'secondary-tabs', 'ui'\]/)
  assert.match(source, /const FRONTEND_CHUNK_BASE_COLLISIONS = \{[\s\S]*catalog: \['context', 'display', 'editor', 'icons', 'preview', 'products', 'public', 'secondary-tabs', 'ui'\]/)
  assert.match(source, /function resolveFrontendChunkAssetName\(chunkBase = ''\)/)
  assert.match(source, /function appendSpaModulePreloadHeaders\(req, res\)/)
  assert.match(source, /return sendSpaIndex\(req, res, next\)/)
})

runTest('files router registers list, upload, and delete routes', () => {
  const router = require('../src/routes/files.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/'), 'missing /api/files list route')
  assert.ok(paths.includes('/upload'), 'missing /api/files/upload')
  assert.ok(paths.includes('/:id'), 'missing /api/files/:id delete route')
})

runTest('categories router registers lookup CRUD routes', () => {
  const router = require('../src/routes/categories.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/'), 'missing /api/categories list/create route')
  assert.ok(paths.includes('/:id'), 'missing /api/categories/:id update/delete route')
})

runTest('units router registers lookup CRUD routes', () => {
  const { unitsRouter } = require('../src/routes/units.ts')
  const paths = getRoutePaths(unitsRouter)
  assert.ok(paths.includes('/'), 'missing /api/units list/create route')
  assert.ok(paths.includes('/:id'), 'missing /api/units/:id update/delete route')
})

runTest('system router registers Google Drive sync connect and disconnect routes', () => {
  const router = require('../src/routes/system/index.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/drive-sync/status'), 'missing /api/system/drive-sync/status')
  assert.ok(paths.includes('/drive-sync/oauth/start'), 'missing /api/system/drive-sync/oauth/start')
  assert.ok(paths.includes('/drive-sync/oauth/callback'), 'missing /api/system/drive-sync/oauth/callback')
  assert.ok(paths.includes('/drive-sync/disconnect'), 'missing /api/system/drive-sync/disconnect')
  assert.ok(paths.includes('/drive-sync/forget-credentials'), 'missing /api/system/drive-sync/forget-credentials')
  assert.ok(paths.includes('/drive-sync/sync-now'), 'missing /api/system/drive-sync/sync-now')
  assert.ok(paths.includes('/drive-sync/jobs'), 'missing /api/system/drive-sync/jobs')
  assert.ok(paths.includes('/storage-mode'), 'missing /api/system/storage-mode')
})

runTest('system router registers non-blocking job and backup routes', () => {
  const router = require('../src/routes/system/index.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/jobs/:id'), 'missing /api/system/jobs/:id')
  assert.ok(paths.includes('/jobs/:id/cancel'), 'missing /api/system/jobs/:id/cancel')
  assert.ok(paths.includes('/jobs'), 'missing /api/system/jobs')
  assert.ok(paths.includes('/backups'), 'missing /api/system/backups')
  assert.ok(paths.includes('/backups/:id'), 'missing /api/system/backups/:id')
  assert.ok(paths.includes('/backups/:id/restore'), 'missing /api/system/backups/:id/restore')
})

runTest('system router exposes paged audit logs and retention cleanup', () => {
  const router = require('../src/routes/system/index.ts')
  const paths = getRoutePaths(router)
  const source = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/system/index.ts'), 'utf8')
  assert.ok(paths.includes('/audit-logs'), 'missing /api/system/audit-logs')
  assert.ok(paths.includes('/audit-logs/retention'), 'missing /api/system/audit-logs/retention')
  assert.match(source, /COUNT\(\*\)[\s\S]*FROM audit_logs/)
  assert.match(source, /pageSize/)
  assert.match(source, /userId/)
  assert.match(source, /isAdminControlUser/)
  assert.match(source, /olderThanDays/)
})

runTest('system settings writes reuse prepared statements inside transactions', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/system/index.ts'), 'utf8')
  assert.match(source, /const upsert = db\.prepare\(`[\s\S]*INSERT INTO settings/)
  assert.match(source, /const deleteSetting = db\.prepare\('DELETE FROM settings WHERE key = \?'\)/)
  assert.match(source, /if \(value == null\) deleteSetting\.run\(key\)/)
  assert.doesNotMatch(source, /if \(value == null\) db\.prepare\('DELETE FROM settings WHERE key = \?'\)\.run\(key\)/)
})

runTest('settings route caches updated_at schema metadata', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/settings.ts'), 'utf8')
  const router = require('../src/routes/settings.ts')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/'), 'missing /api/settings read/write route')
  assert.ok(paths.includes('/meta'), 'missing /api/settings/meta route')
  assert.match(source, /const \{ hasColumn \} = require\('\.\.\/schemaMetadata\.ts'\)/)
  assert.match(source, /return hasColumn\('settings', 'updated_at'\)/)
  assert.doesNotMatch(source, /information_schema\.columns/)
})

runTest('branch and inventory routes cache stock transfer note metadata', () => {
  const fs = require('fs')
  const path = require('path')
  const branchesSource = fs.readFileSync(path.join(__dirname, '../src/routes/branches.ts'), 'utf8')
  const inventorySource = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')
  assert.match(branchesSource, /const \{ firstExistingColumn \} = require\('\.\.\/schemaMetadata\.ts'\)/)
  assert.match(branchesSource, /return firstExistingColumn\('stock_transfers', \['notes', 'note'\]\)/)
  assert.match(inventorySource, /const \{ firstExistingColumn \} = require\('\.\.\/schemaMetadata\.ts'\)/)
  assert.match(inventorySource, /return firstExistingColumn\('stock_transfers', \['note', 'notes', 'reason'\]\)/)
  assert.doesNotMatch(branchesSource, /information_schema\.columns/)
  assert.doesNotMatch(inventorySource, /information_schema\.columns/)
})

runTest('inventory stock writes index active branches per request', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')
  assert.match(source, /function buildActiveBranchIndex\(rows = \[\]\)/)
  assert.match(source, /const activeBranchIndex = buildActiveBranchIndex\(activeBranches\)/)
  assert.match(source, /activeBranchIndex\.byId\.get\(Number\(targetBranchId\)\)/)
  assert.match(source, /activeBranchIndex\.byId\.get\(Number\(requestedBranchId\)\)/)
  assert.doesNotMatch(source, /activeBranches\.find\(\(branch\) => branch\.id === targetBranchId\)/)
  assert.doesNotMatch(source, /activeBranches\.find\(\(entry\) => Number\(entry\.id\) === Number\(requestedBranchId\)\)/)
})

runTest('product import route caches settings updated_at schema metadata', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/products.ts'), 'utf8')
  assert.match(source, /const \{ hasColumn \} = require\('\.\.\/schemaMetadata\.ts'\)/)
  assert.match(source, /function settingsHasUpdatedAt\(\)/)
  assert.match(source, /return hasColumn\('settings', 'updated_at'\)/)
  assert.match(source, /const upsertSetting = settingsHasUpdatedAt\(\)/)
  assert.doesNotMatch(source, /information_schema\.columns/)
})

runTest('custom tables route caches managed column metadata', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/customTables.ts'), 'utf8')
  assert.match(source, /const \{ hasColumn, markColumnPresent \} = require\('\.\.\/schemaMetadata\.ts'\)/)
  assert.match(source, /return hasColumn\(tableName, columnName\)/)
  assert.match(source, /markColumnPresent\(tableName, 'updated_at'\)/)
  assert.doesNotMatch(source, /information_schema\.columns/)
})

runTest('shared schema metadata helper caches column probes', () => {
  const fs = require('fs')
  const path = require('path')
  const source = fs.readFileSync(path.join(__dirname, '../src/schemaMetadata.ts'), 'utf8')
  assert.match(source, /const columnPresenceCache = new Map\(\)/)
  assert.match(source, /const firstColumnCache = new Map\(\)/)
  assert.match(source, /function hasColumn\(tableName, columnName\)/)
  assert.match(source, /function firstExistingColumn\(tableName, columnNames = \[\]\)/)
  assert.match(source, /function markColumnPresent\(tableName, columnName\)/)
  assert.match(source, /FROM information_schema\.columns/)
})

runTest('production routes do not bypass shared schema metadata cache', () => {
  const routesDir = path.join(__dirname, '../src/routes')
  const offenders = []
  for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    const routePath = path.join(routesDir, entry.name)
    const source = fs.readFileSync(routePath, 'utf8')
    if (/information_schema\.columns/.test(source)) offenders.push(entry.name)
  }
  assert.deepEqual(offenders, [], `routes should use schemaMetadata.ts for column probes: ${offenders.join(', ')}`)
})

runTest('activity routes include admin-only user filters for attribution review', () => {
  const fs = require('fs')
  const path = require('path')
  const salesSource = fs.readFileSync(path.join(__dirname, '../src/routes/sales.ts'), 'utf8')
  const inventorySource = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')
  const actionHistorySource = fs.readFileSync(path.join(__dirname, '../src/routes/actionHistory.ts'), 'utf8')
  assert.match(salesSource, /cashier_id\s*=\s*\?/)
  assert.match(salesSource, /isAdminControlUser/)
  assert.match(inventorySource, /user_id\s*=\s*\?/)
  assert.match(inventorySource, /isAdminControlUser/)
  assert.match(actionHistorySource, /created_by_id\s*=\s*\?/)
  assert.match(actionHistorySource, /isAdminControlUser/)
})

runTest('upload serving is local-first with bounded object-store fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
  assert.match(source, /function\s+serveLocalUpload\(/)
  assert.match(source, /function\s+getObjectStreamWithTimeout\(/)
  assert.match(source, /Object storage read timed out after/)
  assert.match(source, /function\s+findBackupUploadFallback\(/)
  assert.match(source, /fs\.copyFileSync\(fallbackPath,\s*activePath\)/)
  assert.match(source, /if\s*\(serveLocalUpload\(req,\s*res,\s*fileName,\s*activePath\)\)\s*return/)
})

runTest('sales search uses joined customer membership data instead of a missing sales column', () => {
  const fs = require('fs')
  const path = require('path')
  const salesSource = fs.readFileSync(path.join(__dirname, '../src/routes/sales.ts'), 'utf8')
  assert.match(salesSource, /MAX\(c\.membership_number\)\s+AS customer_membership_number/)
  assert.match(salesSource, /lower\(COALESCE\(c\.membership_number, ''\)\) LIKE \?/)
  assert.doesNotMatch(salesSource, /lower\(COALESCE\(s\.customer_membership_number, ''\)\) LIKE \?/)
})

runTest('sales export product summary groups every selected product identity column', () => {
  const fs = require('fs')
  const path = require('path')
  const salesSource = fs.readFileSync(path.join(__dirname, '../src/routes/sales.ts'), 'utf8')
  assert.match(salesSource, /SELECT si\.product_name,\s*si\.product_id,[\s\S]*GROUP BY si\.product_name,\s*si\.product_id ORDER BY revenue_usd DESC/)
  assert.doesNotMatch(salesSource, /SELECT si\.product_name,\s*si\.product_id,[\s\S]*GROUP BY si\.product_name ORDER BY revenue_usd DESC/)
})

runTest('server health route exposes runtime driver diagnostics', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '../server.js'), 'utf8')
  assert.match(source, /drivers:\s*\{/)
  assert.match(source, /database:\s*DATABASE_DRIVER/)
  assert.match(source, /objectStorage:\s*OBJECT_STORAGE_DRIVER/)
  assert.match(source, /analytics:\s*ANALYTICS_ENGINE/)
  assert.match(source, /parquetStore:\s*PARQUET_STORE/)
  assert.match(source, /getDuckDbRuntimeStatus/)
})

if (failed > 0) {
  process.exitCode = 1
}
