// Owner, 17 Nov 2026: the Inventory rows show prices and cost in the colours Products shows them in ("wire what is done in the Products page"). The colours now live in ONE export
// (ProductRowParts VALUE_TONE / PriceValue), read by Products' price cells, the Products column headers and the Inventory rows. Products must look exactly as it did: this file renders the real
// cells and headers and compares them with the markup the code produced before PriceValue existed (rebuilt here with React.createElement from the old JSX), so a changed class or an extra node fails.
//
// Run: node tests/productValueTones.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { headOf, loadSource, renderSurface } from './productsSurfaceFixture.ts'
import { productColumnsFor } from '../src/components/products/config/productTableColumns.ts'
import { createHarness } from './mountedComponentHarness.ts'

const parts = await loadSource('components/products/surfaces/ProductRowParts.tsx')
const PriceCell = parts.ProductPriceCell as React.ComponentType<Record<string, unknown>>
const PriceValue = parts.PriceValue as React.ComponentType<Record<string, unknown>>
const ReadOnlyMark = parts.ReadOnlyMark as React.ComponentType<Record<string, unknown>>
const VALUE_TONE = parts.VALUE_TONE as Record<string, string>
const h = React.createElement
const html = (node: React.ReactElement) => renderToStaticMarkup(node)
const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const fmt = (value: number) => `$${value.toFixed(2)}`

// The price cell as it was written before PriceValue (khr 0: the riel line is untouched code and not drawn).
function legacyPriceCell(args: { usd: number; tone: 'selling' | 'wholesale'; lockTip?: string }) {
  const ink = args.lockTip ? 'text-gray-500 dark:text-gray-400' : args.tone === 'selling' ? 'font-semibold text-green-700 dark:text-green-400' : 'font-medium text-primary-700 dark:text-primary-400'
  return h('div', { className: 'min-w-0' }, h('div', { className: 'flex items-center justify-end gap-1' }, args.lockTip ? h(ReadOnlyMark, { tip: args.lockTip }) : null, h('span', { className: ink }, fmt(args.usd))))
}
const cell = (props: Record<string, unknown>) => h(PriceCell, { khr: 0, fmtUSD: fmt, fmtKHR: (v: number) => `${v}៛`, ...props })

