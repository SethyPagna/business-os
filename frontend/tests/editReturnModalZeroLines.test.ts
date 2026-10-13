import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessibleText, createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

// The return edit form never submits zero lines (OPUS-REVIEW-RETURN-EDIT-7077
// finding 2, 12 Oct 2026). Saving with every line at 0 -- or with a form built
// from a row whose lines never loaded -- sent `items: []`, and PATCH
// /api/returns/:id emptied the return: lines -> 0, refund -> 0, restocked units
// back off the shelf. The Worker refuses that body now (return_edit_empty,
// cloudflare/scripts/test-return-edit-empty-refused-native.cjs); this is the
// form's half of the same rule, mounted for real:
//   1. every line set to 0 -> the inline alert explains, Save is disabled, and
//      even a direct press of Save prepares and sends nothing;
//   2. a form whose return carries no lines -> the same, from first paint;
//   3. control: keeping one line still saves exactly that line.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const EMPTY_EDIT = 'A return must keep at least one line. To undo the whole return, cancel it instead.'

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const header = {
  id: 41, return_number: 'RET-41', return_scope: 'customer', return_type: 'restock', status: 'completed', reason: 'Changed mind',
  updated_at: '2026-10-12T02:00:00.000Z', total_refund_usd: 10, branch_id: 1, money_precision_version: 0,
}
const lines = [
  { id: 1, sale_item_id: 11, product_id: 5, product_name: 'Serum', quantity: 1, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1 },
  { id: 2, sale_item_id: 12, product_id: 6, product_name: 'Toner', quantity: 1, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1 },
]

await runTest('the refusal text is the Worker\'s sentence, in English and Khmer', () => {
  assert.equal(en.return_edit_empty, EMPTY_EDIT)
  const worker = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  assert.ok(worker.includes(`error: '${EMPTY_EDIT}'`) && worker.includes(`code: 'return_edit_empty'`), 'the pack key is named after the Worker code and carries its sentence')
  assert.match(String(km.return_edit_empty || ''), /[ក-៿]/, 'km.return_edit_empty is Khmer')
})

const operator = { id: 3, name: 'Dara', username: 'dara', role: 'admin' }
const harness = await createHarness({
  localStorage: { businessos_user: JSON.stringify(operator), businessos_read_session: 'read-session-of-dara' },
})

async function mountForm(ret: Record<string, unknown>) {
  const writes: unknown[][] = []
  const notices: Array<{ message: string; tone?: string }> = []
  const page = await harness.mount({
    component: 'components/returns/EditReturnModal.tsx',
    props: {
      ret,
      onClose: () => {},
      onSuccess: () => {},
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`,
      notify: (message: string, tone?: string) => { notices.push({ message: String(message), tone }) },
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
  const saveButton = (): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(en.save), 'the Save button')
  const quantityInputs = (): MemoryNode[] => page.findAll((node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'number')
  const emptyAlert = (): MemoryNode[] => page.findAll((node) => node.hasAttribute('data-return-edit-empty'))
  // Bypasses the disabled attribute on purpose: the handler must refuse too.
  const pressSaveDirectly = () => page.call(saveButton(), 'onClick', [{ preventDefault() {}, stopPropagation() {} }])
  return { page, writes, notices, saveButton, quantityInputs, emptyAlert, pressSaveDirectly }
}

await runTest('every line set to 0: the alert explains, Save is disabled and nothing is sent', async () => {
  const form = await mountForm({ ...header, items: structuredClone(lines) })
  try {
    assert.equal(form.quantityInputs().length, 2)
    assert.equal(form.emptyAlert().length, 0, 'no alert while a line is kept')
    for (const input of form.quantityInputs()) await form.page.type(input, '0')
    await form.pressSaveDirectly()
    assert.deepEqual(form.writes, [], 'a press that reaches the handler prepares and sends nothing')
    assert.deepEqual(form.notices, [{ message: EMPTY_EDIT, tone: 'error' }])
    const alert = form.emptyAlert()
    assert.equal(alert.length, 1, 'the form says why it will not save')
    assert.equal(alert[0].getAttribute('role'), 'alert')
    assert.ok(alert[0].textContent.includes(EMPTY_EDIT), alert[0].textContent)
    assert.equal(propsOf(form.saveButton()).disabled, true, 'Save is disabled with zero lines')
  } finally {
    await form.page.unmount()
  }
})

await runTest('a form whose return carries no lines refuses from first paint', async () => {
  const form = await mountForm({ ...header })
  try {
    assert.equal(form.quantityInputs().length, 0)
    await form.pressSaveDirectly()
    assert.deepEqual(form.writes, [], 'nothing is prepared or sent')
    assert.equal(form.emptyAlert().length, 1, 'the alert is there before any input')
    assert.equal(propsOf(form.saveButton()).disabled, true)
  } finally {
    await form.page.unmount()
  }
})

await runTest('control: keeping one line saves exactly that line', async () => {
  const form = await mountForm({ ...header, items: structuredClone(lines) })
  try {
    await form.page.type(form.quantityInputs()[1], '0')
    assert.equal(form.emptyAlert().length, 0)
    await form.page.click(form.saveButton())
    const submitted = form.writes.filter((call) => call[0] === 'submit')
    assert.equal(submitted.length, 1, 'one save, one request')
    const body = submitted[0][2] as { items: Array<Record<string, unknown>> }
    assert.deepEqual(body.items.map((item) => [item.sale_item_id, item.quantity]), [[11, 1]])
  } finally {
    await form.page.unmount()
  }
})

await harness.close()
if (failed) {
  console.error(`${failed} edit-return zero-line check(s) failed`)
  process.exit(1)
}
console.log('PASS the return edit form never submits zero lines')
