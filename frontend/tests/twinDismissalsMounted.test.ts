// Owner, 16 Nov 2026: "Keep both" is a ruling. Round 3/4 review, finding (a): after "Keep both" the app said "no longer flagged as duplicates" while every list went on
// tagging the pair "Duplicate", pointing at a Conflicts tab that no longer listed it. This renders the REAL Inventory list (react-dom/server) with the real grouping, the
// real dismissal rule, store and hook, and shows the tag on both twins before a ruling and on neither after it, then wires the rest: every list that memoises its groups
// reads the rulings, the shell loads them, every dismissal path re-reads them. Mutants edit the real sources and must each turn it red.
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

type Sources = { grouping?: string; dismissals?: string }
function load(sources: Sources = {}) {
  const grouping = compile(sources.grouping ?? read('utils/productGrouping.ts'), (id) => {
    if (id.endsWith('initials.ts')) return require('../src/utils/initials.ts')
    if (id.endsWith('productDetailRule.ts')) return require('../src/utils/productDetailRule.ts')
    if (id.endsWith('productMerge.ts')) return require('../src/utils/productMerge.ts')
    throw new Error(`unexpected require ${id}`)
  })
  // The dismissal module registers its rule on THIS grouping instance, the one the surface renders with.
  const dismissals = compile(sources.dismissals ?? read('utils/productTwinDismissals.ts'), (id) => {
    if (id.endsWith('productGrouping.ts')) return grouping
    if (id.endsWith('productDetailRule.ts')) return require('../src/utils/productDetailRule.ts')
    throw new Error(`unexpected require ${id}`)
  })
  const loader = compile(read('components/shared/useTwinDismissalsLoader.ts'), (id) => {
    if (id.endsWith('productTwinDismissals.ts')) return dismissals
    if (id.endsWith('twinDismissalsTransport.ts')) return { refreshTwinDismissals: async () => {}, supersedeTwinDismissalReads: () => {} }
    if (id.endsWith('AppContext.tsx')) return { useSync: () => ({ syncChannel: null }) }
    throw new Error(`unexpected require ${id}`)
  })
  const stockQty = compile(read('components/inventory/StockQty.tsx'), (id) => {
    if (id.endsWith('AppContext')) return { useLowStockConfig: () => DEFAULT_LOW_STOCK_CONFIG, useT: () => ({}) }
    if (id.endsWith('lowStockSettings.ts')) return lowStock
    throw new Error(`unexpected require ${id}`)
  })
  const surface = compile(read('components/inventory/InventoryProductsSurface.tsx'), (id) => {
    if (id.includes('productGrouping')) return grouping
    if (id.includes('costDisplay')) return require('../src/utils/costDisplay.ts')
    if (id.includes('acquisitionCostAccess')) return require('../src/utils/acquisitionCostAccess.ts')
    if (id.includes('AppContextCore')) return { useApp: () => ({ can: () => true, user: { role_code: 'admin', role_permissions: { all: true } } }) }
    if (id.endsWith('unmergedTwinHint.ts')) return require('../src/components/products/unmergedTwinHint.ts')
    if (id.endsWith('useTwinDismissalsLoader.ts')) return loader
    if (id.endsWith('StockQty.tsx')) return stockQty
    if (id.endsWith('UnmergedTwinTag.tsx')) return compile(read('components/products/UnmergedTwinTag.tsx'), (inner) => (inner.includes('lucide-react') ? { default: () => null, __esModule: true } : inner.endsWith('productTwinDismissals.ts') ? dismissals : (() => { throw new Error(`unexpected require ${inner}`) })()))
    return { default: () => null, TopPager: (props: { children?: unknown }) => props.children ?? null, __esModule: true }
  })
  return { grouping, dismissals, surface }
}

const row = (id: number, name: string, barcode: string, quantity: number) => ({
  id, name, barcode, display_quantity: quantity, stock_quantity: quantity,
  branch_stock: [{ branch_id: 1, branch_name: 'B1', quantity }],
  low_stock_threshold: 10, out_of_stock_threshold: 0, purchase_price_usd: 2, selling_price_usd: 4,
})
// A real/empty pair (held by the name cluster) and a same-code pair (held by the barcode cluster), plus a lone product.
const items = [row(1, 'Glow Serum', '8851234567890', 8), row(2, 'Glow Serum', '', 50), row(3, 'Aloe Gel', '8850000000011', 5), row(4, 'Aloe Gel', '8850000000011', 7), row(5, 'Single', '8850000000099', 3)]
const props = (list: unknown[]) => ({
  items: list, total: 5, page: 1, pageSize: 20, totalPages: 1, branchFilter: 'all', loading: false, error: null, serverStats: null,
  statsLoading: false, t: (key: string) => key, fmtUSD: (v: number) => `$${v}`, fmtKHR: (v: number) => `${v}KHR`,
  onPageChange() {}, onPageSizeChange() {}, onOpenDetail() {}, onOpenInCatalogue() {},
})
const tags = (api: ReturnType<typeof load>) => (renderToStaticMarkup(React.createElement(api.surface.default, props(items))).match(/data-unmerged-twin/g) || []).length

