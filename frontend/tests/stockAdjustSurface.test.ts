import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { batchDisplayLabel } from '../src/utils/batchLabel.ts'
import { dateEntryDisplayValue } from '../src/utils/dateEntry.ts'

// The adjust half of InventoryStockModals (received-date Options fold, quantity
// presets, its own Save) was retired on 30 Sep 2026: every stock change opens
// the Stock Session, whose received date is one compact select (owner: "the
// options into one button compact"). The transfer half stays and follows the
// same received-date display and button contracts.

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stockModals = read('../src/components/inventory/InventoryStockModals.tsx')
const sessionFiles = [
  '../src/components/inventory/FastStockInModal.tsx',
  '../src/components/stock-session/StockSessionSharedDetails.tsx',
  '../src/components/stock-session/StockSessionLineEntry.tsx',
  '../src/components/stock-session/StockSessionItems.tsx',
  '../src/components/stock-session/StockSessionReviewStep.tsx',
].map((rel) => [rel, read(rel)] as const)

assert.doesNotMatch(stockModals, /data-stock-received-date-options|receivedDateOptionsOpen/, 'the adjust Options fold is retired with the adjust half')
for (const [rel, source] of [['InventoryStockModals.tsx', stockModals] as const, ...sessionFiles]) {
  assert.doesNotMatch(source, /dateToBatchCode|batch_code_preview/, `${rel} must not show the internal MMDDYYYY received-date code`)
  assert.doesNotMatch(source, /addQuantityChoices|quantity: n \}\)\)/, `${rel} must not bring back quantity preset chips`)
}

// Received dates render through the one display helper wherever they are offered.
assert.match(stockModals, /label: `\$\{batchDisplayLabel\(batch, tr\('batch', 'Received date'\)\)\} · \$\{batch\.quantity\}`/, 'the transfer lot select labels each received date with the canonical helper')
assert.match(read('../src/components/inventory/FastStockInModal.tsx'), /label: `\$\{batchDisplayLabel\(lot, tr\('batch', 'Received date'\)\)\} · \$\{lot\.quantity\}/, 'the session lot select uses the same helper')

// The transfer keeps the shared 40px button contracts.
assert.match(stockModals, /TOOLBAR_BUTTON_BASE, toolbarIconButtonClassName/, 'the transfer must consume the shared 40px button contracts')
assert.match(stockModals, /onClick=\{onTransfer\} className=\{`btn-primary \$\{TOOLBAR_BUTTON_BASE\} w-full`\}/, 'Transfer must use the shared toolbar height')
assert.match(stockModals, /onClick=\{requestCloseTransfer\} disabled=\{transferSaving\} className=\{toolbarIconButtonClassName\}/, 'Close must use the shared 40px icon target')

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

console.log('PASS stock surfaces show received dates through the helper, with no code or presets')
