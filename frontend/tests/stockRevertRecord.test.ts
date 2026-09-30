import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'
import { revertDisplayReason, revertsMovementId } from '../src/utils/stockMovementDetail.ts'
import { buildMovementGroups } from '../src/components/inventory/movementGroups.ts'
import { collectInventoryMovementRows } from '../src/components/inventory/inventoryExport.ts'

// REVERT-FIX F4/F6 (owner, 30 Sep 2026): a Revert is its own record. In Stock
// Changes it reads "Revert" in both languages, links to the row it reverts,
// and the original says it was reverted, links back and offers no second
// Revert. Its link comes from the immutable reference_id, so an edited reason
// cannot hide it, and the export writes "Revert" / "#N", never "revert:N".

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

const base = {
  product_id: 7, product_name: 'Synthetic serum', barcode: 'TEST-7', unit: 'pcs', branch_name: 'Synthetic branch',
  user_name: 'Synthetic operator', batch_id: 9001, batch_lot_code: '09152026', batch_received_at: '2026-09-15',
  batch_supplier_id: null, batch_supplier_name: 'Probe Supplier', unit_cost_usd: 2, total_cost_usd: 20,
}
const original = {
  ...base, id: 10, movement_type: 'add', quantity: 10, signed_quantity: 10, reason: 'Probe receipt', reference_id: '777',
  created_at: '2026-09-15T03:00:00Z', ledger_bucket: 'in', before_qty: 0, after_qty: 10,
  reverts_movement_id: null, reverted_by_movement_id: 11, batch_payment_status: 'credit',
}
const revert = {
  ...base, id: 11, movement_type: 'remove', quantity: 10, signed_quantity: -10, reason: 'Revert of #10: Probe receipt', reference_id: 'revert:10',
  created_at: '2026-09-30T03:00:00Z', ledger_bucket: 'out', before_qty: 10, after_qty: 0,
  reverts_movement_id: 10, reverted_by_movement_id: null,
}

// Pure helpers: the link is the reference, the label hides the English prefix.
assert.equal(revertsMovementId({ reference_id: 'revert:10' }), 10)
assert.equal(revertsMovementId({ reference_id: 'revert:product_remove:op:0' }), null, 'a History Undo of a delete is not a numeric Revert link')
assert.equal(revertsMovementId({ reference_id: '777' }), null)
assert.equal(revertDisplayReason(revert), 'Probe receipt')
assert.equal(revertDisplayReason({ reason: 'Revert of #5 (remove)', reference_id: 'revert:5' }), '')
assert.equal(revertDisplayReason({ reason: 'Revert of #5: kept', reference_id: null }), 'Revert of #5: kept', 'only a Revert row loses the prefix')
assert.equal(revertDisplayReason({ reason: 'typo fixed', reference_id: 'revert:10' }), 'typo fixed')

// F6: the Inventory movements export names a Revert readably.
const exported = collectInventoryMovementRows(buildMovementGroups([revert, original]))
const revertLine = exported.find((line) => line.Receipt === '#10')
assert.ok(revertLine, JSON.stringify(exported))
assert.equal(revertLine.Activity, 'Revert')
assert.ok(!exported.some((line) => String(line.Receipt).startsWith('revert:')), 'no raw revert: token in the export')
console.log('PASS helpers and the movements export name a Revert and its #N, never the raw token')

const harness = await createHarness()
for (const lang of ['en', 'km']) {
  const words = packs[lang]
  const t = (key: string) => words[key] || key
  const reads: Array<Record<string, unknown>> = []
  const app = { t, page: 'products', user: { id: 1, username: 'fixture-admin', role_code: 'admin' }, can: () => true, notify: () => {} }
  const surface = await harness.mount({
    component: 'components/products/StockChangeSection.tsx', props: { t }, app,
    doubles: {
      'api/productReadTransport.ts': {
        getStockLedger: async (query: Record<string, unknown> = {}) => {
          reads.push(query)
          if (query.movementId === 10) return { items: [original], total: 1, totalPages: 1 }
          return { items: [revert, original], total: 2, totalPages: 1 }
        },
        getStockLedgerMovementBalance: async (id: number) => ({ id, before_qty: 0, after_qty: 10 }),
      },
      'api/inventoryWriteTransport.ts': { revertStockMovement: async () => ({ success: true }) },
      'api/actionHistoryTransport.ts': { getStockMovementRevertPreview: async (id: number) => ({ success: true, revert: { kind: 'movement', movementId: id, lineCount: 1 } }) },
      'api/branchTransport.ts': { getBranches: async () => [] },
      'components/shared/SupplierPickerField.tsx': { loadSupplierNames: async () => [] },
    },
  })
  const text = surface.text()
  assert.ok(text.includes(words.revert), `${lang}: the Revert row is labelled ${words.revert}`)
  assert.ok(text.includes(words.movement_reverted_chip), `${lang}: the original is marked reverted`)
  assert.ok(!text.includes('Revert of #10'), `${lang}: the English server prefix never reaches the screen`)

  const openRow = async (id: number) => surface.click(surface.find((node) => node.tagName === 'TR' && node.getAttribute('data-clickable') === 'true'
    && (id === 11) === node.textContent.includes('#10'), `row ${id}`))
  await openRow(11)
  const link = surface.button(words.movement_reverts_link.replace('{id}', '10'))
  assert.equal(surface.findAll((node) => node.getAttribute('aria-label') === words.revert).length, 1, `${lang}: a Revert can itself be reverted`)
  await surface.click(link)
  assert.deepEqual(reads.at(-1), { movementId: 10, page: 1, pageSize: 1 }, `${lang}: the #10 link reads that one row`)
  const dialog = surface.text()
  assert.ok(dialog.includes(words.movement_reverted_by_link.replace('{id}', '11')), `${lang}: the original links back to its Revert`)
  assert.equal(surface.findAll((node) => node.getAttribute('aria-label') === words.revert).length, 0, `${lang}: a reverted row offers no second Revert`)
  await surface.unmount()
}
console.log('PASS Stock Changes labels a Revert, links it both ways and hides a second Revert, in English and Khmer')
