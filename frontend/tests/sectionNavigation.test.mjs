import assert from 'node:assert/strict'
import fs from 'node:fs'

const sectionSwitcher = fs.readFileSync(new URL('../src/components/shared/SectionSwitcher.jsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/utils-settings/Settings.jsx', import.meta.url), 'utf8')
const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
const loyalty = fs.readFileSync(new URL('../src/components/loyalty-points/LoyaltyPointsPage.jsx', import.meta.url), 'utf8')
const loadingWatchdog = fs.readFileSync(new URL('../src/components/shared/LoadingWatchdog.jsx', import.meta.url), 'utf8')

assert.match(sectionSwitcher, /export default function SectionSwitcher/)
assert.match(sectionSwitcher, /value = 'all'/)
assert.match(sectionSwitcher, /localStorage/)
assert.match(sectionSwitcher, /All/)

for (const [name, source] of [
  ['Inventory', inventory],
  ['Settings', settings],
  ['Loyalty', loyalty],
]) {
  assert.match(source, /SectionSwitcher/, `${name} should use the shared section switcher`)
  assert.match(source, /sectionStorageKey|storageKey/, `${name} should persist focused section state`)
  assert.match(source, /LoadingWatchdog/, `${name} should use the loading watchdog`)
}

assert.match(backup, /SectionSwitcher/, 'Backup should use the shared section switcher')
assert.doesNotMatch(backup, /sectionStorageKey|storageKey/, 'Backup should not auto-restore heavy sections on page entry')
assert.match(backup, /LoadingWatchdog/, 'Backup should use the loading watchdog')

assert.match(inventory, /label: 'All'/)
assert.doesNotMatch(inventory, /Stats \+ sections/)
assert.match(inventory, /showInventorySections/)
assert.match(inventory, /showInventoryTabs/)
assert.match(inventory, /showProductsSection/)
assert.match(inventory, /inventorySection === 'stats'/)
assert.match(inventory, /RFID_SECTION_OPTIONS/)
assert.match(inventory, /Overview/)
assert.match(inventory, /Tagging/)
assert.match(inventory, /Stock Count/)
assert.match(inventory, /Exceptions/)
assert.match(inventory, /Sessions/)

assert.match(loadingWatchdog, /Still loading/)
assert.match(loadingWatchdog, /onRetry/)
assert.match(loadingWatchdog, /timeoutMs/)

console.log('PASS focused section navigation and loading watchdog are wired')
