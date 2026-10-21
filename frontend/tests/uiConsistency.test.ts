// Lane 6.0.912 -- UI consistency: no native popups in the audited files, every
// icon-only control named, promotions flip on the Cambodia day, receipt
// literals translated, formerly identical Khmer values translated.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { isPromotionEnded } from '../src/utils/promotionWindow.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')
const read = (rel: string): string => fs.readFileSync(path.join(src, rel), 'utf8')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

/** Calls to the browser's alert/prompt/confirm (bare or window./globalThis.), by real parse. */
function nativeDialogCallsIn(code: string): string[] {
  const file = ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const names = ['alert', 'prompt', 'confirm']
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && names.includes(callee.text)) found.push(callee.text)
      if (ts.isPropertyAccessExpression(callee) && names.includes(callee.name.text)
        && ts.isIdentifier(callee.expression) && ['window', 'globalThis', 'self'].includes(callee.expression.text)) found.push(callee.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Every <button ...> opening tag in a file, including multi-line JSX with {} attributes. */
function buttonTags(rel: string): string[] {
  const text = read(rel)
  const tags: string[] = []
  for (const match of text.matchAll(/<button\b/g)) {
    let depth = 0
    let end = match.index!
    for (; end < text.length; end += 1) {
      const c = text[end]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0 && text[end - 1] !== '=') break
    }
    tags.push(text.slice(match.index!, end + 1))
  }
  return tags
}

function tagWith(rel: string, needle: string): string {
  const tags = buttonTags(rel).filter((tag) => tag.includes(needle))
  assert.equal(tags.length >= 1, true, `${rel}: no <button> containing ${needle}`)
  return tags[0]
}

runTest('positive control: the scanner sees every native form and ignores look-alikes', () => {
  assert.deepEqual(nativeDialogCallsIn('window.prompt("x"); alert("y"); globalThis.confirm("z")'), ['prompt', 'alert', 'confirm'])
  assert.deepEqual(nativeDialogCallsIn('notify("z"); toast.alert("w"); // alert("c")'), [])
})

runTest('no native alert/prompt/confirm in the audited files', () => {
  for (const rel of [
    'components/products/forms/ProductForm.tsx',
    'components/receipt/Receipt.tsx',
    'components/receipt-settings/PrintSettings.tsx',
    'components/utils-settings/Settings.tsx',
  ]) assert.deepEqual(nativeDialogCallsIn(read(rel)), [], rel)
})

runTest('renaming a payment method asks in the shared dialog with before and after', () => {
  const source = read('components/utils-settings/Settings.tsx')
  assert.match(source, /payment_method_new_name/)
  assert.match(source, /label: t\('before'\) \|\| 'Before', value: renameDraft\.from/)
  assert.match(source, /label: t\('after'\) \|\| 'After', value: renamedTo/)
})

runTest('every audited icon-only button names itself', () => {
  const must: Array<[string, string]> = [
    ['components/inventory/ManageBatchesModal.tsx', 'onClick={closeIfIdle}'],
    ['components/receipt-settings/FieldOrderManager.tsx', 'removeDivider(realIndex)'],
    ['components/receipt-settings/FieldOrderManager.tsx', 'moveItem(realIndex, realIndex - 1)'],
    ['components/receipt-settings/FieldOrderManager.tsx', 'moveItem(realIndex, realIndex + 1)'],
    ['components/receipt-settings/FieldOrderManager.tsx', 'addDivider(realIndex)'],
    ['components/users/Users.tsx', 'three-dot-btn'],
    ['components/pos/CartItem.tsx', 'item.quantity - 1'],
    ['components/pos/CartItem.tsx', 'item.quantity + 1'],
    ['components/returns/EditReturnModal.tsx', '(item.returnQty || 0) - 1'],
    ['components/returns/EditReturnModal.tsx', '(item.returnQty || 0) + 1'],
    ['components/promotions/PromotionsPage.tsx', 'draft.products.filter'],
    ['components/pos/POS.tsx', 'isDelivery: !active.isDelivery'],
    ['components/contacts/DuplicatesTab.tsx', "kind: 'dismiss'"],
    ['components/contacts/SaleLinkConflictsSection.tsx', "handleDismiss('mismatch'"],
    ['components/contacts/SaleLinkConflictsSection.tsx', "handleDismiss('missing'"],
    ['components/inventory/InventoryMovementsSurface.tsx', 'openMovementDetail(movement)'],
    ['components/products/forms/ProductForm.tsx', 'moveImage(index, -1)'],
    ['components/products/forms/ProductForm.tsx', 'moveImage(index, 1)'],
    ['components/products/StockInSessionsSection.tsx', 'setCostFloatOpen(true)'],
    ['components/products/surfaces/ProductDetailModal.tsx', 'setCostFloatOpen(true)'],
  ]
  for (const [rel, needle] of must) assert.match(tagWith(rel, needle), /aria-label=/, `${rel}: ${needle}`)
})

