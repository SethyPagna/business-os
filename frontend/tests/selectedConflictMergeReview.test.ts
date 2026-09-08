import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'components', 'products', 'SelectedConflictMergeReviewModal.tsx'), 'utf8')

assert.match(source, /item\.before\.keeper\.name[\s\S]*item\.before\.discarded\.name/, 'the keeper and discarded identities are visible together')
assert.match(source, /item\.before\.keeper\.barcode[\s\S]*item\.before\.discarded\.barcode/, 'both exact identity barcodes remain visible')
assert.match(source, /item\.before\.keeper\.is_active[\s\S]*item\.before\.discarded\.is_active/, 'authoritative active state is not hidden')
for (const field of ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr']) {
  assert.ok(source.includes(field), `before/after review must render ${field}`)
}
for (const field of ['keeper_quantity', 'discarded_quantity', 'keeper_lot_count', 'discarded_lot_count']) {
  assert.ok(source.includes(field), `before review must show ${field}`)
}
assert.match(source, /const resolvedChoice = choice \|\| \(!item\.needs_stock_choice \? 'merge' : null\)/, 'an unstocked pair can show its deterministic After state without inventing a stock choice')
assert.match(source, /after_by_stock_choice\[resolvedChoice\]/, 'the visible After state follows the explicit stock decision')
assert.match(source, /\(\['merge', 'write_off'\] as const\)\.map/, 'both stock outcomes are offered')
assert.match(source, /checked=\{choice === value\}/)
assert.doesNotMatch(source, /useState<SelectedConflictStockChoice>/, 'the component must not preselect a destructive stock outcome')
assert.match(source, /selectedConflictChoicesComplete\(preview\.cases, choices\)/, 'confirmation waits for every required stock choice')
assert.match(source, /&& !needsRefresh/, 'a stale preview cannot be reconfirmed')
assert.match(source, /onClick=\{onRefresh\}/, 'the operator can explicitly reload a stale manifest')
assert.match(source, /<ConfirmDialog[\s\S]*layer="nested"/, 'one explicit final confirmation sits above the combined review')
assert.match(source, /result\.committedCases\.map/)
assert.match(source, /result\.refusals\.map/)
assert.match(source, /result\.pendingCaseKeys\.map/, 'pending cases remain named separately from committed and refused work')
assert.match(source, /result\.remainingCaseCount == null \? tr\('unknown'/, 'unknown remaining work is never rendered as zero')
assert.match(source, /item\.undoReady[\s\S]*item\.actionHistoryId[\s\S]*item\.undoAvailability === 'pending'[\s\S]*item\.operationId/, 'each committed pair exposes ready, pending, or terminally unavailable Undo truth')
assert.match(source, /unknownOutcome[\s\S]*selected_conflict_unknown_outcome/, 'an uncertain write outcome has a distinct reconciliation message')
assert.match(source, /onClick=\{onClose\}>\{working \? tr\('selected_conflict_cancel_and_refresh'/, 'Cancel remains available during the request and refreshes through the owner')

console.log('PASS selected conflict combined review shows exact before/after, explicit choices, partial truth, and independent undo identities')
