// S4-41 (UI half): a cancelled sale is read-only on the detail modal.
//
// The Worker refuses the write (`cancelled_sale_read_only`); this is about
// not walking the user into that refusal. It evaluates the REAL expression
// lifted out of SaleDetailModal.tsx rather than a re-typed copy, so an edit
// that drops the guard turns this red instead of leaving a stale duplicate
// green.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---------------------------------------------------------------------------
// 1. SaleDetailModal hides "Edit customer" on a cancelled sale.
// ---------------------------------------------------------------------------
const modalSource = read('../src/components/sales/SaleDetailModal.tsx')
const actionAt = modalSource.indexOf("<SectionCard title={t('customer') || 'Customer'} action={")
assert.ok(actionAt >= 0, 'the Customer SectionCard should still be recognisable')
const exprStart = modalSource.indexOf('action={', actionAt) + 'action={'.length
// Walk the braces so the JSX inside the ternary cannot end the expression early.
let depth = 1
let cursor = exprStart
while (depth > 0) {
  const ch = modalSource[cursor]
  if (ch === '{') depth += 1
  else if (ch === '}') depth -= 1
  cursor += 1
}
const customerActionExpression = modalSource.slice(exprStart, cursor - 1)
assert.match(customerActionExpression, /currentStatus/, 'the customer action must consult the status at all')

const evaluateCustomerAction = (
  currentStatus: string,
  onCustomerAction: unknown,
  onCustomerDetails: unknown = undefined,
  sale: Record<string, unknown> = { id: 1, customer_id: 5 },
  customerIsAnonymous = false,
) => {
  const code = transformSync(`module.exports = (${customerActionExpression})`, {
    loader: 'tsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment',
  }).code
  const module: { exports: unknown } = { exports: undefined }
  new Function('module', 'exports', 'currentStatus', 'onCustomerAction', 'onCustomerDetails', 'customerIsAnonymous', 'Pencil', 'sale', 't', 'h', 'Fragment', code)(
    module, module, currentStatus, onCustomerAction, onCustomerDetails, customerIsAnonymous, 'Pencil', sale,
    (key: string) => key, (tag: unknown) => ({ tag }), 'Fragment',
  )
  return module.exports
}

const handler = () => {}
assert.equal(
  evaluateCustomerAction('cancelled', handler), null,
  'a cancelled sale must not offer Edit customer -- the Worker refuses it',
)
for (const status of ['completed', 'awaiting_payment', 'awaiting_delivery', 'partial_return', 'returned']) {
  assert.notEqual(
    evaluateCustomerAction(status, handler), null,
    `${status} must keep Edit customer -- the owner's rule is every status EXCEPT cancelled`,
  )
}
// The permission-driven hide-by-omission must still win on a live sale.
assert.equal(
  evaluateCustomerAction('completed', undefined), null,
  'no onCustomerAction still means no control',
)

// The customer-details pencil follows the same rules: never on a cancelled sale,
// and only for a linked, named customer.
assert.equal(evaluateCustomerAction('cancelled', undefined, handler), null, 'a cancelled sale hides the details pencil too')
assert.notEqual(evaluateCustomerAction('completed', undefined, handler), null, 'a live sale with a linked customer offers the pencil')
assert.equal(evaluateCustomerAction('completed', undefined, handler, { id: 1, customer_id: null }), null, 'a sale with no linked customer has no profile to edit')
assert.equal(evaluateCustomerAction('completed', undefined, handler, { id: 1, customer_id: 5 }, true), null, 'a walk-in identity has no profile to edit')
assert.equal(evaluateCustomerAction('completed', undefined, undefined), null, 'no callback, no control')

console.log('saleCancelledReadOnly OK')
