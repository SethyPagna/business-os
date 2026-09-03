// Pins the Sep 3 2026 ask (user, verbatim):
//
//   "sales the click to view details hasa many not converted to excel tyle
//    like totals, discounts, customers, cashier etc... like i don't mean it
//    has to be excel style but a row view is better instead of current broken
//    view..."
//
// The sale detail was HALF converted, which is what made it read as broken:
// the Totals block was already a label-left / amount-right row list, while
// Sale, Customer and Delivery stacked the label ABOVE the value, and the
// cancelled record wrote its reason as inline prose with a colon. Three
// shapes in one modal. The money block had its own defect on top of that:
// every KHR figure rendered as a bare right-aligned line UNDERNEATH its USD
// row with no label of its own, so the reader met naked numbers -- and the
// membership-discount and refund KHR lines were missing the minus sign their
// own USD row carried.
//
// This test pins the fix: ONE shared row primitive, used by every
// record-detail surface; a money summary that lives in the same table as the
// line items so the amounts column-align; no unlabelled KHR line anywhere;
// and no field lost in the conversion.
//
// Run: node tests/recordDetailRowRhythm.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const rows = read('src/components/shared/DetailRows.tsx')
const saleDetail = read('src/components/sales/SaleDetailModal.tsx')
const returnDetail = read('src/components/returns/ReturnDetailModal.tsx')
const returnsPage = read('src/components/returns/Returns.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- 1. there is ONE shared primitive, not a per-file hand-roll ------------

runTest('the label/value row rhythm is one shared component', () => {
  assert.match(rows, /export function DetailRow\(/, 'DetailRows must export the label/value row')
  assert.match(rows, /export function DetailRowGroup\(/, 'DetailRows must export the row container')
  assert.match(rows, /export function MoneyRow\(/, 'DetailRows must export the money row')
  // The row is a horizontal flex pair with a fixed-width label column -- that
  // fixed column is what makes values line up down the card. A stacked block
  // (label on its own line above the value) is exactly the shape being retired.
  assert.match(rows, /<div className="flex min-w-0 items-baseline gap-3[^"]*">/, 'a DetailRow is a horizontal label/value pair')
  assert.match(rows, /className="w-\[[\d.]+rem\] flex-shrink-0[^"]*text-xs text-gray-400/, 'the label column has a fixed width so values align')
  // MoneyRow is a real table row so the amounts share a column with the line
  // totals above them, right-aligned and tabular so they can be scanned.
  assert.match(rows, /<tr className=/, 'MoneyRow must render a table row')
  assert.match(rows, /text-right tabular-nums/, 'money amounts are right-aligned and tabular')
  // The KHR figure belongs INSIDE its row's own amount cell.
  assert.match(rows, /\{sub \? <div className="text-\[11px\][^"]*">\{sub\}<\/div> : null\}/, 'the secondary (KHR) amount renders inside the same cell as the primary one')
})

for (const [name, source] of [['sale detail', saleDetail], ['return detail', returnDetail]] as const) {
  // --- 2. both record details use it, and nothing stacks any more ----------

  runTest(`${name} renders its fields as shared label/value rows`, () => {
    assert.match(source, /import \{ DetailRow, DetailRowGroup, MoneyRow \} from '\.\.\/shared\/DetailRows\.tsx'/, `${name} must use the shared row primitive`)
    assert.match(source, /<DetailRowGroup>/, `${name} must group its rows`)
    // The retired stacked shapes, verbatim from the old sources: the sale
    // detail's InfoBlock ("mb-1 text-xs text-gray-400" label div above a value
    // div) and the return detail's inline twin ("mb-0.5 text-xs text-gray-400").
    assert.doesNotMatch(source, /className="mb-1 text-xs text-gray-400">\{(?:t\(|tr\(|translateOr\()/, `${name} must not stack a label above its value`)
    assert.doesNotMatch(source, /className="mb-0\.5 text-xs text-gray-400"/, `${name} must not stack a label above its value`)
    assert.doesNotMatch(source, /function InfoBlock\(/, `${name} must not keep a private copy of the row primitive`)
  })

  // --- 3. the money summary is a tfoot of the items table -----------------

  runTest(`${name} puts its money summary in the same table as the line items`, () => {
    const tableStart = source.indexOf('<table className="w-full text-sm">')
    assert.ok(tableStart > 0, `${name} must render its line items as a table`)
    assert.match(source, /<tfoot[^>]*>[\s\S]*?<MoneyRow/, `${name} money rows must sit in the items table's tfoot`)
    // The numeric item cells are right-aligned and tabular so a column of
    // amounts reads straight down into the summary beneath it.
    // Matched as a set, not as one literal class string: the phone padding
    // (px-1.5 ... sm:px-2) sits between these tokens in the real className.
    const numericCells = source.match(/className="[^"]*text-right[^"]*align-top[^"]*"/g) || []
    assert.ok(numericCells.length > 0, `${name} must have right-aligned numeric item cells`)
    assert.ok(numericCells.every((cls) => cls.includes('tabular-nums')), `${name} item amounts must be tabular so a column of figures lines up`)
    assert.ok(numericCells.every((cls) => cls.includes('whitespace-nowrap')), `${name} item amounts must not wrap mid-figure`)
    // A wide table may scroll inside its own box, but never the page.
    assert.match(source, /<div className="overflow-x-auto">\s*<table/, `${name} table must own its horizontal scroll`)
    // The old width floor starved the product column to 151px at 1280.
    assert.doesNotMatch(source, /min-w-\[3[0-9]rem\]/, `${name} table must not carry a width floor that starves the product column`)
  })

  // --- 4. no unlabelled KHR line anywhere ---------------------------------

  runTest(`${name} never prints a KHR figure without its own label`, () => {
    // The exact orphan shape being retired: a right-aligned grey div whose
    // whole content is a fmtKHR call, rendered as a SIBLING of the row it
    // belongs to rather than inside it.
    assert.doesNotMatch(
      source,
      /<div className="(?:mt-1 )?text-right text-xs text-gray-400">\{?-?\{?fmtKHR\(/,
      `${name} must not render a bare right-aligned KHR line under a row`,
    )
    // Belt and braces: no JSX element in these files may consist solely of a
    // fmtKHR call plus a "text-right" class.
    const orphans = source.match(/className="[^"]*text-right[^"]*"[^>]*>\s*\{?-?\s*\{?fmtKHR\(/g) || []
    assert.equal(orphans.length, 0, `${name} still has ${orphans.length} unlabelled KHR line(s)`)
  })
}

// --- 5. the sale's money rows keep every line, in order, signed correctly --

runTest('the sale money summary keeps every line it used to show', () => {
  const foot = saleDetail.slice(saleDetail.indexOf('<tfoot'), saleDetail.indexOf('</tfoot>'))
  assert.ok(foot.length > 500, 'expected to find the sale money summary')
  const expected = [
    "t('subtotal')",
    "t('discount')",
    "t('membership_discount')",
    "t('points_redeemed')",
    "t('tax')",
    "'delivery_fee'",
    "t('returns_refunded')",
    "t('total')",
    "t('amount_paid')",
    "'outstanding_balance'",
    "t('change')",
    "'delivery_actual_cost'",
  ]
  let cursor = -1
  for (const label of expected) {
    const at = foot.indexOf(label)
    assert.ok(at >= 0, `the money summary lost the "${label}" row`)
    assert.ok(at > cursor, `the money summary reordered "${label}" -- the reading order must not change`)
    cursor = at
  }
  // Exactly one grand total, and it is the one that gets the heavier type.
  assert.equal((foot.match(/\bstrong\b/g) || []).length, 1, 'exactly one row is the grand total')
  // Sign parity: a row whose USD is negative must carry a negative KHR too.
  // The membership-discount and refund rows used to show "-$4.00" over a
  // positive "16,400.00៛", which reads as money ADDED.
  for (const [row, khrSource] of [
    ['membership_discount', 'membershipDiscountKhr'],
    ['returns_refunded', 'refundKhr'],
    ['discount', 'discountKhr'],
  ] as const) {
    const at = foot.indexOf(row)
    assert.ok(at >= 0, `expected the ${row} row`)
    const block = foot.slice(at, at + 420)
    assert.match(block, /amount=\{`-\$\{fmtUSD\(/, `${row} must show its USD as a deduction`)
    assert.match(
      block,
      new RegExp(`sub=\\{${khrSource} > 0 \\? \`-\\$\\{fmtKHR\\(`),
      `${row} must show its KHR as a deduction too, not as a positive figure`,
    )
  }
  // The riel column has no hole at the top any more.
  assert.match(foot, /sub=\{subtotalKhr > 0 \? fmtKHR\(subtotalKhr\) : null\}/, 'the subtotal must carry its KHR like every other money row')
})

// --- 6. no field was lost turning blocks into rows -------------------------

runTest('every field the sale detail used to show is still rendered', () => {
  const fields = [
    'sale.cashier_name', 'sale.payment_method', 'paymentCurrency', 'paymentDetails',
    'sale.branch_name', 'sale.source_return_id', 'sale.device_tz', 'sale.device_name',
    'sale.customer_name', 'sale.customer_phone', 'sale.customer_address',
    'sale.customer_membership_number', 'sale.notes',
    'sale.delivery_contact_name', 'sale.delivery_contact_phone', 'sale.delivery_contact_address',
    'sale.cancel_reason', 'sale.cancel_note', 'sale.cancelled_by_name', 'sale.cancelled_at',
    'sale.cancel_fee_id', 'sale.credit_due_date', 'sale.receipt_number', 'sale.created_at',
    'item.branch_name', 'item.returned_quantity',
  ]
  for (const field of fields) {
    assert.ok(saleDetail.includes(field), `the sale detail no longer renders ${field}`)
  }
  // The receipt id keeps its full-width, copyable header treatment.
  assert.match(saleDetail, /<CopyableId[\s\S]*?value=\{sale\.receipt_number \|\| ''\}/, 'the receipt id must stay fully visible and copyable')
})

runTest('every field the return detail used to show is still rendered', () => {
  const fields = [
    'return_scope', 'typeLabel', 'ret.receipt_number', 'ret.replacement_receipt_number',
    'ret.supplier_name', 'ret.customer_name', 'ret.branch_name', 'ret.cashier_name',
    'ret.reason', 'ret.notes', 'item.product_name', 'item.quantity', 'item.total_usd',
    'item.total_khr', 'stock_action', 'replacement_items', 'settlement_mode',
    'settlement_diff_usd', 'supplier_compensation_usd', 'supplier_loss_usd',
    'supplier_compensation_khr', 'supplier_loss_khr', 'total_refund_usd', 'total_refund_khr',
  ]
  for (const field of fields) {
    assert.ok(returnDetail.includes(field), `the return detail no longer renders ${field}`)
  }
  // The money summary must appear ONCE. It used to be repeated: a flex block
  // at the bottom of the modal, unconnected to the amounts it summed.
  assert.equal((returnDetail.match(/total_refunded/g) || []).length, 1, 'the refund total must be stated once, in the items table footer')
})

// --- 7. the new labels exist in BOTH packs, in real Khmer ------------------

runTest('the new column and field labels ship in both language packs', () => {
  for (const key of ['line_total', 'cancelled_by']) {
    assert.ok(en[key], `en.json is missing "${key}"`)
    assert.ok(km[key], `km.json is missing "${key}"`)
    assert.match(km[key], /[ក-៿]/, `km.json "${key}" must be Khmer, not English left in place`)
    // A column header has to fit a phone column -- keep it short.
    assert.ok(km[key].length <= 16, `km.json "${key}" is too long for a table header (${km[key].length} chars)`)
    assert.ok(en[key].length <= 16, `en.json "${key}" is too long for a table header (${en[key].length} chars)`)
  }
  // The items table's last column no longer collides with the grand total row
  // sitting directly beneath it in the same table -- both used to say "Total".
  assert.match(saleDetail, /t\('line_total'\) \|\| 'Line total'/, 'the line-total column must have its own label')
  assert.match(saleDetail, /t\('unit_price'\) \|\| 'Unit price'/, 'the unit-price column must use the unit_price key, not the generic price key')
})

// --- 8. the return items table is actually reachable ----------------------

runTest('opening a return fetches the record that has the line items', () => {
  // GET /api/returns hydrates items only for a caller that passes
  // includeItems, and the Returns list does not -- so handing the list row
  // straight to the detail modal made its Items table read "No item details
  // available" for every record ever opened, and the replacement table never
  // appeared at all. An aligned items table nothing can fill is not a fix.
  const has = (needle: string, why: string): void => { assert.ok(returnsPage.includes(needle), why) }
  has('const openReturnDetail = useCallback(async (ret: ReturnRow)', 'opening a return must go through the hydrating handler')
  has('openReturnDetail(ret as ReturnRow)', 'the list must call it instead of setting the raw list row')
  has('fetchReturnDetail(ret.id)', 'the open handler must re-fetch the record by id')
  // Open on the list row FIRST so the modal is never a blank wait.
  const opener = returnsPage.slice(returnsPage.indexOf('const openReturnDetail'), returnsPage.indexOf('const handleOpenEdit'))
  assert.ok(opener.indexOf('setDetailRet(ret)') < opener.indexOf('fetchReturnDetail(ret.id)'), 'the row must be shown before the fetch, not after it')
  // A background list refresh must not undo the hydrate.
  has('items: fresh.items ?? current.items', 'rebinding an open detail to a fresh list row must keep its items')
  has('replacement_items: fresh.replacement_items ?? current.replacement_items', 'rebinding must keep the replacement items too')
})

if (failed > 0) process.exitCode = 1
else console.log('PASS record detail surfaces share one row rhythm with an aligned money summary')
