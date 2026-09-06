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
    "t('tax')",
    "'delivery_fee'",
    "t('returns_refunded')",
    "t('total')",
    "t('amount_paid')",
    "'outstanding_balance'",
    "t('change')",
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
    'sale.cashier_name', 'sale.payment_method', 'paymentDetails',
    'sale.branch_name', 'sale.source_return_id',
    'sale.customer_name', 'sale.customer_phone', 'sale.customer_address',
    'sale.customer_membership_number', 'sale.notes',
    // N21 (owner, Sep 6 2026): the Customer card's second address row is gone,
    // so sale.delivery_contact_address is deliberately NOT in this list any
    // more. It is still on the sale record, still exported and still printed
    // under the receipt template's delivery toggles.
    'sale.delivery_contact_name', 'sale.delivery_contact_phone',
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

// --- 9. delivery: driver info reads as driver info -------------------------

runTest('the sale detail has no separate Delivery card', () => {
  // Sep 4 2026, in two steps.
  //
  // S4-25 first killed the standalone Delivery SectionCard ("Delivery can
  // merge into items as like receipt it shows near total") and hung all three
  // delivery fields off the delivery-fee row's label instead. Killing the card
  // was right and still holds. Hanging the fields off a money row was not: it
  // grew three wrapped lines of contact detail out of the left of a totals row
  // and pushed the amount column down with them, and it filed a person's name
  // and phone number under money.
  //
  // The user's own correction, same day: "delivery only needs phone and driver
  // name...this is driver info, for customer name, phone and address keep it
  // same in customer section... make them compact...". So the two driver
  // fields are ordinary compact rows in the SALE card. (The drop address then
  // lived in the CUSTOMER card when it differed; N21 removed that row on the
  // owner's Sep 6 instruction -- see the end of this test.)
  assert.ok(
    !/SectionCard title=\{translateOr\('delivery'/.test(saleDetail),
    'delivery must not be its own card any more',
  )
  // The driver rows are in the Sale card, above the items table -- NOT in the
  // money summary.
  const foot = saleDetail.slice(saleDetail.indexOf('<tfoot'), saleDetail.indexOf('</tfoot>'))
  assert.ok(foot.indexOf("'delivery_fee'") >= 0, 'the delivery fee row must still exist')
  assert.ok(
    !foot.includes('deliveryContactNote') && !foot.includes('deliveryDriverName'),
    'the driver must not be rendered inside the money summary',
  )
  for (const [needle, why] of [
    ["translateOr('driver', 'Driver'", 'the driver name row'],
    ["translateOr('driver_phone', 'Driver phone'", 'the driver phone row'],
    ['value={deliveryDriverName}', 'the driver name value'],
    ['value={deliveryDriverPhone}', 'the driver phone value'],
  ] as Array<[string, string]>) {
    assert.ok(saleDetail.includes(needle), `the sale detail lost ${why}`)
  }
  // Compact means the shared row primitive, not a bespoke block: a driver row
  // is a DetailRow like every other field in that card, so it hides itself
  // when empty and a walk-in sale is unchanged.
  const driverAt = saleDetail.indexOf("translateOr('driver', 'Driver'")
  assert.match(
    saleDetail.slice(driverAt - 60, driverAt),
    /<DetailRow label=\{$/,
    'the driver must ride the shared DetailRow, not a hand-rolled block',
  )
  // A free delivery still names its driver. This is now structural rather than
  // conditional -- the driver rows do not depend on the fee row rendering at
  // all, which is what made the zero-fee case fragile before.
  assert.match(
    saleDetail,
    /\{isDelivery \|\| deliveryFeeUsd > 0 \|\| deliveryFeeKhr > 0 \?/,
    'the fee row still renders for a delivery whose fee is zero',
  )
  // The two DRIVER fields are still read.
  const builder = saleDetail.slice(saleDetail.indexOf('const deliveryDriverName'), saleDetail.indexOf('const paymentDetails ='))
  assert.ok(builder.length > 80, 'expected to find the delivery field derivation')
  for (const field of ['delivery_contact_name', 'delivery_contact_phone']) {
    assert.ok(builder.includes(field), `the delivery derivation lost ${field}`)
  }
  // N21 SUPERSEDES the drop-address row. The earlier reading of "keep it same
  // in customer section" put the delivery address in the Customer card
  // whenever it differed from the customer's own; the owner then said plainly
  // (Sep 6 2026): "i see the customer show delivery address and address. just
  // keep address ... because in sales only show address." So the Customer card
  // carries ONE address row. The drop address is not lost -- it is still on
  // the sale, still exported, and still printed under the receipt template's
  // own delivery toggles -- this screen simply stops repeating it.
  assert.ok(
    !saleDetail.includes("translateOr('delivery_address', 'Delivery address'"),
    'the Customer card must not carry a second, Delivery address row',
  )
  assert.ok(
    !saleDetail.includes('sameAddressText') && !saleDetail.includes('deliveryAddressToShow'),
    'the difference-only derivation must be gone with the row it fed',
  )
})

// --- 9b. one Edit column, one Edit label -----------------------------------

runTest('every amend control on the items table sits in one aligned column', () => {
  // User, Sep 4 2026: "the current edit in click to view detail is placed all
  // over the place..you can align it with the edit volumn...for products,
  // delivery etc... just call it 'Edit'."
  //
  // The delivery-fee editor used to be a bare <div> rendered as a direct child
  // of <tfoot>. A table section may contain only rows, so the browser hoists
  // such a child out of the table box entirely -- which is literally why that
  // control appeared somewhere other than where it was written. Every amend
  // control now travels in a cell of its own row.
  // Structural, not textual: walk the tfoot and require that every <div> it
  // contains is inside an open <td>. A <div> parked between two <tr>s is the
  // exact defect -- a table section may contain only rows, so the browser
  // hoists such a child clean out of the table box and drops it elsewhere.
  // Comments are stripped first: this reads MARKUP, and the prose explaining
  // the defect naturally quotes the tag it is about.
  const tfoot = saleDetail
    .slice(saleDetail.indexOf('<tfoot'), saleDetail.indexOf('</tfoot>'))
    .replace(new RegExp("\\{/\\*[\\s\\S]*?\\*/\\}", 'g'), '')
  let cellDepth = 0
  for (const token of tfoot.match(/<\/?(?:td|div)\b/g) || []) {
    if (token === '<td') cellDepth += 1
    else if (token === '</td') cellDepth -= 1
    else if (token === '<div') assert.ok(cellDepth > 0, 'a <div> in the money summary must live inside a table cell')
  }
  // MoneyRow can carry a control, in a trailing cell that lines up with the
  // per-line Edit buttons above it.
  assert.match(rows, /action\?: ReactNode/, 'MoneyRow must accept a row-level action')
  assert.match(rows, /\{action \? <td className="[^"]*text-right[^"]*">\{action\}<\/td> : null\}/, 'the action must render as a trailing cell')
  // The column has a visible header, not an sr-only one.
  assert.ok(
    !/<th[^>]*><span className="sr-only">\{translateOr\('amend_line'/.test(saleDetail),
    'the Edit column header must be visible, not screen-reader-only',
  )
  // And one label everywhere: "Edit". Not "Edit line", not "Correct delivery
  // fee" -- the user named it once.
  assert.ok(!saleDetail.includes("'Edit line'"), 'the per-line control must just say Edit')
  assert.ok(!saleDetail.includes("'Correct delivery fee'"), 'the delivery-fee control must just say Edit')
  assert.equal(en.amend_line, 'Edit', 'the English pack must say Edit')
  assert.ok(km.amend_line && km.amend_line !== 'Edit', 'the Khmer pack must carry its own word for Edit')
  // The fee editor opens from that column and renders as a full-width row.
  const feeAt = saleDetail.indexOf('canAmendThisSale && feeEditing')
  assert.ok(feeAt >= 0, 'the fee editor must be gated on the Edit control being open')
  assert.match(saleDetail.slice(feeAt, feeAt + 320), /<tr className=[\s\S]*?<td colSpan=\{5\}/, 'the fee editor must be a spanning table row')
})

// --- 9c. the note the cashier typed is a field of the sale -----------------

runTest('the sale note reads inside the Sale card, not as a card above it', () => {
  // User, Sep 4 2026: "the notes did not show in the notes area for sales, it
  // went to above". The note was rendering as its own SectionCard in the
  // top grid, so it appeared above and beside the record it annotates.
  assert.ok(
    !/<SectionCard title=\{t\('notes'\)/.test(saleDetail),
    'the note must not be a card of its own',
  )
  const notesAt = saleDetail.indexOf("<DetailRow label={t('notes')")
  assert.ok(notesAt >= 0, 'the note must render as a DetailRow')
  assert.match(saleDetail.slice(notesAt, notesAt + 200), /value=\{sale\.notes\}/, 'the note row must read sale.notes')
  // A multi-line note must survive as multiple lines.
  assert.match(saleDetail.slice(notesAt, notesAt + 200), /whitespace-pre-wrap/, 'a multi-line note must keep its line breaks')
  // It belongs to the Sale card: it must appear before the Customer card, not
  // after the items table.
  const saleCardAt = saleDetail.indexOf("<SectionCard title={t('sale')")
  const customerCardAt = saleDetail.indexOf("<SectionCard title={t('customer')")
  if (saleCardAt >= 0 && customerCardAt > saleCardAt) {
    assert.ok(notesAt > saleCardAt && notesAt < customerCardAt, 'the note row belongs to the Sale card')
  }
})

// --- 10. S4-24: what the receipt does not print, this does not print -------

runTest('the sale detail shows what a receipt shows, and stops there', () => {
  // User, Sep 4 2026: "in sales the click to view details for receipt, show
  // data like receipt... no need so much break downs and difference".
  //
  // The rows below are gone ON PURPOSE. This is the inverse of the Sep-3 rule
  // one section above ("no field was lost"), which was written for a restyle;
  // this is a scope decision the user made, and it is pinned here so nobody
  // re-adds a row by reflex. Every reference is to what SaleDetailModal
  // renders -- the data itself is untouched on the sale row, in the exports
  // and in the reports.
  const gone: Array<[needle: string, why: string]> = [
    ['sale.device_tz', 'Timezone is device telemetry; no receipt prints it'],
    ['sale.device_name', 'Device is device telemetry; no receipt prints it'],
    ["translateOr('payment_currency'", 'Payment currency is not a receipt line'],
    ["t('points_redeemed')", 'points are the mechanism behind the membership discount printed above them'],
    ["translateOr('delivery_actual_cost'", 'what the shop paid the driver is not part of what the customer owes'],
    ['deliveryActualCostUsd', 'the local it was computed from is dead too'],
  ]
  for (const [needle, why] of gone) {
    assert.ok(!saleDetail.includes(needle), `the sale detail put "${needle}" back -- ${why}`)
  }

  // What the user named as must-keep, kept.
  for (const [needle, why] of [
    ["t('status')", 'status'],
    ['sale.customer_membership_number', 'customer with membership'],
    ['handleMembershipAttach', 'attaching a membership to the sale'],
    ["t('update_status')", 'the status update section'],
    ['handleStatusUpdate', 'the status update action'],
  ] as Array<[string, string]>) {
    assert.ok(saleDetail.includes(needle), `the sale detail lost ${why}`)
  }

  // A split payment is still shown -- as the payment row's own detail, the way
  // the receipt prints it, not as a row called "Payment breakdown".
  assert.ok(!saleDetail.includes("'payment_breakdown'"), 'the split payment must not be its own labelled row')
  // Two rows carry this label -- the awaiting-payment affordance comes first,
  // so anchor on the badge that only the settled row renders.
  const payAt = saleDetail.indexOf('<span className="badge-blue text-xs">{sale.payment_method}</span>')
  assert.ok(payAt >= 0, 'expected the settled payment-method row')
  assert.ok(
    saleDetail.slice(payAt, payAt + 1200).includes('paymentDetails.map'),
    'the payment methods must be listed under the payment row itself',
  )
})

runTest('both record details put their actions at the end, not beside the close button', () => {
  // The two modals must agree. Fixing only the sale would leave a shopkeeper
  // reaching for Edit in a different place depending on which record is open,
  // which is the same disagreement the Sep-3 row rhythm was written to end.
  for (const [name, source, action] of [
    ['sale detail', saleDetail, 'onPrint(sale)'],
    ['return detail', returnDetail, 'onClick={onEdit}'],
  ] as Array<[string, string, string]>) {
    const closeAt = source.indexOf("aria-label={tr('close'") >= 0
      ? source.indexOf("aria-label={tr('close'")
      : source.indexOf("aria-label={t('close')")
    assert.ok(closeAt >= 0, `expected ${name} to have a close control`)
    const actionAt = source.indexOf(action)
    assert.ok(actionAt >= 0, `${name} lost its action`)
    assert.ok(actionAt > closeAt, `${name} still renders its action beside the close button`)
  }
})

if (failed > 0) process.exitCode = 1
else console.log('PASS record detail surfaces share one row rhythm with an aligned money summary')
