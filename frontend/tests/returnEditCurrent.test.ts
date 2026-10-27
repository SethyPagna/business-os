// 6.0.997 slice S1: the Edit Return screen for a current-format customer return (reason, notes, handling method, per-line stock
// handling). The Worker is the enforcement (cloudflare/scripts/test-return-edit-v1-native.cjs: 200 for a manager and an admin, 403 for
// Review / Edit-off / View, money asserted unchanged); this pins the screen to the same rules so it never offers an edit the Worker
// refuses, never sends a money figure, and never shows the Worker's English or the words format / v0 / v1.
//
// Run: node tests/returnEditCurrent.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildCurrentEditBody, canEditCurrentReturns, CURRENT_EDIT_CODES, currentEditFailureText, currentReturnEditAccess, draftChanged, initialDraft,
  isCurrentFormatCustomerReturn, isStaleEdit, reviewRows, type CurrentReturn, type EditPreview,
} from '../src/components/returns/helpers/returnEditCurrent.ts'
import { canConvertLegacyReturns } from '../src/components/returns/helpers/returnLegacyConvert.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

// --- who is offered the form (the Worker's getActionTier(user, 'returns', 'edit') === 'full') -----------------------------
const admin = { role_code: 'admin', permissions: '{}' }
const manager = { role_code: 'manager', permissions: JSON.stringify({ returns: true }) }
const reviewer = { role_code: 'manager', permissions: JSON.stringify({ returns: 'review' }) }
const editOff = { role_code: 'manager', permissions: JSON.stringify({ returns: true, 'returns:edit': false }) }
const viewer = { role_code: 'staff', permissions: JSON.stringify({ returns: 'view' }) }
const ret = (extra: Record<string, unknown> = {}): CurrentReturn => ({ id: 5, money_precision_version: 1, return_scope: 'customer', status: 'completed', updated_at: '2026-10-27T01:00:00.000Z',
  reason: 'Wrong size', notes: null, return_type: 'restock',
  items: [{ id: 11, sale_item_id: 101, product_id: 1, product_name: 'Widget', quantity: 3, stock_action: 'restock' },
    { id: 12, sale_item_id: 102, product_id: 2, product_name: 'Gadget', quantity: 1, stock_action: 'damaged' }], ...extra })
for (const [name, user, expected] of [['admin', admin, 'form'], ['manager', manager, 'form'], ['review', reviewer, 'ask_manager'], ['edit off', editOff, 'ask_manager'], ['view', viewer, 'ask_manager']] as const) {
  assert.equal(currentReturnEditAccess(ret(), user), expected, name)
  assert.equal(canEditCurrentReturns(user), canConvertLegacyReturns(user), `${name}: the same tier rule as updating money details`)
}
assert.equal(currentReturnEditAccess(ret({ status: 'cancelled' }), admin), 'cancelled', 'a cancelled return says restore it first, for everyone')
assert.equal(currentReturnEditAccess(ret({ money_precision_version: 0 }), admin), null, 'an older-form return is not this screen')
assert.equal(currentReturnEditAccess(ret({ return_scope: 'supplier' }), admin), null, 'supplier returns are not this screen')
assert.equal(isCurrentFormatCustomerReturn(null), false)
// Worker parity: the Worker's helper IS the money-details one (one rule, two surfaces).
const worker = read('../../cloudflare/src/lib/returnEditV1.ts')
assert.match(worker, /export const canEditCurrentReturns = canConvertLegacyReturns/)
assert.match(read('../src/components/returns/helpers/returnEditCurrent.ts'), /export const canEditCurrentReturns = \(user: PermissionUser\): boolean => canConvertLegacyReturns\(user\)/)
console.log('PASS who is offered the current-format edit: admins and managers with full Returns access; everyone else is told to ask')

