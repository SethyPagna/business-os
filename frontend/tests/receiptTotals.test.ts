/**
 * Does the printed money column ADD UP to the total the sale was recorded at?
 *
 * receiptLineMath.test.ts proves a single line and the delivery split. This
 * proves the composition -- the rows a customer reads down the right-hand edge
 * of a receipt, and the same rows on the admin sale detail, against the stored
 * `sales.total_usd` that the Worker's computeSaleTotals wrote:
 *
 *     total_usd = subtotal - discount - membership_discount + tax
 *                 + (delivery fee, only when the CUSTOMER paid it)
 *
 * Every fixture below is run through `receiptTotalsFootingErrorUsd`, which is
 * that identity written once in production code, so a surface cannot foot in a
 * test and not on paper.
 *
 * Coverage matches the shapes that actually break: three kinds of discount at
 * once, a split payment, a partially-returned sale, a KHR-primary sale, and a
 * delivery the shop absorbed.
 */
import assert from 'node:assert/strict'
import { receiptTotalsFigures, receiptTotalsFootingErrorUsd } from '../src/utils/receiptTotals.ts'

const RATE = 4100
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// 1. All three kinds of discount at once, plus tax and a customer-paid
//    delivery -- the case where a receipt has the most ways to go wrong.
//
//    Line A: 2 x $28.00 list, charged $21.00  -> $42.00 net, $14.00 saved
//    Line B: 1 x $10.00 list, charged $10.00  -> $10.00 net, nothing saved
//    subtotal 52.00 (sum of NET lines, which is what sales.subtotal_usd holds)
//    store discount 3.00 · membership 2.00 · tax 1.00 · delivery 1.50 (customer)
//    total = 52 - 3 - 2 + 1 + 1.50 = 49.50
// ---------------------------------------------------------------------------
const everyDiscountKind = {
  exchange_rate: RATE,
  items: [
    { product_name: 'Serum 30ml', quantity: 2, applied_price_usd: 21, base_price_usd: 28, product_discount_usd: 0 },
    { product_name: 'Lip balm', quantity: 1, applied_price_usd: 10, base_price_usd: 10, product_discount_usd: 0 },
  ],
  subtotal_usd: 52,
  discount_usd: 3,
  membership_discount_usd: 2,
  tax_usd: 1,
  is_delivery: 1,
  delivery_fee_usd: 1.5,
  delivery_fee_paid_by: 'customer',
  total_usd: 49.5,
  amount_paid_usd: 50,
  change_usd: 0.5,
}

{
  const figures = receiptTotalsFigures(everyDiscountKind)

  assert.equal(figures.subtotalUsd, 52, 'Subtotal is the sum of the NET line totals')
  assert.equal(figures.itemDiscountUsd, 14, 'the per-line cut is 2 x $7.00')
  assert.equal(figures.discountUsd, 3, 'Discount means the order-level cut alone')
  assert.equal(figures.membershipDiscountUsd, 2)
  assert.equal(figures.totalDiscountUsd, 19, 'Total Discount recaps item + store + membership')
  assert.equal(figures.delivery.chargedUsd, 1.5, 'the customer paid this delivery, so it is in the total')

  // THE FOOTING CHECK. Zero means the rows above the Total reconcile to it.
  assert.equal(
    receiptTotalsFootingErrorUsd(figures),
    0,
    'subtotal - discount - membership + tax + charged delivery must equal total_usd',
  )

  // The same identity spelled out, so a reader can see which rows are operative.
  assert.equal(
    round2(figures.subtotalUsd - figures.discountUsd - figures.membershipDiscountUsd + figures.taxUsd + figures.delivery.chargedUsd),
    49.5,
  )

  // ...and which are NOT. Item Discount and Total Discount are RECAPS: the
  // per-line cut is already inside `subtotal_usd`, and Total Discount is a sum
  // of rows printed above it. Subtracting either again lands short by exactly
  // its own value. This is a property of the numbers, not of any one layout --
  // it is asserted so that if a future change ever makes one of those rows
  // operative, the size of the gap is stated here rather than discovered on a
  // customer's receipt. (Escalated Sep 4 2026: on the current layout both rows
  // render inline in the running column with a leading minus, which is the
  // presentational hazard this pins the arithmetic of.)
  const recapSubtractedAgain = round2(
    figures.subtotalUsd - figures.discountUsd - figures.membershipDiscountUsd
    - figures.totalDiscountUsd + figures.taxUsd + figures.delivery.chargedUsd,
  )
  assert.equal(recapSubtractedAgain, 30.5)
  assert.equal(round2(figures.totalUsd - recapSubtractedAgain), figures.totalDiscountUsd,
    'treating the Total Discount recap as a subtraction understates by exactly the recap')

  // Item Discount above Subtotal is the same shape: already inside subtotal.
  assert.equal(round2(figures.subtotalUsd + figures.itemDiscountUsd), 66,
    'the pre-discount value of the goods -- what Subtotal would be if the lines printed list prices')
}

