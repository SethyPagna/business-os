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

// The ONE owner of the receipt's grid geometry -- the component and the
// print/image/PDF exporter both read it, and so does this test, rather than
// restating the numbers and pinning a second copy of them.
const {
  RECEIPT_ITEM_COLUMN_LIMIT_EM,
  RECEIPT_ITEM_NUMERIC_FONT_EM,
  receiptItemGridTemplate,
  receiptNameColumnWidthPx,
  receiptNameLineCount,
  receiptNumericWidthEm,
} = require('../src/utils/receiptItemColumns.ts') as typeof import('../src/utils/receiptItemColumns.ts')

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

// --- 4. compact item rows: the name column gets the width -----------------

await runTest('a 34-character product name fits two lines at 80 mm', () => {
  assert.equal(LONG_ITEM_NAME.length, 34)
  assert.ok(
    receiptNameLineCount(LONG_ITEM_NAME.length, { paperWidthMm: 80, fontSizePx: 12 }) <= 2,
    `the name column must hold the owner's example in two lines, got ${receiptNameLineCount(LONG_ITEM_NAME.length, { paperWidthMm: 80, fontSizePx: 12 })}`,
  )
  // The budget charges every money column its full fit-content limit, so a
  // real row -- a one-digit qty costs one character, not 1.8em -- has more
  // room than this, never less.
  assert.ok(receiptNameColumnWidthPx({ paperWidthMm: 80, fontSizePx: 12 }) > 140)
})

