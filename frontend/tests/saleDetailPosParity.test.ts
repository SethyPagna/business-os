import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeSaleDetailText } from '../src/components/sales/saleDetailText.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const detail = read('../src/components/sales/SaleDetailModal.tsx')
const picker = read('../src/components/sales/SaleDetailProductPicker.tsx')
const workflow = read('../src/components/sales/SaleStatusWorkflow.tsx')
const backend = read('../../cloudflare/src/routes/sales.ts')

assert.equal(sanitizeSaleDetailText('  Sok\u0007 Dara  '), 'Sok Dara')
assert.equal(sanitizeSaleDetailText('Sok Ã©'), 'Sok é')
assert.equal(sanitizeSaleDetailText('អ្នកដឹកជញ្ជូន\u0000 ល្អ'), 'អ្នកដឹកជញ្ជូន ល្អ')

// Generate the two legacy decoding failures from known UTF-8, including C1
// bytes that Windows-1252 displays as punctuation instead of Latin-1 controls.
const asLatin1 = (text: string) => Buffer.from(text, 'utf8').toString('latin1')
const asWindows1252 = (text: string) => new TextDecoder('windows-1252').decode(Buffer.from(text, 'utf8'))
for (const corrupt of [asLatin1, asWindows1252]) {
  for (const name of ['ដារ៉ា', 'អ្នកដឹកជញ្ជូន', 'José', 'Sok “Dara” — driver', 'Dara 🚚']) {
    assert.equal(sanitizeSaleDetailText(corrupt(name)), name)
    assert.equal(sanitizeSaleDetailText(`ដារ៉ា ${corrupt(name)} 李`), `ដារ៉ា ${name} 李`)
  }
  // U+17A0 ends in byte A0: normalizing whitespace before repair loses it.
  assert.equal(sanitizeSaleDetailText(corrupt('\u17a0')), '\u17a0')
  assert.equal(sanitizeSaleDetailText(`Chloé${corrupt('é')}ដារ៉ា`), 'Chloééដារ៉ា')
  for (let code = 0x1780; code <= 0x17ff; code += 1) {
    const char = String.fromCodePoint(code)
    assert.equal(sanitizeSaleDetailText(corrupt(char)), char)
    assert.equal(sanitizeSaleDetailText(char), char)
  }
}
assert.equal(sanitizeSaleDetailText('Sok Ã© ដារ៉ា'), 'Sok é ដារ៉ា')
assert.equal(sanitizeSaleDetailText('â€™'), '’')
assert.equal(sanitizeSaleDetailText('ðŸšš'), '🚚')

for (const name of [
  'ដារ៉ា', 'José', 'Chloé', 'Ângela', 'Ãlvaro', 'Đặng Thị Ánh', 'Łukasz',
  '李 🚚', 'Sok “Dara” — driver', 'a\u0301', 'Dara\u200dSok',
  'Ã', 'á', 'â', 'ð', 'Ã(', 'á\u009e', 'á\u009e(', 'â€',
  'â\u0082(', 'ð\u009f\u009a', 'ð\u0080\u0080\u0080', 'Â\u0080', 'Sok \ufffd Dara',
]) {
  assert.equal(sanitizeSaleDetailText(name), name, `preserve ${JSON.stringify(name)}`)
}
assert.equal(sanitizeSaleDetailText('Sok Ã( Ã© ដារ៉ា'), 'Sok Ã( é ដារ៉ា')
// One reversible layer per call; no recursive guesses on double corruption.
assert.equal(sanitizeSaleDetailText(asLatin1(asLatin1('é'))), asLatin1('é'))
assert.equal(sanitizeSaleDetailText('  0012 034 567  '), '0012 034 567')
assert.equal(sanitizeSaleDetailText('+855 (0)12-034-567'), '+855 (0)12-034-567')
assert.equal(sanitizeSaleDetailText(null), '')
assert.equal(sanitizeSaleDetailText(undefined), '')
assert.equal(sanitizeSaleDetailText(0), '0')

