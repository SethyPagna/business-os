// PERM-UI review E3 (4 Nov 2026): Manage Received Dates drew Edit, the quantity field and Deactivate for any role that could open it,
// and every one of those writes answers 403 unless the role holds Inventory at Full with Adjust / receive (routes/batches.ts, the
// router-wide write gate; the catalog row inventory.adjust says it covers the lot writes). The Employee default holds no Inventory
// grant, so it saw three controls that only ever refused. The modal now takes the answer from its opener and draws a control only
// for a role that can use it. Mounted, not source-shaped: the person sees (or does not see) the buttons.
//
// Run: node tests/manageBatchesPermission.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, type MountedSurface } from './mountedComponentHarness.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const lots = [
  { id: 11, lot_code: '07012026', received_at: '2026-07-01 03:00:00', expiry_date: null, notes: null, is_active: 1, quantity: 4, batch_number: 1, supplier_id: 5, supplier_name: 'Stored Supplier', updated_at: '2026-07-02 00:00:00' },
  { id: 13, lot_code: '09202026', received_at: '2026-09-20 03:00:00', expiry_date: null, notes: null, is_active: 0, quantity: 0, batch_number: 3, supplier_id: null, supplier_name: null, updated_at: '2026-09-21 00:00:00' },
]
const tr = (_key: string, fallback = '') => fallback
const app = { t: (key: string) => key, user: { id: 1, role_code: 'admin', role_permissions: { all: true } }, notify() {} }
const baseProps = {
  product: { id: 7, name: 'Synthetic serum', unit: 'pcs' },
  branchSelectOptions: [{ value: '1', label: 'LC Store' }],
  defaultBranchId: '1',
  notify() {}, onClose() {}, onChanged() {},
  t: (key: string) => key, tr,
}

let failed = 0
async function test(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`, error) }
}

const harness = await createHarness()
const mount = (extra: Record<string, unknown>): Promise<MountedSurface> => harness.mount({
  component: 'components/inventory/ManageBatchesModal.tsx',
  props: { ...baseProps, ...extra },
  app,
  doubles: { 'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: lots }) } },
})
const buttons = (surface: MountedSurface, name: string) => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === name)

try {
  await test('a read-only role (the opener passes nothing, or false) sees the lots and the day drill-down but no Edit and no Deactivate', async () => {
    for (const extra of [{}, { canEditBatches: false }, { canEditBatches: false, canChangeSupplier: true }]) {
      const surface = await mount(extra)
      try {
        assert.ok(surface.text().includes('01/07/2026'), `the lot is listed: ${surface.text().slice(0, 300)}`)
        assert.ok(surface.text().includes('Stored Supplier'), 'the supplier is shown as text')
        assert.equal(buttons(surface, 'edit').length, 0, `no Edit for ${JSON.stringify(extra)}`)
        assert.equal(buttons(surface, 'Deactivate').length, 0, `no Deactivate for ${JSON.stringify(extra)}`)
        assert.equal(surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).startsWith('Received')).length >= 1, true, 'the read-only drill into the day stays')
      } finally {
        await surface.unmount()
      }
    }
  })

  await test('a role that can adjust stock gets Edit on every lot and Deactivate on the active one; Edit opens the quantity correction', async () => {
    const surface = await mount({ canEditBatches: true })
    try {
      assert.equal(buttons(surface, 'edit').length, lots.length, 'Edit on both lots')
      assert.equal(buttons(surface, 'Deactivate').length, 1, 'Deactivate only on the active lot')
      await surface.click(buttons(surface, 'edit')[0])
      assert.ok(surface.text().includes('Quantity at this branch'), 'the editor opens with the quantity correction')
    } finally {
      await surface.unmount()
    }
  })

  await test('the supplier picker is drawn only for a role that may change a supplier (the Worker refuses a different supplier without it)', async () => {
    const without = await mount({ canEditBatches: true, canChangeSupplier: false })
    try {
      await without.click(buttons(without, 'edit')[0])
      assert.ok(without.text().includes('Quantity at this branch'), 'the editor is open')
      assert.equal(without.findAll((node) => String(node.getAttribute('id') ?? '').startsWith('manage-batch-11')).length, 0, 'no supplier picker without Change supplier')
    } finally {
      await without.unmount()
    }
    const withGrant = await mount({ canEditBatches: true, canChangeSupplier: true })
    try {
      await withGrant.click(buttons(withGrant, 'edit')[0])
      assert.ok(withGrant.findAll((node) => String(node.getAttribute('id') ?? '').startsWith('manage-batch-11')).length > 0, 'the supplier picker is drawn with Change supplier')
    } finally {
      await withGrant.unmount()
    }
  })

  await test('both openers pass the role: Products and Inventory hand the modal Adjust / receive and Change supplier', async () => {
    const products = read('../src/components/products/Products.tsx')
    const inventory = read('../src/components/inventory/Inventory.tsx')
    assert.ok(products.includes("const canAdjustInventoryStock = can('inventory', 'adjust')"))
    assert.match(products, /<ManageBatchesModal[\s\S]{0,600}?canEditBatches=\{canAdjustInventoryStock\}\s+canChangeSupplier=\{canEditSupplier\}/)
    assert.ok(inventory.includes("const canAdjustStock = can('inventory', 'adjust')"))
    assert.match(inventory, /<ManageBatchesModal[\s\S]{0,600}?canEditBatches=\{canAdjustStock\}\s+canChangeSupplier=\{canChangeProductSupplier\(user\)\}/)
    // A third opener must pass the role too: the modal is mounted exactly twice.
    assert.equal(products.split('<ManageBatchesModal').length - 1, 1)
    assert.equal(inventory.split('<ManageBatchesModal').length - 1, 1)
  })
} finally {
  await harness.close()
}
console.log(failed ? `${failed} Manage Received Dates permission test(s) failed` : 'all Manage Received Dates permission tests passed')
process.exitCode = failed ? 1 : 0