// ---------------------------------------------------------------------------
// 2. Split payment: half in dollars, half in riel, one sale.
// ---------------------------------------------------------------------------
const splitPayment = {
  exchange_rate: RATE,
  items: [{ product_name: 'Gift set', quantity: 1, applied_price_usd: 20, base_price_usd: 20 }],
  subtotal_usd: 20,
  discount_usd: 0,
  total_usd: 20,
  amount_paid_usd: 10,
  amount_paid_khr: 41000,
  payment_details: [
    { method: 'Cash', amount_usd: 10, amount_khr: 0 },
    { method: 'ABA', amount_usd: 0, amount_khr: 41000 },
  ],
}

{
  const figures = receiptTotalsFigures(splitPayment)
  assert.equal(receiptTotalsFootingErrorUsd(figures), 0)

  // The tender is 10 dollars plus 41,000 riel, which at the booked rate is
  // exactly the $20 total -- so nothing is owed and no change is due.
  assert.equal(figures.paidTotalUsd, 20, 'both currencies count toward what was handed over')
  assert.equal(figures.outstandingUsd, 0, 'a split payment that covers the total leaves nothing owed')

  // The per-method breakdown the receipt prints is a pass-through of the
  // stored payment_details and does no arithmetic of its own; what has to hold
  // is that it accounts for the same tender the Paid row states.
  const detailUsd = splitPayment.payment_details.reduce((sum, d) => sum + d.amount_usd, 0)
  const detailKhr = splitPayment.payment_details.reduce((sum, d) => sum + d.amount_khr, 0)
  assert.equal(detailUsd, figures.paidUsd, 'the method breakdown must sum to amount_paid_usd')
  assert.equal(detailKhr, figures.paidKhr, 'the method breakdown must sum to amount_paid_khr')
}

// ---------------------------------------------------------------------------
// 3. Partially-returned sale. GET /api/sales attaches refund_usd from the
//    returns table; the Total is untouched by it, so the refund needs a Net
//    total beneath it or it is a minus sign nothing acts on.
// ---------------------------------------------------------------------------
const partiallyReturned = {
  exchange_rate: RATE,
  items: [
    { product_name: 'Cleanser', quantity: 1, applied_price_usd: 30, base_price_usd: 30 },
    { product_name: 'Toner', quantity: 1, applied_price_usd: 70, base_price_usd: 70 },
  ],
  subtotal_usd: 100,
  discount_usd: 0,
  total_usd: 100,
  total_khr: 410000,
  refund_usd: 30,
  refund_khr: 123000,
  amount_paid_usd: 100,
}

{
  const figures = receiptTotalsFigures(partiallyReturned)

  // The refund is NOT part of the footing identity: total_usd is what the sale
  // rang up, and a return is a later event against it.
  assert.equal(receiptTotalsFootingErrorUsd(figures), 0, 'a refund must not disturb the sale column')
  assert.equal(figures.totalUsd, 100)
  assert.equal(figures.netTotalUsd, 70, 'net total = total - refund')
  assert.equal(figures.netTotalKhr, 287000)
  assert.equal(figures.outstandingUsd, 0, 'the customer paid the full total; the refund is money going back')
}

// ---------------------------------------------------------------------------
// 4. KHR-primary sale: nothing tendered in dollars at all.
//    This is the shape that made the admin detail print a false "still owed".
// ---------------------------------------------------------------------------
const khrPrimary = {
  exchange_rate: RATE,
  items: [{ product_name: 'Sunscreen', quantity: 1, applied_price_usd: 12.5, base_price_usd: 12.5 }],
  subtotal_usd: 12.5,
  discount_usd: 0,
  total_usd: 12.5,
  total_khr: 51250,
  amount_paid_usd: 0,
  amount_paid_khr: 55000,
  change_usd: 0.6,
  change_khr: 2400,
}

{
  const figures = receiptTotalsFigures(khrPrimary)
  assert.equal(receiptTotalsFootingErrorUsd(figures), 0)
  assert.equal(figures.paidUsd, 0, 'no dollars were handed over')
  assert.equal(figures.paidKhr, 55000)
  assert.equal(figures.paidTotalUsd, 13.41, '55,000 riel at the booked 4,100 is $13.41')
  assert.equal(figures.outstandingUsd, 0, 'riel covers the bill -- nothing is still owed')

  // Both currencies convert at the rate the sale was BOOKED at, never a
  // re-fetched current rate: a reprint has to tell the same story as the
  // original. A sale that stored no rate falls back, and only then.
  assert.equal(figures.exchangeRate, RATE)
  assert.equal(receiptTotalsFigures({ ...khrPrimary, exchange_rate: null }, { fallbackExchangeRate: 4000 }).exchangeRate, 4000)
}