// --- the body: never money, quantities unchanged, a tag only when chosen -----------------------------------------------------
const draft = initialDraft(ret())
assert.deepEqual(draft.lines.map((line) => line.action), ['restock', 'damaged'])
assert.equal(draftChanged(ret(), draft), false, 'nothing touched: nothing to save')
const body = buildCurrentEditBody(ret(), draft) as { items: Array<Record<string, unknown>> } & Record<string, unknown>
assert.deepEqual(Object.keys(body).sort(), ['expected_updated_at', 'items', 'notes', 'reason', 'return_type'])
for (const key of ['total_refund_usd', 'total_refund_khr', 'refund_currency', 'branch_id', 'applied_price_usd', 'cost_price_usd']) {
  assert.ok(!(key in body) && body.items.every((item) => !(key in item)), `the body never carries ${key}`)
}
assert.deepEqual(body.items.map((item) => [item.id, item.quantity, item.stock_action]), [[11, 3, 'restock'], [12, 1, 'damaged']], 'quantities go back exactly as stored')
assert.ok(body.items.every((item) => !('condition_tag' in item)), 'an untouched damaged line keeps the tag it has')
assert.equal(body.notes, null)
assert.equal(body.expected_updated_at, '2026-10-27T01:00:00.000Z')
const changedDraft = { ...draft, reason: '  Damaged box ', notes: ' note ', lines: [{ ...draft.lines[0], action: 'damaged' as const, tag: 'expired', tagTouched: true }, { ...draft.lines[1], action: 'none' as const }] }
const changedBody = buildCurrentEditBody(ret(), changedDraft) as { items: Array<Record<string, unknown>> } & Record<string, unknown>
assert.equal(changedBody.reason, 'Damaged box'); assert.equal(changedBody.notes, 'note')
assert.deepEqual(changedBody.items.map((item) => [item.stock_action, item.condition_tag ?? null]), [['damaged', 'expired'], ['none', null]], 'a tag rides only on a damaged line the person tagged')
assert.equal(draftChanged(ret(), changedDraft), true)
assert.equal(draftChanged(ret(), { ...draft, reason: 'Other' }), true)
assert.equal(draftChanged(ret(), { ...draft, notes: 'x' }), true)
assert.equal(draftChanged(ret(), { ...draft, returnType: 'refund' }), true)
assert.equal(draftChanged(ret(), { ...draft, lines: [draft.lines[0], { ...draft.lines[1], tag: 'broken', tagTouched: true }] }), true, 're-tagging an existing damaged line counts')
assert.equal(draftChanged(ret(), { ...draft, reason: ' Wrong size ' }), false, 'spacing alone is not a change')
console.log('PASS the edit body carries quantities as stored and never a refund, currency, price, cost or branch')

// --- the review dialog rows ---------------------------------------------------------------------------------------------------
const preview: EditPreview = { digest: 'd', changed: true,
  header: [{ field: 'return_type', before: 'restock', after: 'refund' }, { field: 'reason', before: 'Wrong size', after: null }],
  lines: [{ id: 11, product_name: 'Widget', quantity: 3, before: 'restock', after: 'damaged', tag_before: null, tag_after: 'expired' }],
  stock: [{ product_id: 1, product_name: 'Widget', branch_id: 1, branch_name: 'Shop', batch_id: 500, quantity: -3, kind: 'sellable' },
    { product_id: 1, product_name: 'Widget', branch_id: 1, branch_name: 'Shop', batch_id: 500, quantity: 3, kind: 'damaged' }] }
const rows = reviewRows(preview, (_key, fallback) => fallback)
assert.deepEqual(rows.map((row) => row.value), ['Restock → Refund Only', 'Wrong size → —', 'Restock → Damaged (expired)', '-3', '+3 Damaged'])
assert.deepEqual(rows.map((row) => row.label), ['Handling Method', 'Return reason', 'Widget', 'Widget · Shop', 'Widget · Shop'])
assert.ok(rows.every((row) => !/refund \$|total_refund/i.test(row.value)), 'no money row: it does not move')
assert.equal(reviewRows(preview, (key, fallback) => (key === 'stock_action_damaged' ? 'ខូច' : fallback))[2].value, 'Restock → ខូច (expired)', 'words come from the pack')
console.log('PASS the review rows say what moves, before -> after, in the reader\'s language')

// --- every Worker refusal has a sentence in both packs, none with the retired words ------------------------------------------------
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const workerCodes = new Set([...worker.matchAll(/,\s*(?:400|403|404|409|503),\s*'([a-z_]+)'/g)].map((match) => match[1]))
// undo_* codes belong to History (the same three sentences updating money details already uses), not to this screen.
for (const code of [...workerCodes]) if (code.startsWith('undo_')) workerCodes.delete(code)
assert.ok(workerCodes.size >= 20, `found the Worker's refusal codes (${workerCodes.size})`)
for (const code of workerCodes) assert.ok(CURRENT_EDIT_CODES.includes(code), `Worker code ${code} has a sentence on the screen`)
for (const code of CURRENT_EDIT_CODES) {
  assert.ok(en[code] && km[code], `${code} is in both packs`)
  assert.match(km[code], /[ក-៿]/, `${code} is Khmer`)
  assert.ok(!/\bformat\b|\bv0\b|\bv1\b/i.test(en[code]), `${code} never says format / v0 / v1`)
  const sentence = currentEditFailureText(Object.assign(new Error('x'), { code, params: { product: 'Serum', available: 2, needed: 3, branch: 'Shop' } }), (key, fallback) => (key === code ? en[code] : fallback))
  assert.ok(sentence && !/\{\w+\}/.test(sentence), `${code} resolves with its figures: ${sentence}`)
}
assert.equal(currentEditFailureText(Object.assign(new Error('x'), { code: 'return_edit_stock_too_low', params: { product: 'Serum', available: 2, needed: 3, branch: 'Shop' } }), (_k, f) => f),
  'Only 2 of Serum are in stock at Shop, and 3 must be taken back. Count it with Set, then edit again.')
