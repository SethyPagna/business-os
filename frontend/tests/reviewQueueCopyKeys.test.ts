// Pins the language keys the review queue consumes (pending tag, Telegram category, approve-performs-merge
// refusals and the merge-confirm dialog).
//
// verify:i18n only proves a referenced key exists; it cannot see an English sentence left in km.json,
// a placeholder one pack lacks, or a Khmer sentence that forked a term the pack already settled. The
// placeholder table below is also the contract with the call sites: a slot named here is a slot the
// caller must substitute, and a key with no slot must never render a literal {brace}.
//
// Run: node tests/reviewQueueCopyKeys.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const SLOTS: Record<string, string[]> = {
  pending_review_tag: [],
  telegram_cat_reviews: [],
  telegram_cat_reviews_desc: [],
  review_merge_confirm_required: [],
  review_merge_target_changed: [],
  review_merge_rest_unapplied: ['{fields}'],
  request_permission_revoked: [],
  review_merge_plan_budget: [],
  review_product_has_stock: [],
  review_merge_confirm_title: [],
  review_merge_confirm_survivor: [],
  review_merge_confirm_stock_moved: [],
  review_merge_confirm_price_after: [],
  review_merge_confirm_sessions_closing: ['{n}'],
}
const slotsOf = (value: string): string[] => [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort()
const KHMER = /[ក-៿]/

for (const [key, slots] of Object.entries(SLOTS)) {
  assert.ok(en[key]?.trim(), `English pack lacks ${key}`)
  assert.ok(km[key]?.trim(), `Khmer pack lacks ${key}`)
  assert.notEqual(km[key], en[key], `${key}: Khmer is the English text`)
  assert.ok(KHMER.test(km[key]), `${key}: Khmer text has no Khmer letters`)
  assert.deepEqual(slotsOf(en[key]), slots, `${key}: English slots are not the documented ${slots.join(' ') || 'none'}`)
  assert.deepEqual(slotsOf(km[key]), slots, `${key}: Khmer slots are not the documented ${slots.join(' ') || 'none'}`)
  // Latin letters in the Khmer value are only allowed inside a {slot}.
  const latin = km[key].replace(/\{[a-zA-Z0-9_]+\}/g, '').match(/[A-Za-z]+/g)
  assert.equal(latin, null, `${key}: Khmer text carries English words ${latin?.join(' ')}`)
}
console.log(`PASS ${Object.keys(SLOTS).length} review-queue keys exist in both packs, in Khmer, with the documented placeholders`)

// The owner's own wording for the tag is exact.
assert.equal(en.pending_review_tag, 'Waiting for review')
assert.equal(km.pending_review_tag, 'កំពុងរង់ចាំការត្រួតពិនិត្យ')
console.log('PASS the pending tag carries the owner’s wording in both packs')

// Terms the pack already settled; a new sentence must reuse them rather than fork a second spelling.
const KEPT_PRODUCT = 'ផលិតផលដែលរក្សាទុក'
assert.ok(km.merge_cost_fill_title.startsWith(KEPT_PRODUCT), 'the pack still names the survivor with the term this test pins')
for (const key of ['review_merge_confirm_survivor', 'review_merge_confirm_stock_moved', 'review_merge_rest_unapplied']) {
  assert.ok(km[key].includes(KEPT_PRODUCT), `${key}: the surviving product must be called ${KEPT_PRODUCT}, as the Resolve merge dialog does`)
}
const NOTHING_APPLIED = 'មិនមានអ្វីត្រូវបានអនុវត្តទេ'
assert.ok(km.review_identity_conflict.includes(NOTHING_APPLIED), 'the sibling refusal still uses the pinned phrase')
for (const key of ['review_merge_target_changed', 'request_permission_revoked', 'review_merge_plan_budget', 'review_product_has_stock']) {
  assert.ok(km[key].includes(NOTHING_APPLIED), `${key}: a refusal that writes nothing must say so in the pack’s own words`)
  assert.match(en[key], /nothing was applied/i, `${key}: English refusal must say nothing was applied`)
}
assert.ok(km.review_merge_confirm_sessions_closing.includes('វគ្គបញ្ចូលស្តុក'), 'a stock-in session is វគ្គបញ្ចូលស្តុក')
assert.ok(km.review_merge_confirm_sessions_closing.includes('ការត្រឡប់វិញ'), 'Undo is ការត្រឡប់វិញ, as in resolve_closes_stock_sessions')
assert.ok(km.review_merge_confirm_price_after.includes('ការបញ្ចូលគ្នា'), 'merge is ការបញ្ចូលគ្នា')
assert.ok(km.telegram_cat_reviews_desc.includes('ថ្លៃដើម'), 'cost is ថ្លៃដើម')
assert.ok(!km.telegram_cat_reviews_desc.includes('តម្លៃដើម'), 'cost is never តម្លៃដើម')
console.log('PASS the new Khmer reuses the terms the pack already settled')

// The dialog buttons are the existing generic keys, not copies: Confirm and Back already exist.
assert.equal(en.confirm, 'Confirm')
assert.equal(en.back, 'Back')
assert.ok(km.confirm && km.back, 'Confirm and Back exist in Khmer for the merge-confirm dialog')
console.log('PASS Confirm and Back for the merge-confirm dialog resolve from the existing generic keys')
