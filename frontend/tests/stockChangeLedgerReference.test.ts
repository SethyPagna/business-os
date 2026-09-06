// O3 / N13 (owner, Sep 6 2026): "in stock change, still did not show details
// for sales, branch, supplier, reason, barcode still placed very ugly in large
// screens."
//
// Two defects, pinned two ways.
//
// PART 1 is behavioural: the shared history row model now answers a fourth
// question -- WHICH RECORD a movement belongs to. Red on 3a94368f, where
// historyReference / formatHistoryReference do not exist at all and
// buildHistoryRowModel returns no `reference`.
//
// PART 2 is structural, because the second defect is geometry. The ledger's
// desktop table gave Product 18% of a 1005px content width (~180px at 1280)
// while four fixed-width numeric columns -- a clock, a signed integer,
// "128 -> 130" -- held width they cannot use, so a real product name was cut
// after a third of itself with only a `title` tooltip behind it. A tooltip is
// not an affordance: nothing marks the "…" as openable and a tap cannot reach
// it. A behavioural test cannot see a column budget or a component choice, and
// both regressions come back through a careless JSX edit.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildHistoryRowModel,
  formatHistoryReference,
  historyReference,
} from '../src/utils/historyRowModel.ts'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

// ---- 1. the record a movement row names ------------------------------------

// The imported legacy sale the owner is looking at. Its reason carries the old
// system's "<receipt>@<date>" text; the receipt itself comes from the sales row
// the Worker resolved, and the two must never be confused (receipt ids in this
// business are bare YYYYMMDD-HHMMSS -- an "@date" suffix is not a receipt).
const importedSale = {
  branch_name: 'Shop',
  user_name: 'Old system',
  reason: 'Old-system sale 004419@2026-09-01',
  barcode: '8800000000011',
  reference_kind: 'sale',
  reference_label: '20260901-142200',
}
const saleModel = buildHistoryRowModel(importedSale)
assert.deepEqual(saleModel.reference, { kind: 'sale', label: '20260901-142200' })
assert.equal(saleModel.reason, 'Old-system sale 004419@2026-09-01', 'the legacy text stays in the reason line')
const words = { sale: 'Sale', return: 'Return' }
assert.equal(formatHistoryReference(saleModel.reference, words), 'Sale 20260901-142200')
assert.ok(!formatHistoryReference(saleModel.reference, words).includes('@'), 'a displayed receipt never carries the legacy @date suffix')

// A return names its return number with the return word.
assert.equal(
  formatHistoryReference(historyReference({ reference_kind: 'return', reference_label: 'RET-20260902-0007' }), words),
  'Return RET-20260902-0007',
)

// A kind with no label is NOT a reference: "Sale" alone says nothing the Type
// column has not already said, so nothing is rendered.
assert.deepEqual(historyReference({ reference_kind: 'sale', reference_label: null }), { kind: null, label: '' })
assert.deepEqual(historyReference({ reference_kind: 'sale', reference_label: '   ' }), { kind: null, label: '' })
assert.equal(formatHistoryReference({ kind: 'sale', label: '' }, words), '')

// An unknown kind still shows the receipt rather than swallowing it -- the
// label is the fact; the word in front of it is only a courtesy.
assert.equal(formatHistoryReference(historyReference({ reference_kind: 'shipment', reference_label: 'X-1' }), words), 'X-1')

// A stock row (add / remove / transfer) names no record and must not invent one.
assert.deepEqual(buildHistoryRowModel({ branch_name: 'Shop', reason: 'Shipment' }).reference, { kind: null, label: '' })
assert.deepEqual(buildHistoryRowModel(null).reference, { kind: null, label: '' }, 'a null row must not throw')

