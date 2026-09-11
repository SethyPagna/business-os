import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { salesCustomerPickerFallbackMatches } from '../src/api/customerPickerMatch.ts'

const reordered = { name: 'Sok Dara', phone: '012 345 678', membership_number: 'VIP-204' }
assert.equal(salesCustomerPickerFallbackMatches(reordered, 'Dara Sok'), true, 'name words match in any order like server FTS')
assert.equal(salesCustomerPickerFallbackMatches(reordered, 'dar so'), true, 'each typed name word remains a prefix')
assert.equal(salesCustomerPickerFallbackMatches({ name: 'José Álvarez' }, 'alv jose'), true, 'diacritic folding matches the server tokenizer')
assert.equal(salesCustomerPickerFallbackMatches({ name: 'សុខ ដារ៉ា' }, 'ដារ៉ា សុខ'), true, 'Khmer name tokens match in any order')
assert.equal(salesCustomerPickerFallbackMatches(reordered, 'Dara Missing'), false, 'all name tokens remain required')
assert.equal(salesCustomerPickerFallbackMatches(reordered, 'vip 20'), true, 'membership stays in the existing searchable identity pool')

assert.equal(salesCustomerPickerFallbackMatches(reordered, '+855 12 345 678'), true, 'country-code input finds a locally formatted phone')
assert.equal(salesCustomerPickerFallbackMatches({ phone: '+855 (12) 345-678' }, '012345678'), true, 'local input finds a country-code phone')
assert.equal(salesCustomerPickerFallbackMatches({ phone: '012-345-678' }, '345678'), true, 'formatted phones retain server-compatible digit-fragment search')
assert.equal(salesCustomerPickerFallbackMatches({ phone: '012-345-678' }, '12'), false, 'phone fragments shorter than the server minimum do not widen results')
assert.equal(salesCustomerPickerFallbackMatches(reordered, ''), true, 'an empty query preserves the existing unfiltered fallback')

const transport = readFileSync(new URL('../src/api/contactReadTransport.ts', import.meta.url), 'utf8')
const picker = transport.slice(transport.indexOf('export async function getSalesCustomerPicker'))
assert.match(picker, /salesCustomerPickerFallbackMatches\(value, search\)/, 'the real fallback uses the parity matcher')
assert.match(picker, /options\.requireFresh \|\| status === 401 \|\| status === 403/, 'fresh-only and authorization failures still cannot fall back')
assert.match(picker, /Number\(value\.is_anonymous \|\| 0\) === 1/, 'anonymous identities remain excluded')
assert.match(picker, /\['id', 'name', 'phone', 'email', 'address', 'membership_number', 'updated_at', 'is_anonymous'\]/, 'the response privacy allowlist is unchanged')
assert.doesNotMatch(picker, /points_balance|last_sale_at|notes/, 'fallback does not expose directory or finance-only fields')

console.log('PASS Sales customer picker local fallback matches authoritative name/phone semantics without widening policy or fields')
