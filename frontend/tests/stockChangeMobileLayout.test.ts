import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('const renderCard = (row: LedgerRow) => {')
const end = source.indexOf('\n  const renderDesktopRows', start)
assert.ok(start > 0 && end > start, 'mobile Stock Change card renderer located')
const card = source.slice(start, end)

function band(name: string, next?: string): string {
  const at = card.indexOf(`data-stock-mobile-row="${name}"`)
  assert.ok(at > 0, `${name} information band exists`)
  const stop = next ? card.indexOf(`data-stock-mobile-row="${next}"`, at) : card.length
  assert.ok(stop > at, `${name} information band has a stable boundary`)
  return card.slice(at, stop)
}

assert.equal((card.match(/data-stock-mobile-row=/g) || []).length, 3, 'mobile cards expose exactly three information bands')
const primary = band('primary', 'reference')
const reference = band('reference', 'metadata')
const metadata = band('metadata')

assert.ok(primary.indexOf('{timeUnknown ?') < primary.indexOf('{row.product_name}'), 'time leads the product name')
assert.match(primary, /data-stock-mobile-product-name="true"/, 'the complete product name has a stable hook for the shared two-line rail')
assert.doesNotMatch(primary, /\btruncate\b|line-clamp/, 'the temporary name rendering must not hide its tail before the shared rail lands')
assert.match(primary, /signedLabel\(row\)/, 'signed movement quantity stays in the primary band')
assert.match(primary, /translateMovementType\(row\.movement_type, t\)/, 'movement type remains attached to its quantity')
assert.doesNotMatch(card, /\{row\.before_qty\}[\s\S]{0,120}\{row\.after_qty\}/, 'before/after detail must not create a fourth mobile card line')

assert.ok(reference.indexOf('<CopyableId') < reference.indexOf('{model.barcode}'), 'source receipt leads the barcode')
assert.match(reference, /copyValue=\{model\.reference\.label\}/, 'copying retains the bare server receipt identifier')
assert.match(reference, /overflow-x-auto/, 'long reference and barcode values remain horizontally reachable')
assert.match(reference, /\[scrollbar-width:none\]/, 'the identity rail hides its Firefox scrollbar')
assert.match(reference, /\[&::-webkit-scrollbar\]:hidden/, 'the identity rail hides its WebKit scrollbar')
assert.doesNotMatch(reference, /\btruncate\b|line-clamp/, 'identity values are never clipped')

const actor = metadata.indexOf('{model.actor}</span>')
const receivedDate = metadata.indexOf('batchDisplayLabel(')
const branch = metadata.indexOf('{model.branch}</span>')
const reason = metadata.indexOf('{model.reason}</span>')
assert.ok(actor > 0 && receivedDate > actor && branch > receivedDate && reason > branch, 'metadata order is user, received date, branch, reason')
assert.match(metadata.slice(0, actor), /font-bold/, 'the acting user starts the metadata rail in bold')
assert.match(metadata, /data-stock-mobile-reason="true"/, 'the complete reason has a stable mobile marker')
assert.match(metadata, /overflow-x-auto/, 'long metadata pans instead of increasing card height')
assert.match(metadata, /\[scrollbar-width:none\]/, 'the metadata rail hides its Firefox scrollbar')
assert.match(metadata, /\[&::-webkit-scrollbar\]:hidden/, 'the metadata rail hides its WebKit scrollbar')
assert.doesNotMatch(metadata, /row\.batch_supplier_name/, 'supplier stays in details rather than adding a fourth card fact')
assert.match(card, /onClick=\{\(\) => openDetail\(row\)\}/, 'ordinary card taps still open the movement detail')

console.log('PASS Stock Change mobile cards keep three complete, horizontally reachable information bands')
