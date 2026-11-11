// D1 client lane (C1): tapping a product always opens the lot/option sheet, and neither the till nor the receipt add flow
// reads batches/tracked-product-ids any more (TransferModal keeps its own read).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const pos = read('../src/components/pos/POS.tsx')
const receipt = read('../src/components/sales/SaleDetailModal.tsx')
const transfer = read('../src/components/branches/TransferModal.tsx')
const card = read('../src/components/pos/ProductCard.tsx')

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

function openProductCardWith(env: Record<string, unknown>) {
  const start = pos.indexOf('  const openProductCard = useCallback(')
  const end = pos.indexOf('\n  }, [', start)
  assert.ok(start > 0 && end > start)
  const code = transformSync(`${pos.slice(start, end)}\n  }, [])`, { loader: 'tsx' }).code
  return new Function('env', `with(env) { ${code}; return openProductCard }`)({ useCallback: (fn: unknown) => fn, ...env })
}

await test('no tracked-product-ids read from the till or the receipt add flow; the transfer keeps its own', () => {
  assert.doesNotMatch(pos, /getTrackedBatchProductIds|batchTracking|trackedBatchProductIds/, 'POS')
  assert.doesNotMatch(receipt, /getTrackedBatchProductIds|trackedBatchLookup|trackedIdsForAddSheet/, 'receipt')
  assert.match(transfer, /getTrackedBatchProductIds\(/, 'TransferModal is untouched')
})

await test('a tap opens the sheet with no request, whatever the product (base: one-tap add after a lot read)', async () => {
  let fetches = 0
  const opened: unknown[] = []
  const added: unknown[] = []
  const open = openProductCardWith({
    isActive: true, authReady: true, user: { id: 1 }, trackingScope: 's', trackingScopeRef: { current: 's' },
    trackingOwner: { current: { cancel() {}, async prove() { fetches++ } } },
    setDetailProduct: (p: unknown) => opened.push(p),
    addToCart: (p: unknown) => added.push(p),
    fetch: () => { fetches++; return Promise.resolve() },
    asNumber: Number, promotionBadgeForProduct: () => ({ active: false }), promotionRules: [],
    readFreshPickerLots: () => { fetches++; return Promise.resolve({ batches: [], known_positive_quantity: 0 }) },
    resolveSaleBranch: () => ({ blocked: false, branchId: 1 }),
    primaryBranchFilterId: 1, defaultBranchId: 1,
  })
  const plain = { id: 7, name: 'Plain', wholesale_price_usd: 0 }
  for (const options of [{ groupProduct: false, inStock: true }, { groupProduct: false, inStock: false }, { groupProduct: true, inStock: true }, undefined]) {
    open(plain, options)
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(opened.length, 4, 'every tap opens the sheet')
  assert.equal(added.length, 0, 'no tap adds a line behind the sheet')
  assert.equal(fetches, 0, 'no lot read before the sheet opens')
})

await test('card click, Enter and Space, and the scan highlight all end in the same tap function', () => {
  assert.match(card, /onClick=\{\(\) => onOpen\(\{ groupProduct, inStock \}\)\}/)
  assert.match(card, /event\.key === 'Enter' \|\| event\.key === ' '\) \{[\s\S]{0,120}onOpen\(\{ groupProduct, inStock \}\)/)
  assert.match(pos, /onOpen: \(options: \{ groupProduct: boolean; inStock: boolean \}\) => openProductCard\(p, options\)/)
  const callers = pos.match(/\baddToCart\(/g) || []
  assert.equal(callers.length, 1, 'addToCart is only declared here; the sheet adds through its onAddToCart prop')
  assert.match(pos, /onAddToCart=\{addToCart\}/)
  const scan = pos.slice(pos.indexOf('onScan: (code: string, origin: ScanOrigin) => {'), pos.indexOf('const scanHitId'))
  assert.doesNotMatch(scan, /addToCart|setDetailProduct/, 'a scan only fills the search; the person taps the card')
})

await test('the sheet checks the opened product\'s own lots and offers a way through with none', () => {
  const sheet = read('../src/components/pos/ProductDetailSheet.tsx')
  assert.match(sheet, /const requireFreshLots = intent === 'sell' && !hideReceivedDates/)
  assert.match(sheet, /trackedBatchLookupUnavailable: trackedBatchLookupUnavailable \|\| requireFreshLots/, 'a sell pick never trusts a global list')
  assert.match(sheet, /readFreshPickerLots\(productId, resolvedBranchId, signal\)/)
  assert.match(sheet, /setBatchesReloadKey|batchesReloadKey/, 'a failed lot read can be retried')
  const state = read('../src/components/pos/productSheetState.ts')
  assert.match(state, /unlottedStockOptions/, 'stock with no lot is sold through an explicit unrecorded-stock choice')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('PASS d1 client POS always opens the sheet')