runTest('promotions end on the Cambodia business day, not the device midnight', () => {
  assert.equal(isPromotionEnded('2026-10-21', '2026-10-20'), true)
  assert.equal(isPromotionEnded('2026-10-21', '2026-10-21'), false, 'the end day itself is still running')
  assert.equal(isPromotionEnded('2026-10-21', ''), false)
  const page = read('components/promotions/PromotionsPage.tsx')
  assert.match(page, /isPromotionEnded\(todayStr\(\)/)
  assert.doesNotMatch(page, /setHours\(0, 0, 0, 0\)/, 'no device-local midnight')
})

runTest('the receipt prints its own labels in the receipt language', () => {
  const source = read('components/receipt/Receipt.tsx')
  assert.doesNotMatch(source, />Tax ID: \{/)
  assert.doesNotMatch(source, />Received payment</)
  assert.doesNotMatch(source, /alt="ABA payment QR"/)
  assert.match(source, /taxId: 'លេខអត្តសញ្ញាណកម្មពន្ធ:'/)
  assert.match(source, /receivedPayment: 'បានទទួលប្រាក់'/)
  assert.match(source, /labelFor\(lang, 'taxId'\)/)
  assert.match(source, /labelFor\(lang, 'receivedPayment'\)/)
})

runTest('new keys exist in both packs with Khmer text', () => {
  for (const key of ['increase_quantity', 'decrease_quantity', 'remove_divider', 'payment_method_new_name', 'receipt_aba_payment_qr_alt']) {
    assert.ok(en[key], `en ${key}`)
    assert.match(km[key] || '', /[ក-៿]/, `km ${key}`)
  }
})

runTest('formerly English-in-Khmer values are Khmer now', () => {
  for (const key of ['drive_sync_client_id', 'drive_sync_client_secret', 'drive_sync_redirect_uri', 'font_sans', 'font_serif', 'font_monospace']) {
    assert.notEqual(km[key], en[key], key)
    assert.match(km[key], /[ក-៿]/, key)
  }
  const common = (km as unknown as { common: Record<string, string> }).common
  assert.match(common.drive_sync_redirect_uri, /[ក-៿]/)
})

runTest('the factory-reset token the user types is unchanged and still compared literally', () => {
  assert.match(read('components/utils-settings/ResetData.tsx'), /CONFIRM_WORD = 'FACTORY RESET'/)
  assert.match(read('api/systemRuntime.ts'), /confirm !== 'FACTORY RESET'/)
})

runTest('the courier report no longer sends a timezone offset the Worker ignores', () => {
  assert.doesNotMatch(read('components/contacts/DeliveryContactReportModal.tsx'), /tzOffsetMinutes/)
})

if (failed) { console.error(`\n${failed} ui-consistency test(s) failed`); process.exit(1) }
console.log('PASS uiConsistency')