// A sale row that carries ONLY its receipt is not "bare": the receipt is the
// fact that makes it identifiable, and the bare-row branch would have printed
// one placeholder instead of it.
assert.equal(buildHistoryRowModel({ reference_kind: 'sale', reference_label: '20260901-193100' }).isBare, false)
assert.equal(buildHistoryRowModel({}).isBare, true)
console.log('PASS the shared row model names the record a movement belongs to, and never invents one')

// ---- 2. every renderer of a ledger row shows it ----------------------------

const sc = read('components/products/StockChangeSection.tsx').replace(/\r\n/g, '\n')

// The desktop Reason cell leads with the record and keeps the free text under
// it -- that ORDER is the fix: the reason line was all there was before.
const reasonCell = sc.match(/<td>\s*\{model\.reference\.label \? \([\s\S]*?<\/td>/)
assert.ok(reasonCell, 'the desktop Reason cell must render the receipt line before the reason line')
assert.ok(
  reasonCell[0].indexOf('referenceText(row)') < reasonCell[0].indexOf('{model.reason}'),
  'the receipt must lead the Reason cell, with the free-text reason under it',
)

// ...and so do the mobile card, the CSV export and the detail modal, all from
// the ONE composition, so the four renderers cannot word it four ways.
assert.match(sc, /const referenceText = useCallback\(/, 'the section must compose the reference once, not per renderer')
assert.match(sc, /receipt: historyExportField\(referenceText\(row\)\)/, 'the CSV export must carry the receipt column the table shows')
assert.ok((sc.match(/referenceText\(row\)/g) || []).length >= 3, 'the desktop row, the mobile card and the export must all use the shared composition')
assert.match(sc, /<CopyableId/, 'the detail modal must show the receipt through the shared copyable-id component, never truncated')
console.log('PASS the receipt reaches the table, the card, the detail modal and the CSV export from one composition')

// ---- 3. the column budget --------------------------------------------------

const colgroup = sc.match(/<colgroup>([\s\S]*?)<\/colgroup>/)
assert.ok(colgroup, 'the Stock Change desktop table must declare its column budget')
const widths = [...colgroup[1].matchAll(/<col className="w-\[([^\]]+)\]"/g)].map((m) => m[1])
const auto = (colgroup[1].match(/<col \/>/g) || []).length
assert.equal(widths.length + auto, 9, 'the ledger has nine columns: time, product, type, quantity, before/after, branch, supplier, user, reason')

const rem = (value: string): number => (value.endsWith('rem') ? Number.parseFloat(value) * 16 : 0)
const pct = (value: string): number => (value.endsWith('%') ? Number.parseFloat(value) : 0)
const [time, product, type, quantity, beforeAfter, branch, supplier, user] = widths

// (a) Product gets a real share. 18% -- what it held -- is ~180px of the
// 1005px content width at 1280, which cuts "L'Occitane Hand Cream Shea Butter
// 20% 150ml" after a third of itself.
assert.ok(pct(product) >= 24, `Product must hold at least 24% of the row, found ${product}`)
assert.ok(
  pct(product) > Math.max(pct(branch), pct(supplier), pct(user)),
  'Product must be the widest proportional column -- it holds the longest value in the row',
)

// (b) ...and it is paid for by the numeric columns, whose content is bounded
// (a clock, a signed integer, "128 -> 130"). None of them may grow.
const NUMERIC_CEILING: Array<[string, string, number]> = [
  ['Time', time, 5.5 * 16],
  ['Type', type, 8 * 16],
  ['Quantity', quantity, 5.5 * 16],
  ['Before -> After', beforeAfter, 7.5 * 16],
]
for (const [label, value, ceiling] of NUMERIC_CEILING) {
  assert.ok(rem(value) > 0, `${label} must stay a fixed-width column, found ${value}`)
  assert.ok(rem(value) <= ceiling, `${label} must not take width from Product (${value} > ${ceiling / 16}rem)`)
}

// (c) The budget still fits the table's own 980px floor with room left for the
// Reason column, which now carries two lines. A budget that overflows would
// put a horizontal scrollbar under a 1280px viewport -- trading one owner
// complaint for another.
const FLOOR = 980
const fixedPx = widths.reduce((sum, value) => sum + rem(value), 0)
const percentPx = widths.reduce((sum, value) => sum + (pct(value) / 100) * FLOOR, 0)
const reasonPx = FLOOR - fixedPx - percentPx
assert.ok(reasonPx >= 96, `the Reason column is left ${Math.round(reasonPx)}px at the ${FLOOR}px floor; it needs at least 96`)
assert.match(sc, /min-w-\[980px\]/, 'the table keeps its 980px floor -- widening it would add a horizontal scrollbar at 1280')
console.log(`PASS the column budget gives Product ${product} and still leaves Reason ${Math.round(reasonPx)}px at the ${FLOOR}px floor`)

// (d) The clipped name is REVEALABLE, through the shared component -- not a
// bare `title`, which shows no affordance and cannot be opened by tap.
assert.match(sc, /import TruncatedText from '\.\.\/shared\/TruncatedText\.tsx'/, 'the ledger must use the shared TruncatedText')
assert.match(sc, /<TruncatedText text=\{row\.product_name\}/, 'the desktop product name must render through TruncatedText')
// Scoped to a CLIPPED name: the mobile card wraps the name in full
// (`break-words`, no clamp), so its tooltip reveals nothing that is hidden and
// is not this rule's business. A clipped one is.
const titledName = sc.split('\n').filter((line) => (
  /\{row\.product_name\}<\/span>/.test(line) &&
  /title=\{row\.product_name\}/.test(line) &&
  /\btruncate\b|dense-cell-truncate|line-clamp/.test(line)
))
assert.deepEqual(titledName, [], `a clipped product name is still a dead-end title tooltip:\n${titledName.join('\n')}`)
console.log('PASS the product name is revealed through the shared TruncatedText, not a dead-end title')

// ---- 4. sibling parity: every reader of a movement row says the same thing --

// A movement row is rendered by five surfaces, all fed by the two endpoints
// that now resolve the record (/products/stock-ledger and
// /inventory/movements). A receipt that appears on one of them and not the
// others is the SAME defect the owner reported, one surface along -- so the
// rule is pinned per surface, not once.
const SIBLINGS: Array<[string, string]> = [
  ['Inventory movement drill', 'components/inventory/InventoryMovementsSurface.tsx'],
  ['Product history preview', 'components/inventory/ProductHistoryPreviewModal.tsx'],
  ['Batch day movements', 'components/inventory/ManageBatchesModal.tsx'],
  ['Product detail report', 'components/products/surfaces/ProductDetailReport.tsx'],
]
for (const [label, path] of SIBLINGS) {
  const source = read(path).replace(/\r\n/g, '\n')
  assert.match(source, /formatHistoryReference/, `${label} must name the record through the same shared composition`)
  assert.match(
    source,
    /from '(\.\.\/)+utils\/historyRowModel\.ts'/,
    `${label} must take the composition from the shared model, not re-word it locally`,
  )
  console.log(`PASS ${label} names the record through the same shared composition`)
}

// The product detail report's "Source" row is the one that printed the raw
// sales.id -- "Sale #742", a number that identifies nothing to a person and
// is not what they would search for. The raw id may only survive as the
// FALLBACK for a row that names no record (a stock-in session token, a
// revert), never as the answer when the receipt is known.
const report = read('components/products/surfaces/ProductDetailReport.tsx').replace(/\r\n/g, '\n')
const bareId = report.split('\n').filter((line) => (
  /#\{row\.reference_id\}|#\$\{row\.reference_id\}/.test(line) && !/receipt \|\|/.test(line)
))
assert.deepEqual(bareId, [], `the detail report still prints a bare reference id with no receipt in front of it:\n${bareId.join('\n')}`)
console.log('PASS the product detail report names the receipt and keeps the raw id only as a fallback')
