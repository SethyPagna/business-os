// Owner, 16 Nov 2026: "merged duplicate row should integrate with the merge, so there shouldn't be any so called
// merged duplicate row left ... if the duplicate row is not merged then show it as separate" and "show them next to
// each other, so it is easier to notice".
//
// Rendered for real (react-dom/server): the Inventory list gets two UNMERGED duplicates (same name, same barcode) with an
// unrelated sibling BETWEEN them in id order. They must be two rows, side by side, each with its own figure and its own
// colour (8 against a threshold of 10 is low, 50 is healthy), and the name-group header counts records. The same must hold
// for every input order a sort can hand over (all 24 permutations). Mutants edit the real source and must each turn it red.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { DEFAULT_LOW_STOCK_CONFIG } from '../src/utils/lowStockSettings.ts'
import * as lowStock from '../src/utils/lowStockSettings.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function compile(code: string, resolve: (id: string) => unknown): Record<string, any> {
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    return resolve(id)
  }, mod, mod.exports)
  return mod.exports
}

function load(groupingSource = read('utils/productGrouping.ts'), surfaceSource = read('components/inventory/InventoryProductsSurface.tsx')) {
  const grouping = compile(groupingSource, (id) => {
    if (id.endsWith('initials.ts')) return require('../src/utils/initials.ts')
    if (id.endsWith('productDetailRule.ts')) return require('../src/utils/productDetailRule.ts')
    if (id.endsWith('productMerge.ts')) return require('../src/utils/productMerge.ts')
    throw new Error(`unexpected require ${id}`)
  })
  const stockQty = compile(read('components/inventory/StockQty.tsx'), (id) => {
    if (id.endsWith('AppContext')) return { useLowStockConfig: () => DEFAULT_LOW_STOCK_CONFIG, useT: () => ({}) }
    if (id.endsWith('lowStockSettings.ts')) return lowStock
    throw new Error(`unexpected require ${id}`)
  })
  const surface = compile(surfaceSource, (id) => {
    if (id.includes('productGrouping')) return grouping
    if (id.includes('costDisplay')) return require('../src/utils/costDisplay.ts')
    if (id.includes('acquisitionCostAccess')) return require('../src/utils/acquisitionCostAccess.ts')
    if (id.includes('AppContextCore')) return { useApp: () => ({ user: { role_code: 'admin', role_permissions: { all: true } } }) }
    if (id.endsWith('StockQty.tsx')) return stockQty
    return { default: () => null, TopPager: (props: { children?: unknown }) => props.children ?? null, __esModule: true }
  })
  return { grouping, surface }
}

const row = (id: number, name: string, barcode: string, quantity: number, price = 4) => ({
  id, name, barcode, display_quantity: quantity, stock_quantity: quantity,
  branch_stock: [{ branch_id: 1, branch_name: 'B1', quantity }],
  low_stock_threshold: 10, out_of_stock_threshold: 0, purchase_price_usd: 2, selling_price_usd: price,
})
// Duplicate pair 1 and 3 (same name AND barcode); id 2 is an unrelated variant (other barcode) between them in id order,
// and its price sits between theirs, so id order AND the old price order both separate the pair.
const A = row(1, 'Glow Serum', '8851234567890', 8, 3)
const X = row(2, 'Glow Serum', '8859999999999', 5, 4)
const B = row(3, 'Glow Serum', '8851234567890', 50, 5)
const Z = row(4, 'Aloe Gel', '8850000000001', 30)
const fixture = [A, X, B, Z]

const props = (items: unknown[]) => ({
  items, total: 2, page: 1, pageSize: 20, totalPages: 1, branchFilter: 'all', loading: false, error: null, serverStats: null,
  statsLoading: false, t: (key: string) => key, fmtUSD: (v: number) => `$${v}`, fmtKHR: (v: number) => `${v}KHR`,
  onPageChange() {}, onPageSizeChange() {}, onOpenDetail() {}, onOpenInCatalogue() {},
})
const desktopRows = (html: string) => Array.from(html.matchAll(/<tr class="[^"]*hover:bg-blue[^"]*">([\s\S]*?)<\/tr>/g) as Iterable<RegExpMatchArray>).map((m) => m[1])
const permutations = <T,>(xs: T[]): T[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]))

