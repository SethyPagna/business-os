import assert from 'node:assert/strict'
import { balancedSaleItemNameLines, saleEditorInputWidth } from '../src/utils/saleItemNameLayout.ts'

const shortName = 'Olay Serum 547ml'
assert.deepEqual(balancedSaleItemNameLines(shortName), [shortName], 'short names stay on one compact row')

const longName = 'Clarins Super Restorative Decollete And Neck Concentrate 75ml'
const balanced = balancedSaleItemNameLines(longName)
assert.equal(balanced.length, 2, 'a long name with word boundaries uses at most two rows')
assert.equal(balanced.join(''), longName, 'balancing must preserve the exact stored value for copy and accessibility')
assert.ok(Math.abs(Array.from(balanced[0]).length - Array.from(balanced[1]).length) <= 12, 'the two rows should be visually balanced')

const repeatedWhitespace = 'Long  product\tname with preserved spacing for the original copy value'
assert.equal(balancedSaleItemNameLines(repeatedWhitespace).join(''), repeatedWhitespace, 'whitespace must not be normalized')

const khmerUnbroken = 'ផលិតផលថែរក្សាស្បែកដែលមានឈ្មោះវែងណាស់គ្មានចន្លោះសម្រាប់សាកល្បង'
assert.deepEqual(balancedSaleItemNameLines(khmerUnbroken), [khmerUnbroken], 'an unbroken Khmer name remains fully available to horizontal scrolling')

const khmerWords = 'ក្រែម ថែរក្សា ស្បែក សម្រាប់ ប្រើប្រាស់ ប្រចាំថ្ងៃ ទំហំ ធំ ពិសេស'
const khmerBalanced = balancedSaleItemNameLines(khmerWords)
assert.ok(khmerBalanced.length <= 2)
assert.equal(khmerBalanced.join(''), khmerWords, 'Khmer whitespace boundaries must also retain the exact original text')

assert.equal(saleEditorInputWidth('3'), '5ch', 'short values keep a compact usable floor')
assert.equal(saleEditorInputWidth('12345.67'), '12ch', 'long values include the native number-control allowance instead of clipping')
assert.equal(saleEditorInputWidth('១២៣៤៥.៦៧'), '12ch', 'Khmer digits use the same character-aware fit')

console.log('sale item name balancing tests passed')
