/**
 * The receipt prints the SELLING price and carries every discount in the
 * Discount row -- "selling price (-discount)", not "discounted price
 * (-discount)" (owner, Sep 4 2026).
 *
 * The two sales below are REAL production rows, not invented fixtures. Before
 * this change 16433 printed "$49.00 (-$4.00)" on its first line, a $109.00
 * Subtotal and a $5.00 Discount -- so the $4.00 it had just shown the customer
 * on that line was nowhere in the totals.
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

  // The discounted line prints its SELLING price, with the saving beside it.
  assert.equal(bobbi.sellingUnitUsd, 53, 'the line must print the selling price, not the charged one')
  assert.equal(bobbi.sellingUnitUsd * bobbi.qty, 53)
  assert.equal(bobbi.savingsUsd, 4)
  assert.equal(bobbi.hasDiscount, true)

  // A line sold at list is untouched and shows no discount.
  assert.equal(lancome.sellingUnitUsd, 20)
  assert.equal(lancome.sellingUnitUsd * lancome.qty, 60)
  assert.equal(lancome.savingsUsd, 0)
  assert.equal(lancome.hasDiscount, false)

  const savings = receiptLineSavingsUsd(sale16433.items, true, RATE)
  assert.equal(savings, 4)

  const shownSubtotal = sale16433.subtotal + savings
  const shownDiscount = sale16433.discount + savings
  assert.equal(shownSubtotal, 113, 'Subtotal must be the sum of SELLING prices')
  assert.equal(shownDiscount, 9, 'Discount must carry the per-line cut as well as the order-level one')

  // The lines must add up to the subtotal that is printed above them.
  const lineSum = sale16433.items
    .map((i) => receiptLineFigures(i, true, RATE))
    .reduce((sum, f) => sum + f.sellingUnitUsd * f.qty, 0)
  assert.equal(lineSum, shownSubtotal, 'the printed lines must sum to the printed Subtotal')

  // THE INVARIANT: the customer still pays exactly what they paid before.
  assert.equal(round2(shownSubtotal - shownDiscount), sale16433.total)
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
  const savings = receiptLineSavingsUsd(items, true, RATE)
  assert.equal(savings, 6, '2 + 2 + 2, and the line sold at list contributes nothing')
  assert.equal(154 + savings, 160)
  assert.equal(4 + savings, 10)
  assert.equal(round2(160 - 10), 150, 'total unchanged')
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
}

// --- the component must consume the shared math, not re-derive it ----------
{
  const src = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(src, /import \{ receiptDeliveryFigures, receiptLineFigures, receiptLineSavingsUsd \} from '\.\.\/\.\.\/utils\/receiptLineMath'/)
  assert.match(src, /const lineSavingsUsd = receiptLineSavingsUsd\(items, showItemDiscount, exchangeRate\)/)
  assert.match(src, /const displayedSubtotalUsd = subtotalUsd \+ lineSavingsUsd/)
  assert.match(src, /const displayedDiscountUsd = discountUsd \+ lineSavingsUsd/)
  // The rows must print the DISPLAYED figures.
  assert.match(src, /label=\{labelFor\(lang, 'subtotal'\)\} value=\{fmtUSD\(displayedSubtotalUsd\)\}/)
  assert.match(src, /value=\{`-\$\{fmtUSD\(displayedDiscountUsd\)\}`\}/)
  // And the line must print the selling price. If this regresses to
  // applied_price_usd the receipt goes back to "discounted price (-discount)".
  assert.match(src, /const unitUsd = figures\.sellingUnitUsd/)
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

console.log('receiptLineMath: selling price on the line, every discount in the Discount row, an absorbed delivery fee prints Free, total unchanged')