function probe(api: ReturnType<typeof load>): string[] {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  const idsOf = (items: any[]) => api.grouping.buildProductGroups(items, new Map(), { preserveInputOrder: true }).flatMap((g: any) => g.rows.map((r: any) => Number(r.id)))
  check('every record is its own row', () => {
    const groups = api.surface.groupInventoryProducts(fixture)
    const rows = groups.flatMap((g: any) => g.rows)
    assert.equal(rows.length, 4, 'four records, four rows (nothing folded, nothing missing)')
    assert.deepEqual(rows.map((r: any) => r.__mergedProductIds), rows.map((r: any) => [r.id]), 'no row stands for several records')
    assert.equal(new Set(rows.map((r: any) => r.id)).size, 4, 'nothing doubled')
    assert.equal(groups.find((g: any) => g.label === 'Glow Serum').items.length, 3, 'the group header counts records')
  })
  check('duplicates are consecutive under every input order', () => {
    for (const order of permutations(fixture)) {
      const ids = idsOf(order)
      assert.equal(ids.length, 4)
      assert.equal(Math.abs(ids.indexOf(1) - ids.indexOf(3)), 1, `pair split for input ${order.map((p) => p.id)} -> ${ids}`)
    }
  })
  check('the rendered list shows two rows, two figures, two colours', () => {
    const html = renderToStaticMarkup(React.createElement(api.surface.default, props(fixture)))
    const trs = desktopRows(html)
    assert.equal(trs.length, 4, 'four desktop rows')
    const order = trs.map((tr) => Number((/data-stock-qty[^>]*>(\d+)/.exec(tr) || [])[1]))
    assert.deepEqual(order.filter((q) => q === 8 || q === 50), [8, 50], 'the 8 and the 50 are separate rows, side by side')
    const state = (qty: number) => /data-stock-state="(\w+)"/.exec(trs[order.indexOf(qty)])?.[1]
    assert.equal(state(8), 'low', 'row 8 is judged on its own figure')
    assert.equal(state(50), 'healthy', 'row 50 is judged on its own figure')
    assert.ok(!trs.some((tr) => />58</.test(tr)), 'no summed 58 row')
    assert.equal(Math.abs(order.indexOf(8) - order.indexOf(50)), 1, 'adjacent')
    assert.equal((html.match(/data-stock-qty/g) || []).length, 8, 'desktop and phone render four figures each')
  })
  return failures
}

const real = load()
const base = probe(real)
assert.deepEqual(base, [], `unmutated source is red:\n${base.join('\n')}`)
// The fixture really separates the right implementation from the wrong one: id order alone would put 2 between the pair.
assert.deepEqual([...fixture].sort((a, b) => a.id - b.id).map((p) => p.id), [1, 2, 3, 4], 'control: id order separates the pair')

const groupingSource = read('utils/productGrouping.ts')
const surfaceSource = read('components/inventory/InventoryProductsSurface.tsx')
const mutants: Array<{ name: string; file: 'grouping' | 'surface'; from: string; to: string }> = [
  { name: 'folds the duplicates into one row again', file: 'grouping', from: 'rows: ownRows(items),', to: 'rows: mergeSameDetailRows(items),' },
  { name: 'drops the barcode tie-break (name, then id)', file: 'grouping', from: 'if (leftKey !== rightKey) {', to: 'if (false) {' },
  { name: 'parentless same-name rows ordered by root id alone', file: 'grouping', from: 'return compareProductsByNameBarcodeId(resolveRootProduct(left, productsById), resolveRootProduct(right, productsById)) || leftRootId - rightRootId', to: 'return leftRootId - rightRootId' },
  { name: 'barcode compared by id, not identity key', file: 'grouping', from: 'const leftKey = identityBarcodeKey(left?.barcode)', to: 'const leftKey = String(left?.id)' },
  { name: 'row coloured by a summed figure of its barcode siblings', file: 'surface', from: 'const stockQty = (product: InventoryProductRow) => <StockQty qty={quantity(product)} product={product} />',
    to: 'const stockQty = (product: InventoryProductRow) => <StockQty qty={items.filter((r) => r.barcode === product.barcode).reduce((s, r) => s + Number(r.display_quantity || 0), 0)} product={product} />' },
]
const results: string[] = []
for (const mutant of mutants) {
  const source = mutant.file === 'grouping' ? groupingSource : surfaceSource
  assert.ok(source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const mutated = mutant.file === 'grouping' ? load(groupingSource.replace(mutant.from, mutant.to)) : load(groupingSource, surfaceSource.replace(mutant.from, mutant.to))
  const failed = probe(mutated)
  assert.ok(failed.length > 0, `mutant survived: ${mutant.name}`)
  results.push(mutant.name)
}
console.log(`PASS no folded duplicates: separate rows, own figure and colour, adjacent under all 24 input orders, ${results.length} mutants killed`)
