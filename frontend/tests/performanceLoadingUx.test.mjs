import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
const contactsShared = fs.readFileSync(new URL('../src/components/contacts/shared.jsx', import.meta.url), 'utf8')
const customers = fs.readFileSync(new URL('../src/components/contacts/CustomersTab.jsx', import.meta.url), 'utf8')
const suppliers = fs.readFileSync(new URL('../src/components/contacts/SuppliersTab.jsx', import.meta.url), 'utf8')
const delivery = fs.readFileSync(new URL('../src/components/contacts/DeliveryTab.jsx', import.meta.url), 'utf8')
const sales = fs.readFileSync(new URL('../src/components/sales/Sales.jsx', import.meta.url), 'utf8')
const returns = fs.readFileSync(new URL('../src/components/returns/Returns.jsx', import.meta.url), 'utf8')
const branches = fs.readFileSync(new URL('../src/components/branches/Branches.jsx', import.meta.url), 'utf8')
const loaders = fs.readFileSync(new URL('../src/utils/loaders.mjs', import.meta.url), 'utf8')

assert.match(app, /const WARMUP_PAGE_IDS = \[\s*'products',[\s\S]*'backup',[\s\S]*\]/, 'background chunk warmup should target the primary day-to-day pages only')
assert.match(app, /Page bundle is still loading/, 'page loader should explain stalled chunk loads')
assert.match(app, /console\.warn\('\[PageLoader\]/, 'page loader should expose diagnostic breadcrumbs')
assert.match(app, /const CHUNK_IMPORT_TIMEOUT_MS = 15000/, 'chunk timeout should allow slow mobile networks before showing stalled UI')
assert.match(app, /buildChunkRecoveryUrl/, 'chunk recovery should use a cache-busting recovery URL')
assert.match(app, /window\.history\.replaceState/, 'successful boot should clean recovery params from the URL')
assert.match(app, /business_os_page_loader_retry:\$\{window\.location\.pathname\}:\$\{FRONTEND_BUILD_HASH \|\| 'dev'\}/, 'page loader retries should be scoped per build hash')
assert.match(app, /window\.location\.replace\(target\)/, 'stalled chunk recovery should use hard location replacement')

assert.match(inventory, /inventory-history-row/, 'inventory history controls should live on their own row')
assert.doesNotMatch(inventory, /<ActionHistoryBar history=\{actionHistory\} className="shrink-0"/, 'inventory filter/search row should not contain inline ActionHistoryBar')
assert.match(inventory, /inventory-history-row[\s\S]{0,160}<ActionHistoryBar/, 'inventory history controls should render inside the dedicated history row')

assert.match(backup, /useState\('all'\)/, 'Backup should default to the lightweight overview tab without showing duplicate All and Overview tabs')
assert.match(backup, /BackupOverview/, 'Backup overview should provide lightweight section entry points')
assert.doesNotMatch(backup, /function DataFolderLocation/, 'unused backup data-folder UI should not remain in the bundle')
assert.doesNotMatch(backup, /function ScaleMigrationSection/, 'unused backup migration UI should not remain in the bundle')
assert.doesNotMatch(backup, /backupSection === 'all' \|\|/, 'Backup sections should not mount every tool in overview mode')

assert.match(contactsShared, /LoadingWatchdog/, 'shared contact table should use retryable loading watchdog UI')
assert.match(customers, /generateCustomerMembershipNumber/, 'customer form should auto-generate membership numbers')
assert.match(customers, /Regenerate/, 'customer form should let staff regenerate membership numbers')
assert.match(loaders, /const DEFAULT_LOADER_TIMEOUT_MS = 20_000/, 'loader timeout should give slow pages enough time before failing first render')
const appContext = fs.readFileSync(new URL('../src/AppContext.jsx', import.meta.url), 'utf8')
assert.match(appContext, /RUNTIME_RECOVERY_SESSION_KEY/, 'runtime mismatch recovery should guard against reload loops')
assert.match(appContext, /window\.location\.replace\(url\.toString\(\)\)/, 'runtime mismatch should heal through a hard reload once')
for (const [name, source] of [
  ['Customers', customers],
  ['Suppliers', suppliers],
  ['Delivery', delivery],
]) {
  assert.match(source, /onRetry=\{\(\) => load\(\{ silent: false/, `${name} contacts should pass retry to the table`)
  assert.match(source, /autoComplete=/, `${name} contacts should define autocomplete hints`)
  assert.doesNotMatch(source, /if \(!loadedOnceRef\.current\) \{[\s\S]{0,240}loadedOnceRef\.current = true/, `${name} contacts should not lock in a failed first load as a completed render`)
}
for (const [name, source] of [
  ['Inventory', inventory],
  ['Sales', sales],
  ['Returns', returns],
  ['Branches', branches],
]) {
  assert.doesNotMatch(source, /set(?:Summary|Movements|Rows|Sales)\(\[\]\)[\s\S]{0,120}loadedOnceRef\.current = true/, `${name} should preserve the previous dataset when a refresh fails`)
}

console.log('PASS performance loading UX guards')
