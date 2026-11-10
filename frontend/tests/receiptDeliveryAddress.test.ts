// Defect A/B (10 Nov 2026): a delivery contact whose address column holds the
// Contact Options JSON printed that JSON on the receipt, and the hide switch
// must hide the resolved address in every shape.
// Run: node tests/receiptDeliveryAddress.test.ts
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
  RECEIPT_ITEM_COLUMN_FLOOR_EM,
  RECEIPT_ITEM_NUMERIC_FONT_EM,
  RECEIPT_ROW_COLUMN_GAP_PX,
  RECEIPT_ROW_GRID_TEMPLATE,
  RECEIPT_ROW_LABEL_PADDING_PX,
  receiptItemGridTemplate,
  receiptNameColumnWidthPx,
  receiptNameLineCount,
  receiptNumericWidthEm,
  receiptResolveItemTracksPx,
  receiptTextWidthPx,
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
    if (id.includes('utils/pricing')) return require('../src/utils/pricing.ts') // priceText: a unit price shows rounded UP, the till's rule
    if (id.includes('receiptTotals')) return require('../src/utils/receiptTotals.ts')
    if (id.includes('receipt-settings/template')) return require('../src/components/receipt-settings/template.ts')
    if (id.includes('receiptAppliedConfig')) return require('../src/utils/receiptAppliedConfig.ts')
    if (id.includes('receiptTextContrast')) return require('../src/utils/receiptTextContrast.ts')
    if (id.includes('receiptItemColumns')) return require('../src/utils/receiptItemColumns.ts')
    // Real: it caps the promotion named beside the item name. Stubbed away,
    // the whole line throws (see promotionLabelCap.test.ts).
    if (id.includes('saleItemNameLayout')) return require('../src/utils/saleItemNameLayout.ts')
    if (id.includes('customerIdentity')) return require('../src/utils/customerIdentity.ts')
    // Real: the receipt prints the sale's DISPLAY address, and this kernel is
    // what turns a stored options blob into one (see contactDisplayAddress.test
    // .ts). Stubbed away, the customer row silently renders nothing.
    if (id.includes('contactOptionUtils')) return require('../src/components/contacts/contactOptionUtils.ts')
    if (id.includes('ReceiptQrCodes')) {
      return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceiptComponent(receiptSource)

const JSON_ADDRESS = '[{"label":"Default","name":"ta","phone":"","email":"","address":"","area":""}]'
const REAL_OPTIONS = JSON.stringify([
  { label: 'Default', name: '', phone: '', email: '', address: '', area: '' },
  { label: 'Shop', name: '', phone: '', email: '', address: 'St 271, Phnom Penh', area: 'Toul Kork' },
])
const AREA_ONLY = JSON.stringify([{ label: 'Default', name: '', phone: '', email: '', address: '', area: 'Toul Kork' }])

const sale = (address: unknown) => ({
  receipt_number: '20261110-130012',
  created_at: '2026-11-10T06:00:12Z',
  cashier_name: 'Za',
  payment_method: 'Cash',
  exchange_rate: 4065,
  is_delivery: 1,
  delivery_contact_name: 'ta',
  delivery_contact_phone: '',
  delivery_contact_address: address,
  subtotal_usd: 10,
  total_usd: 10,
  amount_paid_usd: 10,
  items: [{ product_name: 'Lip Balm', quantity: 1, base_price_usd: 10, price_usd: 10, applied_price_usd: 10 }],
})

function render(saleRow: Record<string, unknown>, template: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(React.createElement(Receipt, {
    sale: saleRow,
    settings: { business_name: 'Shop', exchange_rate: 4065, receipt_template: JSON.stringify(template), receipt_print_settings: '{}' },
    onClose: () => {},
    _previewMode: true,
  }))
}

for (const receipt_language of ['en', 'km', 'both']) {
  await runTest(receipt_language + ': an all-empty address array prints no JSON and no address row', () => {
    const html = render(sale(JSON_ADDRESS), { receipt_language })
        assert.ok(!html.includes('&quot;label'), 'no escaped JSON quotes')
    assert.ok(!html.includes('[{'), 'no array text')
    assert.ok(html.includes('ta'), 'the driver name still prints')
    const driverBlock = html.split('data-receipt-line="true"').filter((row) => /អាសយដ្ឋាន|Address/.test(row))
    assert.equal(driverBlock.length, 0, 'no address row at all: customer has none either')
  })
}

await runTest('an options array with a real entry prints that address, not the JSON', () => {
  const html = render(sale(REAL_OPTIONS))
  assert.ok(html.includes('St 271, Phnom Penh'))
  assert.ok(!html.includes('&quot;label'))
})

await runTest('an area-only entry prints the area, a plain string prints as typed', () => {
  assert.ok(render(sale(AREA_ONLY)).includes('Toul Kork'))
  assert.ok(render(sale('Street 9, Siem Reap')).includes('Street 9, Siem Reap'))
})

await runTest('a sale whose only delivery field is an empty address array prints no delivery block', () => {
  const html = render({ ...sale(JSON_ADDRESS), delivery_contact_name: '' })
  assert.equal(occurrences(html, 'border-t border-dashed border-gray-300 pt-2'), occurrences(render({ ...sale(null), delivery_contact_name: '' }), 'border-t border-dashed border-gray-300 pt-2'))
})

for (const address of [REAL_OPTIONS, JSON_ADDRESS, 'Street 9, Siem Reap']) {
  await runTest('delivery_show_address false hides the address in every shape, default shows it', () => {
    const hidden = render(sale(address), { delivery_show_address: false })
    assert.ok(!hidden.includes('St 271') && !hidden.includes('Street 9') && !hidden.includes('&quot;label'))
    assert.ok(hidden.includes('ta'), 'only the address goes')
  })
}

await runTest('the hide switch is honoured when the saved template is the stringified form too', () => {
  const settings = { business_name: 'Shop', receipt_template: JSON.stringify({ delivery_show_address: false }), receipt_print_settings: '{}' }
  const html = renderToStaticMarkup(React.createElement(Receipt, { sale: sale('Street 9, Siem Reap'), settings, onClose: () => {}, _previewMode: true }))
  assert.ok(!html.includes('Street 9'))
  assert.ok(render(sale('Street 9, Siem Reap')).includes('Street 9'), 'default (no saved key) shows it')
})

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

if (failed) process.exit(1)
