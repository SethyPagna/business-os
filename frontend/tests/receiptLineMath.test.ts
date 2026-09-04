/**
 * The receipt’s item table is FOUR columns -- item, qty, price, total --
 * and the price column shows the SELLING price with the cut beside it, not
 * the discounted price (owner, Sep 4 2026, from a photo of a printed
 * receipt: `28.00 (-7.00)` in the price column, `21.00` in the total).
 *
 * The two sales below are REAL production rows, not invented fixtures. Before
 * any of this 16433 printed "$49.00 (-$4.00)" on its first line, a $109.00
 * Subtotal and a $5.00 Discount -- so the $4.00 it had just shown the customer
 * on that line was nowhere in the totals. It is now on the receipt under its
 * own name, Item Discount, which is what the photo labels it
 * (`សរុបបញ្ចុះលើទំនិញ`). Both presentations leave the customer paying
 * exactly the same money; the named row is the one the owner asked for.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { receiptDeliveryFigures, receiptLineFigures, receiptLineSavingsUsd } from '../src/utils/receiptLineMath.ts'

const RATE = 4100
const round2 = (n: number) => Math.round(n * 100) / 100

// --- production sale 16433 (receipt 20260808-112713) -----------------------
// stored: subtotal_usd 109, discount_usd 5, total_usd 104
const sale16433 = {
  subtotal: 109,
  discount: 5,
  total: 104,
  items: [
    { product_name: 'Bobbi Brown Face Base Alice 50ml', quantity: 1, applied_price_usd: 49, base_price_usd: 53, product_discount_usd: 0 },
    { product_name: 'Lancome Idole 10ml', quantity: 3, applied_price_usd: 20, base_price_usd: 20, product_discount_usd: 0 },
  ],
}

{
  const [bobbi, lancome] = sale16433.items.map((i) => receiptLineFigures(i, true, RATE))

  // PRICE column: the selling price, with the per-UNIT cut beside it.
  assert.equal(bobbi.sellingUnitUsd, 53, 'the price column must show the selling price, not the charged one')
  assert.equal(bobbi.unitSavingsUsd, 4, 'the parenthesised cut is per unit -- the photo’s (-7.00) on a 1-unit line')
  assert.equal(bobbi.savingsUsd, 4)
  assert.equal(bobbi.hasDiscount, true)
  // TOTAL column: what the line actually came to.
  assert.equal(bobbi.chargedUnitUsd * bobbi.qty, 49, 'the total column is net, like the photo’s 21.00')

  // A line sold at list is untouched and shows no discount.
  assert.equal(lancome.sellingUnitUsd, 20)
  assert.equal(lancome.chargedUnitUsd * lancome.qty, 60)
  assert.equal(lancome.unitSavingsUsd, 0)
  assert.equal(lancome.savingsUsd, 0)
  assert.equal(lancome.hasDiscount, false)

  // A multi-unit line multiplies the unit cut, so the two figures differ and
  // the price column must print the unit one. (Lancome's is zero, so this is
  // asserted on a discounted 3-pack rather than on it.)
  const threePack = receiptLineFigures({ quantity: 3, applied_price_usd: 20, base_price_usd: 24 }, true, RATE)
  assert.equal(threePack.unitSavingsUsd, 4, 'price column prints the cut on ONE unit')
  assert.equal(threePack.savingsUsd, 12, 'the Item Discount row sums the cut on the whole line')

  const itemDiscount = receiptLineSavingsUsd(sale16433.items, true, RATE)
  assert.equal(itemDiscount, 4)

  // The lines are net now, so they sum to the STORED subtotal and the
  // Subtotal row needs no adjustment.
  const lineSum = sale16433.items
    .map((i) => receiptLineFigures(i, true, RATE))
    .reduce((sum, f) => sum + f.chargedUnitUsd * f.qty, 0)
  assert.equal(lineSum, sale16433.subtotal, 'the printed lines must sum to the printed Subtotal')
  assert.equal(lineSum, 109)

  // The three discount rows the owner's photo and ask call for.
  const totalDiscount = itemDiscount + sale16433.discount + 0 // + membership, zero here
  assert.equal(itemDiscount, 4, 'Item Discount = the per-line cut')
  assert.equal(sale16433.discount, 5, 'Discount = the order-level (store) cut alone')
  assert.equal(totalDiscount, 9, 'Total Discount = every cut on the sale')

  // THE INVARIANT: the customer still pays exactly what they paid before,
  // and pays it out of the rows actually printed above the TOTAL.
  assert.equal(round2(sale16433.subtotal - sale16433.discount), sale16433.total)

  // Nothing is lost relative to the presentation this replaced: the old
  // inflated Subtotal is still recoverable from the printed rows, which is
  // what "the $4.00 must not vanish" actually demanded.
  assert.equal(sale16433.subtotal + itemDiscount, 113)
  assert.equal(round2((sale16433.subtotal + itemDiscount) - totalDiscount), sale16433.total)
}

// --- production sale 16815 (receipt 20260902-140834) -----------------------
// stored: subtotal_usd 154, discount_usd 4, total_usd 150
{
  const items = [
    { quantity: 1, applied_price_usd: 35, base_price_usd: 37 },
    { quantity: 1, applied_price_usd: 45, base_price_usd: 47 },
    { quantity: 1, applied_price_usd: 22, base_price_usd: 24 },
    { quantity: 1, applied_price_usd: 52, base_price_usd: 52 },
  ]
  const itemDiscount = receiptLineSavingsUsd(items, true, RATE)
  assert.equal(itemDiscount, 6, '2 + 2 + 2, and the line sold at list contributes nothing')
  // Net lines sum to the stored subtotal.
  const lineSum = items
    .map((i) => receiptLineFigures(i, true, RATE))
    .reduce((sum, f) => sum + f.chargedUnitUsd * f.qty, 0)
  assert.equal(lineSum, 154)
  assert.equal(itemDiscount + 4, 10, 'Total Discount = item + store')
  assert.equal(round2(154 - 4), 150, 'total unchanged')
}

// --- the fallbacks that keep old receipts reprinting identically -----------
{
  // No base_price at all (older sales): selling falls back to charged, no discount.
  const f = receiptLineFigures({ quantity: 2, applied_price_usd: 12 }, true, RATE)
  assert.equal(f.sellingUnitUsd, 12)
  assert.equal(f.savingsUsd, 0)
  assert.equal(f.hasDiscount, false)

  // base below charged (a price INCREASE) is not a discount and must not
  // produce a negative saving, which would inflate the printed total.
  const up = receiptLineFigures({ quantity: 1, applied_price_usd: 30, base_price_usd: 25 }, true, RATE)
  assert.equal(up.hasDiscount, false)
  assert.equal(up.savingsUsd, 0)
  assert.equal(up.sellingUnitUsd, 30)

  // Sub-cent noise is not a discount.
  const noise = receiptLineFigures({ quantity: 1, applied_price_usd: 10, base_price_usd: 10.004 }, true, RATE)
  assert.equal(noise.hasDiscount, false)

  // The template switch still wins: with item discounts hidden, nothing moves,
  // so Subtotal and Discount stay exactly as they are stored.
  const off = receiptLineFigures({ quantity: 1, applied_price_usd: 49, base_price_usd: 53 }, false, RATE)
  assert.equal(off.hasDiscount, false)
  assert.equal(off.savingsUsd, 0)
  assert.equal(off.sellingUnitUsd, 49)

  // A product-level cut counts toward the list price too.
  const promo = receiptLineFigures({ quantity: 1, applied_price_usd: 8, base_price_usd: 9, product_discount_usd: 1 }, true, RATE)
  assert.equal(promo.sellingUnitUsd, 10)
  assert.equal(promo.savingsUsd, 2)
}

// --- riel column tells the same story as the dollar column ------------------
{
  // Real riel figure on the payload wins.
  const real = receiptLineFigures(
    { quantity: 1, applied_price_usd: 49, applied_price_khr: 200900, base_price_usd: 53, base_price_khr: 217300 },
    true,
    RATE,
  )
  assert.equal(real.sellingUnitKhr, 217300)

  // No base riel: scale the charged riel by the same ratio as the dollars.
  const scaled = receiptLineFigures(
    { quantity: 1, applied_price_usd: 49, applied_price_khr: 200900, base_price_usd: 53 },
    true,
    RATE,
  )
  assert.equal(Math.round(scaled.sellingUnitKhr), 217300)

  // No riel at all: fall back to the exchange rate.
  const none = receiptLineFigures({ quantity: 1, applied_price_usd: 49, base_price_usd: 53 }, true, RATE)
  assert.equal(none.sellingUnitKhr, 53 * RATE)

  // Undiscounted lines keep their stored riel untouched.
  const plain = receiptLineFigures({ quantity: 1, applied_price_usd: 20, applied_price_khr: 82000, base_price_usd: 20 }, true, RATE)
  assert.equal(plain.sellingUnitKhr, 82000)

  // The Total column's riel subline is the CHARGED riel, not the selling one,
  // or a discounted line would print a dollar total and a riel total that
  // disagree with each other.
  assert.equal(real.chargedUnitKhr, 200900, 'the riel subline follows the net total')
  assert.equal(plain.chargedUnitKhr, 82000)
  assert.equal(none.chargedUnitKhr, 49 * RATE, 'no stored riel: fall back to the rate on the CHARGED dollars')
}

// --- the component must consume the shared math, not re-derive it ----------
{
  const src = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(src, /import \{ receiptDeliveryFigures, receiptLineFigures, receiptLineSavingsUsd \} from '\.\.\/\.\.\/utils\/receiptLineMath'/)
  assert.match(src, /const lineSavingsUsd = receiptLineSavingsUsd\(items, showItemDiscount, exchangeRate\)/)
  // Subtotal and Discount are the STORED figures now: the lines are net, so
  // the per-line cut is reported on its own row instead of being folded in.
  assert.match(src, /const displayedSubtotalUsd = subtotalUsd$/m)
  assert.match(src, /const displayedDiscountUsd = discountUsd$/m)
  assert.match(src, /const totalDiscountUsd = lineSavingsUsd \+ discountUsd \+ membershipDiscountUsd/)
  // The rows must print the DISPLAYED figures.
  assert.match(src, /label=\{labelFor\(lang, 'subtotal'\)\} value=\{fmtUSD\(displayedSubtotalUsd\)\}/)
  assert.match(src, /value=\{`-\$\{fmtUSD\(displayedDiscountUsd\)\}`\}/)

  // FOUR columns, and each one printing the figure the photo puts in it.
  assert.match(src, /data-receipt-cell="line-total"/, 'the fourth column must exist')
  assert.match(src, /labelFor\(lang, 'item'\)/)
  assert.match(src, /labelFor\(lang, 'unitPrice'\)/)
  assert.match(src, /labelFor\(lang, 'lineTotal'\)/)
  // Price column = selling unit price + the per-UNIT cut. If this regresses
  // to applied_price_usd the receipt goes back to "discounted price
  // (-discount)", which is the thing the owner has now asked for twice.
  assert.match(src, /const unitUsd = figures\.sellingUnitUsd/)
  assert.match(src, /const unitSavingsUsd = figures\.unitSavingsUsd/)
  assert.match(src, /\(-\{fmtUSD\(unitSavingsUsd\)\}\)/)
  // Total column = the NET line, matching the photo’s 21.00.
  assert.match(src, /const lineUsd = figures\.chargedUnitUsd \* qty/)
  assert.match(src, /const lineKhr = figures\.chargedUnitKhr \* qty/)
  // The two named discount rows, and the qty total under the table.
  assert.match(src, /labelFor\(lang, 'itemDiscount'\)/)
  assert.match(src, /labelFor\(lang, 'totalDiscount'\)/)
  assert.match(src, /labelFor\(lang, 'totalQty'\)/)
  // ...registered in the field order, or they never render.
  assert.match(src, /fieldOrder\.push\('item_discount'\)/)
  assert.match(src, /fieldOrder\.push\('total_discount'\)/)
  assert.match(src, /fieldOrder\.push\('total_qty'\)/)
  // Both label packs carry every new key, or a Khmer receipt prints blanks.
  for (const key of ['item', 'unitPrice', 'lineTotal', 'totalQty', 'itemDiscount', 'totalDiscount']) {
    assert.equal(
      (src.match(new RegExp(`^\\s+${key}: '`, 'gm')) || []).length,
      2,
      `${key} must be defined in BOTH LABELS.en and LABELS.km`,
    )
  }
  // The Khmer wording is read off the owner’s photo; pin the two that name
  // the new rows so a future edit cannot quietly paraphrase them.
  assert.match(src, /totalQty: 'សរុបចំនួនទំនិញ:'/)
  assert.match(src, /itemDiscount: 'សរុបបញ្ចុះលើទំនិញ:'/)
  assert.doesNotMatch(
    src,
    /const unitUsd = toNumber\(item\.applied_price_usd/,
    'the line price must come from the shared math, not straight off applied_price_usd',
  )
  // The delivery row reads the shared split and prints Free from it.
  assert.match(src, /const delivery = receiptDeliveryFigures\(sale, exchangeRate\)/)
  assert.match(src, /const deliveryPaidByStore = delivery\.printsAsFree/)
  assert.match(src, /deliveryPaidByStore \? \(/)
  assert.match(src, /labelFor\(lang, 'free'\)/)
  assert.match(src, /line-through/)
  assert.doesNotMatch(
    src,
    /delivery_fee_paid_by \|\| 'customer'/,
    'the payer test must come from the shared math, not be re-derived in the component',
  )
  // Both label packs carry the word, or a Khmer receipt prints an empty cell.
  assert.match(src, /free: 'Free',/)
  assert.match(src, /free: '\u17a5\u178f\u1782\u17b7\u178f\u1790\u17d2\u179b\u17c3',/)

  // total_usd must stay untouched -- the whole change is display-only.
  assert.match(src, /const totalUsd = toNumber\(sale\.total_usd \?\? sale\.total\)/)
}

// --- the delivery fee, split by who paid it -------------------------------
// "if free/paid by shop in receipt note 'Free' and a delivery fee crossed out
// fee. so Free crossed out $N." (owner, Sep 4 2026)
//
// The wording is the visible half. The half that matters is that total_usd
// only ever carried a CUSTOMER-paid fee, so printing the stored fee on a
// shop-absorbed delivery left the receipt's own column not adding up.
{
  // Production shape (measured Sep 4 2026): of 15,044 sales, 4,412 carry a
  // delivery fee -- $8,380.80 charged to customers and $7.50 absorbed by the
  // shop across 4 sales. All 4 of those are still awaiting_payment, so the
  // absorbed case has never yet printed on a settled receipt. Both shapes are
  // asserted, because the untested one is the one about to arrive.
  const charged = receiptDeliveryFigures(
    { delivery_fee_usd: 2, delivery_fee_khr: 8200, delivery_fee_paid_by: 'customer' },
    RATE,
  )
  assert.equal(charged.chargedUsd, 2, 'a customer-paid fee is charged in full')
  assert.equal(charged.absorbedUsd, 0)
  assert.equal(charged.printsAsFree, false, 'a customer-paid fee must never print as Free')
  assert.equal(charged.chargedKhr, 8200)

  const absorbed = receiptDeliveryFigures(
    { delivery_fee_usd: 2, delivery_fee_khr: 8200, delivery_fee_paid_by: 'store' },
    RATE,
  )
  assert.equal(absorbed.chargedUsd, 0, 'a shop-absorbed fee is not charged to the customer')
  assert.equal(absorbed.absorbedUsd, 2)
  assert.equal(absorbed.printsAsFree, true)
  assert.equal(absorbed.faceUsd, 2, 'the struck-through figure still shows what it was worth')

  // The column now adds up. This is the defect stated as arithmetic:
  // total_usd = subtotal - discount + tax + CUSTOMER-paid delivery, so the
  // delivery row has to print chargedUsd and nothing else. Before the fix an
  // absorbed fee printed faceUsd here and the printed column overshot TOTAL by
  // exactly that amount.
  const subtotal = 100
  const discount = 10
  const tax = 0
  assert.equal(
    subtotal - discount + tax + absorbed.chargedUsd,
    90,
    'an absorbed fee must not be added to the printed total',
  )
  assert.equal(
    subtotal - discount + tax + charged.chargedUsd,
    92,
    'a customer-paid fee must still be added',
  )

  // The invariant the split is built on, asserted rather than assumed.
  for (const figures of [charged, absorbed]) {
    assert.equal(round2(figures.chargedUsd + figures.absorbedUsd), figures.faceUsd)
    assert.equal(figures.chargedKhr + figures.absorbedKhr, figures.faceKhr)
  }

  // A missing payer is the column's own default: customer. Historical rows
  // predate the column, and reading a blank as "store" would silently print
  // Free across the whole archive.
  const legacy = receiptDeliveryFigures({ delivery_fee_usd: 1.5 }, RATE)
  assert.equal(legacy.chargedUsd, 1.5)
  assert.equal(legacy.printsAsFree, false, 'a missing payer must read as customer-paid')
  assert.equal(legacy.faceKhr, 1.5 * RATE, 'riel falls back to the rate when not stored')

  // Any other spelling is customer-paid too -- the receipt must never invent a
  // discount the till did not give.
  assert.equal(receiptDeliveryFigures({ delivery_fee_usd: 3, delivery_fee_paid_by: 'shop' }, RATE).printsAsFree, false)
  assert.equal(receiptDeliveryFigures({ delivery_fee_usd: 3, delivery_fee_paid_by: 'Store' }, RATE).printsAsFree, false)

  // Nothing to give away, nothing to strike through.
  assert.equal(receiptDeliveryFigures({ delivery_fee_usd: 0, delivery_fee_paid_by: 'store' }, RATE).printsAsFree, false)
}

console.log('receiptLineMath: four columns, selling price with the unit cut, net line total, Item + Total Discount rows, an absorbed delivery fee prints Free, total unchanged')
