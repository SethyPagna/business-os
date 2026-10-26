// REVQ-A, the Review page half: approving a queued rename that now matches an existing product MERGES it, after the
// approver confirms the kept product. The Worker (cloudflare/src/lib/reviewApply.ts applyApprovedIdentityMerge) refuses
// the unconfirmed approval with the merge preview; the page shows it in the shared confirm dialog and sends the approval
// again naming exactly that product (approve body { confirm_merge_into }). This pins the contract on both sides.
//
// Run: node tests/reviewMergeConfirm.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { reviewApprovalRefusalText, reviewMergePreview } from '../src/api/branchRuleErrors.ts'

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pack = (language: 'en' | 'km') => JSON.parse(read(`../src/lang/${language}.json`)) as Record<string, string>

// --- the preview the Worker sends is read exactly, and nothing else is mistaken for one -------------------------------
const preview = { survivorId: 7, survivorName: 'Rice 5kg', stockMoved: 3, priceAfter: 6, sessionsClosing: 2, restUnapplied: ['description'], fingerprint: 'fp-1' }
assert.deepEqual(reviewMergePreview({ code: 'review_merge_confirm_required', preview }),
  { survivorId: 7, survivorName: 'Rice 5kg', stockMoved: 3, priceAfter: 6, sessionsClosing: 2, restUnapplied: ['description'], fingerprint: 'fp-1', changed: false })
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

// --- the transport and the page carry the confirmation ---------------------------------------------------------------
const transport = read('../src/api/reviewQueueTransport.ts')
assert.match(transport, /approvePendingAction\(id: number, confirmMergeInto\?: number, confirmFingerprint\?: string\)/, 'the transport takes the confirmed product id and fingerprint')
assert.match(transport, /confirm_merge_into: confirmMergeInto, \.\.\.\(confirmFingerprint \? \{ confirm_fingerprint: confirmFingerprint \}/, 'and sends them as the fields the Worker reads')
assert.match(transport, /confirmMergeInto === undefined \? undefined :/, 'an approval that confirms nothing sends no body')
const worker = read('../../cloudflare/src/routes/reviewQueue.ts')
assert.match(worker, /\.confirm_merge_into/, 'the Worker reads the same field name')
assert.match(worker, /confirm_fingerprint/, 'and the same fingerprint field')
const page = read('../src/components/review/ReviewQueue.tsx')
assert.match(page, /reviewMergePreview\(error\)/, 'the page turns a merge refusal into the dialog')
assert.match(page, /handleApprove\(draft\.row, draft\.preview\.survivorId, draft\.preview\.fingerprint\)/, 'confirming approves again naming the previewed product and its fingerprint, never another')
assert.match(page, /review_merge_rest_unapplied/, 'the page says which queued changes the merge did not apply')
assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(page + read('../src/components/review/ReviewMergeDialog.tsx')), 'no native confirm()')
const writes = read('../src/api/productWriteTransport.ts')
assert.match(writes, /updateProduct[\s\S]{0,900}ensureClientRequestId\(\{ \.\.\.getDevicePayload\(\), \.\.\.\(payload \|\| \{\}\) \}, 'product-edit'\)/, 'a product edit carries a client_request_id, so a queued edit can be retried safely')
console.log('PASS the transport sends the confirmed product and fingerprint; the page and product edits are wired to it')

// --- the dialog, rendered ---------------------------------------------------------------------------------------------
const SHELL = `import React from 'react'
export default function Dialog(p) { return React.createElement('section', null,
  React.createElement('h1', null, p.title), React.createElement('p', {className: 'message'}, p.message),
  React.createElement('dl', null, (p.items || []).map((i, n) => React.createElement('div', {key: n}, React.createElement('dt', null, i.label), React.createElement('dd', null, i.value)))),
  p.note ? React.createElement('small', null, p.note) : null,
  React.createElement('button', null, p.confirmLabel), React.createElement('button', null, p.cancelLabel)) }`
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/review/ReviewMergeDialog.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom'],
  plugins: [{ name: 'dialog-shell', setup(builder) {
    // The shared dialog's modal chrome needs the whole app; its content API (title, message, items, note, labels) is what is under test.
    builder.onResolve({ filter: /ConfirmDialog(?:\.tsx)?$/ }, () => ({ path: 'dialog', namespace: 'merge-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'merge-test' }, () => ({ loader: 'js', contents: SHELL }))
  } }],
})
const dialogModule = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), dialogModule, dialogModule.exports)
const Dialog = dialogModule.exports.default
for (const language of ['en', 'km'] as const) {
  const strings = pack(language)
  const tr = (key: string, fallback: string) => strings[key] || fallback
  const base = { preview: { ...preview, restUnapplied: ['selling_price_usd', 'description'], fingerprint: 'fp', changed: false }, tr, t: (key: string) => strings[key], fmtUSD: (v: unknown) => '$' + v, working: false, onConfirm() {}, onClose() {} }
  const html = renderToStaticMarkup(React.createElement(Dialog, base))
  assert.ok(html.includes('Rice 5kg') && html.includes('>3<') && html.includes('$6'), `${language}: kept product, stock moved and price after are on screen`)
  assert.ok(html.includes(strings.review_merge_confirm_rest_unapplied), `${language}: the not-applied list is labelled before the approver confirms`)
  assert.ok(html.includes(strings.review_merge_confirm_required) && !html.includes(strings.review_merge_target_changed), `${language}: first ask uses the confirm sentence`)
  assert.ok(html.includes(strings.review_merge_confirm_sessions_closing.replace('{n}', '2')), `${language}: sessions closing is stated`)
  assert.ok(html.includes(strings.confirm) && html.includes(strings.back), `${language}: Confirm and Back`)
  const none = renderToStaticMarkup(React.createElement(Dialog, { ...base, preview: { ...base.preview, restUnapplied: [], sessionsClosing: 0 } }))
  assert.ok(!none.includes(strings.review_merge_confirm_rest_unapplied), `${language}: no not-applied row when nothing is dropped`)
  assert.ok(!none.includes('<small'), `${language}: no sessions note when none close`)
  const changed = renderToStaticMarkup(React.createElement(Dialog, { ...base, preview: { ...base.preview, changed: true } }))
  assert.ok(changed.includes(strings.review_merge_target_changed), `${language}: a changed merge says so`)
  assert.ok(!/approve again/i.test(strings.review_merge_target_changed), `${language}: the changed-merge sentence does not send the approver back to Approve (Confirm in this dialog already merges)`)
}
console.log('PASS the merge dialog renders the preview, the not-applied list and the right sentence in EN and KM')
