// The sale corner tag (owner, 6 Oct 2026): the status chip is the PAYMENT state
// only, and the return state is a corner ribbon that overlays the card without
// moving anything. Every assertion below is built so the plausible wrong
// implementation fails it: a chip that still says Partial Return, a returned
// Not Paid sale printed as Completed, a ribbon that takes clicks or sits above
// a float, a ribbon that pushes the card, a surface that kept the old chip.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { RETURN_STATUSES, saleChipStatus, saleReturnLoweredDebt, saleTags } from '../src/utils/saleTags.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

// ---- 1. the chip is the payment state ---------------------------------------
// chip('x') = the response did not carry the column; chip('x', v) = it carried v (possibly null).
const chip = (sale_status: string, ...before: unknown[]) =>
  saleChipStatus(before.length ? { sale_status, status_before_return: before[0] } : { sale_status })

assert.equal(chip('completed'), 'completed')
assert.equal(chip('awaiting_payment'), 'awaiting_payment')
assert.equal(chip('awaiting_delivery'), 'awaiting_delivery', 'a paid delivery still waiting keeps its own chip')
assert.equal(chip('cancelled'), 'cancelled', 'Cancelled stays Cancelled')
assert.equal(chip('cancelled', 'awaiting_payment'), 'cancelled', 'only a return state is re-read through status_before_return')

for (const returned of RETURN_STATUSES) {
  assert.equal(chip(returned, 'completed'), 'completed', `${returned} that was paid shows Completed, not a return chip`)
  assert.equal(chip(returned, 'awaiting_payment'), 'awaiting_payment', `${returned} that was Not Paid still shows Not Paid -- never Completed`)
  assert.equal(chip(returned, null), 'completed', 'a NULL column is the Worker COALESCE(status_before_return, completed)')
  assert.equal(chip(returned, ''), 'completed')
  assert.equal(chip(returned, ' Awaiting_Payment '), 'awaiting_payment', 'the stored value is read trimmed and lower-cased')
  assert.equal(chip(returned, 'awaiting_delivery'), 'awaiting_delivery')
  assert.equal(chip(returned, 'partial_return'), 'completed', 'a return state is never a payment state')
  assert.equal(chip(returned, 'garbage'), 'completed')
  assert.equal(saleChipStatus({ sale_status: returned }), returned,
    `${returned} from a response that does not carry the column keeps the stored status: unknown is NOT "was completed" (that would print Completed on a debt)`)
}
assert.equal(saleChipStatus({ status: 'returned', status_before_return: 'awaiting_payment' }), 'awaiting_payment', 'the customer report names the field `status`')
assert.equal(saleChipStatus({}), 'completed', 'blank is completed, as everywhere else')
assert.equal(saleChipStatus(null), 'completed')

// ---- 2. the tag is the return state -------------------------------------------
assert.deepEqual(saleTags({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }).map((tag) => tag.id), ['partial_return'])
assert.deepEqual(saleTags({ sale_status: 'returned', status_before_return: 'completed' }).map((tag) => tag.id), ['returned'])
assert.deepEqual(saleTags({ status: 'returned' }).map((tag) => tag.id), ['returned'], 'reads `status` too')
for (const none of ['completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled', '']) {
  assert.deepEqual(saleTags({ sale_status: none, status_before_return: 'awaiting_payment' }), [], `${none || 'blank'} carries no tag`)
}
assert.equal(saleReturnLoweredDebt({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }), true)
assert.equal(saleReturnLoweredDebt({ sale_status: 'returned', status_before_return: 'completed' }), false)
assert.equal(saleReturnLoweredDebt({ sale_status: 'returned' }), false, 'unknown is not a claim about a debt')
assert.equal(saleReturnLoweredDebt({ sale_status: 'awaiting_payment', status_before_return: 'awaiting_payment' }), false, 'a sale not returned lowered no debt')

