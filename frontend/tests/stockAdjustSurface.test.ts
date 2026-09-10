import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { batchDisplayLabel } from '../src/utils/batchLabel.ts'
import { dateEntryDisplayValue } from '../src/utils/dateEntry.ts'

const stockModals = readFileSync(new URL('../src/components/inventory/InventoryStockModals.tsx', import.meta.url), 'utf8')

const optionsStart = stockModals.indexOf('data-stock-received-date-options="true"')
const supplierStart = stockModals.indexOf('<SupplierPickerField', optionsStart)
assert.ok(optionsStart >= 0, 'Adjust Stock must expose one received-date Options control')
assert.ok(supplierStart > optionsStart, 'the received-date Options section must close before supplier receipt fields')
const optionsSection = stockModals.slice(optionsStart, supplierStart)

assert.match(optionsSection, /aria-expanded=\{receivedDateOptionsOpen\}/, 'Options must expose its expanded state')
assert.match(optionsSection, /tr\('options', 'Options', 'ជម្រើស'\)/, 'Options must retain English and Khmer copy without adding language-pack keys')
assert.match(optionsSection, /\{showBatchPicker \? \([\s\S]*batchDisplayLabel\(batch/, 'existing received-date choices must live inside Options and use the canonical display helper')
assert.match(optionsSection, /\{receivedDateInputVisible \? \([\s\S]*<DateEntryInput/, 'a new received date must be entered inside Options')
assert.doesNotMatch(stockModals, /dateToBatchCode|batch_code_preview/, 'Adjust Stock must not show the internal MMDDYYYY received-date code')
assert.doesNotMatch(stockModals, /addQuantityChoices|setAdjustForm\(f => \(\{ \.\.\.f, quantity: n \}\)\)/, 'quantity preset controls must be removed')

assert.match(
  stockModals,
  /scroll-x-clean mt-0\.5 max-w-full whitespace-nowrap[^>]*title=\{adjustModal\.name\}>\{adjustModal\.name\}<\/div>/,
  'the full Adjust Stock product name must be horizontally scrollable and non-ellipsized',
)
assert.doesNotMatch(stockModals, /<div className="truncate[^>]*>\{adjustModal\.name\}/, 'the Adjust Stock product name must not be truncated')

assert.match(stockModals, /TOOLBAR_BUTTON_BASE, toolbarIconButtonClassName/, 'Adjust Stock must consume the shared 40px button contracts')
assert.match(stockModals, /onClick=\{onAdjust\} className=\{`btn-primary \$\{TOOLBAR_BUTTON_BASE\} flex-1`\}/, 'Save must use the shared toolbar height')
assert.match(stockModals, /onClick=\{requestCloseAdjust\} className=\{toolbarIconButtonClassName\}/, 'Close must use the shared 40px icon target')

assert.equal(
  batchDisplayLabel({ id: 7, lot_code: '09112026', received_at: null }),
  '11/09/2026',
  'a date-derived stored lot code must render as DD/MM/YYYY',
)
assert.equal(
  dateEntryDisplayValue('2026-09-11'),
  '11/09/2026',
  'canonical ISO form state must render as DD/MM/YYYY',
)
assert.equal(
  batchDisplayLabel({ id: 8, lot_code: 'CUSTOM-LOT', received_at: null }),
  'CUSTOM-LOT',
  'a genuine custom lot code must remain a code',
)

console.log('PASS stock adjust responsive options and received-date display')