assert.match(detail, /placeholder=\{translateOr\('add_items_search_placeholder', 'Search by name or barcode'/)
assert.match(detail, /<SaleDetailProductPicker/)
assert.match(detail, /buildProductGroups\(addCandidates, new Map\(\), \{ preserveInputOrder: true \}\)/)
assert.match(detail, /const choices = \(group\.sellableItems\.length \? group\.sellableItems : \[group\.leadProduct\]\)/)
assert.match(detail, /__groupChoices: choices/)
assert.match(detail, /addCandidateGroups\.map\(\(candidate\)/)
assert.doesNotMatch(detail, /addCandidateGroups\.map\([\s\S]{0,900}candidate\.barcode/)
assert.match(detail, /const addSearchInputRef = useRef<HTMLInputElement \| null>\(null\)/)
assert.match(detail, /ref=\{addSearchInputRef\}/)
assert.match(detail, /inert=\{addPicking \? true : undefined\}/)
assert.match(detail, /aria-hidden=\{addPicking \? true : undefined\}/)
assert.match(detail, /onClick=\{addPicking \? undefined : onClose\}/)
assert.match(detail, /requestAnimationFrame\(\(\) => addSearchInputRef\.current\?\.focus\(\)\)/)
assert.match(picker, /import Modal from '\.\.\/shared\/Modal\.tsx'/)
assert.match(picker, /layer="nested"/)
assert.match(picker, /unsavedChanges="read-only"/)
assert.match(picker, /event\.key !== 'Escape'/)
assert.match(picker, /document\.addEventListener\('keydown', onKeyDown, true\)/)
assert.match(picker, /document\.removeEventListener\('keydown', onKeyDown, true\)/)
assert.match(picker, /__groupChoices/)
assert.match(picker, /candidates\.filter/)
assert.match(picker, /Options \/ variants/)
assert.match(picker, /setBatchId\(null\)/)
assert.match(picker, /getProductBatches\(productId, branchId, true\)/)
assert.match(picker, /received_at/)
assert.match(picker, /expiry_date/)
assert.match(picker, /batches\.length > 0 && !batch/)
assert.match(picker, /htmlFor="sale-detail-picker-quantity"/)
assert.match(picker, /htmlFor="sale-detail-picker-price"/)
assert.match(picker, /setPriceText\(String\(number\(selected\?\.selling_price_usd\)\)\)/)
assert.match(picker, /quantity: parsedQuantity/)
assert.match(picker, /unitPriceUsd: parsedPrice/)
assert.match(picker, /batchId: batch\?\.id \?\? null/)
assert.match(picker, /const stagedQuantity = stagedLines/)
assert.match(picker, /row\.productId === productId && row\.batchId === selectedBatchId/)
assert.match(picker, /const trackedAvailableQuantity = batches\.reduce/)
assert.match(picker, /batches\.length > 0 \? trackedAvailableQuantity : number\(selected\?\.stock_quantity\)/)
assert.match(picker, /stockMoves && availabilityKnown && availableAfterStaged <= 0 \? 'no-stock'/)
assert.match(picker, /parsedQuantity > availableAfterStaged \? 'not-enough-stock'/)
assert.match(picker, /role="alert"/)
assert.match(picker, /'No Stock'/)
assert.match(picker, /'Not Enough Stock'/)
assert.match(picker, /disabled=\{loading \|\| failed \|\| !!stockError/)
assert.doesNotMatch(picker, /Pick a lot/i)

assert.match(detail, /quantity: Math\.max\(1, Math\.floor\(Number\(choice\.quantity\) \|\| 1\)\)/)
assert.match(detail, /quantity: next\[existing\]\.quantity \+ Math\.max\(1, Math\.floor\(Number\(choice\.quantity\) \|\| 1\)\)/)
assert.match(detail, /priceText: price > 0 \? String\(price\) : '0'/)
assert.match(detail, /unitPriceUsd: toNumber\(text\)/)
assert.match(detail, /batch_id: line\.batchId/)
assert.match(detail, /batch_label: line\.batchLabel/)
assert.match(detail, /batch_expiry_date: line\.batchExpiryDate/)
assert.match(detail, /applied_price_usd: line\.unitPriceUsd/)
assert.match(detail, /const addStockMoves = !Number\(sale\?\.stock_skipped \|\| 0\)/)
assert.match(detail, /stockMoves=\{addStockMoves\}/)
assert.match(detail, /stagedLines=\{addLines\}/)
assert.match(detail, /const addHasStockError = addStockMoves/)
assert.match(detail, /disabled=\{addSaving \|\| addLines\.length === 0 \|\| addHasStockError\}/)
assert.match(detail, /if \(!onAddItems \|\| !addLines\.length \|\| addHasStockError\) return/)
assert.doesNotMatch(detail, /More than the stock this product had a moment ago/)
assert.match(backend, /batchId: Number\(item\.batch_id\) \|\| null/)
assert.match(backend, /allocateNewSaleLines\(/)

assert.match(detail, /<SaleStatusWorkflow/)
assert.match(workflow, /'closed' \| 'destination' \| 'review'/)
assert.match(workflow, /Choose destination status/)
assert.match(workflow, /getStatusLabel\(currentStatus, t\)/)
assert.match(workflow, /getStatusLabel\(selectedStatus, t\)/)
assert.match(workflow, /onClick=\{onConfirm\}/)

console.log('sale-detail POS parity and personalized status workflow tests passed')
