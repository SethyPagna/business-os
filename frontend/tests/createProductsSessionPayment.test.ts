import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionPaymentDueInvalid, sessionPaymentFields } from '../src/utils/createProductsSessionPayment.ts'

const paid = { paymentStatus: 'paid' as const, creditDueDate: '2026-09-30' }
const credit = { paymentStatus: 'credit' as const, creditDueDate: '30/09/2026' }
assert.deepEqual(sessionPaymentFields(paid), { payment_status: 'paid', credit_due_date: null })
assert.deepEqual(sessionPaymentFields(credit), { payment_status: 'credit', credit_due_date: '2026-09-30' })
for (const due of [undefined, '', '31/02/2026', 'no date']) {
  assert.equal(sessionPaymentDueInvalid({ paymentStatus: 'credit', creditDueDate: due }, 2), true)
  assert.equal(sessionPaymentDueInvalid({ paymentStatus: 'credit', creditDueDate: due }, 0), false)
}
assert.equal(sessionPaymentDueInvalid(credit, 2), false)
assert.equal(sessionPaymentDueInvalid(paid, 2), false)
// Pre-P10-18 rows did not declare payment. Reloading must not invent Paid.
assert.deepEqual(sessionPaymentFields(JSON.parse('{"quantity":2}')), { payment_status: null, credit_due_date: null })
assert.equal(sessionPaymentDueInvalid({}, 2), false)
const restored = JSON.parse(JSON.stringify({ lines: [{ quantity: 2, ...credit }], paymentStatus: 'paid', creditDueDate: '' }))
assert.deepEqual(sessionPaymentFields(restored.lines[0]), { payment_status: 'credit', credit_due_date: '2026-09-30' })
assert.equal(sessionPaymentDueInvalid(restored.lines[0], 2), false)

