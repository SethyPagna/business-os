// RET-A F6 (owner, 5 Oct 2026): REMOVE manual returns -- every return is
// linked to a sale. The New return float has no way past the sale search
// without a sale, the dead "skip -- manual return" key is gone from both
// packs, and the Worker's refusal reaches the operator in their language.
// The Worker half is driven for real by
// cloudflare/scripts/test-return-sale-required-native.cjs.
//
// Run: node tests/returnSaleRequired.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { returnRefusalText } from '../src/components/returns/helpers/returnRefusalError.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const modal = read('src/components/returns/NewReturnModal.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

assert.ok(!modal.includes('btn_manual_return'), 'no "skip -- manual return" button')
assert.ok(!/setFoundSale\(null\);\s*setSelectedItems\(\[\]\);\s*setStep\('items'\)/.test(modal), 'nothing opens the item step without a sale')
assert.ok(!/manual return/i.test(modal.replace(/\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, '')), 'no operator-facing text offers a manual return')
assert.ok(!('btn_manual_return' in en) && !('btn_manual_return' in km), 'the dead key left both packs')
assert.ok(en.manual_return && km.manual_return, 'the label for old manual returns in history stays')
console.log('PASS the New return float has no way past the sale search without a sale')

const refusal = Object.assign(new Error('Every return must be linked to a sale.'), { status: 400, code: 'return_sale_required' })
assert.equal(returnRefusalText(refusal, (key, fallback) => km[key] ?? fallback), km.return_sale_required)
assert.match(km.return_sale_required, /ការលក់/, 'the Khmer refusal speaks of the sale')
assert.equal(returnRefusalText(refusal, (key, fallback) => en[key] ?? fallback), en.return_sale_required)
// N1 (6 Oct): a sale id that names no sale has its own code in both packs.
const notFound = Object.assign(new Error('The sale this return names was not found.'), { status: 400, code: 'return_sale_not_found' })
assert.equal(returnRefusalText(notFound, (key, fallback) => km[key] ?? fallback), km.return_sale_not_found)
assert.ok(km.return_sale_not_found && km.return_sale_not_found !== en.return_sale_not_found, 'the Khmer text is translated')
console.log('PASS the Worker refusal is shown in the operator\'s language')