function probe(api: ReturnType<typeof load>): string[] {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  const ruling = (pairs: Array<[string, string]>) => api.dismissals.parseTwinDismissals({ dismissals: pairs })
  check('before any ruling the four twin rows are tagged (desktop and phone render each row once, so 8 tags), the lone product is not', () => {
    api.dismissals.setTwinDismissals(api.dismissals.NO_TWIN_DISMISSALS)
    assert.equal(tags(api), 8)
  })
  check('"Keep both" on the name cluster takes the tag off the real/empty pair and leaves the other pair tagged', () => {
    api.dismissals.setTwinDismissals(ruling([['name', 'glow serum']]))
    assert.equal(tags(api), 4)
  })
  check('"Keep both" on the barcode cluster takes the tag off the same-code pair and leaves the other pair tagged', () => {
    api.dismissals.setTwinDismissals(ruling([['barcode', '8850000000011']]))
    assert.equal(tags(api), 4)
  })
  check('both rulings: no tag anywhere', () => {
    api.dismissals.setTwinDismissals(ruling([['name', 'glow serum'], ['barcode', '8850000000011']]))
    assert.equal(tags(api), 0)
  })
  check('the list reads the rulings through the store hook: a render after the set changed shows the change', () => {
    api.dismissals.setTwinDismissals(api.dismissals.NO_TWIN_DISMISSALS)
    assert.equal(tags(api), 8)
    api.dismissals.setTwinDismissals(ruling([['name', 'glow serum'], ['barcode', '8850000000011']]))
    assert.equal(tags(api), 0)
    api.dismissals.setTwinDismissals(api.dismissals.NO_TWIN_DISMISSALS)
    assert.equal(tags(api), 8, 'and back: a sign-out empties the set')
  })
  api.dismissals.setTwinDismissals(api.dismissals.NO_TWIN_DISMISSALS)
  return failures
}

const real = probe(load())
assert.deepEqual(real, [], `unmutated source is red:\n${real.join('\n')}`)

const grouping = read('utils/productGrouping.ts')
const dismissals = read('utils/productTwinDismissals.ts')
const mutants: Array<{ name: string; sources: Sources; from: string; to: string; key: keyof Sources }> = [
  { name: 'the grouping ignores the rulings', key: 'grouping', sources: { grouping }, from: 'if (cluster.length < 2 || twinDismissalRule?.(cluster, name, rows)) continue', to: 'if (cluster.length < 2) continue' },
  { name: 'the store never registers the rule', key: 'dismissals', sources: { dismissals }, from: '  setTwinDismissalRule(rule)\n', to: '' },
]
for (const mutant of mutants) {
  const source = mutant.sources[mutant.key] as string
  assert.ok(source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const failed = probe(load({ [mutant.key]: source.replace(mutant.from, mutant.to) }))
  assert.ok(failed.length > 0, `mutant survived: ${mutant.name}`)
}

// Wiring: the shell loads the rulings; every list that groups rows reads them; every dismissal path re-reads them.
const app = read('App.tsx')
assert.match(app, /<TwinDismissalsLoader\s/, 'the shell mounts the loader as a component of its own (a sync update must not re-render the shell)')
assert.ok(!/useTwinDismissalsLoader\(/.test(app), 'and does not call the sync-subscribing hook itself')
assert.match(app, /enabled=\{Boolean\(authReady && user\) && \['products', 'inventory', 'branches', 'pos'\]\.some\(\(id\) => canAccessPage\(id\)\)\}/, 'only for an account that can open a list that shows the tag')
for (const [file, memo] of [
  ['components/products/Products.tsx', /\[filtered, hideZeroStockRows, productSortDirection, productsById, searchTerms, t, twinDismissals\]/],
  ['components/inventory/InventoryProductsSurface.tsx', /groupInventoryProducts\(items\), \[items, twinDismissals\]/],
  ['components/branches/TransferModal.tsx', /\[filteredMulti, debouncedSearch, twinDismissals\]/],
  ['components/pos/POS.tsx', /\[debouncedProductSearch, filteredProducts, productsById, twinDismissals\]/],
] as const) {
  const text = read(file)
  assert.match(text, /const twinDismissals = useTwinDismissals\(\)/, `${file} reads the rulings`)
  assert.match(text, memo, `${file} regroups when the rulings change`)
}
const transport = read('components/shared/twinDismissalsTransport.ts')
assert.match(transport, /const result = await dismissProductDuplicateCluster\(type, value\)\n  await refreshTwinDismissals\(\)\n  return result/, 'dismissProductClusterAndRefresh re-reads the rulings before it answers')
const tab = read('components/products/ProductDuplicatesTab.tsx')
assert.equal((tab.match(/await dismissProductClusterAndRefresh\(/g) || []).length + (tab.match(/await dismissProductClustersAndRefresh\(/g) || []).length, 2, 'the Conflicts tab dismisses (one, and bulk) only through the calls that re-read')
assert.ok(!/dismissProductDuplicateCluster\(/.test(tab), 'and never through the bare transport')
const productsSource = read('components/products/Products.tsx')
// Round 6 (L2): Keep both dismisses every Conflicts cluster that lists the pair, in one call that re-reads once (tests/twinDismissalsTransport.test.ts runs it).
assert.match(productsSource, /await keepBothDuplicate\(/, "Products' Keep both goes through the one handler, which re-reads the rulings once")
assert.match(transport, /await dismissProductClustersAndRefresh\(rulings\)/, 'and that handler dismisses in one re-reading call')
assert.ok(!/dismissProductDuplicateCluster\(/.test(productsSource), 'and never goes through the bare transport')

console.log(`PASS twin dismissals mounted: the real Inventory list tags both twins of a pair before a ruling and neither after it, per cluster kind; ${mutants.length} mutants killed; the shell, four lists and every dismissal path are wired`)
