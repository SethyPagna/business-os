// Owner (Sep 17, P10-23): "sales after made, the sale rows, free can't be
// changed to paid by customer..."
//
// A delivery rung up as free -- delivery_fee_paid_by = 'store', the shop
// absorbing the fee -- had no way back. The fee AMOUNT was correctable after
// the sale; the PAYER was not, so money the customer actually handed over
// could never be recorded, and the sale stayed understated forever.
//
// The correction rides on the amendment that already exists for this fact,
// delivery_fee_changed, rather than a second kind every ledger, record, undo
// and language pack would have to learn. That choice is only safe if three
// things hold, and each is checked here against its opposite:
//
//   1. the request carries the payer, and the confirm dialog names it only
//      when it actually moves;
//   2. the "that is already the amount" refusal no longer swallows a
//      payer-only correction -- while still refusing a form where NOTHING
//      moved, which is the reason that refusal exists;
//   3. the editor opens showing the payer the sale really has, from both
//      Edit buttons, so the toggle is never a lie about the current state.
//
// The Worker half -- that the plan writes the column, and that a caller which
// says nothing about the payer never resets it -- is proved for real against
// SQLite in cloudflare/scripts/test-sale-amendments-pure.cjs, section 11e.
//
// Run: node --experimental-strip-types frontend/tests/deliveryFeePayerAmendment.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// Line endings are normalised because this checkout is Windows with
// core.autocrlf=true: a pattern spanning two lines would otherwise fail on a
// pristine tree for a reason that has nothing to do with the code.
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const modal = read('src/components/sales/SaleDetailModal.tsx')
const transport = read('src/api/salesTransport.ts')
const route = read('../cloudflare/src/routes/sales.ts')
const plan = read('../cloudflare/src/lib/saleAmendments.ts')

runTest('the payer travels with the amendment request, all the way to the Worker', () => {
  assert.match(
    transport,
    /delivery_fee_paid_by\?: 'customer' \| 'store'/,
    'the transport request type must carry the payer, or TypeScript drops it silently',
  )
  assert.match(
    modal,
    /kind: 'delivery_fee_changed', delivery_fee_usd: next, delivery_fee_paid_by: feePayer/,
    'the staged request must send the payer alongside the amount',
  )
  // The header quote is the anti-tamper check: if it were quoted without the
  // payer, the Worker would compute a different total and answer 409 on every
  // payer correction.
  assert.match(
    modal,
    /headerQuote\(Number\(sale\?\.subtotal_usd\), \{ delivery_fee_usd: next, delivery_fee_paid_by: feePayer \}\)/,
    'the expected header quote must be taken WITH the new payer',
  )
})

runTest('a payer-only correction is allowed; a form where nothing moved is still refused', () => {
  assert.match(
    modal,
    /const payerChanged = feePayer !== \(deliveryPaidByStore \? 'store' : 'customer'\)/,
    'the modal must know whether the payer actually moved',
  )
  assert.match(
    modal,
    /if \(!deliveryAmountChanged\(currentFeeUsd, next, 1\) && !payerChanged\) \{/,
    'an unchanged amount must only refuse when the payer is unchanged too',
  )
  // The opposite half: the refusal must still exist. Deleting it would let an
  // empty correction through, and that is what it was written to stop.
  assert.match(
    modal,
    /delivery_amount_unchanged/,
    'the unchanged refusal must survive -- it is narrowed here, not removed',
  )
})

runTest('the Worker agrees, on both halves of the same rule', () => {
  assert.match(
    route,
    /if \(feePlan\.feeDeltaUsd === 0 && !feePlan\.payerChanged\) \{/,
    'the route must mirror the browser: zero delta refuses only when the payer held still',
  )
  // Backend enforcement, not frontend decoration: a payer the route does not
  // recognise is refused rather than coerced into one of the two real values.
  assert.match(
    route,
    /if \(payer !== 'customer' && payer !== 'store'\) \{/,
    'the route must validate the payer instead of trusting the browser',
  )
  assert.match(
    route,
    /const payerRaw = body\.delivery_fee_paid_by/,
    'the route must read the payer off the request body',
  )
  // And absent must mean "leave it alone" on the Worker side too, or every
  // ordinary fee correction from an older client would quietly un-free a sale.
  assert.match(
    plan,
    /input\.newPaidBy === undefined \|\| input\.newPaidBy === null\n\s*\? payerBefore/,
    'an omitted payer must fall back to the recorded one, never to a default',
  )
  assert.match(
    plan,
    /delivery_fee_paid_by = @paid_by/,
    'the plan must actually write the column',
  )
})

runTest('the corrected payer comes back with the response, so the row stops lying', () => {
  // Without this the browser keeps its cached copy of the sale: a delivery
  // just switched to customer-paid would still read Free, with the driver
  // struck through (P10-24), until something else forced a refetch.
  assert.match(
    route,
    /deliveryFeePaidBy: feePlan\.payerAfter/,
    'the amendment response must report the new payer',
  )
  assert.match(
    transport,
    /result\?\.deliveryFeePaidBy !== undefined \? \{ delivery_fee_paid_by: result\.deliveryFeePaidBy \}/,
    'and the local row must take it',
  )
})

runTest('the editor shows the payer the sale really has, from either Edit button', () => {
  assert.equal(
    (modal.match(/setFeePayer\(deliveryPaidByStore \? 'store' : 'customer'\)/g) || []).length,
    2,
    'both the free-delivery Edit and the charged-delivery Edit must seed the toggle',
  )
  assert.match(modal, /aria-pressed=\{feePayer === value\}/, 'the toggle must announce which payer is selected')
  // Both language packs, through the shared helper -- no hard-coded English.
  assert.match(
    modal,
    /translateOr\('fee_by_store', 'Store', '[^']+'\)/,
    'the Store label must come from the language pack',
  )
  assert.match(
    modal,
    /translateOr\('fee_by_customer', 'Customer', '[^']+'\)/,
    'the Customer label must come from the language pack',
  )
  const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
  for (const key of ['fee_paid_by', 'fee_by_customer', 'fee_by_store']) {
    assert.ok(en[key], `${key} must exist in the English pack`)
    assert.ok(km[key], `${key} must exist in the Khmer pack`)
    assert.notEqual(km[key], en[key], `${key} must actually be translated, not copied`)
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All deliveryFeePayerAmendment tests passed')
}
