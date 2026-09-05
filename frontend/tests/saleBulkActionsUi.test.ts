import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBulkSaleCancelInput } from '../src/api/salesTransport.ts'

assert.deepEqual(buildBulkSaleCancelInput({
  cancel_reason: 'other',
  cancel_note: '  buyer unreachable  ',
  cancel_fee_usd: '2.50',
  cancel_fee_khr: '4000',
  cancel_fee_note: ' courier ',
}), { reason: 'other', note: 'buyer unreachable', fee_usd: 2.5, fee_khr: 4000, fee_note: 'courier' })

assert.deepEqual(buildBulkSaleCancelInput({
  cancel_reason: 'mistake',
  cancel_note: ' ',
  cancel_fee_usd: '-1',
  cancel_fee_khr: 'not a number',
}), { reason: 'mistake' }, 'blank and invalid optional inputs must not become cancellation fields')

const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const change = readFileSync(new URL('../src/components/sales/BulkSaleChangeModal.tsx', import.meta.url), 'utf8')
const cancel = readFileSync(new URL('../src/components/sales/BulkSaleCancelModal.tsx', import.meta.url), 'utf8')

for (const field of ['status', 'payment_method', 'delivery_contact', 'customer']) {
  assert.ok(sales.includes(`openBulkChange('${field}')`), `${field} must be offered from the selected-sales toolbar`)
}
assert.match(change, /rows\.filter\(\(row\) => row\.currentKeys\.includes\(sourceKey\)\)/, 'review applies only to selected rows matching the chosen source, including split tenders')
assert.match(sales, /sale\.payment_details/, 'payment sources are derived from individual split-tender details')
assert.match(change, /matched\.length/, 'review shows the matching count')
assert.match(change, /rows\.length - matched\.length/, 'review shows how many selected rows are skipped')
assert.match(change, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/, 'bulk change review exposes dialog semantics and its title')
assert.match(change, /event\.key === 'Escape'/, 'bulk change review closes from the keyboard')
assert.match(sales, /getCustomers\(\{ search: query, page: 1, pageSize: 100 \}\)/, 'customer targets remain searchable beyond the initially loaded page')
assert.match(sales, /getDeliveryContacts\(\{ search: query, page: 1, pageSize: 100 \}\)/, 'delivery targets remain searchable beyond the initially loaded page')
assert.match(sales, /searchVersion !== bulkTargetSearchVersionRef\.current/, 'a slower superseded contact search cannot replace newer target choices')
assert.match(cancel, /drafts\.map/, 'bulk cancellation renders a review entry per sale')
assert.match(cancel, /max-h-\[65vh\].*overflow-y-auto/, 'bulk cancellation review stays scrollable')
assert.match(cancel, /aria-expanded=\{open\}/, 'each sale review is independently collapsible')
assert.match(cancel, /cancel_fee_usd/, 'each sale includes the single-sale USD lost-fee ask')
assert.match(cancel, /cancel_fee_khr/, 'each sale includes the single-sale KHR lost-fee ask')
assert.match(cancel, /useCloseGuard\(\{ dirty \}, onClose\)/, 'entered per-sale cancellation details are guarded from accidental dismissal')
assert.match(cancel, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/, 'bulk cancellation exposes dialog semantics and its title')
assert.match(cancel, /event\.key === 'Escape'/, 'bulk cancellation routes Escape through its close guard')
assert.match(cancel, /disabled=\{saving\}/, 'cancellation review fields lock while the frozen request is saving')
assert.match(sales, /source_status: sourceStatus/, 'status requests preserve the reviewed source condition')
assert.match(sales, /items: frozenSales\.map/, 'field updates send the whole frozen selection so server unchanged counts include source mismatches')
assert.match(sales, /statusPrompt\.requestSales/, 'status confirmation retains the whole frozen selection while reviewing matching rows')
assert.match(sales, /cancel: buildBulkSaleCancelInput\(draft\)/, 'each frozen status item carries its own reviewed cancellation answers')
assert.match(sales, /SectionExportAction/, 'Sales exports register with the section/title action host')
assert.match(sales, /hidden md:inline/, 'the mobile title-bar export keeps an icon-only 44px trigger')
const selectedToolbar = sales.slice(sales.indexOf('{selectedSales.length > 0 ? ('), sales.indexOf('{/* Pagination on its own row'))
assert.doesNotMatch(selectedToolbar, /handleExportSelected|translateOr\('export'/, 'selected-sales toolbar does not duplicate the top Export menu')

console.log('PASS Sales conditional bulk-action review and per-sale cancellation payloads')
