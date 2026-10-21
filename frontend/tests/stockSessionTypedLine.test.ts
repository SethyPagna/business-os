// A scan clears a picked Stock Session item, and with it everything typed on it (lane 6.0.945, release review P3-2).
// The rule that decides whether it may: lineEntryHasTypedValues compares the row with what it was loaded with, so the
// cost and price that picking a product fills in do not count as typing, and the reason and tag (which clearing keeps)
// are not asked about at all. The real float, in a real browser, is pinned in scannerSurfacesStockSessionBrowser.test.ts.
//
// Run: node tests/stockSessionTypedLine.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lineEntryHasTypedValues } from '../src/utils/stockSessionDraft.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// What picking a product in Add mode fills in: quantity 1, the catalogue cost and price, no date.
const loaded = { quantity: '1', unitCost: '4', sellingPrice: '12', expiryDate: '' }
const entry = (patch: Partial<typeof loaded & { holdsNewProduct: boolean }> = {}) => ({ ...loaded, holdsNewProduct: false, ...patch })

test('an item exactly as picking it left it has nothing typed, so a scan may clear it', () => {
  assert.equal(lineEntryHasTypedValues(entry(), loaded), false)
})

test('a changed quantity, cost, price or date is typed', () => {
  for (const patch of [{ quantity: '12' }, { quantity: '' }, { unitCost: '3.5' }, { unitCost: '' }, { sellingPrice: '13' }, { sellingPrice: '' }, { expiryDate: '2027-01-31' }]) {
    assert.equal(lineEntryHasTypedValues(entry(patch), loaded), true, JSON.stringify(patch))
  }
})

test('the same number written differently is not typing (a cost of 4 retyped as 4.00), and spaces do not count', () => {
  assert.equal(lineEntryHasTypedValues(entry({ unitCost: '4.00', sellingPrice: '12.0', quantity: ' 1 ' }), loaded), false)
  assert.equal(lineEntryHasTypedValues(entry({ unitCost: '4.01' }), loaded), true)
})

test('a product made in this session and not yet an item is typed work whatever the boxes say', () => {
  assert.equal(lineEntryHasTypedValues(entry({ holdsNewProduct: true }), loaded), true)
})

test('Set mode loads an empty target: empty is clean, any target is typed', () => {
  const set = { quantity: '', unitCost: '', sellingPrice: '12', expiryDate: '' }
  assert.equal(lineEntryHasTypedValues({ ...set, holdsNewProduct: false }, set), false)
  assert.equal(lineEntryHasTypedValues({ ...set, quantity: '7', holdsNewProduct: false }, set), true)
})

test('a role that cannot see costs loads no cost: an empty cost is clean and a typed one is not', () => {
  const blind = { quantity: '1', sellingPrice: '12' }
  assert.equal(lineEntryHasTypedValues({ quantity: '1', unitCost: '', sellingPrice: '12', expiryDate: '', holdsNewProduct: false }, blind), false)
  assert.equal(lineEntryHasTypedValues({ quantity: '1', unitCost: '2', sellingPrice: '12', expiryDate: '', holdsNewProduct: false }, blind), true)
})

test('the float asks before a scan clears a picked item, says so in both packs, and clearing keeps the reason and tag', () => {
  const entrySource = read('../src/components/stock-session/StockSessionLineEntry.tsx')
  const host = read('../src/components/inventory/FastStockInModal.tsx')
  assert.ok(entrySource.indexOf('if (picked && typedRef.current)') > 0 && entrySource.indexOf('if (picked && typedRef.current)') < entrySource.indexOf('if (picked) onClearPick()'), 'the guard comes before the clear')
  assert.match(entrySource, /const typedRef = useRef\(hasTypedValues\)\s*typedRef\.current = hasTypedValues/, 'read through a ref: the hook holds the handler from before it puts a burst back')
  assert.match(host, /hasTypedValues=\{entryHasTypedValues\}/)
  assert.match(host, /onScanKept=\{\(\) => notify\(tr\('stock_session_scan_finish_item', 'Add or clear this item first'\), 'warning'\)\}/, 'a short translated notice, no native confirm')
  assert.doesNotMatch(entrySource, /\bconfirm\(/)
  assert.match(host, /: picked \? entryFor\(picked, mode\) : \{\}/, 'the loaded values come from entryFor, so the pick and the check cannot drift apart')
  assert.match(host, /holdsNewProduct: !editedLine && Boolean\(createPayload\)/, 'a line being edited keeps its own held product; only a new one is unsaved work')
  const reset = host.slice(host.indexOf('const resetLine = () => {'), host.indexOf('const applyEntry'))
  assert.doesNotMatch(reset, /setReason|setConditionTag/, 'clearing keeps the sticky reason and tag, so they do not count as typed work')
  assert.equal(en.stock_session_scan_finish_item, 'Add or clear this item first')
  assert.ok(km.stock_session_scan_finish_item && km.stock_session_scan_finish_item !== en.stock_session_scan_finish_item && !/[A-Za-z]/.test(km.stock_session_scan_finish_item), 'the Khmer pack has its own words')
})

if (failed) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exitCode = 1
} else console.log('\nall tests passed')
