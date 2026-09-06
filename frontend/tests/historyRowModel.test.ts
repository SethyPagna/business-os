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

// ---- 3. O3 + N8: the shape of the Stock Change row -------------------------
// The owner's two complaints were about geometry, not data: the barcode sat
// inline with the product name (wrapping the row and shoving the amount column
// around on a narrow card), and "Edit reason" / "Revert" were bare text links
// among real buttons. Both are structural, so they are pinned structurally --
// a behavioural test cannot see a class name, and these regressions come back
// through a careless JSX edit rather than through logic.
const sc = stockChanges.replace(/\r\n/g, '\n')

// (a) Desktop table: the product cell is exactly two stacked single-line
// cells -- the name, then the barcode on its own muted `dense-id` line.
assert.match(
  sc,
  /<td>\n\s*<span className="block dense-cell-truncate font-semibold[^"]*"[^>]*>\{row\.product_name\}<\/span>\n\s*<span className="block dense-cell-truncate dense-id[^"]*"[^>]*>\{model\.barcode\}<\/span>\n\s*<\/td>/,
  'the desktop product cell must render two stacked `block dense-cell-truncate` spans, the second carrying `dense-id` for the barcode',
)

// (b) ...and the barcode is never emitted on the same line as the name, which
// is the exact shape that used to wrap and stretch the row.
const inlineBarcode = sc.split('\n')
  .map((line, index) => [index + 1, line] as [number, string])
  .filter(([, line]) => /\{row\.product_name\}/.test(line) && /\{model\.barcode\}/.test(line))
assert.deepEqual(inlineBarcode, [], `the barcode is rendered inline with the product name:\n${inlineBarcode.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')}`)

// (c) Mobile card: a dedicated mono barcode line, and it comes BEFORE the
// branch . user . reason row rather than sharing that wrapping chip row.
const mobileBarcode = sc.search(/<div className="[^"]*font-mono[^"]*">\{model\.barcode\}<\/div>/)
assert.ok(mobileBarcode > 0, 'the mobile card must give the barcode its own font-mono line')
const mobileActor = sc.indexOf('{model.actor}</span>')
assert.ok(mobileActor > 0, 'the mobile card must show the actor in the branch / user / reason row')
assert.ok(mobileBarcode < mobileActor, 'the mobile barcode line must come before the branch / user / reason row, not inside it')

// (d) Row actions are real buttons from the app kit, not text links: same
// height / radius / weight as sibling actions, icon + label on desktop,
// icon-only with an aria-label below sm.
const buttons = sc.split('<button').slice(1)
const ROW_ACTIONS: Array<[string, RegExp]> = [
  ['Edit reason', /aria-label=\{tr\(t, 'edit_reason'/],
  ['Revert', /aria-label=\{tr\(t, 'revert'/],
]
for (const [label, aria] of ROW_ACTIONS) {
  const matches = buttons.map((b) => b.slice(0, 900)).filter((head) => aria.test(head))
  assert.ok(matches.length > 0, `${label} row action must be a <button> carrying an aria-label`)
  for (const head of matches) {
    assert.match(head, /className="btn-(secondary|danger)\b/, `${label} must use the shared button kit (btn-secondary / btn-danger), not a text link`)
    assert.match(head, /<span className="hidden sm:inline">/, `${label} must hide its label below sm and stay icon-only there`)
    assert.doesNotMatch(head, /\bunderline\b/, `${label} must not be styled as a link`)
  }
  console.log(`PASS Stock Change ${label} is a button-kit action (${matches.length} site(s))`)
}
console.log('PASS Stock Change barcode has its own line on both the desktop table and the mobile card')
