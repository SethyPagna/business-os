// N13 -- one row model for every history surface.
//
// Part 1 is BEHAVIOURAL and discriminating: it feeds the model the exact rows
// that used to render four different ways (a table cell printing '—', a detail
// footer printing '--', a mobile card and an Inventory drill printing nothing
// at all) and asserts one answer.
//
// Part 2 pins that the surfaces actually call the model, so the four renderers
// of a single ledger row cannot drift apart again.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HISTORY_EMPTY,
  buildHistoryRowModel,
  historyActor,
  historyExportField,
  historyField,
} from '../src/utils/historyRowModel.ts'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

// ---- 1. behaviour ----------------------------------------------------------

// The row the owner screenshotted: a Sale movement with no branch snapshot and
// no reason. Every surface must say the same thing about it.
const saleRow = { branch_name: null, user_name: 'za', reason: null, barcode: '8800000000011' }
const model = buildHistoryRowModel(saleRow)
assert.equal(model.branch, HISTORY_EMPTY, 'a missing branch renders as the shared placeholder, not as nothing')
assert.equal(model.actor, 'za')
assert.equal(model.reason, HISTORY_EMPTY)
assert.equal(model.barcode, '8800000000011')
assert.equal(model.isBare, false, 'a row with an actor is not bare')

// Every "absent" shape the API can produce collapses to ONE placeholder --
// null, undefined, '' and whitespace all used to render differently.
for (const absent of [null, undefined, '', '   ', '\t']) {
  assert.equal(historyField(absent), HISTORY_EMPTY, `absent value ${JSON.stringify(absent)} must render as ${HISTORY_EMPTY}`)
  assert.equal(historyActor(absent), HISTORY_EMPTY, `absent actor ${JSON.stringify(absent)} must render as ${HISTORY_EMPTY}`)
}
assert.notEqual(HISTORY_EMPTY, '--', 'the placeholder is a single em dash, not the old double hyphen')

// A stored value is shown EXACTLY as the server stored it. The actor snapshot
// is the account username; this layer must not swap in a display name, and it
// has no second identity available to swap in even if it wanted to.
assert.equal(historyActor('za'), 'za')
assert.equal(historyActor(' za '), 'za', 'surrounding whitespace is trimmed, the value is not')
assert.equal(historyActor('Za Sethy'), 'Za Sethy', 'a legacy full-name snapshot is displayed verbatim, never rewritten client-side')
assert.equal(buildHistoryRowModel.length, 1, 'the row model takes the row and nothing else -- no fallback actor can be passed in')

// A completely empty row is honestly bare rather than three blank cells.
const bare = buildHistoryRowModel({})
assert.equal(bare.branch, HISTORY_EMPTY)
assert.equal(bare.actor, HISTORY_EMPTY)
assert.equal(bare.reason, HISTORY_EMPTY)
assert.equal(bare.isBare, true)
assert.equal(buildHistoryRowModel(null).isBare, true, 'a null row must not throw')

// Exports get an empty cell, never a dash that would be read back as data.
assert.equal(historyExportField(null), '')
assert.equal(historyExportField('  '), '')
assert.equal(historyExportField('Warehouse'), 'Warehouse')

// Numbers (a branch id leaking into a name column) are rendered, not dropped.
assert.equal(historyField(2), '2')
assert.equal(historyField(Number.NaN), HISTORY_EMPTY)

console.log('PASS history row model: one placeholder, verbatim server values, no client-side actor fallback')

// ---- 2. every history surface uses it --------------------------------------

const SURFACES: Array<[string, string]> = [
  ['Stock Change ledger', 'components/products/StockChangeSection.tsx'],
  ['Inventory movement drill', 'components/inventory/InventoryMovementsSurface.tsx'],
  ['Inventory product history preview', 'components/inventory/ProductHistoryPreviewModal.tsx'],
  ['Batch day movements', 'components/inventory/ManageBatchesModal.tsx'],
  ['Transfer History', 'components/branches/Branches.tsx'],
  ['Audit Log', 'components/utils-settings/AuditLog.tsx'],
]

for (const [label, path] of SURFACES) {
  const source = read(path)
  assert.match(source, /from '(\.\.\/)+utils\/historyRowModel\.ts'/, `${label} must render its branch/actor/reason through the shared history row model`)
  assert.ok(
    /historyField\(|historyActor\(|buildHistoryRowModel\(|historyExportField\(/.test(source),
    `${label} imports the row model but never calls it`,
  )
  // The old per-surface placeholders are what made the same fact read four
  // different ways ('--' here, 'N/A' there, '-' in the next table, nothing at
  // all in the fourth). None of them may come back on a branch/actor/reason
  // line. Scoped to those lines on purpose: an unrelated field's own empty
  // marker is not this module's business.
  const offenders = source.split(/\r?\n/)
    .map((line, index) => [index + 1, line] as [number, string])
    .filter(([, line]) => /branch_name|user_name|\breason\b/.test(line))
    .filter(([, line]) => /\|\|\s*'(--|-|N\/A)'/.test(line))
  assert.deepEqual(offenders, [], `${label} still uses a per-surface placeholder for a history field:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')}`)
  console.log(`PASS ${label} renders branch / actor / reason through the shared model`)
}

// The Stock Change ledger is the surface the owner reported: its four
// renderers (desktop row, mobile card, detail view, CSV) must all be on it.
const stockChanges = read('components/products/StockChangeSection.tsx')
const modelCalls = (stockChanges.match(/buildHistoryRowModel\(/g) || []).length
assert.ok(modelCalls >= 3, `Stock Change must build the row model in each renderer, found ${modelCalls}`)
assert.match(stockChanges, /historyExportField\(/, 'the Stock Change CSV export must use the export placeholder')
console.log(`PASS Stock Change builds the shared row model in ${modelCalls} renderers`)
