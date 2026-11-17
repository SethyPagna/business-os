// <StockQty> (components/inventory/StockQty.tsx): the stock figure tinted by state.
//
// Rendered for real (react-dom/server) with the app's context, in both language packs. Every state is
// asserted by its data attribute, tint class, tooltip and screen-reader word, and the no-folded-rows rule
// (owner, 16 Nov 2026) is pinned with the 101 (8) / 102 (50) fixture: two rows, one low and one healthy. The light and dark palettes of each tint are checked
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
    // The figure is rendered ONCE and the state word follows it in screen-reader-only text: the text is exactly "4 Low Stock" (copy,
    // Ctrl+F and innerText all see one figure), and the tooltip sits on the whole pill (padding included), not on the digits.
    assert.equal(out.replace(/<[^>]*>/g, ''), `${qty} ${word}`, `${language} ${state}: the text is the figure once, then the word once`)
    assert.ok(out.startsWith(`<span data-stock-qty="" data-stock-state="${state}" title="${word}" class=`), `${language} ${state}: the tooltip is on the outer pill`)
    assert.ok(out.endsWith(`>${qty}<span class="stock-qty-word"> ${word}</span></span>`), `${language} ${state}: figure, then the screen-reader-only word`)
    assert.ok(!out.includes('aria-hidden'), `${language} ${state}: nothing is hidden from screen readers (no duplicate figure to hide)`)
    assert.equal(out.split(word).length - 1, 2, `${language} ${state}: the word is in the markup twice (tooltip + screen-reader-only text)`)
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
assert.equal(html('en', { qty: undefined, product }).replace(/<[^>]*>/g, ''), '0 Out of Stock')

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

// No folded rows (owner, 16 Nov 2026). Two unmerged duplicates of one barcode are TWO rows, each judged on its own
// figure and its own thresholds: the review's exact example, products 101 (8) and 102 (50), threshold 10, is a low 8
// and a healthy 50 -- never one healthy 58. stockLevelParity.test.ts runs the bell, the Dashboard and the client side
// by side on this same fixture.
const p101 = { id: 101, low_stock_threshold: 10, out_of_stock_threshold: 0 }
const p102 = { id: 102, low_stock_threshold: 10, out_of_stock_threshold: 0 }
assert.equal(stockQtyLevel({ qty: 8, product: p101, config: DEFAULT_LOW_STOCK_CONFIG }), 'low', 'row 101 is low')
assert.equal(stockQtyLevel({ qty: 50, product: p102, config: DEFAULT_LOW_STOCK_CONFIG }), 'healthy', 'row 102 is healthy')
assert.ok(html('en', { qty: 8, product: p101 }).includes('data-stock-state="low"') && html('en', { qty: 50, product: p102 }).includes('data-stock-state="healthy"'))
// Two low products that would sum to "healthy" stay two low rows.
assert.equal(stockQtyLevel({ qty: 8, product, config: DEFAULT_LOW_STOCK_CONFIG }), 'low')
assert.equal(stockQtyLevel({ qty: 16, product, config: DEFAULT_LOW_STOCK_CONFIG }), 'healthy', 'control: the sum alone would have been healthy')
// There is no family input any more: a members prop changes nothing, and the family rule is gone from the client.
assert.equal(stockQtyLevel({ qty: 16, product, config: DEFAULT_LOW_STOCK_CONFIG, members: [{ qty: 8, product }, { qty: 8, product }] }), 'healthy', 'members are not a thing; the figure alone decides')
assert.equal((lowStock as Record<string, unknown>).stockGroupLevel, undefined, 'stockGroupLevel is removed')
assert.equal((lowStock as Record<string, unknown>).isStockFamilyHeader, undefined, 'isStockFamilyHeader is removed')

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

// The state word is screen-reader/selection text that stays INLINE: position:absolute (Tailwind's sr-only) would blockify it and
// put a line break between the figure and the word in innerText and in copied text; it must also add no width or height to the pill.
const word = /\.stock-qty-word\s*\{([^}]*)\}/.exec(css)
assert.ok(word, 'stylesheet has .stock-qty-word')
assert.ok(!/position:\s*absolute/.test(word[1]) && /display:\s*inline-block/.test(word[1]) && /white-space:\s*pre/.test(word[1]), '.stock-qty-word stays inline and keeps its leading space')
assert.ok(/width:\s*1px/.test(word[1]) && /margin-right:\s*-1px/.test(word[1]) && /height:\s*1px/.test(word[1]) && /overflow:\s*hidden/.test(word[1]), '.stock-qty-word is a net-zero 1px clipped box')

// ---- Mutants on the component source: each must break at least one pinned behaviour ----
const source = readSrc('components/inventory/StockQty.tsx')
const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'figure judged as healthy whatever its thresholds', from: 'return stockLevelState(qty, product, config)', to: "return stockLevelState(qty, undefined, config) === 'out' ? 'out' : 'healthy'" },
  { name: 'state word dropped from the tooltip', from: 'title={word}', to: 'title=""' },
  { name: 'screen-reader word dropped', from: '<span className="stock-qty-word">{` ${word}`}</span>', to: '' },
  { name: 'figure rendered twice (reads "55 Low Stock")', from: '<span className="stock-qty-word">{` ${word}`}</span>', to: '<span className="stock-qty-word">{` ${figure} ${word}`}</span>' },
  { name: 'tooltip off the pill (it would cover the digits only)', from: 'data-stock-state={level} title={word} className=', to: 'data-stock-state={level} className=' },
  { name: 'duplicate figure hidden from screen readers instead of removed', from: '{figure}<span className="stock-qty-word">', to: '<span aria-hidden="true">{figure}</span>{figure}<span className="stock-qty-word">' },
  { name: 'low state shows the healthy word', from: "low: ['low_stock', 'Low Stock']", to: "low: ['healthy_stock', 'Healthy']" },
  { name: 'tint class not keyed by state', from: '${LEVEL_CLASS[level]}', to: 'stock-qty-healthy' },
]
for (const mutant of mutants) {
  assert.ok(source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source`)
  const mutated = loadComponent(source.replace(mutant.from, mutant.to))
  language = 'en'
  const probes = [
    html('en', { qty: 8, product: p101 }, mutated),
    html('en', { qty: 4, product }, mutated),
    html('en', { qty: 0, product }, mutated),
    html('en', { qty: 40, product }, mutated),
    html('en', { qty: 50, product: p102 }, mutated),
  ]
  const low = packs.en.low_stock
  const holds = probes[0].includes('data-stock-state="low"') && probes[1].startsWith(`<span data-stock-qty="" data-stock-state="low" title="${low}" class=`) && probes[1].replace(/<[^>]*>/g, '') === `4 ${low}` && !probes[1].includes('aria-hidden')
    && probes[1].includes('stock-qty-low') && probes[2].includes('data-stock-state="out"') && probes[3].includes('stock-qty-healthy') && probes[4].includes('data-stock-state="healthy"')
  assert.ok(!holds, `mutant survived: ${mutant.name}`)
}

console.log(`PASS StockQty: three states x EN/KM, tooltip + screen-reader word, two unfolded rows (101 low, 102 healthy), both themes, ${mutants.length} mutants killed`)
