// One storefront search request per change (AUDIT-FRONTEND-ROUND-TRIPS finding
// 8). The search effect in PublicCatalogPage listed `loading` and
// `products.length` as dependencies, so applying a response that changed the
// grid's length re-ran the effect and sent the identical request again.
//
// React re-runs an effect when any dependency changes (Object.is). This test
// reads the effect's REAL dependency list, evaluates every entry (and any
// derived const it names) against the state before a response and after the
// response's own setters ran, and fails if any entry moved -- that is the
// second request. A user-driven change (a new filter) must still move one.
//
// Run: node tests/storefrontSearchSingleRequest.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx', import.meta.url), 'utf8')
const marker = source.indexOf("'Portal product search'")
assert.ok(marker > 0, 'the storefront search effect is present')
const depsMatch = /\n {2}\}, \[([^\]]*)\]\)/.exec(source.slice(marker))
assert.ok(depsMatch, 'the search effect dependency list is found')
const deps = depsMatch[1].split(',').map((dep) => dep.trim()).filter(Boolean)

type State = Record<string, unknown>
// Component state the effect can depend on (useState values and the debounced term).
const before: State = {
  brandFilter: [], branchFilter: [], categoryFilter: [], stockFilter: [],
  browseSort: 'featured', browseView: 'brand', config: { showCatalog: true, showStockStatus: true },
  deferredSearch: 'serum', loadFailed: false, loading: false, productInitial: 'all', productPage: 1,
  productPageSize: 20, promoFacet: '', products: new Array(20).fill({}), refreshingProducts: true,
  productTotal: 120, productsFailed: false,
}
// What the success handler sets: a shorter grid, a new total, refreshing off,
// and the page/page size it echoes back unchanged.
const afterResponse: State = { ...before, products: new Array(7).fill({}), productTotal: 7, refreshingProducts: false }

// A dependency that is not state is a const derived in the component body.
const derived = new Map<string, string>()
for (const dep of deps) {
  const root = dep.split('.')[0]
  if (root in before) continue
  const declaration = new RegExp(`\\n\\s*const ${root} = ([^\\n]+)\\n`).exec(source)
  assert.ok(declaration, `dependency ${dep} is neither modelled state nor a derived const -- extend this test`)
  derived.set(root, declaration[1].trim())
}

function evaluate(expression: string, state: State): unknown {
  const scope: State = { ...state }
  for (const [name, expr] of derived) scope[name] = new Function(...Object.keys(state), `return (${expr})`)(...Object.values(state))
  return new Function(...Object.keys(scope), `return (${expression})`)(...Object.values(scope))
}

const moved = (a: State, b: State) => deps.filter((dep) => !Object.is(evaluate(dep, a), evaluate(dep, b)))

assert.deepEqual(moved(before, afterResponse), [], `applying a search response must not re-run the search effect (moved: ${moved(before, afterResponse).join(', ')})`)
assert.deepEqual(moved(before, { ...before, brandFilter: ['dior'] }), ['brandFilter'], 'a new filter still runs one search')
assert.deepEqual(moved(before, { ...before, deferredSearch: 'cream' }), ['deferredSearch'], 'a new search term still runs one search')

// First load: the effect waits for the bootstrap and runs once when it lands.
const waiting: State = { ...before, loading: true, products: [] }
const landed: State = { ...before, loading: false, products: new Array(20).fill({}) }
assert.ok(moved(waiting, landed).length > 0, 'the search runs when the bootstrap lands')
const stillWaiting: State = { ...waiting, refreshingProducts: false }
assert.deepEqual(moved(waiting, stillWaiting), [], 'nothing runs while the bootstrap is in flight')

console.log(`PASS storefront search: one request per change (deps: ${deps.join(', ')})`)