await runTest('the money columns cannot claim the name column by growing to max-content', () => {
  const template = receiptItemGridTemplate(true)
  assert.match(template, /^minmax\(0,1fr\) /, 'the name column is the flexible one')
  assert.ok(!template.includes('auto'), 'an auto track takes max-content and squeezes the name')
  assert.equal((template.match(/fit-content\(/g) || []).length, 3, 'qty, price and total are all capped')
  const threeCol = receiptItemGridTemplate(false)
  assert.equal((threeCol.match(/fit-content\(/g) || []).length, 2, 'with the price column off, two money tracks')
  // em, never rem: rem is the ROOT font size (16px) and knows nothing about
  // the receipt's own font_size, so a shop printing at 9px paid 16px-rooted
  // columns. Every track this module hands out is relative to the receipt.
  assert.ok(!template.includes('rem'), 'the item track must not be rem-sized')
  assert.ok(!threeCol.includes('rem'))
})

await runTest('a capped money column still never breaks a figure across lines', () => {
  // The widest thing the price column prints on a line of its own is the
  // parenthesised per-unit cut. Its limit has to hold that whole, or the
  // "compact" columns would win their width by splitting "(-$3.00)" in two.
  assert.ok(
    RECEIPT_ITEM_COLUMN_LIMIT_EM.unitPrice >= receiptNumericWidthEm('(-$3.00)'.length),
    `the price column must hold "(-$3.00)" unbroken, ${RECEIPT_ITEM_COLUMN_LIMIT_EM.unitPrice}em < ${receiptNumericWidthEm(8)}em`,
  )
  assert.ok(
    RECEIPT_ITEM_COLUMN_LIMIT_EM.lineTotal >= receiptNumericWidthEm('$18.00'.length),
    'and the total column its own figure',
  )
  assert.ok(
    RECEIPT_ITEM_COLUMN_LIMIT_EM.qty >= receiptNumericWidthEm('99'.length),
    'and the qty column a two-digit quantity',
  )
  assert.ok(RECEIPT_ITEM_NUMERIC_FONT_EM < 1, 'the money cells print smaller than the name')
})

await runTest('the 58 mm and 80x50 templates still leave the name a real column', () => {
  // 58mm is the narrowest paper the settings offer, and 80x50 prints its full
  // rendition on the 80mm roll. Both are measured at the smallest font the
  // receipt settings allow through to the largest, because the tracks are em
  // -sized and the paper is not.
  for (const paperWidthMm of [58, 80]) {
    for (const fontSizePx of [9, 12, 16]) {
      const width = receiptNameColumnWidthPx({ paperWidthMm, fontSizePx })
      assert.ok(width > 0, `${paperWidthMm}mm @ ${fontSizePx}px: the name column collapsed to ${Math.round(width)}px`)
    }
  }
  // On 58mm the owner's 34-character example does not fit two lines -- there
  // is not that much paper -- but it must not be the four it was.
  assert.ok(
    receiptNameLineCount(LONG_ITEM_NAME.length, { paperWidthMm: 58, fontSizePx: 12 }) <= 4,
    'the 58mm name column must still be usable',
  )
})

await runTest('the rendered table uses the shared track on the header AND the rows', () => {
  const html = renderReceipt()
  const template = receiptItemGridTemplate(true)
  assert.equal(
    occurrences(html, `grid-template-columns:${template}`),
    2,
    'the header row and the item row must both carry the one shared track',
  )
  // The name column takes every pixel the money columns leave.
  assert.ok(html.includes(LONG_ITEM_NAME))
  // The numbers never break mid-figure, and the discount keeps its
  // parentheses beside the price it describes.
  const rows = html.split('data-receipt-cell="price"')
  const priceCell = rows[rows.length - 1]
  assert.ok(priceCell.includes('$21.00'), 'the price cell prints the selling price')
  assert.ok(priceCell.includes('(-$3.00)'), 'and the cut in parentheses')
  assert.ok(priceCell.includes('whitespace-nowrap'), 'the figures do not wrap mid-number')
  assert.ok(html.includes('data-receipt-cell="line-total"'))
})

await runTest('the narrow templates render the same one table', () => {
  const template = receiptItemGridTemplate(true)
  for (const paperSize of ['58mm', '80x50mm']) {
    const html = renderReceipt({}, { paperSize })
    assert.equal(
      occurrences(html, `grid-template-columns:${template}`),
      2,
      `${paperSize}: the item table is the same table at every paper width`,
    )
    assert.ok(html.includes(LONG_ITEM_NAME), `${paperSize}: the full name still prints`)
  }
})

await runTest('the print/image/PDF export reads the same track, not its own copy', () => {
  const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(printSource, /receiptItemGridTemplate/, 'the exporter must call the shared helper')
  assert.doesNotMatch(
    printSource,
    /gridTemplateColumns = 'minmax\(0,1fr\) 2\.2rem/,
    'the exporter must not carry its own item track -- that copy had already drifted',
  )
  assert.doesNotMatch(receiptSource, /grid-cols-\[minmax\(0,1fr\)_2\.2rem/, 'nor the component')
  // The label/value rows had drifted too -- 4.25rem on paper against 4.6rem
  // on screen -- so they come from the same module now.
  assert.match(printSource, /RECEIPT_ROW_GRID_TEMPLATE/, 'and the label/value row track is shared as well')
  assert.doesNotMatch(printSource, /minmax\(4\.25rem,auto\)/, 'the exporter\'s drifted value column is gone')
  assert.doesNotMatch(receiptSource, /grid-cols-\[minmax\(0,1fr\)_minmax\(4\.6rem,auto\)\]/, 'and the component\'s rem-sized one with it')
})

// --- 5. the QR codes sit tight above their captions ------------------------

// Tailwind's spacing scale in px, for the classes this block uses. Reading the
// gap out of the rendered markup rather than asserting a class name means the
// test states the DISTANCE the owner complained about, not its spelling.
const TAILWIND_SPACING_PX: Record<string, number> = {
  '0': 0, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '3': 12,
}

function spacingPx(classList: string, prefix: string): number {
  const match = classList.match(new RegExp(`(?:^|\\s)${prefix}-([0-9.]+)(?:\\s|$)`))
  if (!match) return 0
  const px = TAILWIND_SPACING_PX[match[1]]
  assert.ok(px !== undefined, `unmapped Tailwind spacing ${prefix}-${match[1]}`)
  return px
}

const qrSource = fs.readFileSync(new URL('../src/components/receipt/ReceiptQrCodes.tsx', import.meta.url), 'utf8')

function loadQrComponent(): unknown {
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(qrSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    return { normalizeSocialQrUrl: (url: string) => ({ url }) }
  }, mod, mod.exports)
  return mod.exports.default
}

await runTest('a QR image and its caption are 2px apart, not 8', () => {
  const ReceiptQrCodes = loadQrComponent()
  const html = renderToStaticMarkup(React.createElement(ReceiptQrCodes, {
    entries: [
      { key: 'portal', label: 'Shop Online', url: 'https://example.com' },
      { key: 'fb', label: 'Facebook', url: 'https://facebook.com/x' },
      { key: 'tg', label: 'Telegram', url: 'https://t.me/x' },
    ],
    scanLabel: 'Scan to visit',
  }))
  // The tile is the flex column that holds one code and its name.
  const tileClasses = [...html.matchAll(/class="([^"]*flex-col[^"]*)"/g)].map((match) => match[1])
  assert.equal(tileClasses.length, 3, 'three tiles rendered')
  // The white box around the code, whose padding used to add 4px underneath
  // the image on top of the flex gap.
  const boxClasses = [...html.matchAll(/class="(flex w-full max-w-\[68px\][^"]*)"/g)].map((match) => match[1])
  assert.equal(boxClasses.length, 3, 'each code sits in its own box')
  for (let index = 0; index < 3; index += 1) {
    const distance = spacingPx(tileClasses[index], 'gap') + spacingPx(boxClasses[index], 'p')
    assert.ok(
      distance <= 2,
      `the code and its caption must sit within 2px, got ${distance}px (it was 4px of box padding + a 4px gap)`,
    )
  }
})

await runTest('the three QR columns are evenly spaced and fit narrow paper', () => {
  const ReceiptQrCodes = loadQrComponent()
  const html = renderToStaticMarkup(React.createElement(ReceiptQrCodes, {
    entries: [
      { key: 'portal', label: 'Shop Online', url: 'https://example.com' },
      { key: 'fb', label: 'Facebook', url: 'https://facebook.com/x' },
      { key: 'tg', label: 'Telegram', url: 'https://t.me/x' },
    ],
    scanLabel: 'Scan to visit',
  }))
  const grid = html.match(/class="(grid grid-cols-3[^"]*)"/)
  assert.ok(grid, 'the codes are laid out on a grid')
  assert.match(grid[1], /grid-cols-3/, 'three equal columns')
  assert.match(grid[1], /justify-items-center/, 'each tile centred in its own column -- that is the even spacing')
  // A fixed 80px tile times three plus gutters overflows a 58mm receipt's
  // ~187px content box; the tile has to be able to shrink.
  assert.doesNotMatch(qrSource, /className="flex w-\[80px\]/, 'the tile must not be a fixed width')
  assert.match(qrSource, /w-full max-w-\[80px\]/)
})

if (failed > 0) {
  process.exitCode = 1
}