// ---- 3. the ribbon renders the right text ---------------------------------------
const compiled = transformSync(read('components/sales/SaleTagRibbon.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const mod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.includes('utils/saleTags')) return require('../src/utils/saleTags.ts')
  throw new Error(`unexpected import ${id}`)
}, mod, mod.exports)
const SaleTagRibbon = (mod.exports as { default: (props: Record<string, unknown>) => unknown }).default
const render = (sale: unknown, t?: (key: string) => string) => renderToStaticMarkup(React.createElement(SaleTagRibbon, { sale, t }))

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const tIn = (pack: Record<string, string>) => (key: string) => pack[key] ?? key
const partial = { sale_status: 'partial_return', status_before_return: 'awaiting_payment' }

assert.equal(render({ sale_status: 'completed' }, tIn(en)), '', 'no tag, no ribbon')
assert.equal(render({ sale_status: 'cancelled' }, tIn(en)), '')
const partialEn = render(partial, tIn(en))
assert.match(partialEn, /data-sale-tag-ribbon="partial_return"/)
assert.match(partialEn, />Partial</, 'the band carries the short English word')
assert.match(partialEn, /aria-label="Partial Return"/, 'the accessible name is the full status name, with the pack arrow stripped')
const returnedKm = render({ sale_status: 'returned', status_before_return: 'completed' }, tIn(km))
assert.match(returnedKm, />បានប្រគល់</, 'Khmer reuses the existing word for Returned')
assert.match(render(partial, tIn(km)), />ប្រគល់ខ្លះ</, 'Khmer reuses the existing word for Partial return')
assert.match(render(partial), />Partial</, 'a missing translator falls back to English rather than printing a key')
assert.doesNotMatch(render(partial, tIn(en)), /sale_tag_/, 'the key never leaks')

// ---- 4. overlay, never reflow; never in the way; below every float ---------------
const ribbon = read('components/sales/SaleTagRibbon.tsx')
const hostClass = /<span\s+data-sale-tag-ribbon[\s\S]*?className="([^"]+)"/.exec(ribbon)?.[1] || ''
for (const required of ['absolute', 'pointer-events-none', 'overflow-hidden', 'z-0']) {
  assert.ok(hostClass.split(/\s+/).includes(required), `the ribbon box carries ${required}`)
}
assert.doesNotMatch(hostClass, /(^|\s)(relative|static|flex|block|inline|p-\d|m-\d|border)\b/, 'the ribbon box takes no space in the host and adds no padding or border')
assert.match(partialEn, /pointer-events-none/, 'the rendered markup does not take taps')
assert.match(ribbon, /-rotate-45/, 'the text is rotated about 45 degrees')
// z-0 is the floor of the app's scale: every layer that must cover it is above.
const layerNumbers = (path: string) => [...read(path).matchAll(/z-\[(\d+)\]/g)].map((match) => Number(match[1]))
const modalLayers = /layer === 'nested' \? 'z-\[(\d+)\]' : 'z-\[(\d+)\]'/.exec(read('components/shared/Modal.tsx'))
assert.ok(modalLayers, 'found the Modal layer classes')
const modalLayer = Math.min(Number(modalLayers[1]), Number(modalLayers[2]))
assert.ok(modalLayer >= 1050, `the Modal layer is z-[${modalLayer}]`)
const ribbonLayer = Number(/\bz-(\d+)\b/.exec(hostClass)?.[1])
assert.ok(ribbonLayer < 10, 'below even the smallest sticky/local layer (z-10)')
assert.ok(ribbonLayer < modalLayer)
for (const [path, floor] of [['components/shared/NotificationCenter.tsx', 1000], ['components/shared/BackgroundImportTracker.tsx', 1000], ['components/shared/DraftChipFloat.tsx', 60]] as const) {
  const highest = Math.max(0, ...layerNumbers(path))
  assert.ok(highest === 0 || highest >= floor, `${path} sits above the ribbon`)
}

