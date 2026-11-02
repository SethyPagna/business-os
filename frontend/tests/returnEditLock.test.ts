// 6.0.990: the Edit Return form never offers an edit the Worker is certain to refuse. PUT /api/returns/:id refuses a v1
// return (customer_return_edit_v1_not_supported) and a v0 return on a v1 sale (money_precision_review_needed, decided by
// STORED data, so no restart fixes it). GET /api/returns/:id carries the sale's version so the form shows that refusal
// first, in words; the Worker refusal stays the enforcement (cloudflare/scripts/test-customer-return-legacy-body-v1-sale-native.cjs
// drives both the refusal and the detail field).
//
// Run: node tests/returnEditLock.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { returnEditLock } from '../src/components/returns/helpers/returnEditLock.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

assert.equal(returnEditLock({ money_precision_version: 0, sale_money_precision_version: 0 }), null, 'legacy return on a legacy sale stays editable')
assert.equal(returnEditLock({ money_precision_version: null, sale_money_precision_version: null }), null, 'a manual return with no sale stays editable')
assert.equal(returnEditLock({ money_precision_version: 0 }), null, 'an older Worker without the field keeps today\'s behaviour')
assert.equal(returnEditLock({ money_precision_version: 1, sale_money_precision_version: 1 }), 'exact_return')
assert.equal(returnEditLock({ money_precision_version: '1' }), 'exact_return')
assert.equal(returnEditLock({ money_precision_version: 0, sale_money_precision_version: 1 }), 'legacy_return_on_exact_sale')
assert.equal(returnEditLock({ money_precision_version: 0, sale_money_precision_version: '1' }), 'legacy_return_on_exact_sale')
console.log('PASS returnEditLock mirrors the two Worker edit refusals')

const worker = read('../../cloudflare/src/routes/returns.ts')
const detail = worker.slice(worker.indexOf("app.get('/:id', async"), worker.indexOf("app.get('/:id/records'"))
assert.match(detail, /origin_sale\.money_precision_version AS sale_money_precision_version/)
assert.match(detail, /LEFT JOIN sales origin_sale ON origin_sale\.id = r\.sale_id/)
assert.match(worker, /if \(Number\(existing\.money_precision_version\) === 1\) \{\s*return c\.json\(\{ error: '[^']+',\s*code: 'customer_return_edit_v1_not_supported'/)
assert.match(worker, /if \(Number\(linkedSale\?\.money_precision_version\) === 1\) \{\s*return c\.json\(\{ \.\.\.MONEY_PRECISION_REVIEW_NEEDED \}, 409\)/)
console.log('PASS the Worker detail carries the sale version and the edit route refuses on the same two conditions')

const modal = read('../src/components/returns/EditReturnModal.tsx')
assert.match(modal, /const editLock = returnEditLock\(ret\)/)
assert.match(modal, /if \(returnEditLock\(ret\)\) return\n/, 'submit refuses to send a locked edit (run for both locks in returnMoneyV1Flow.test.ts)')
assert.match(modal, /if \(editLock\) return createPortal\(/, 'the locked panel replaces the form from first paint')
// 6.0.992 ships with this lane: every legacy_return_on_exact_sale lock opens the Update money details panel first
// (tests/returnLegacyConvert.test.ts), so this panel only ever shows the exact-return lock.
assert.match(modal, /if \(editLock === 'legacy_return_on_exact_sale'\) return <ReturnLegacyLockPanel /)
assert.match(modal, /data-return-edit-lock=\{editLock\}>\{T\('return_v1_edit_unavailable'/)
assert.ok(!/Number\(ret\.money_precision_version\) === 1/.test(modal), 'no second, narrower lock check left behind')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
assert.ok(!('return_legacy_edit_unavailable' in en) && !('return_legacy_edit_unavailable' in km), 'the unreachable legacy sentence is retired in both packs')
console.log('PASS the Edit Return form shows the reason in both languages instead of the form')
