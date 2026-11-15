// <StockQty> (components/inventory/StockQty.tsx): the stock figure tinted by state.
//
// Rendered for real (react-dom/server) with the app's context, in both language packs. Every state is
// asserted by its data attribute, tint class, tooltip and screen-reader word, and the family rule for a
// merged row is pinned with a fixture where the SUM and the members disagree, so an implementation that
// judged the sum (or the lead's thresholds) fails. The light and dark palettes of each tint are checked
// in the stylesheet here and measured in a real browser by stockQtyLayout.test.ts. Mutants edit the
// component source and must each go red.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as lowStock from '../src/utils/lowStockSettings.ts'
import { DEFAULT_LOW_STOCK_CONFIG, resolveLowStockConfig, type LowStockConfig } from '../src/utils/lowStockSettings.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
const readSrc = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// The component compiled for real; only the app context is a stand-in whose language and settings the test sets.
let language: 'en' | 'km' = 'en'
let appSettings: Record<string, unknown> | undefined
function loadComponent(code = readSrc('components/inventory/StockQty.tsx')): { default: (props: Record<string, unknown>) => unknown; stockQtyLevel: (input: Record<string, unknown>) => string } {
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.endsWith('AppContext')) {
      return {
        useLowStockConfig: () => resolveLowStockConfig(appSettings),
        useT: (keys: string[]) => Object.fromEntries(keys.map((key) => [key, packs[language][key] ?? key])),
      }
    }
    if (id.endsWith('utils/lowStockSettings.ts')) return lowStock
    throw new Error(`unexpected require ${id}`)
  }, mod, mod.exports)
  return mod.exports as never
}
const component = loadComponent()
const stockQtyLevel = component.stockQtyLevel

function html(lang: 'en' | 'km', props: Record<string, unknown>, api = component): string {
  language = lang
  return renderToStaticMarkup(React.createElement(api.default, props))
}

const product = { low_stock_threshold: 10, out_of_stock_threshold: 0 }
const cases: Array<{ state: 'out' | 'low' | 'healthy'; qty: number; key: string; tint: string }> = [
  { state: 'out', qty: 0, key: 'out_of_stock', tint: 'stock-qty-out' },
  { state: 'low', qty: 4, key: 'low_stock', tint: 'stock-qty-low' },
  { state: 'healthy', qty: 40, key: 'healthy_stock', tint: 'stock-qty-healthy' },
]

for (const language of ['en', 'km'] as const) {
  for (const { state, qty, key, tint } of cases) {
    const out = html(language, { qty, product })
    const word = packs[language][key]
    assert.ok(word && word !== key, `${language} pack has ${key}`)
    assert.ok(out.includes(`data-stock-state="${state}"`), `${language} ${state}: state attribute`)
    assert.ok(out.includes(`class="stock-qty ${tint}"`), `${language} ${state}: tint class`)
    // The tooltip sits on an aria-hidden copy of the figure and the sr-only text says figure + word: a screen reader announces the word ONCE.
    assert.ok(out.includes(`<span aria-hidden="true" title="${word}">${qty}</span>`), `${language} ${state}: the figure carries the tooltip, hidden from screen readers`)
    assert.ok(out.includes(`<span class="sr-only">${qty} ${word}</span>`), `${language} ${state}: screen-reader text is the figure and the word`)
    assert.equal(out.split(word).length - 1, 2, `${language} ${state}: the word is in the markup twice (tooltip + sr-only text)`)
    assert.equal((out.match(/title=/g) || []).length, 1, `${language} ${state}: one tooltip`)
    for (const other of cases.filter((c) => c.state !== state)) assert.ok(!out.includes(other.tint), `${language} ${state}: no ${other.tint}`)
  }
}
// Khmer words are real Khmer, not an English placeholder.
for (const { key } of cases) assert.ok(/[ក-៿]/.test(packs.km[key]), `km ${key} is Khmer`)

// A caller can pass a class (the detail pane's bold figure).
assert.ok(html('en', { qty: 4, product, className: 'font-bold' }).includes('class="stock-qty stock-qty-low font-bold"'))
// null / undefined quantity prints 0 and is "out", like the server's COALESCE(qty, 0).
assert.ok(html('en', { qty: null, product }).includes('data-stock-state="out"'))
assert.ok(html('en', { qty: undefined, product }).includes('>0</span>'))

// Settings drive the state: alerts off removes "low"; global mode ignores the product's own number.
const off: LowStockConfig = { enabled: false, mode: 'product', threshold: 10 }
const global3: LowStockConfig = { enabled: true, mode: 'global', threshold: 3 }
assert.ok(html('en', { qty: 4, product, config: off }).includes('data-stock-state="healthy"'))
assert.ok(html('en', { qty: 4, product, config: global3 }).includes('data-stock-state="healthy"'))
assert.ok(html('en', { qty: 3, product, config: global3 }).includes('data-stock-state="low"'))
// Without a config prop the app's own settings apply (context settings -> resolveLowStockConfig).
appSettings = { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }
assert.ok(html('en', { qty: 4, product }).includes('data-stock-state="healthy"'))
appSettings = undefined

