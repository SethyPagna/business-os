// Fix stock (Inventory Check) is Set-only (owner 13 Nov 2026): Add -- and its Cost field -- must be unreachable from it, even
// after the one seeded line is removed. The old guard was `modeSwitchBlocked(lines)`, which unlocks the moment Items is empty.
//
// The REAL Stock Session float, mounted with transport doubles, for an admin (a cost viewer).
// Run: node tests/fixStockSetOnly.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const rects = MemoryNode.prototype.getClientRects
MemoryNode.prototype.getClientRects = function (): unknown[] { return this.isConnected ? [{}] : [] }
const harness = await createHarness({ observe: ['api/methods.ts', 'api/productSearchIndex.ts'] })

const product = { id: 41, name: 'Fixture lipstick', selling_price_usd: 5, unit_cost: 2, stock_quantity: 7, branch_id: 1 }

async function mountFloat(extra: Record<string, unknown>, keepStorage = false): Promise<MountedSurface> {
  if (!keepStorage) localStorage.clear()
  return harness.mount({
    component: 'components/inventory/FastStockInModal.tsx',
    props: {
      tr: (key: string, fallback?: string) => fallback ?? key, notify() {}, onClose() {}, onDone() {},
      branchOptions: [{ value: '1', label: 'Fixture branch' }], defaultBranchId: '1', initialHeader: { branchId: '1' },
      initialLines: [{ mode: 'set', quantity: 4, reason: 'Inventory check', product }],
      ...extra,
    },
    app: { user: { id: 3, username: 'fixture', role_code: 'admin' }, t: (key: string) => key, can: () => true, notify() {}, usdSymbol: '$', exchangeRate: 4100 },
    doubles: {
      'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }) },
      'api/inventoryWriteTransport.ts': { getInventoryReasons: async () => ({}) },
      'api/methods.ts': { getProductFilters: async () => ({ brands: [] }), searchProducts: async () => ({ items: [product], total: 1 }) },
      'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 },
    },
  })
}

const modeRadios = (float: MountedSurface): MemoryNode[] => float.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('role') === 'radio')
const radioNamed = (float: MountedSurface, label: string): MemoryNode | undefined => modeRadios(float).find((node) => node.textContent.trim() === label)
const costFields = (float: MountedSurface): MemoryNode[] => float.findAll((node) => node.textContent.trim() === 'Cost' && (node.tagName === 'LABEL' || node.tagName === 'SPAN'))
const trash = (float: MountedSurface): MemoryNode => float.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Remove', 'the line trash button')

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  await check('control: an ordinary Set session offers Add, and Add shows the Cost field once Items is empty', async () => {
    const float = await mountFloat({ initialMode: 'set' })
    assert.equal(modeRadios(float).length, 3, 'the Add | Remove | Set tabs are there')
    await float.click(trash(float))
    const add = radioNamed(float, 'Add')
    assert.ok(add && add.getAttribute('aria-disabled') !== 'true' && !(add as unknown as { disabled?: boolean }).disabled, 'Add unlocks when the seeded line is gone')
    await float.click(add)
    assert.ok(costFields(float).length > 0, 'a cost viewer sees Cost in Add')
    await float.unmount()
  })

  await check('Fix stock (lockMode="set"): no Add or Remove tab at first paint, only the Set title, and no Cost field', async () => {
    const float = await mountFloat({ initialMode: 'set', lockMode: 'set' })
    assert.equal(modeRadios(float).length, 0, 'no mode tabs')
    assert.ok(float.findAll((node) => node.getAttribute('data-stock-session-fixed-mode') === 'set').length === 1, 'the Set title')
    assert.equal(costFields(float).length, 0)
    await float.unmount()
  })

  await check('Fix stock: removing the seeded line leaves Add unreachable and the Cost field unrendered, even for a cost viewer', async () => {
    const float = await mountFloat({ initialMode: 'set', lockMode: 'set' })
    await float.click(trash(float))
    assert.equal(modeRadios(float).length, 0, 'still no mode tabs with Items empty')
    assert.equal(radioNamed(float, 'Add'), undefined)
    assert.equal(costFields(float).length, 0, 'no Cost field in the empty entry row')
    await float.unmount()
  })

  await check('Fix stock: a parked Add draft in storage is not resumed into the locked session', async () => {
    const parked = await mountFloat({ initialMode: 'add', initialLines: [{ mode: 'add', quantity: 3, product }] })
    assert.ok(costFields(parked).length > 0, 'the parked Add session shows Cost')
    await parked.unmount()
    const float = await mountFloat({ initialMode: 'set', lockMode: 'set', initialLines: undefined }, true)
    assert.equal(costFields(float).length, 0)
    assert.equal(modeRadios(float).length, 0)
    await float.unmount()
  })

  await check('the Inventory Check page mounts the session with lockMode="set"', async () => {
    const source = readFileSync(new URL('../src/components/inventory/InventoryChecksPage.tsx', import.meta.url), 'utf8')
    const start = source.indexOf('<FastStockInModal')
    assert.match(source.slice(start, source.indexOf('/>', start)), /lockMode="set"/)
  })
} finally {
  await harness.close()
  MemoryNode.prototype.getClientRects = rects
}
if (failed > 0) process.exitCode = 1
