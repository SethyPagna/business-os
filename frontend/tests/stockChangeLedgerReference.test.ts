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
// Anchored on the conditional itself rather than on the `<td>` that opens the
// cell: the cell carries a leading comment, and a rule that breaks when a
// comment is added is pinning the whitespace, not the order.
const reasonCell = sc.match(/\{model\.reference\.label \? \([\s\S]*?<\/td>/)
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

// The selected movement's product identity follows the same visual order as
// the rows: full name in the modal title, then its barcode before any action
// facts. A separate lower Barcode fact made the identity look like one of many
// unrelated technical fields.
const detailStart = sc.indexOf('{detail ? (')
const detailEnd = sc.indexOf('{adjustType ? (', detailStart)
const movementDetail = sc.slice(detailStart, detailEnd)
assert.ok(detailStart > 0 && detailEnd > detailStart, 'stock movement detail located')
assert.ok(
  movementDetail.indexOf('{detail.barcode}') < movementDetail.indexOf("tr(t, 'date', 'Date')"),
  'the barcode must sit directly under the product title, before the movement summary',
)
assert.doesNotMatch(movementDetail, /tr\(t, 'barcode', 'Barcode'\).*detail\.barcode/, 'barcode must not be repeated as a lower fact card')
console.log('PASS stock movement detail keeps barcode directly under its product title')

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
// (a clock, a signed integer, "128 -> 130"). None of them may grow -- and none
// of them may be STARVED either. A ceiling-only rule is not discriminating: it
// passes a 1rem Type column, which wraps its own chip and doubles the row
// height, which is the same "ugly at large screens" the owner reported, one
// column along. So each fixed column also carries a floor, measured from the
// widest thing it must hold at the dense 13px scale plus the ~16px the cell
// spends on horizontal padding:
//   Time             '19:31' / '––:––'                       ~52 + 16 -> 4rem
//   Type             the longest chip label 'Adjust Quantity'
//                    ~95 + 12 (the chip's own px-1.5) + 16   -> 7.5rem
//   Quantity         the uppercase header 'QUANTITY', wider
//                    than any signed integer under it        ~60 + 16 -> 5rem
//   Before -> After  '1280 → 1300' (the header itself wraps
//                    by design, dense-th-wrap)               ~72 + 16 -> 5.5rem
const NUMERIC_BOUNDS: Array<[string, string, number, number]> = [
  ['Time', time, 4 * 16, 5.5 * 16],
  ['Type', type, 7.5 * 16, 8 * 16],
  ['Quantity', quantity, 5 * 16, 5.5 * 16],
  ['Before -> After', beforeAfter, 5.5 * 16, 7.5 * 16],
]
for (const [label, value, floor, ceiling] of NUMERIC_BOUNDS) {
  assert.ok(rem(value) > 0, `${label} must stay a fixed-width column, found ${value}`)
  assert.ok(
    rem(value) >= floor,
    `${label} is starved and wraps its own content (${value} < ${floor / 16}rem)`,
  )
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
// 140px is the RECEIPT LINE's requirement, not a round number: the cell's
// first line must hold a composed receipt ("Sale 20260901-142200", 20
// characters at the dense 13px scale) plus the compact copy button (16px) and
// its gap, inside the ~16px the cell spends on its own left/right padding.
// 96px (what this asserted before) fits 'Sale 202609...' and nothing more, so
// it passed the very budget that clips the line the lane exists to add.
// Beyond that width the id WRAPS -- the longest return label,
// 'Return RET-20260902-0007', can take a second row at the floor -- because
// the owner's ruling is that a receipt id is never truncated, and a wrapped
// id is still whole while a clipped one is not.
assert.ok(reasonPx >= 140, `the Reason column is left ${Math.round(reasonPx)}px at the ${FLOOR}px floor; the receipt line needs at least 140`)
assert.match(sc, /min-w-\[980px\]/, 'the table keeps its 980px floor -- widening it would add a horizontal scrollbar at 1280')

// ...and the SOURCE must justify that floor with what it GUARANTEES, not with a
// per-character estimate of a string it does not guarantee. The first round sold
// the 140px as room for "the widest receipt this ledger prints,
// 'Return RET-20260902-0007' (~118px + padding)" -- unmeasurable from source,
// and flatly contradicted by the Reason cell two hundred lines below it and by
// the paragraph directly above, both of which say a long return label WRAPS at
// this floor rather than fitting on one line. A comment that disagrees with the
// rule it sits on is worse than no comment: the next reader trims the column to
// the number the comment claims. So the justification is pinned as prose too.
const beforeColgroup = sc.split('<colgroup>')[0]
// Read as one line: the comment is hard-wrapped, so a phrase spanning a line
// break is invisible to a literal regex -- which is how the stale sentence
// survived a round that claimed to have removed it.
const colgroupComment = beforeColgroup.slice(beforeColgroup.lastIndexOf('{/*')).replace(/\s+/g, ' ')
assert.ok(colgroupComment.includes('Reason keeps'), 'the column budget must state what the Reason floor is solved against')
assert.ok(
  !/widest receipt this ledger prints/.test(colgroupComment),
  'the colgroup comment still sizes the Reason floor by a per-character estimate of a label that wraps at that floor',
)
assert.match(
  colgroupComment,
  /wraps onto a second row/,
  'the colgroup comment must say what happens beyond the floor: a longer receipt wraps onto a second row rather than clipping',
)
console.log(`PASS the column budget gives Product ${product} and still leaves Reason ${Math.round(reasonPx)}px at the ${FLOOR}px floor`)

// (d) The clipped name is REVEALABLE through the delegated controller mounted
// by the app shell. The ledger keeps the dense title contract so an ordinary
// row tap still opens the movement; press-and-hold or hover reveals the name.
assert.doesNotMatch(sc, /import TruncatedText/, 'the ledger must not install a competing per-cell reveal component')
assert.match(
  sc,
  /<span className="block dense-cell-truncate font-semibold[^"]*" title=\{row\.product_name\}>\{row\.product_name\}<\/span>/,
  'the desktop product name must opt into the delegated dense-cell reveal',
)

// The receipt line is NOT the same rule. Owner ruling (Sep 6 2026), after the
// first round shipped it through TruncatedText: a receipt id is shown in FULL,
// never truncated, wrapping onto a second row when it must, with the shared
// copy affordance beside it -- and it opens its record where a detail opener
// is reachable from the surface (it is not from here; see the lane report).
// TruncatedText is the opposite bargain: it clips to one line and hands the
// tail back only in a tooltip, and its whole click budget goes on opening that
// tooltip. So the ledger's receipt renders through CopyableId -- the same
// component the Sale detail, the Return detail and this section's own movement
// modal already use -- on BOTH the desktop row and the mobile card, because
// "shows the full id and copies it" is one rule, not a large-screen one.
const receiptRenders = [...sc.matchAll(/<CopyableId([\s\S]*?)\/>/g)].map((m) => m[1])
const rowReceipts = receiptRenders.filter((props) => /value=\{referenceText\(row\)\}/.test(props))
assert.equal(
  rowReceipts.length,
  2,
  `the desktop row and the mobile card must both render the receipt through CopyableId, found ${rowReceipts.length}`,
)
for (const props of rowReceipts) {
  assert.match(props, /\bcompact\b/, 'a ledger row keeps its dense height: the copy affordance uses the compact variant')
  // Displayed as the record, copied as the bare receipt: pasting "Sale " in
  // front of an id into a search box finds nothing, and a receipt id in this
  // business is bare YYYYMMDD-HHMMSS.
  assert.match(props, /copyValue=\{model\.reference\.label\}/, 'the clipboard must get the bare receipt id, not the composed label')
  assert.match(props, /copy_return_id/, 'a return row must offer the return-id copy label')
  assert.match(props, /copy_receipt_number/, 'a sale row must offer the receipt-number copy label')
}
// ...and the component it delegates to must actually keep the id whole and
// keep the copy gesture out of the row's own click, or the two rules above are
// satisfied only on paper.
const copyable = read('components/shared/CopyableId.tsx').replace(/\r\n/g, '\n')
const copyController = read('components/shared/textAffordances.ts').replace(/\r\n/g, '\n')
assert.match(copyable, /whitespace-normal break-all/, 'CopyableId must wrap the id rather than clip it')
// Its own prose uses the word 'truncation'; what matters is that no rendered
// class clips the id, so this reads the code with its comments stripped.
const copyableCode = copyable.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
assert.ok(
  !/\btruncate\b|line-clamp/.test(copyableCode),
  'CopyableId must never clip -- truncation is not legitimate for an identifier',
)
assert.match(copyable, /\[COPY_ATTR\]: String\(copyValue \?\? value\)/, 'the bare receipt copyValue must reach the shared gesture controller')
assert.match(copyable, /data-copy-success=\{copiedLabel\}/, 'the shared controller receives localized Copied feedback')
assert.doesNotMatch(copyableCode, /<button\b|onClick=|navigator\.clipboard|\bunderline\b|text-blue-/, 'ledger references remain plain unchanged text with no visible copy icon or click takeover')
assert.match(copyController, /createLongPressHandlers\([\s\S]*onLongPress/, 'touch copying uses the shared long-press behavior')
assert.match(copyController, /event\.key !== 'Enter' && event\.key !== ' '/, 'keyboard copying supports Enter and Space')
assert.match(copyController, /valueNode\.textContent = success[\s\S]*host\.style\.pointerEvents = 'none'/, 'Copied feedback is nonblocking and appears only after success')
// The receipt must not go back through a clipping wrapper on either surface.
assert.ok(
  !/<TruncatedText text=\{referenceText\(row\)\}/.test(sc),
  'the receipt line must not be clipped by TruncatedText -- an id is shown in full',
)
const clippedReference = sc.split('\n').filter((line) => (
  /\{referenceText\(row\)\}/.test(line) &&
  /\btruncate\b|dense-cell-truncate|line-clamp/.test(line)
))
assert.deepEqual(clippedReference, [], `the receipt line is still clipped:\n${clippedReference.join('\n')}`)
console.log('PASS the clipped product name is revealed, and the receipt is shown in full and copied on both ledger surfaces')

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

// ...and a surface that CLIPS the line it puts the receipt into owes the same
// reveal the ledger owes (section 3d): a receipt id is what a person copies
// out of a history row, so a `title` on a `truncate` span is a dead end on
// touch. Only the two surfaces that clip with no other way out are listed --
// the movements drill wraps its receipt in a full-width header line, and the
// product detail report's collapsed line expands into a "Source" row that
// prints the receipt in full, so neither hides anything.
const CLIPPED_RECEIPT_LINES: Array<[string, string, string]> = [
  ['Batch day movements', 'components/inventory/ManageBatchesModal.tsx', 'factLine'],
  ['Product history preview', 'components/inventory/ProductHistoryPreviewModal.tsx', 'factLine'],
]
for (const [label, path, expr] of CLIPPED_RECEIPT_LINES) {
  const source = read(path).replace(/\r\n/g, '\n')
  const deadEnd = source.split('\n').filter((line) => (
    new RegExp(`title=\\{${expr}\\}`).test(line) &&
    /\btruncate\b|line-clamp/.test(line)
  ))
  assert.deepEqual(deadEnd, [], `${label} clips the line carrying the receipt behind a dead-end title:\n${deadEnd.join('\n')}`)
  assert.match(
    source,
    new RegExp(`<TruncatedText\\s+text=\\{${expr}\\}`),
    `${label} must reveal its clipped receipt line through the shared TruncatedText`,
  )
  console.log(`PASS ${label} reveals the clipped line that carries the receipt`)
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

// The /movements CSV is the fifth reader, and it is the one that silently
// dropped the receipt: buildMovementRows shipped {Date, Activity, Products,
// Records, Qty, Total_Cost_USD, Branch, Reason, User} -- every column the
// drill header shows EXCEPT the record the group belongs to. A ledger export
// that cannot be matched back to a receipt is the owner's complaint in a
// spreadsheet, so the export composes it from the SAME two functions the drill
// header uses, never from a fourth wording of its own.
const movementExport = read('components/inventory/inventoryExport.ts').replace(/\r\n/g, '\n')
const movementRows = movementExport.match(/function buildMovementRows\([\s\S]*?\n\}/)
assert.ok(movementRows, 'inventoryExport must build the movement CSV rows in one place')
assert.match(movementRows[0], /\bReceipt:/, 'the /movements CSV must carry the receipt column the drill header shows')
assert.match(
  movementRows[0],
  /Receipt: formatHistoryReference\(/,
  'the export must compose the receipt through the shared composition, not re-word it',
)
assert.match(
  movementExport,
  /from '(\.\.\/)+utils\/historyRowModel\.ts'/,
  'the export must take the composition from the shared row model',
)

// ...and the group-level pick ("read across the WHOLE group, not the visible
// page") is itself one implementation, not a lambda copied into each reader:
// the drill's copy and the export's copy would be free to disagree about which
// row of a mixed group names the record.
assert.match(movementExport, /historyGroupReference\(/, 'the export must pick the group reference through the shared helper')
const drill = read('components/inventory/InventoryMovementsSurface.tsx').replace(/\r\n/g, '\n')
assert.match(drill, /historyGroupReference\(group\.items\)/, 'the drill header must pick the group reference through the same shared helper')
for (const [label, source] of [['drill', drill], ['export', movementExport]] as Array<[string, string]>) {
  assert.ok(
    !/\.map\(historyReference\)\s*\.find\(/.test(source),
    `${label} still inlines its own group-reference pick instead of the shared helper`,
  )
}
console.log('PASS the /movements CSV names the record from the same composition as the drill header')