// Merged row: two real products, 8 each (low: threshold 10). The row shows the SUM 16, which alone is healthy,
// but each real product is low -- the Dashboard / bell call it low, so the pill must too.
const lowMembers = [{ qty: 8, product }, { qty: 8, product }]
assert.equal(stockQtyLevel({ qty: 16, product, config: DEFAULT_LOW_STOCK_CONFIG, members: lowMembers }), 'low')
assert.equal(stockQtyLevel({ qty: 16, product, config: DEFAULT_LOW_STOCK_CONFIG }), 'healthy', 'control: the sum alone is healthy')
// The review's exact example: products 101 (8) and 102 (50), same barcode, threshold 10. The merged row is
// healthy (the Dashboard's family rule: best product wins) while product 101 alone is low -- the bell lists 101
// on its own, so the row is green while the bell lists one of its products. Deliberate; stockLevelParity.test.ts
// runs the bell's, the Dashboard's and the client's answers side by side on this same fixture.
const p101 = { id: 101, low_stock_threshold: 10, out_of_stock_threshold: 0 }
const p102 = { id: 102, low_stock_threshold: 10, out_of_stock_threshold: 0 }
assert.equal(stockQtyLevel({ qty: 58, product: p101, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 8, product: p101 }, { qty: 50, product: p102 }] }), 'healthy', 'merged 101 + 102 row is healthy')
assert.equal(stockQtyLevel({ qty: 8, product: p101, config: DEFAULT_LOW_STOCK_CONFIG }), 'low', 'product 101 alone is low')
// Best member wins: one out + one healthy is healthy; one out + one low is low; all out is out.
assert.equal(stockQtyLevel({ qty: 40, product, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 0, product }, { qty: 40, product }] }), 'healthy')
assert.equal(stockQtyLevel({ qty: 4, product, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 0, product }, { qty: 4, product }] }), 'low')
assert.equal(stockQtyLevel({ qty: 0, product, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 0, product }, { qty: 0, product }] }), 'out')
// Each member answers to its OWN thresholds, not the lead's.
assert.equal(stockQtyLevel({ qty: 10, product: { low_stock_threshold: 2 }, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 5, product: { low_stock_threshold: 2 } }, { qty: 5, product: { low_stock_threshold: 9 } }] }), 'healthy')
// The header-row rule: a family header with a real member is ignored; alone it counts.
const header = { is_group: 1, parent_id: 0, low_stock_threshold: 10 }
assert.equal(stockQtyLevel({ qty: 0, product, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 500, product: header }, { qty: 0, product }] }), 'out', 'header is ignored while a real member exists')
assert.equal(stockQtyLevel({ qty: 500, product: header, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 500, product: header }, { qty: 500, product: header }] }), 'healthy', 'a header-only family counts the headers')
// A merged row renders the member rule in markup too.
assert.ok(html('en', { qty: 16, product, members: lowMembers }).includes('data-stock-state="low"'))

// ---- Both themes: every state has a light tint and a dark tint in the stylesheet ----
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const palette: Record<string, string> = { healthy: 'green', low: 'yellow', out: 'red' }
for (const [state, hue] of Object.entries(palette)) {
  const rule = new RegExp(`\\.stock-qty-${state}\\s*\\{([^}]*)\\}`).exec(css)
  assert.ok(rule, `stylesheet has .stock-qty-${state}`)
  assert.ok(new RegExp(`bg-${hue}-100`).test(rule![1]) && new RegExp(`text-${hue}-800`).test(rule![1]), `${state} light tint is ${hue}`)
  assert.ok(new RegExp(`dark:bg-${hue}-900/40`).test(rule![1]) && new RegExp(`dark:text-${hue}-300`).test(rule![1]), `${state} dark tint is ${hue}`)
}
// No vertical padding and an inherited line-height: the pill must not grow the row (Khmer needs the room the row gives).
const base = /\.stock-qty\s*\{([^}]*)\}/.exec(css)
assert.ok(base && /line-height:\s*inherit/.test(base[1]) && !/\bpy-|\bp-\d|padding-(top|bottom)/.test(base[1]), '.stock-qty adds no vertical size')

// ---- Mutants on the component source: each must break at least one pinned behaviour ----
const source = readSrc('components/inventory/StockQty.tsx')
const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'members ignored (judges the sum)', from: 'members && members.length > 1 ? stockGroupLevel(members, config) : stockLevelState(qty, product, config)', to: 'stockLevelState(qty, product, config)' },
  { name: 'state word dropped from the tooltip', from: 'title={word}', to: 'title=""' },
  { name: 'screen-reader word dropped', from: '<span className="sr-only">{figure} {word}</span>', to: '' },
  { name: 'tooltip no longer hidden from screen readers (word announced twice)', from: 'aria-hidden="true" ', to: '' },
  { name: 'low state shows the healthy word', from: "low: ['low_stock', 'Low Stock']", to: "low: ['healthy_stock', 'Healthy']" },
  { name: 'tint class not keyed by state', from: '${LEVEL_CLASS[level]}', to: 'stock-qty-healthy' },
]
for (const mutant of mutants) {
  assert.ok(source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source`)
  const mutated = loadComponent(source.replace(mutant.from, mutant.to))
  language = 'en'
  const probes = [
    html('en', { qty: 16, product, members: lowMembers }, mutated),
    html('en', { qty: 4, product }, mutated),
    html('en', { qty: 0, product }, mutated),
    html('en', { qty: 40, product }, mutated),
  ]
  const low = packs.en.low_stock
  const holds = probes[0].includes('data-stock-state="low"') && probes[1].includes(`title="${low}"`) && probes[1].includes(`<span class="sr-only">4 ${low}</span>`) && probes[1].includes('<span aria-hidden="true" title=')
    && probes[1].includes('stock-qty-low') && probes[2].includes('data-stock-state="out"') && probes[3].includes('stock-qty-healthy')
  assert.ok(!holds, `mutant survived: ${mutant.name}`)
}

console.log(`PASS StockQty: three states x EN/KM, tooltip + screen-reader word, family rule, both themes, ${mutants.length} mutants killed`)