const cases: Array<[string, () => void | Promise<void>]> = [
  ['Products price cells are byte-identical to the markup before PriceValue (selling, wholesale, read-only, no wholesale)', () => {
    for (const args of [{ usd: 12.5, tone: 'selling' }, { usd: 8, tone: 'wholesale' }, { usd: 12.5, tone: 'selling', lockTip: 'No price permission' }, { usd: 8, tone: 'wholesale', lockTip: 'No price permission' }] as const) {
      assert.equal(html(cell(args)), html(legacyPriceCell(args)), `${args.tone}${'lockTip' in args ? ' (locked)' : ''}`)
    }
    assert.match(html(cell({ usd: 0, tone: 'wholesale' })), /<span>—<\/span>/, 'an unset wholesale price still reads as a dash')
    const withPromotion = html(cell({ usd: 12.5, tone: 'selling', children: h('i', { id: 'promo' }) }))
    assert.ok(withPromotion.endsWith('</span></div><i id="promo"></i></div>'), 'children (the promotion line) stay under the value')
  }],
  ['the shared tones are exactly the Products colours: selling green semibold, wholesale primary medium, cost red, margin blue', () => {
    assert.deepEqual({ ...VALUE_TONE }, {
      selling: 'font-semibold text-green-700 dark:text-green-400',
      wholesale: 'font-medium text-primary-700 dark:text-primary-400',
      cost: 'text-red-600 dark:text-red-400',
      margin: 'text-blue-600 dark:text-blue-400',
      muted: 'text-gray-500 dark:text-gray-400',
    })
  }],
  ['PriceValue: without a label it is one bare span; with one the name is sr-only text plus a tooltip and the value keeps its tone', () => {
    assert.equal(html(h(PriceValue, { tone: 'cost' }, '$3.00')), '<span class="text-red-600 dark:text-red-400">$3.00</span>')
    const named = html(h(PriceValue, { tone: 'selling', label: 'Selling price', 'data-price': 'selling', className: 'tabular-nums' }, '$9.00'))
    assert.match(named, /^<span [^>]*class="font-semibold text-green-700 dark:text-green-400 tabular-nums"/)
    assert.match(named, /title="Selling price"/)
    assert.match(named, /data-price="selling"/)
    assert.match(named, /<span class="sr-only">Selling price <\/span>\$9\.00<\/span>$/)
  }],
  ['the Products column headers keep their cost, selling and margin colours (cost and margin now come from the shared tones)', () => {
    const columns = productColumnsFor({ canViewCosts: true })
    const head = headOf(renderSurface(columns))
    const classOf = (key: string) => (head.match(new RegExp(`<th [^>]*data-column="${key}"[^>]*class="([^"]*)"`)) ?? head.match(new RegExp(`<th [^>]*class="([^"]*)"[^>]*data-column="${key}"`)))?.[1] ?? ''
    for (const [key, tone] of [['cost', 'col-highlight-red text-red-600 dark:text-red-400'], ['selling', 'col-highlight-green text-green-600 dark:text-green-400'], ['margin', 'text-blue-600 dark:text-blue-400']] as const) {
      assert.ok(classOf(key).includes(tone), `${key} header keeps "${tone}" (got "${classOf(key)}")`)
    }
  }],
  ['one source: the Inventory rows and the Products headers read VALUE_TONE and carry no colour literal of their own', () => {
    const rows = read('components/inventory/InventoryCheckListRows.tsx')
    assert.match(rows, /import \{ PriceValue, ProductDiscountBadge \} from '\.\.\/products\/surfaces\/ProductRowParts\.tsx'/)
    for (const literal of ['text-green-700', 'text-primary-700', 'text-blue-600', 'text-green-400', 'text-primary-400']) assert.ok(!rows.includes(literal), `the Inventory rows do not copy ${literal}`)
    const surface = read('components/products/surfaces/ProductsListSurface.tsx')
    assert.match(surface, /VALUE_TONE\.cost/)
    assert.match(surface, /margin: VALUE_TONE\.margin/)
  }],
  ['the detail sheet draws selling, wholesale, cost and margin in the SAME tones as the rows (it used to read green-600 / indigo-600 literals)', async () => {
    const found = await detailTones()
    assert.equal(found.selling, VALUE_TONE.selling)
    assert.equal(found.wholesale, VALUE_TONE.wholesale, 'wholesale was text-indigo-600 here and text-primary-700 on the rows')
    assert.ok((found.cost ?? '').includes(VALUE_TONE.cost), `cost: ${found.cost}`)
    assert.equal(found.margin, VALUE_TONE.margin)
  }],
  ['the detail sheet source carries no money colour literal of its own', () => {
    const modal = read('components/products/surfaces/ProductDetailModal.tsx')
    assert.match(modal, /import \{ VALUE_TONE \} from '\.\/ProductRowParts\.tsx'/)
    for (const literal of ['text-indigo-', 'text-green-600', 'text-blue-600', 'text-red-600 decoration']) assert.ok(!modal.includes(literal), `the detail sheet does not copy ${literal}`)
  }],
]

// The detail sheet (Products AND Inventory mount it) is the other place these four colours are drawn; mounted for real, each value must carry exactly the shared class string.
const detailHarness = await createHarness({})
const detailTones = async () => {
  const surface = await detailHarness.mount({
    component: 'components/products/surfaces/ProductDetailModal.tsx',
    props: { p: { id: 41, name: 'Tone serum', unit: 'pcs', stock_quantity: 7, selling_price_usd: 12.5, wholesale_price_usd: 10, cost_price_usd: 3.21 }, fmtUSD: fmt, fmtKHR: (v: number) => `${v}៛`, onClose: () => {}, report: false },
    app: { user: { id: 1, role_code: 'admin', permissions: {} }, getPermissionTier: () => 'full', can: () => false, t: (key: string) => key, settings: {} },
    doubles: {},
  })
  const classOf = (value: string) => surface.find(node => node.textContent === value && (node.getAttribute('class') ?? '') !== '' && node.children.every(child => child.textContent !== value), value).getAttribute('class')
  const found = { selling: classOf('$12.50'), wholesale: classOf('$10.00'), cost: surface.find(node => node.tagName === 'BUTTON' && node.textContent === '$3.21', 'cost button').getAttribute('class'), margin: classOf('$9.29') }
  await surface.unmount()
  return found
}

let failed = 0
for (const [name, run] of cases) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
await detailHarness.close()
if (failed) process.exit(1)
console.log(`productValueTones passed: ${cases.length} cases`)
