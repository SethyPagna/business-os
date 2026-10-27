import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, type MemoryNode } from './mountedComponentHarness.ts'

// 6.0.999. The ordinary return edit form used to reset a damaged line's condition tag. return_items has no tag column
// (the tag lives on the damaged lot), the form read `it.condition_tag` off a stored line that never carried one, and
// saved `condition_tag || 'damaged'`: a line tagged `expired` came back from a plain "change the notes" edit as
// `damaged`. GET /api/returns/:id now attaches the stored tag (cloudflare/scripts/test-return-edit-undo-damaged-native.cjs
// pins that half against the real route); this is the form's half, mounted for real: a damaged line opened with
// its stored tag is saved with it, untouched, and a line that is not damaged carries no tag.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const header = {
  id: 41, return_number: 'RET-41', return_scope: 'customer', return_type: 'restock', status: 'completed', reason: 'Changed mind',
  updated_at: '2026-10-12T02:00:00.000Z', total_refund_usd: 15, branch_id: 1, money_precision_version: 0,
}
// The lines exactly as GET /api/returns/:id returns them: the database row (integer flags) plus, on the damaged line, the
// tag and disposition the Worker attached from its lot.
const lines = [
  { id: 1, sale_item_id: 11, product_id: 5, product_name: 'Serum', quantity: 1, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1 },
  { id: 2, sale_item_id: 12, product_id: 6, product_name: 'Toner', quantity: 2, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 0, stock_action: 'damaged', condition_tag: 'expired', damaged_disposition: 'keep', branch_id: 1 },
]

const operator = { id: 3, name: 'Dara', username: 'dara', role: 'admin' }
const harness = await createHarness({
  localStorage: { businessos_user: JSON.stringify(operator), businessos_read_session: 'read-session-of-dara' },
})

await runTest('saving an untouched damaged line sends the tag it was stored with, and a restock line sends none', async () => {
  const writes: unknown[][] = []
  const page = await harness.mount({
    component: 'components/returns/EditReturnModal.tsx',
    props: {
      ret: { ...header, items: structuredClone(lines) },
      onClose: () => {},
      onSuccess: () => {},
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`,
      notify: () => {},
    },
    app: {
      page: 'sales', language: 'en', t: (key: string) => en[key] ?? key, user: operator, settings: {},
      notify: () => {}, hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
    },
    doubles: {
      'api/returnsReadTransport.ts': { getReturnReasonPresets: async () => ({}) },
      'api/returnsTransport.ts': {
        prepareReturnUpdateRequest: async (...args: unknown[]) => { writes.push(['prepare', ...args]); return { ...(args[1] as object), client_request_id: 'fixture' } },
        submitReturnUpdateRequest: async (...args: unknown[]) => { writes.push(['submit', ...args]); return { id: 41, updated_at: 'later' } },
      },
    },
  })
  try {
    const save: MemoryNode = page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(en.save), 'the Save button')
    await page.click(save)
    const submitted = writes.filter((call) => call[0] === 'submit')
    assert.equal(submitted.length, 1, 'one save, one request')
    const body = submitted[0][2] as { items: Array<Record<string, unknown>> }
    assert.deepEqual(body.items.map((item) => [item.sale_item_id, item.stock_action, item.condition_tag ?? null, item.damaged_disposition ?? null]),
      [[11, 'restock', null, null], [12, 'damaged', 'expired', 'keep']],
      'the damaged line keeps its stored tag instead of the default')
  } finally {
    await page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} edit-return damaged-tag check(s) failed`)
  process.exit(1)
}
console.log('PASS the return edit form keeps a damaged line\'s stored tag')
