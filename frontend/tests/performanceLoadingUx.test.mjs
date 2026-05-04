import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
const contactsShared = fs.readFileSync(new URL('../src/components/contacts/shared.jsx', import.meta.url), 'utf8')
const customers = fs.readFileSync(new URL('../src/components/contacts/CustomersTab.jsx', import.meta.url), 'utf8')
const suppliers = fs.readFileSync(new URL('../src/components/contacts/SuppliersTab.jsx', import.meta.url), 'utf8')
const delivery = fs.readFileSync(new URL('../src/components/contacts/DeliveryTab.jsx', import.meta.url), 'utf8')

assert.match(app, /const WARMUP_PAGE_IDS = \[\]/, 'background chunk warmup should stay disabled to protect INP')
assert.match(app, /Page bundle is still loading/, 'page loader should explain stalled chunk loads')
assert.match(app, /console\.warn\('\[PageLoader\]/, 'page loader should expose diagnostic breadcrumbs')

assert.match(inventory, /inventory-history-row/, 'inventory history controls should live on their own row')
assert.doesNotMatch(inventory, /<ActionHistoryBar history=\{actionHistory\} className="shrink-0"/, 'inventory filter/search row should not contain inline ActionHistoryBar')
assert.match(inventory, /inventory-history-row[\s\S]{0,160}<ActionHistoryBar/, 'inventory history controls should render inside the dedicated history row')

assert.match(backup, /useState\('all'\)/, 'Backup should default to the lightweight overview tab without showing duplicate All and Overview tabs')
assert.match(backup, /BackupOverview/, 'Backup overview should provide lightweight section entry points')
assert.doesNotMatch(backup, /function DataFolderLocation/, 'unused backup data-folder UI should not remain in the bundle')
assert.doesNotMatch(backup, /function ScaleMigrationSection/, 'unused backup migration UI should not remain in the bundle')
assert.doesNotMatch(backup, /backupSection === 'all' \|\|/, 'Backup sections should not mount every tool in overview mode')

assert.match(contactsShared, /LoadingWatchdog/, 'shared contact table should use retryable loading watchdog UI')
for (const [name, source] of [
  ['Customers', customers],
  ['Suppliers', suppliers],
  ['Delivery', delivery],
]) {
  assert.match(source, /onRetry=\{\(\) => load\(\{ silent: false/, `${name} contacts should pass retry to the table`)
  assert.match(source, /autoComplete=/, `${name} contacts should define autocomplete hints`)
}

console.log('PASS performance loading UX guards')
