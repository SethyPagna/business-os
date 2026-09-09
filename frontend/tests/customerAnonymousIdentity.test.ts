import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import {
  filterSelectableCustomerRows,
  isAnonymousCustomerIdentity,
  resolveSaleCustomerEditorRoute,
  resolveSelectableCustomerById,
} from '../src/utils/customerIdentity.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

assert.equal(isAnonymousCustomerIdentity({ is_anonymous: 1 }), true)
assert.equal(isAnonymousCustomerIdentity({ customer_is_anonymous: true }), true)
for (const ordinary of [
  { id: 24969, name: 'General', phone: '', membership_number: 'LC-04971', is_anonymous: 0 },
  { id: 22305, name: 'General', phone: '086897171' },
  { name: 'Anonymous', phone: '' },
]) assert.equal(isAnonymousCustomerIdentity(ordinary), false, 'names and blank fields never infer authority')

const staleRows = [
  { id: 7, name: 'Selected before sync', is_anonymous: 0 },
  { id: 8, name: 'Other', is_anonymous: 0 },
]
assert.equal(resolveSelectableCustomerById(staleRows, 7)?.id, 7)
const refreshedRows = [{ id: 7, name: 'Selected before sync', is_anonymous: 1 }, staleRows[1]]
assert.equal(resolveSelectableCustomerById(refreshedRows, 7), null, 'a server marker transition clears a cached selected id')
assert.deepEqual(filterSelectableCustomerRows(refreshedRows).map((row) => row.id), [8])
assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 24969, customer_is_anonymous: 1 }), 'assignment')
assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 24969, customer_is_anonymous: 0 }), 'load-profile')
assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 24969, customer_is_anonymous: 0 }, { is_anonymous: 0 }), 'profile')
assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 24969, customer_is_anonymous: 0 }, { is_anonymous: 1 }), 'assignment')

function loadReceipt(): unknown {
  const source = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) {
      return { useApp: () => ({ fmtUSD: (v: unknown) => `$${Number(v).toFixed(2)}`, fmtKHR: String, khrSymbol: '៛', t: (key: string) => key }) }
    }
    if (id.includes('utils/formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('receiptLineMath')) return require('../src/utils/receiptLineMath.ts')
    if (id.includes('receiptTotals')) return require('../src/utils/receiptTotals.ts')
    if (id.includes('receipt-settings/template')) return require('../src/components/receipt-settings/template.ts')
    if (id.includes('receiptAppliedConfig')) return require('../src/utils/receiptAppliedConfig.ts')
    if (id.includes('receiptTextContrast')) return require('../src/utils/receiptTextContrast.ts')
    if (id.includes('receiptItemColumns')) return require('../src/utils/receiptItemColumns.ts')
    if (id.includes('contactOptionUtils')) return require('../src/components/contacts/contactOptionUtils.ts')
    if (id.includes('customerIdentity')) return require('../src/utils/customerIdentity.ts')
    if (id.includes('ReceiptQrCodes')) return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceipt()
const baseSale = {
  receipt_number: 'F72-1', created_at: '2026-09-09T00:00:00Z', customer_name: 'General',
  customer_phone: '012345678', customer_address: 'Historical address', customer_membership_number: 'LC-04971',
  total_usd: 0, subtotal_usd: 0, discount_usd: 0, tax_usd: 0, amount_paid_usd: 0, items: [],
}
const settings = { business_name: 'Shop', receipt_template: JSON.stringify({ show_customer_name: true, show_customer_phone: true, show_customer_address: true, show_customer_membership: true }) }
const render = (sale: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Receipt, { sale, settings, onClose: () => {}, _previewMode: true }))
const ordinaryHtml = render({ ...baseSale, customer_is_anonymous: 0 })
assert.match(ordinaryHtml, /012345678/)
assert.match(ordinaryHtml, /LC-04971/)
const anonymousHtml = render({ ...baseSale, customer_is_anonymous: 1 })
assert.doesNotMatch(anonymousHtml, /General/)
assert.match(anonymousHtml, /Historical address/)
assert.doesNotMatch(anonymousHtml, /012345678/)
assert.doesNotMatch(anonymousHtml, /LC-04971/)

const saleDetail = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
assert.match(saleDetail, /customer_is_anonymous\?: number \| boolean \| null/)
assert.match(saleDetail, /const customerIsAnonymous = isAnonymousCustomerIdentity\(sale\)/)
assert.match(saleDetail, /!customerIsAnonymous && sale\.customer_phone/)
assert.match(saleDetail, /customerIsAnonymous \? null : onAttachMembership/)
assert.match(saleDetail, /onClick=\{\(\) => onCustomerAction\(sale\)\}/, 'the single Edit action remains for the parent to route to attach-contact')

const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
assert.match(pos, /invalidatePosCustomerReads\(\)/)
assert.match(pos, /resolveSelectableCustomerById\(rows, selected\.id\)/)
assert.match(pos, /const checkoutCustomer: CustomerRecord = isSelectableCustomerIdentity\(active\.customer\)/)

console.log('customer anonymous identity: 16 checks passed')
