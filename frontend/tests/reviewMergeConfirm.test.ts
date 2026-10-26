// REVQ-A, the Review page half: approving a queued rename that now matches an existing product MERGES it, after the
// approver confirms the kept product. The Worker (cloudflare/src/lib/reviewApply.ts applyApprovedIdentityMerge) refuses
// the unconfirmed approval with the merge preview; the page shows it in the shared confirm dialog and sends the approval
// again naming exactly that product (approve body { confirm_merge_into }). This pins the contract on both sides.
//
// Run: node tests/reviewMergeConfirm.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reviewApprovalRefusalText, reviewMergePreview } from '../src/api/branchRuleErrors.ts'

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pack = (language: 'en' | 'km') => JSON.parse(read(`../src/lang/${language}.json`)) as Record<string, string>

// --- the preview the Worker sends is read exactly, and nothing else is mistaken for one -------------------------------
const preview = { survivorId: 7, survivorName: 'Rice 5kg', stockMoved: 3, priceAfter: 6, sessionsClosing: 2 }
assert.deepEqual(reviewMergePreview({ code: 'review_merge_confirm_required', preview }),
  { survivorId: 7, survivorName: 'Rice 5kg', stockMoved: 3, priceAfter: 6, sessionsClosing: 2, changed: false })
assert.equal(reviewMergePreview({ code: 'review_merge_target_changed', preview })?.changed, true, 'a changed target is flagged')
for (const unusable of [
  null, undefined, 'x', {}, { code: 'review_merge_confirm_required' }, { code: 'review_merge_confirm_required', preview: null },
  { code: 'review_merge_confirm_required', preview: { survivorName: 'Rice' } },
  { code: 'review_merge_confirm_required', preview: { ...preview, survivorId: 0 } },
  { code: 'review_merge_confirm_required', preview: { ...preview, survivorId: 1.5 } },
  { code: 'review_identity_conflict', preview },
  { code: 'review_self_approval', preview },
]) assert.equal(reviewMergePreview(unusable), null, JSON.stringify(unusable))
assert.equal(reviewMergePreview({ code: 'review_merge_confirm_required', preview: { survivorId: 7, sessionsClosing: -4 } })?.sessionsClosing, 0, 'no negative session count')
console.log('PASS the merge preview is read from exactly the two confirm codes')

// --- every refusal code the applier can raise reads in both languages -----------------------------------------------
const applySource = read('../../cloudflare/src/lib/reviewApply.ts')
const raised = [...applySource.matchAll(/new ReviewCodedRefusal\(\s*'([a-z_]+)'/g)].map((m) => m[1])
const budgetCode = [...applySource.matchAll(/'(review_merge_plan_budget)'/g)].map((m) => m[1])
const codes = [...new Set([...raised, ...budgetCode, 'merge_state_conflict'])]
assert.ok(codes.includes('review_merge_confirm_required') && codes.includes('review_merge_target_changed') && codes.includes('review_merge_permission_required'),
  `the applier raises the three approval-merge refusals: ${codes.join(', ')}`)
for (const language of ['en', 'km'] as const) {
  const strings = pack(language)
  const t = (key: string) => strings[key]
  for (const code of codes) {
    const text = reviewApprovalRefusalText(code, 'products', t)
    assert.ok(text && !/\{[a-z]+\}/.test(text), `${language}: ${code} reads as a sentence with no open placeholder (${text})`)
    if (language === 'km') assert.ok(/[ក-៿]/.test(text), `${language}: ${code} is Khmer`)
  }
  assert.equal(reviewApprovalRefusalText('review_merge_permission_required', 'products', t), strings.review_merge_permission_required)
  assert.equal(reviewApprovalRefusalText('request_permission_revoked', 'products', t), strings.request_permission_revoked, 'the products requester text')
  assert.equal(reviewApprovalRefusalText('request_permission_revoked', 'branches', t), null, 'a branch request keeps its own branch wording')
}
console.log('PASS every approval-merge refusal the Worker raises reads in EN and KM')

// --- the page and the transport carry the confirmation ---------------------------------------------------------------
const transport = read('../src/api/reviewQueueTransport.ts')
assert.match(transport, /approvePendingAction\(id: number, confirmMergeInto\?: number\)/, 'the transport takes the confirmed product id')
assert.match(transport, /\{ confirm_merge_into: confirmMergeInto \}/, 'and sends it as confirm_merge_into, the field the Worker reads')
assert.match(transport, /confirmMergeInto === undefined \? undefined :/, 'an approval that confirms nothing sends no body')
const worker = read('../../cloudflare/src/routes/reviewQueue.ts')
assert.match(worker, /\.confirm_merge_into/, 'the Worker reads the same field name')
const page = read('../src/components/review/ReviewQueue.tsx')
assert.match(page, /reviewMergePreview\(error\)/, 'the page turns a merge refusal into the dialog')
assert.match(page, /handleApprove\(draft\.row, draft\.preview\.survivorId\)/, 'confirming approves again naming the previewed product, never another')
assert.match(page, /review_merge_rest_unapplied/, 'the page says which queued changes the merge did not apply')
assert.match(page, /<ConfirmDialog[^>]*\n\s+t=\{t\}\n\s+title=\{tr\('review_merge_confirm_title'/, 'the shared compact dialog is used, never window.confirm')
assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(page), 'no native confirm()')
console.log('PASS the Review page confirms the previewed product through the shared dialog and the transport sends it')
