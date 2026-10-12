// The lot lists as the person sees them (owner ruling, 12 Oct 2026: newest
// received date first everywhere). The Worker answers every lot read in FIFO
// order -- soonest expiry, then OLDEST received -- so each fixture below is
// served oldest first and the mounted surface must reorder it for display.
// Source pins for the lists that are too heavy to mount are in
// tests/lotDisplayOrder.test.ts.
import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'

// Served in the Worker's order: oldest received first.
const fifoLots = [
  { id: 11, lot_code: '07012026', received_at: '2026-07-01 03:00:00', expiry_date: null, notes: null, is_active: 1, quantity: 4, batch_number: 1, supplier_id: null, supplier_name: null },
  { id: 12, lot_code: '08152026', received_at: '2026-08-15 03:00:00', expiry_date: null, notes: null, is_active: 1, quantity: 0, batch_number: 2, supplier_id: null, supplier_name: null },
  { id: 13, lot_code: '09202026', received_at: '2026-09-20 03:00:00', expiry_date: null, notes: null, is_active: 1, quantity: 6, batch_number: 3, supplier_id: null, supplier_name: null },
  { id: 14, lot_code: '10052026', received_at: '2026-10-05 03:00:00', expiry_date: null, notes: null, is_active: 1, quantity: 2, batch_number: 4, supplier_id: null, supplier_name: null },
]

function order(text: string, labels: string[]): string[] {
  const found = labels.map((label) => ({ label, at: text.indexOf(label) }))
  assert.ok(found.every((entry) => entry.at >= 0), `every received date is listed in dd/mm/yyyy; it reads: ${text.slice(0, 500)}`)
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.label)
}

const harness = await createHarness()
try {
  const tr = (_key: string, fallback = '') => fallback
  const app = { t: (key: string) => key, user: { id: 1, role_code: 'admin', role_permissions: { all: true } }, notify() {} }

  const manage = await harness.mount({
    component: 'components/inventory/ManageBatchesModal.tsx',
    props: {
      product: { id: 7, name: 'Synthetic serum', unit: 'pcs' },
      branchSelectOptions: [{ value: '1', label: 'LC Store' }],
      defaultBranchId: '1',
      notify() {}, onClose() {}, onChanged() {},
      t: (key: string) => key, tr,
    },
    app,
    doubles: { 'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: fifoLots }) } },
  })
  assert.deepEqual(
    order(manage.text(), ['05/10/2026', '20/09/2026', '15/08/2026', '01/07/2026']),
    ['05/10/2026', '20/09/2026', '01/07/2026', '15/08/2026'],
    'lots on hand newest first (05/10, 20/09, 01/07), the sold-out 15/08 lot after them (owner, 25 Sep)',
  )
  await manage.unmount()
  console.log('PASS Manage Received Dates lists the lots newest first, sold-out lots after the ones on hand')

  // A lot with no received_at but a date-coded lot code (10052026 = 5 Oct) is
  // dated by its code; the old raw received_at string compare filed it last.
  const attribute = await harness.mount({
    component: 'components/products/surfaces/AttributeSupplierModal.tsx',
    props: {
      productId: 7,
      lots: [
        { id: 21, lot_code: '07012026', batch_number: 1, received_at: '2026-07-01 03:00:00', supplier_name: null },
        { id: 22, lot_code: '09202026', batch_number: 2, received_at: '2026-09-20 03:00:00', supplier_name: null },
        { id: 23, lot_code: '10052026', batch_number: 3, received_at: null, supplier_name: null },
      ],
      tr, notify() {}, onClose() {}, onDone() {},
    },
    app,
    doubles: {},
  })
  assert.deepEqual(
    order(attribute.text(), ['01/07/2026', '20/09/2026', '05/10/2026']),
    ['05/10/2026', '20/09/2026', '01/07/2026'],
    'Attribute supplier lists newest first, and dates a lot from its date-coded lot code when received_at is missing',
  )
  await attribute.unmount()
  console.log('PASS Attribute supplier lists its lots newest first')
} finally {
  await harness.close()
}
