import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'
import { unknownSaveFallback } from '../src/components/inventory/inventoryCheckSaveText.ts'

// Count tasks round 5: each assertion failed on the round-4 tip.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const panel = read('../src/components/inventory/InventoryCheckApprovalPanel.tsx')
const page = read('../src/components/inventory/InventoryChecksPage.tsx')
const controller = read('../src/components/inventory/inventoryCheckApprovalController.ts')
const tasksHook = read('../src/components/inventory/useInventoryCheckTasks.ts')

// 1. No received date: reject the line and fix the stock with Set. Receiving would add the found units twice.
const NO_LOT_EN = "No received date, so this count can't be approved. Reject it, then use Set on Products."
assert.equal(en.inventory_check_error_no_lot, NO_LOT_EN)
assert.equal(REFUSAL_MESSAGES.inventory_check_no_lot.fallback, NO_LOT_EN, 'the fallback is the pack text')
assert.ok(!/receive it first/i.test(en.inventory_check_error_no_lot + REFUSAL_MESSAGES.inventory_check_no_lot.fallback), 'it no longer says to receive first')
assert.ok(/[ក-៿]/.test(km.inventory_check_error_no_lot) && !/\bSet\b/.test(km.inventory_check_error_no_lot), 'the Khmer is Khmer, with no English Set')
assert.ok(km.inventory_check_error_no_lot.includes(km.batch_date) && km.inventory_check_error_no_lot.includes(km.adjust_set) && km.inventory_check_error_no_lot.includes(km.inventory_check_reject), 'the Khmer uses the pack terms for received date, Set and reject')

// 2. The short reason.
assert.equal(en.inventory_check_reason_no_lot, 'No received date')
assert.equal(km.inventory_check_reason_no_lot, 'គ្មានថ្ងៃចូល')
assert.ok(panel.includes("fallback: 'No received date' }"), 'the panel fallback matches')

// 3. Stale fallbacks equal the pack text.
assert.equal(REFUSAL_MESSAGES.branch_redirect_required.fallback, en.branch_redirect_required)
assert.ok(read('../src/components/inventory/InventoryCheckListRows.tsx').includes("'label_cost', 'Cost price'"), 'the list row cost label fallback matches the pack')
assert.ok(!page.includes('Retry the same check to recover') && !page.includes('Retry the same check or reload'), 'no stale row-level fallback')
assert.ok(!controller.includes("'Save not confirmed.") && !tasksHook.includes("'Save not confirmed."), 'no stale approval fallback')
assert.equal(unknownSaveFallback('inventory_check_save_unknown'), en.inventory_check_save_unknown)
assert.equal(unknownSaveFallback('inventory_check_saved_refresh'), en.inventory_check_saved_refresh)

console.log('inventoryCheckT2R5 ok')