// ---- 5. every sale surface draws the same component ---------------------------------
const surfaces: Array<[string, RegExp[]]> = [
  ['components/sales/SalesListSurface.tsx', [/<SaleTagRibbon sale=\{sale\}/g, /saleChipStatus\(sale\)/g]],
  ['components/sales/SaleDetailModal.tsx', [/<SaleTagRibbon sale=\{sale\}/g, /StatusBadge status=\{chipStatus\}/g]],
  ['components/contacts/CustomerPurchasesReportModal.tsx', [/<SaleTagRibbon sale=\{sale\}/g, /StatusBadge status=\{saleChipStatus\(sale\)\}/g]],
  ['components/dashboard/Dashboard.tsx', [/<SaleTagRibbon sale=\{sale\}/g, /saleChipStatus\(sale\)/g]],
]
const expectedRibbons: Record<string, number> = {
  'components/sales/SalesListSurface.tsx': 2, // desktop row + phone card
  'components/sales/SaleDetailModal.tsx': 1,
  'components/contacts/CustomerPurchasesReportModal.tsx': 2, // table row + phone card
  'components/dashboard/Dashboard.tsx': 2, // Sales card + View more list
}
for (const [path, patterns] of surfaces) {
  const source = read(path)
  const [ribbonPattern, chipPattern] = patterns
  assert.equal(source.match(ribbonPattern)?.length ?? 0, expectedRibbons[path], `${path} draws the ribbon once per layout`)
  assert.ok((source.match(chipPattern)?.length ?? 0) >= 1, `${path} shows the payment-state chip`)
  assert.doesNotMatch(source, /<StatusBadge status=\{(status|sale\.status|currentStatus)\}/, `${path} no longer prints the stored status as the chip`)
}
assert.doesNotMatch(read('components/dashboard/Dashboard.tsx'), /formatSaleStatus\(sale\.sale_status\)|getDashboardSaleStatusTone\(sale\.sale_status\)/, 'the dashboard rows no longer print the stored status')
// A ribbon's host must be the positioning context, and its receipt id must paint over the band.
const sales = read('components/sales/SalesListSurface.tsx')
assert.match(sales, /className=\{`card relative cursor-pointer/, 'the phone card is the ribbon host')
assert.match(sales, /<td className=\{`\$\{selectCellPad\} relative py-1\.5`\}/, 'the table row ribbon is hosted by its first cell')
assert.match(sales, /data-sales-card-primary-meta="" className="relative /, 'the phone card receipt row is positioned, so the id paints over the ribbon')

// ---- 6. the Worker projects the column the surfaces need -------------------------------
const compat = fs.readFileSync(new URL('../../cloudflare/src/routes/compat.ts', import.meta.url), 'utf8')
assert.equal(compat.match(/sale_status, status_before_return, branch_name/g)?.length, 2, 'Dashboard recent sales (summary and View more) carry status_before_return')
const salesRoute = fs.readFileSync(new URL('../../cloudflare/src/routes/sales.ts', import.meta.url), 'utf8')
assert.match(salesRoute, /AS status, s\.status_before_return,/, 'the customer sales report carries status_before_return')

// ---- 7. filters: the two return statuses are offered as TAG filters ---------------------
const salesPage = read('components/sales/Sales.tsx')
assert.match(salesPage, /ALL_STATUSES\.filter\(\(status\) => !RETURN_TAG_STATUSES\.includes\(status\)\)\.map\(statusFilterOption\)/, 'the Status section no longer lists the return statuses')
assert.match(salesPage, /id: 'tag',\s+label: t\('tag_label'\) \|\| 'Tag',\s+options: ALL_STATUSES\.filter\(\(status\) => RETURN_TAG_STATUSES\.includes\(status\)\)/, 'they live under a Tag section')
assert.equal(salesPage.match(/setStatusFilter\(toggleMultiValue\(statusFilter, status\)\)/g)?.length, 1, 'one toggle serves both sections, so the same stored status filter still works')

// ---- 8. both packs ---------------------------------------------------------------------------
for (const key of ['sale_tag_partial_return', 'sale_tag_returned', 'sale_tag_debt_lowered']) {
  assert.ok(en[key] && km[key], `${key} exists in both packs`)
  assert.notEqual(km[key], en[key], `${key} is translated`)
}
assert.equal(km.sale_tag_partial_return, km.status_partial_return.replace(/^[↩\s]+/u, ''), 'the Khmer ribbon word IS the existing status word')
assert.equal(km.sale_tag_returned, km.status_returned.replace(/^[↩\s]+/u, ''))

console.log('PASS sale corner tag: payment chip + overlay ribbon on every sale surface')
