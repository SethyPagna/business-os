import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'

// Daily-use A item 1. The Stock Changes detail panel labelled four rows with
// keys no pack defined (tag, payment_status, credit_due_date, receipt_sessions),
// so Khmer showed English, and verify:i18n could not see it: its call shapes
// cover tr('key') but not the tr(t, 'key', fallback) form this file uses.
// This test closes both gaps for the file: every key the file references
// resolves in BOTH packs, and the detail panel reads in the pack's language,
// including the payment status VALUE and the two dates (dd/mm/yyyy).

const source = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

const referenced = [...new Set([...source.matchAll(/\btr\(\s*t\s*,\s*'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]))]
assert.ok(referenced.length > 20, 'the scan must find the tr(t, key, fallback) call sites')
for (const lang of ['en', 'km']) {
  const missing = referenced.filter((key) => packs[lang][key] === undefined)
  assert.deepEqual(missing, [], `${lang}.json is missing keys StockChangeSection.tsx renders`)
}
for (const key of ['tag', 'payment_status', 'credit_due_date', 'receipt_sessions']) {
  assert.notEqual(packs.km[key], packs.en[key], `km.${key} must be translated, not a copy of English`)
  assert.match(packs.km[key], /[ក-៿]/, `km.${key} must be Khmer script`)
  assert.doesNotMatch(packs.en[key], /[ក-៿]/, `en.${key} must be English`)
}
console.log('PASS every key StockChangeSection.tsx references resolves in both packs, and the four new rows are translated')

const base = {
  product_id: 7, product_name: 'Synthetic serum', barcode: 'TEST-7', unit: 'pcs', branch_name: 'Synthetic branch',
  user_name: 'Synthetic operator', batch_id: 9001, batch_lot_code: '09152026', batch_received_at: '2026-09-15',
  batch_supplier_id: null, batch_supplier_name: 'Probe Supplier', unit_cost_usd: 2, total_cost_usd: 20,
}
const receipt = {
  ...base, id: 10, movement_type: 'add', quantity: 10, signed_quantity: 10, reason: 'Probe receipt', reference_id: '777',
  created_at: '2026-09-15T03:00:00Z', ledger_bucket: 'in', before_qty: 0, after_qty: 10,
  reverts_movement_id: null, reverted_by_movement_id: null, reverted_now: 0, tag_label: 'Display',
  batch_payment_status: 'credit', batch_credit_due_date: '2026-10-15', batch_expiry_date: '2027-03-01', batch_receipt_session_count: 2,
}

const harness = await createHarness()
try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const t = (key: string) => words[key] || key
    const app = { t, page: 'products', user: { id: 1, username: 'fixture-admin', role_code: 'admin' }, can: () => true, notify: () => {} }
    const surface = await harness.mount({
      component: 'components/products/StockChangeSection.tsx', props: { t }, app,
      doubles: {
        'api/productReadTransport.ts': {
          getStockLedger: async () => ({ items: [receipt], total: 1, totalPages: 1 }),
          getStockLedgerMovementBalance: async (id: number) => ({ id, before_qty: 0, after_qty: 10 }),
        },
        'api/inventoryWriteTransport.ts': { revertStockMovement: async () => ({ success: true }) },
        'api/actionHistoryTransport.ts': { getStockMovementRevertPreview: async (id: number) => ({ success: true, revert: { kind: 'movement', movementId: id, lineCount: 1 } }) },
        'api/branchTransport.ts': { getBranches: async () => [] },
        'components/shared/SupplierPickerField.tsx': { loadSupplierNames: async () => [] },
      },
    })
    await surface.click(surface.findAll((node) => node.tagName === 'TR' && node.getAttribute('data-clickable') === 'true')[0])
    const detailRow = (key: string): string => {
      const label = surface.find((node) => node.tagName === 'DT' && node.textContent === words[key], `the "${key}" label in ${lang}`)
      return label.parentNode!.children.find((node) => node.tagName === 'DD')!.textContent
    }
    assert.equal(detailRow('tag'), 'Display')
    assert.equal(detailRow('payment_status'), words.on_credit, `${lang}: a credit receipt reads ${JSON.stringify(words.on_credit)}, never the raw status`)
    assert.equal(detailRow('credit_due_date'), '15/10/2026', `${lang}: the Not Yet Paid due date is dd/mm/yyyy`)
    assert.equal(detailRow('receipt_sessions'), '2')
    assert.equal(detailRow('expiry_date'), '01/03/2027', `${lang}: the expiry is dd/mm/yyyy`)
    await surface.unmount()
  }
  console.log('PASS the Stock Changes detail panel reads in English and Khmer: labels, payment status value, dd/mm/yyyy dates')
} finally {
  await harness.close()
}