const source = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')
// Execute the component's real serializer and edit closure. This catches a
// helper being correct while the production UI submits or validates another fact.
const ast = ts.createSourceFile('modal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function handler(name: string, bindings: Record<string, unknown>) {
  let text = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) text = node.initializer!.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(text)
  const js = ts.transpileModule(`const run = ${text}`, { fileName: 'extracted.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText
  return new Function(...Object.keys(bindings), `${js}; return run`)(...Object.values(bindings))
}
const tr = (_key: string, fallback: string) => fallback
const serializeLine = handler('sessionLine', { sessionPaymentFields, tr })
const row = { lineId: 'one', kind: 'create_receive', status: 'queued', quantity: 2, branchId: '1', receivedDate: '2026-09-18', supplierId: 1, supplierName: 'Supplier', name: 'Item', unitCostUsd: 2, product: { name: 'Item' }, ...credit }
assert.equal(serializeLine(row).payment_status, 'credit')
assert.equal(serializeLine(row).credit_due_date, '2026-09-30')
assert.equal(serializeLine({ ...row, ...paid }).payment_status, 'paid')
assert.equal(serializeLine({ ...row, paymentStatus: undefined, creditDueDate: undefined }).payment_status, null)
assert.equal('payment_status' in serializeLine({ ...row, quantity: 0 }), false)
assert.equal('credit_due_date' in serializeLine({ ...row, quantity: 0 }), false)
for (const original of [row, { ...row, paymentStatus: undefined, creditDueDate: undefined }]) {
  let updatedRows = [original]
  const editLine = handler('saveEditedNewLine', {
    saving: false, submissionLocked: false, canCommitProductAdd: true, canReceiveStock: true,
    rows: updatedRows, header: { supplierName: 'Supplier', supplierId: 1 }, freeGoods: false,
    // Header deliberately differs and is invalid: the queued line is authoritative.
    payment: { paymentStatus: 'credit', creditDueDate: '' }, tr, sessionPaymentDueInvalid,
    stockReceiptGateCode: () => null, findSessionProductDuplicate: () => null,
    setSaving() {}, onPrepareProduct: async (payload: unknown) => payload, stockSessionProduct: (payload: unknown) => payload,
    branchNameFor: () => 'Main', setRows: (update: (rows: typeof updatedRows) => typeof updatedRows) => { updatedRows = update(updatedRows) },
    setCommitError() {}, setSubmissionErrorCode() {},
  })
  await editLine('one', { name: 'Item', barcode: '123', stock_quantity: 3, branch_id: 1, cost_price_usd: 4 })
  assert.equal(updatedRows[0].quantity, 3)
  assert.equal(updatedRows[0].paymentStatus, original.paymentStatus)
  assert.equal(updatedRows[0].creditDueDate, original.creditDueDate)
}
assert.match(source, /const linePayment: SessionPayment = replaceLineId \? rows\.find\([\s\S]*?: payment/)
assert.match(source, /sessionPaymentDueInvalid\(linePayment, quantity\)/)
assert.match(source, /paymentStatus: linePayment\.paymentStatus, creditDueDate: linePayment\.creditDueDate/)
const edit = source.slice(source.indexOf('const saveEditedNewLine'), source.indexOf('const removeLine'))
assert.match(edit, /sessionPaymentDueInvalid\(current, quantity\)/)
assert.match(edit, /const updated: SessionLine = \{\s*\.\.\.current,/)
assert.doesNotMatch(edit, /\.\.\.payment\b|paymentStatus:/)
const serialize = source.slice(source.indexOf('const sessionLine'), source.indexOf('const finishSession'))
const zero = serialize.slice(0, serialize.indexOf('const common'))
assert.doesNotMatch(zero, /sessionPaymentFields\(|payment_status:/)
assert.match(serialize, /\.\.\.sessionPaymentFields\(line\)/)
assert.match(source, /const attemptItems = submittedItems \|\| pending\.map\(sessionLine\)/)
assert.match(source, /if \(!submittedItems && pending\.some\(\(line\) => sessionPaymentDueInvalid\(line, line\.quantity\)\)\)/)
for (const persisted of source.matchAll(/(?:scheduleWorkDraftWrite|writeWorkDraft)<UnifiedSessionDraft>\(draftKey, \{([\s\S]*?)\n\s*\}\)/g)) {
  assert.match(persisted[1], /paymentStatus, creditDueDate/, 'every draft path preserves shared terms')
}
assert.match(source, /aria-pressed=\{paymentStatus === value\}/)
assert.match(source, /row\.paymentStatus === 'paid'/)
for (const language of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const translate = (key: string, fallback: string) => pack[key] || fallback
  const renderBindings = {
    React, tr: translate, paymentStatus: 'credit', creditDueDate: '2026-09-30', creditDueMissing: false,
    setPaymentStatus() {}, setCreditDueDate() {}, packLookup: translate,
    DateEntryInput: () => React.createElement('input', { 'aria-label': pack.due_date }),
  }
  for (const [mode, canCommitProductAdd] of [['new', true], ['existing', false]] as const) {
    const render = handler('renderPaymentControls', { ...renderBindings, mode, canCommitProductAdd })
    const html = renderToStaticMarkup(render())
    assert.ok(html.includes(pack.stock_session_payment_scope_hint), `${language}: existing/date-coalesced lot limitation stays visible`)
    assert.ok(html.includes(pack.requested))
    assert.match(html, /<button/)
  }
  const review = handler('renderPaymentControls', { ...renderBindings, mode: 'new', canCommitProductAdd: false })
  const reviewHtml = renderToStaticMarkup(review())
  assert.ok(reviewHtml.includes(pack.stock_session_review_payment_hint))
  assert.doesNotMatch(reviewHtml, /<button|<input/, 'Review path must not offer controls it cannot persist')
  const renderRow = handler('renderLinePayment', { React, tr: translate })
  // A request for credit can target an already-paid lot. The queued row must
  // label its request, not claim that the existing lot became unpaid.
  const rowHtml = renderToStaticMarkup(renderRow({ ...row, batchId: 10, paymentStatus: 'credit' }))
  assert.ok(rowHtml.includes(pack.requested))
  assert.ok(rowHtml.includes(pack.on_credit))
  assert.equal(renderToStaticMarkup(renderRow({ ...row, quantity: 0 })), '')
}
assert.match(source, /\{renderPaymentControls\(\)\}/)
assert.match(source, /\{renderLinePayment\(row\)\}/)
assert.match(source, /rows\.some\(\(row\) => row\.quantity > 0\)[\s\S]*?stock_session_payment_scope_hint/)
console.log('PASS session payment: capture, edit, legacy draft, reload, exact retry, due validation and catalog-only wiring')