// ---------------------------------------------------------------------------
// 5. Delivery the SHOP absorbed. total_usd never carries it, so the printed
//    column must not either -- the row reads "Free" with the fee struck out.
// ---------------------------------------------------------------------------
const storeAbsorbedDelivery = {
  exchange_rate: RATE,
  items: [{ product_name: 'Mask box', quantity: 1, applied_price_usd: 20, base_price_usd: 20 }],
  subtotal_usd: 20,
  discount_usd: 0,
  total_usd: 20,
  is_delivery: 1,
  delivery_fee_usd: 2,
  delivery_fee_khr: 8200,
  delivery_fee_paid_by: 'store',
  amount_paid_usd: 20,
}

{
  const figures = receiptTotalsFigures(storeAbsorbedDelivery)
  assert.equal(figures.delivery.faceUsd, 2, 'the fee still exists and is still struck through')
  assert.equal(figures.delivery.chargedUsd, 0, 'the customer was not billed for it')
  assert.equal(figures.delivery.absorbedUsd, 2)
  assert.equal(figures.delivery.printsAsFree, true)
  // The invariant receiptLineMath guarantees, restated where the column uses it.
  assert.equal(figures.delivery.chargedUsd + figures.delivery.absorbedUsd, figures.delivery.faceUsd)

  assert.equal(
    receiptTotalsFootingErrorUsd(figures),
    0,
    'printing the FACE fee here would leave the column over by exactly the absorbed $2.00',
  )
}

// ---------------------------------------------------------------------------
// 6. A real production sale, so the module is exercised on a row that exists.
//    16433 (receipt 20260808-112713): subtotal 109, discount 5, total 104,
//    with $4.00 of per-line cut inside the subtotal.
// ---------------------------------------------------------------------------
{
  const figures = receiptTotalsFigures({
    exchange_rate: RATE,
    subtotal_usd: 109,
    discount_usd: 5,
    total_usd: 104,
    items: [
      { quantity: 1, applied_price_usd: 49, base_price_usd: 53, product_discount_usd: 0 }, // Bobbi Brown Face Base Alice 50ml
      { quantity: 3, applied_price_usd: 20, base_price_usd: 20, product_discount_usd: 0 }, // Lancome Idole 10ml
    ],
    amount_paid_usd: 104,
  })
  assert.equal(figures.subtotalUsd, 109)
  assert.equal(figures.itemDiscountUsd, 4)
  assert.equal(figures.totalDiscountUsd, 9)
  assert.equal(receiptTotalsFootingErrorUsd(figures), 0)
  assert.equal(figures.netTotalUsd, 104, 'no returns -- net total is the total')
  assert.equal(figures.outstandingUsd, 0)
}

// ---------------------------------------------------------------------------
// 7. Edge shapes that must not invent money.
// ---------------------------------------------------------------------------
{
  // An empty/absent sale reads as zeroes, never NaN.
  const empty = receiptTotalsFigures({})
  assert.equal(receiptTotalsFootingErrorUsd(empty), 0)
  assert.equal(empty.outstandingUsd, 0)
  assert.equal(empty.netTotalUsd, 0)
  assert.equal(empty.exchangeRate, 4100, 'the long-standing default rate, not NaN')

  // items may arrive as a JSON string (sales.items) rather than an array.
  const asJson = receiptTotalsFigures({
    exchange_rate: RATE,
    subtotal_usd: 42,
    discount_usd: 0,
    total_usd: 42,
    items: JSON.stringify([{ quantity: 2, applied_price_usd: 21, base_price_usd: 28 }]),
  })
  assert.equal(asJson.itemDiscountUsd, 14, 'a stringified items column is parsed, not ignored')
  assert.equal(receiptTotalsFootingErrorUsd(asJson), 0)

  // A template with the per-item discount turned off prints no item-discount
  // figure either -- the receipt and this module must agree on that.
  const hidden = receiptTotalsFigures(everyDiscountKind, { showItemDiscount: false })
  assert.equal(hidden.itemDiscountUsd, 0)
  assert.equal(hidden.totalDiscountUsd, 5, 'store + membership only')
  assert.equal(receiptTotalsFootingErrorUsd(hidden), 0, 'hiding a recap row cannot move the total')

  // Overpaid in one currency: change is owed, nothing is outstanding.
  const overpaid = receiptTotalsFigures({ exchange_rate: RATE, subtotal_usd: 5, discount_usd: 0, total_usd: 5, amount_paid_usd: 20, change_usd: 15 })
  assert.equal(overpaid.outstandingUsd, 0, 'an overpayment is change, never a negative balance')

  // Underpaid: the balance is named, in both currencies.
  const credit = receiptTotalsFigures({ exchange_rate: RATE, subtotal_usd: 50, discount_usd: 0, total_usd: 50, amount_paid_usd: 20 })
  assert.equal(credit.outstandingUsd, 30)
  assert.equal(credit.outstandingKhr, 123000)
}

console.log('receiptTotals: column foots to total_usd on every fixture (all-three-discounts, split payment, partial return, KHR-primary, absorbed delivery, production 16433)')
