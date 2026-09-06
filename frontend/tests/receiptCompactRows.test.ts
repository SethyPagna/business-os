// N33 (owner, Sep 6 2026, reading a printed Khmer 80 mm receipt, verbatim):
//   "for receipt, the exchange rate just show the rate, no need 'Exchange
//    Rate: n' just 'n'... and merge into same row as cashier."
//   "I see the delivery fee is shown twice in a row, by the delivery driver
//    and phone number and the mid to bottom... remove the by the delivery
//    driver and phone... keep near the mid to bottom. for the items, qty,
//    price, total make them compact... especially name, it is being pushed
//    two rows. and no need say total items. for the qr code and the qr code
//    name, keep them closer to each other, less margin."
//
// These are RENDERED assertions, not source greps: the file compiles
// components/receipt/Receipt.tsx and renders it with react-dom/server, which
// is the same component POS.tsx, Sales.tsx and receipt-settings/ReceiptPreview
// mount, and the same DOM printReceipt.ts clones for print / image / PDF. A
// grep can pass while the row still prints.
//
// Run: node tests/receiptCompactRows.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const receiptUrl = new URL('../src/components/receipt/Receipt.tsx', import.meta.url)
const receiptSource = fs.readFileSync(receiptUrl, 'utf8')

// The receipt's real collaborators are loaded for real (the money math, the
// template normalizer, the applied-config merge); only the shell around it --
// the app context, the icons, the portal menu -- is stubbed, because none of
// them decide what a row says.
function loadReceiptComponent(source: string): unknown {
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) {
      return {
        useApp: () => ({
          fmtUSD: (value: number | string) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: number | string) => `${Math.round(Number(value)).toLocaleString()}៛`,
          khrSymbol: '៛',
          t: (key: string) => key,
        }),
      }
    }
    if (id.includes('utils/formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('receiptLineMath')) return require('../src/utils/receiptLineMath.ts')
    if (id.includes('receiptTotals')) return require('../src/utils/receiptTotals.ts')
    if (id.includes('receipt-settings/template')) return require('../src/components/receipt-settings/template.ts')
    if (id.includes('receiptAppliedConfig')) return require('../src/utils/receiptAppliedConfig.ts')
    if (id.includes('receiptTextContrast')) return require('../src/utils/receiptTextContrast.ts')
    if (id.includes('receiptItemColumns')) return require('../src/utils/receiptItemColumns.ts')
    if (id.includes('ReceiptQrCodes')) {
      return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceiptComponent(receiptSource)

const LONG_ITEM_NAME = 'Girlactik Matte Liquid Flirtatious'

const saleFixture = {
  receipt_number: '20260906-101500',
  created_at: '2026-09-06T03:15:00Z',
  cashier_name: 'Rath',
  payment_method: 'Cash',
  exchange_rate: 4065,
  is_delivery: 1,
  delivery_contact_name: 'Sok Dara',
  delivery_contact_phone: '012 345 678',
  delivery_fee_usd: 2,
  delivery_fee_khr: 8130,
  delivery_fee_paid_by: 'customer',
  subtotal_usd: 18,
  discount_usd: 0,
  tax_usd: 0,
  total_usd: 20,
  amount_paid_usd: 20,
  items: [
    { product_name: LONG_ITEM_NAME, quantity: 1, base_price_usd: 21, price_usd: 21, applied_price_usd: 18 },
  ],
}

function renderReceipt(templateOverrides: Record<string, unknown> = {}, printOverrides: Record<string, unknown> = {}): string {
  const settings = {
    business_name: 'Shop',
    exchange_rate: 4065,
    receipt_template: JSON.stringify(templateOverrides),
    receipt_print_settings: JSON.stringify(printOverrides),
  }
  return renderToStaticMarkup(React.createElement(Receipt, {
    sale: saleFixture,
    settings,
    onClose: () => {},
    _previewMode: true,
  }))
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// --- 1. the exchange rate rides the cashier row, unlabelled -----------------

await runTest('the rate prints as a bare value on the cashier row, in every language', () => {
  for (const receipt_language of ['en', 'km', 'both']) {
    const html = renderReceipt({ receipt_language })
    assert.ok(html.includes('1 USD = 4,065'), `${receipt_language}: the rate value must still print`)
    assert.equal(occurrences(html, '1 USD ='), 1, `${receipt_language}: the rate prints once`)
    // No "Exchange rate:" / "Rate:" / Khmer equivalent anywhere.
    assert.ok(!html.includes('Rate:'), `${receipt_language}: the English rate label must be gone`)
    assert.ok(!html.includes('អត្រាប្តូរ'), `${receipt_language}: the Khmer rate label must be gone`)
    // Same row as the cashier: one grid row carries both values.
    const rows = html.split('data-receipt-line="true"')
    const rateRow = rows.find((row) => row.includes('1 USD = 4,065'))
    assert.ok(rateRow, `${receipt_language}: the rate must live on a receipt row`)
    assert.ok(rateRow.includes('Rath'), `${receipt_language}: the rate must share the cashier's row`)
  }
})

await runTest('the cashier row is untouched when the rate is switched off', () => {
  const html = renderReceipt({ show_exchange_rate: false })
  assert.ok(!html.includes('1 USD'), 'no rate may print when the template hides it')
  assert.ok(html.includes('Cashier:'), 'the cashier row stays')
  assert.ok(html.includes('Rath'))
})

await runTest('the rate still prints when the cashier row itself is off', () => {
  const html = renderReceipt({ show_cashier: false })
  assert.ok(!html.includes('Cashier:'), 'the cashier label follows its own flag')
  assert.ok(!html.includes('Rath'))
  assert.ok(html.includes('1 USD = 4,065'), 'hiding the cashier must not swallow the rate')
})

await runTest('no labelled rate row survives in the source', () => {
  assert.doesNotMatch(receiptSource, /labelFor\(lang, 'rate'\)/, 'the labelled rate row is gone')
  assert.doesNotMatch(receiptSource, /rate: '/, 'the retired rate label must not linger in LABELS')
})

// --- 2. the delivery fee prints exactly once, in the totals block ----------

await runTest('a sale with a delivery fee prints the fee row once, in the totals', () => {
  for (const receipt_language of ['en', 'km', 'both']) {
    const html = renderReceipt({ receipt_language })
    const feeLabel = receipt_language === 'km' ? 'ថ្លៃដឹកជញ្ជូន' : 'Delivery Fee'
    assert.equal(
      occurrences(html, feeLabel),
      1,
      `${receipt_language}: the delivery fee label must print once, not once per section`,
    )
    // ...and the one that survives is the money row, not a bare heading.
    const rows = html.split('data-receipt-line="true"')
    const feeRow = rows.find((row) => row.includes(feeLabel))
    assert.ok(feeRow, `${receipt_language}: the surviving fee label must be a real row`)
    assert.ok(feeRow.includes('$2.00'), `${receipt_language}: the surviving fee row carries the amount`)
  }
})

await runTest('the driver name and phone rows stay, under their own flags', () => {
  const html = renderReceipt()
  assert.ok(html.includes('Sok Dara'), 'the driver name row stays')
  assert.ok(html.includes('012 345 678'), 'the driver phone row stays')
  const hiddenName = renderReceipt({ delivery_show_driver_name: false })
  assert.ok(!hiddenName.includes('Sok Dara'), 'delivery_show_driver_name still hides the driver')
  assert.ok(hiddenName.includes('012 345 678'), 'and only the driver')
  const hiddenPhone = renderReceipt({ delivery_show_driver_phone: false })
  assert.ok(!hiddenPhone.includes('012 345 678'), 'delivery_show_driver_phone still hides the phone')
  // The fee still prints its one row when the whole contact block is off.
  const noContact = renderReceipt({ delivery_show_contact: false })
  assert.equal(occurrences(noContact, 'Delivery Fee'), 1)
})

await runTest('the contact section does not print a bare divider once every row is off', () => {
  const html = renderReceipt({
    delivery_show_driver_name: false,
    delivery_show_driver_phone: false,
    delivery_show_address: false,
  })
  assert.ok(!html.includes('Sok Dara'))
  assert.ok(!html.includes('012 345 678'))
  // The dashed rule that opened the section must go with its last row: the
  // customer block and the item table each own one, so an empty delivery
  // block would print a third with nothing under it.
  const dashedRules = occurrences(html, 'border-t border-dashed border-gray-300 pt-2')
  const withRows = occurrences(renderReceipt(), 'border-t border-dashed border-gray-300 pt-2')
  assert.equal(dashedRules, withRows - 1, 'the empty delivery block must not render its own rule')
})

await runTest('the delivery-contact section no longer carries a fee heading', () => {
  assert.equal(
    (receiptSource.match(/labelFor\(lang, 'delivery'\)/g) || []).length,
    1,
    'only the totals row may use the delivery-fee label',
  )
})

// --- 3. no item-count row on any template ---------------------------------

await runTest('no template prints a total-items row', () => {
  for (const receipt_language of ['en', 'km', 'both']) {
    // The full roll receipt...
    const full = renderReceipt({ receipt_language })
    assert.ok(!full.includes('Total Qty'), `${receipt_language}: the English total-items row must be gone`)
    assert.ok(!full.includes('សរុបចំនួនទំនិញ'), `${receipt_language}: the Khmer total-items row must be gone`)
    // ...and the 80x50 summary card, which counted the items in a Qty row.
    // With the card enabled the preview stacks BOTH renditions, so isolate
    // the card: it is the block between the "80 × 50 mm" caption and the
    // full receipt's own size caption.
    const stacked = renderReceipt({ receipt_language, sales_receipt_enabled: true })
    const card = stacked.split('mm</p>')[1] || ''
    assert.ok(card.length > 0, `${receipt_language}: the 80x50 card must render`)
    assert.ok(card.includes('TOTAL') || card.includes('សរុប'), `${receipt_language}: sanity -- the card body was isolated`)
    assert.ok(!card.includes('Total Qty'), `${receipt_language}: the 80x50 card must not count items either`)
    assert.ok(!card.includes('សរុបចំនួនទំនិញ'))
    assert.ok(!card.includes('>Qty<'), `${receipt_language}: no bare item-count row on the 80x50 card`)
    assert.ok(!card.includes('>ចំនួន<'), `${receipt_language}: nor its Khmer label`)
  }
})

await runTest('the per-line qty column is untouched by the row removal', () => {
  const html = renderReceipt()
  assert.ok(html.includes('data-receipt-cell="qty"'), 'the qty column stays')
  assert.ok(html.includes('>Qty</span>'), 'and keeps its header cell')
  const noQty = renderReceipt({ show_item_qty: false })
  assert.ok(noQty.includes('data-receipt-cell="qty"'), 'the flag empties the cell rather than dropping the track')
})

await runTest('the retired row leaves no zombie behind', () => {
  assert.doesNotMatch(receiptSource, /totalQty/, 'no totalQty label, const or section may linger')
  assert.doesNotMatch(receiptSource, /total_qty/, 'and no field-order entry for it')
})

if (failed > 0) {
  process.exitCode = 1
}
