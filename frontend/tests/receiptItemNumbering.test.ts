// P10 (owner, photo of a printed 20-line receipt whose column header read
//   "Item / Qty / Price / Total", verbatim): "i want a numbered list for each
//   products as well just before each products. also for the header, items,
//   qty, price, total. for the items do n items. as in total items."
//
// Two behaviours, pinned as RENDERED assertions (react-dom/server, the same
// component POS.tsx, Sales.tsx and the receipt-settings preview mount, and
// the same DOM printReceipt.ts clones for print/image/PDF -- a grep can pass
// while the row still prints the old text):
//   1. every product line carries "N." directly before its name, inside the
//      flexible name column -- never its own row or column.
//   2. the item table's header states the printed LINE count ("Items (n)"),
//      not the summed quantity, and n is exactly items.length.
//
// Run: node --experimental-strip-types tests/receiptItemNumbering.test.ts
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

const { receiptNameLineCount } = require('../src/utils/receiptItemColumns.ts') as typeof import('../src/utils/receiptItemColumns.ts')

// Same stub shape as receiptCompactRows.test.ts: only the shell (app context,
// icons, portal menu) is faked -- every collaborator that decides what a row
// says (money math, template normalizer, name layout) is loaded for real.
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
    if (id.includes('saleItemNameLayout')) return require('../src/utils/saleItemNameLayout.ts')
    if (id.includes('customerIdentity')) return require('../src/utils/customerIdentity.ts')
    if (id.includes('contactOptionUtils')) return require('../src/components/contacts/contactOptionUtils.ts')
    if (id.includes('ReceiptQrCodes')) {
      return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceiptComponent(receiptSource)

function itemsFixture(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    product_name: `Product ${i + 1}`,
    quantity: 1,
    base_price_usd: 5,
    price_usd: 5,
    applied_price_usd: 5,
  }))
}

function renderReceipt(itemCount: number, templateOverrides: Record<string, unknown> = {}, saleOverrides: Record<string, unknown> = {}): string {
  const settings = {
    business_name: 'Shop',
    exchange_rate: 4065,
    receipt_template: JSON.stringify(templateOverrides),
    receipt_print_settings: JSON.stringify({}),
  }
  const sale = {
    receipt_number: '20260916-101500',
    created_at: '2026-09-16T03:15:00Z',
    cashier_name: 'Rath',
    payment_method: 'Cash',
    exchange_rate: 4065,
    subtotal_usd: 5 * itemCount,
    discount_usd: 0,
    tax_usd: 0,
    total_usd: 5 * itemCount,
    amount_paid_usd: 5 * itemCount,
    items: itemsFixture(itemCount),
    ...saleOverrides,
  }
  return renderToStaticMarkup(React.createElement(Receipt, {
    sale,
    settings,
    onClose: () => {},
    _previewMode: true,
  }))
}

function itemRows(html: string): string[] {
  return html.split('data-receipt-cell="name"').filter((chunk) => chunk.includes('data-receipt-main="true"'))
}

for (const count of [1, 9, 20]) {
  await runTest(`the header states "Items (${count})" for a ${count}-line receipt`, () => {
    for (const receipt_language of ['en', 'km', 'both']) {
      const html = renderReceipt(count, { receipt_language })
      const header = html.split('data-receipt-line="true"').find((chunk) => chunk.includes('data-receipt-cell="name"')) || ''
      assert.ok(header.includes(`>Items (${count})</span>`), `${receipt_language}: expected the "Items (${count})" header, got:\n${header}`)
      // Never the summed quantity: every fixture line carries quantity 1, so
      // a header stating the SUM would print the same number here by
      // coincidence -- state it explicitly against items.length instead.
      assert.doesNotMatch(header, />Item<\//, `${receipt_language}: the bare "Item" caption must be gone`)
    }
  })

  await runTest(`every one of ${count} product lines is numbered "N." directly before its name`, () => {
    const html = renderReceipt(count)
    const rows = itemRows(html)
    assert.equal(rows.length, count, `expected ${count} rendered item rows`)
    rows.forEach((row, index) => {
      const expectedNumber = `${index + 1}.`
      assert.match(
        row,
        new RegExp(`data-receipt-cell="item-number"[^>]*>${expectedNumber}</span>Product ${index + 1}`),
        `row ${index + 1}: the number must sit immediately before the product name, got:\n${row.slice(0, 200)}`,
      )
    })
  })
}

await runTest('the numbering counts printed LINES, not the summed quantity', () => {
  // Three lines, quantities 1/12/3 -- the sum (16) must never appear as a
  // line number or as the header count; the header states 3, the lines are
  // numbered 1, 2, 3.
  const html = renderReceipt(0, {}, {
    items: [
      { product_name: 'A', quantity: 1, applied_price_usd: 1 },
      { product_name: 'B', quantity: 12, applied_price_usd: 1 },
      { product_name: 'C', quantity: 3, applied_price_usd: 1 },
    ],
  })
  const header = html.split('data-receipt-line="true"').find((chunk) => chunk.includes('data-receipt-cell="name"')) || ''
  assert.ok(header.includes('>Items (3)</span>'), `expected "Items (3)", got:\n${header}`)
  const rows = itemRows(html)
  assert.equal(rows.length, 3)
  assert.match(rows[0], /data-receipt-cell="item-number"[^>]*>1\.<\/span>A/)
  assert.match(rows[1], /data-receipt-cell="item-number"[^>]*>2\.<\/span>B/)
  assert.match(rows[2], /data-receipt-cell="item-number"[^>]*>3\.<\/span>C/)
})

// A two-digit number plus a long Khmer name must still fit on two printed
// rows at most, on the standard 80mm roll -- the same budget the owner's
// original 34-character Latin example was pinned against in
// receiptCompactRows.test.ts. receiptTextWidthPx (and so
// receiptNameLineCount) already counts CODE POINTS, not UTF-16 units, so this
// is the same Courier model, only fed a Khmer string and the extra "20. "
// width the numbering now spends out of the name column's own budget.
const LONG_KHMER_NAME = 'ក្រែមថ្នាំលាបមុខស្អាតបំបាត់អុជទឹកមុខ' // 38 Khmer code points
const NUMBER_PREFIX = '20. ' // the widest two-digit line this test covers

await runTest('a two-digit number plus a long Khmer name still fits two rows at 80mm', () => {
  const budgetedLength = Array.from(LONG_KHMER_NAME).length + NUMBER_PREFIX.length
  const lineCount = receiptNameLineCount(budgetedLength, { paperWidthMm: 80, fontSizePx: 12 })
  assert.ok(
    lineCount <= 2,
    `the numbered Khmer name must hold two lines at 80mm, got ${lineCount} for a ${budgetedLength}-character budget`,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
