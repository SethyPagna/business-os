import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

// The image-only detail lists a product's received dates gathered branch by branch. They were shown in
// fetch order, so branch one's 2025 lot sat above branch two's 2026 lot. Owner ruling (12 Oct 2026): every
// lot list shows the newest received date first, undated lots last.

const harness = await createHarness()
type Lot = { id: number; lot_code: string | null; received_at: string | null; expiry_date: string | null; batch_number: number | null; quantity: number }
const lotsByBranch: Record<number, Lot[]> = {
  1: [
    { id: 11, lot_code: '01012025', received_at: '2025-01-01', expiry_date: null, batch_number: 1, quantity: 4 },
    { id: 12, lot_code: 'MISC', received_at: 'not a date', expiry_date: null, batch_number: null, quantity: 1 },
    { id: 13, lot_code: '03052026', received_at: '2026-03-05', expiry_date: null, batch_number: 2, quantity: 2 },
  ],
  2: [
    { id: 21, lot_code: '10192026', received_at: '2026-10-19', expiry_date: null, batch_number: 1, quantity: 7 },
    { id: 22, lot_code: null, received_at: null, expiry_date: null, batch_number: null, quantity: 3 },
    { id: 23, lot_code: '03052026', received_at: '2026-03-05', expiry_date: null, batch_number: 3, quantity: 5 },
  ],
}
const product = { id: 7, name: 'Synthetic serum', image_path: null, updated_at: '2026-10-01T00:00:00Z', branch_stock: [{ branch_id: 1, branch_name: 'Branch one', quantity: 7 }, { branch_id: 2, branch_name: 'Branch two', quantity: 15 }] }
const doubles = {
  'api/productReadTransport.ts': { searchProducts: async () => ({ items: [product], total: 1 }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/batchesTransport.ts': { getProductBatches: async (_id: number, branchId: number) => ({ batches: lotsByBranch[branchId] }) },
}

try {
  const surface: MountedSurface = await harness.mount({
    component: 'components/products/ProductsImageOnlyView.tsx',
    app: {
      t: (key: string) => key, notify() {}, hasPermission: (key: string) => key === 'products_image_only_show_batches',
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      user: { id: 1, username: 'fixture-image-only', role_code: 'products_image_only' },
    },
    doubles,
  })
  const open = surface.find((node) => node.tagName === 'BUTTON' && node.textContent.includes('Synthetic serum'), 'the product detail button')
  await surface.click(open)
  await surface.waitFor(() => surface.text().includes('Branch two: 7'), 'the received dates to load')
  const rows = surface.findAll((node: MemoryNode) => node.tagName === 'SPAN' && /^Branch (one|two): \d+$/.test(node.textContent)).map((node) => node.textContent)
  assert.deepEqual(rows, [
    'Branch two: 7', // 19/10/2026
    'Branch two: 5', // 05/03/2026 twice: same stock status, the later receipt (batch 3) first
    'Branch one: 2', // 05/03/2026, batch 2
    'Branch one: 4', // 01/01/2025
    'Branch one: 1', // unparseable date, listed after every dated lot
    'Branch two: 3', // no date at all
  ], 'received dates read newest first across branches, undated last, quantities and branches kept')
  await surface.unmount()
  console.log('PASS the image-only detail lists received dates newest first across branches')
} finally {
  await harness.close()
}