assert.equal(currentEditFailureText(new Error('plain'), (_k, f) => f), null, 'an uncoded failure keeps the loader message')
assert.equal(isStaleEdit({ code: 'return_edit_preview_stale' }), true)
assert.equal(isStaleEdit({ code: 'return_edit_money_locked' }), false)
for (const key of ['return_edit_ask_manager', 'return_edit_review_title', 'return_edit_review_message', 'return_edit_done', 'return_edit_nothing', 'return_edit_qty_locked', 'return_edit_keep_tag',
  'return_edit_history_one', 'return_edit_history_undo', 'return_edit_history_redo', 'stock_action_label', 'stock_tag_label']) {
  assert.ok(en[key] && km[key], `${key} is in both packs`)
  assert.ok(!/\bformat\b|\bv0\b|\bv1\b/i.test(en[key]), `${key} never says format / v0 / v1`)
}
assert.ok(!('return_v1_edit_unavailable' in en) && !('return_v1_edit_unavailable' in km), 'the unreachable net-refund sentence is retired in both packs')
console.log('PASS every Worker refusal has a short sentence in both packs, with its figures')

// --- the wiring ------------------------------------------------------------------------------------------------------------------
const modal = read('../src/components/returns/EditReturnModal.tsx')
assert.match(modal, /if \(editLock === 'exact_return'\) \{\s*const access = currentReturnEditAccess\(ret, user as never\)/, 'a current-format return opens its own screen from first paint')
assert.ok(!/return_v1_edit_unavailable/.test(modal + read('../src/components/returns/ReturnEditCurrent.tsx')))
const screen = read('../src/components/returns/ReturnEditCurrent.tsx')
assert.ok(!/window\.confirm|\bconfirm\(/.test(screen), 'never the native confirm')
assert.match(screen, /useConfirmDialog/, 'the shared compact review dialog')
assert.match(screen, /edit\/preview/); assert.match(screen, /expected_digest: digest/)
assert.match(screen, /unsavedChanges=\{\{ dirty: dirty\.dirty \}\}/, 'the unsaved-changes guard')
assert.match(screen, /const body = buildCurrentEditBody\(ret, effective\)/, "the only body the screen sends is the pure builder's (no money figure)")
assert.ok(!/refund_currency|cost_price|branch_id/.test(screen) && !/applied_price/.test(screen.replace('applied_price_usd?: number | string | null', '')), 'the screen names no money or branch field to send')
assert.match(read('../src/components/shared/ActionHistoryBar.tsx'), /return\.edit_v1/, 'History shows the edit in the reader\'s language')
assert.match(read('../src/utils/entityRecords.ts'), /'stock_handling\.'/, 'the return\'s Records name the product and what moved')
console.log('PASS the Edit Return screen is wired to the Worker preview/apply, the shared dialog and the unsaved-changes guard')

// --- the return's Records (owner, 27 Oct 2026: every edit and its undo/redo shows before -> after, who, when; the return's own date apart) ---
import { entityFieldLabel, RETURN_RECORDS_ADAPTER, withCreatedRecord } from '../src/utils/entityRecords.ts'
const label = (key: string, fallback: string) => ({ stock_action_label: 'ការគ្រប់គ្រងស្តុក' } as Record<string, string>)[key] ?? fallback
assert.equal(entityFieldLabel('stock_handling.Widget', label), 'ការគ្រប់គ្រងស្តុក - Widget', 'the row names the line and says what moved, in the reader\'s language')
assert.equal(entityFieldLabel('damaged_tag.Gadget', label), 'Tag - Gadget')
assert.equal(entityFieldLabel('reason', label), 'Reason')
const created = withCreatedRecord([{ id: 'audit:9', at: '2026-10-27 08:00:00', actor_username: 'manager', branch_name: null, kind: 'return_updated', via: 'apply', subject: null, changes: [] }], '2026-10-20 09:15:00', 'return:5')
assert.deepEqual(created.map((row) => [row.kind, row.at]), [['create', '2026-10-20 09:15:00'], ['return_updated', '2026-10-27 08:00:00']], 'the return\'s own created date is its own first line')
assert.equal(RETURN_RECORDS_ADAPTER.normalizeKind('create'), 'return_created', 'and reads as "Return recorded", not "Other change"')
assert.equal(withCreatedRecord([{ id: 'audit:1', at: 'x', actor_username: null, branch_name: null, kind: 'return_created', via: null, subject: null, changes: [] }], '2026-10-20', 'return:5').length, 1, 'no second created line when the audit trail has one')
console.log('PASS the return\'s Records name each line and keep the created date as its own line')
