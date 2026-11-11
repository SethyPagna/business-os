// D1 client lane (C2): a lone non-digit character is not sent to the server by POS, Products, Sales search or the receipt add-search.
// Counts the requests of a scripted typing session against the production rule and sets them beside what the base sent.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canSearchProductText, isProductSearchTooShort } from '../src/api/productSearchIndex.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

// Product search (POS, Products, Sales search, receipt add-search)

// What each settled (debounced) text sends. The base sent every non-empty text; empty sends the default page.
const baseSends = (text: string) => text.trim().length > 0
const sends = (text: string) => canSearchProductText(text)

await test('one non-digit character is not sent; digits, scans and two characters are', () => {
  const cases: Array<[string, boolean]> = [
    ['c', false], [' c ', false], ['ក', false],
    ['cr', true], ['កា', true], ['5', true], ['0', true], ['១', true],
    ['8851234567890', true], ['', false], ['  ', false],
  ]
  for (const [text, expected] of cases) assert.equal(sends(text), expected, JSON.stringify(text))
  assert.equal(isProductSearchTooShort(''), false, 'an empty box is the default page, not "too short"')
  assert.equal(isProductSearchTooShort('😀'), true, 'counted in code points, one emoji is one character')
})

await test('typing sessions: requests counted before and after', () => {
  const session = ['c', 'cr', 'c', '', '5', 'ក', 'កា', '8851234567890']
  const before = session.filter(baseSends).length
  const after = session.filter(sends).length
  assert.equal(before, 7)
  assert.equal(after, 4, 'cr, 5, កា and the barcode; neither letter, neither backspace to c')
  assert.ok(after < before)
})

await test('every search surface uses the one rule and keeps the previous page, not a narrowed one', () => {
  for (const file of ['../src/components/pos/POS.tsx', '../src/components/products/Products.tsx']) {
    const source = read(file)
    assert.match(source, /isProductSearchTooShort\(/, file)
    assert.match(source, /lastSearchParamsKeyRef/, `${file} keeps the key of the last answered search while a lone letter is typed`)
    assert.match(source, /searchTooShort \? \[\] : buildProductSearchTerms/, `${file} must not narrow the old page locally for a lone letter`)
    assert.match(source, /search_type_one_more/, `${file} shows the hint`)
  }
  const receipt = read('../src/components/sales/SaleDetailModal.tsx')
  assert.doesNotMatch(receipt, /length < 2|length >= 2/, 'the receipt add-search no longer refuses single digits')
  assert.equal((receipt.match(/canSearchProductText\(/g) || []).length, 6)
})

await test('both language packs carry the hint, short', () => {
  for (const pack of ['en', 'km']) {
    const json = JSON.parse(read(`../src/lang/${pack}.json`)) as Record<string, string>
    assert.ok(json.search_type_one_more && json.search_type_one_more.length < 30, pack)
  }
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('PASS d1 client search minimum length')
