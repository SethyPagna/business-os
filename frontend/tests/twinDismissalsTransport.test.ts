// Owner, 16 Nov 2026: "Keep both" is a ruling, and the Duplicate tag must go when it is made. Round 5 review, L2 and I1: Products' Keep both dismissed one cluster
// (the barcode) although a pair inside a variant family is listed by its name cluster too, so the toast "no longer flagged" was false; and the Conflicts tab's bulk Dismiss
// re-read the rulings after every cluster, each read a cache miss behind a version bump.
// This runs the REAL transport with the network stubbed: several rulings are stored in order and the rulings are read ONCE afterwards, a failure does not stop the rest, and
// nothing is read when nothing was stored. clustersListingProducts picks the clusters a pair sits in. Mutants edit the real source and must each turn it red.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { clustersListingProducts, type PossiblySameCluster } from '../src/utils/exactDuplicateProducts.ts'

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function load(source: string, failOn: string[] = []) {
  const calls: string[] = []
  const dismissals = { parseTwinDismissals: () => new Set<string>(), setTwinDismissals: () => {} }
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)((id: string) => {
    if (id.endsWith('http.ts')) return { apiFetch: async (method: string, path: string) => { calls.push(`${method} ${path}`); return { dismissals: [] } } }
    if (id.endsWith('productWriteTransport.ts')) {
      return { dismissProductDuplicateCluster: async (type: string, value: string) => {
        calls.push(`dismiss ${type}:${value}`)
        if (failOn.includes(`${type}:${value}`)) throw new Error(`refused ${type}`)
        return { success: true }
      } }
    }
    if (id.endsWith('productTwinDismissals.ts')) return dismissals
    if (id.endsWith('exactDuplicateProducts.ts')) return { keepBothPlan: () => ({ rulings: [...RULINGS], stillListed: false }) }
    throw new Error(`unexpected require ${id}`)
  }, mod, mod.exports)
  return { api: mod.exports, calls }
}

const REAL_SOURCE = read('components/shared/twinDismissalsTransport.ts')
const READ = 'GET /api/products/duplicate-dismissals'
const RULINGS = [{ type: 'barcode', value: '8851' }, { type: 'name', value: 'Kind Variant' }, { type: 'leadingzero', value: '8851' }] as const

async function run(source: string): Promise<string[]> {
  const failures: string[] = []
  const all = load(source)
  const done = await all.api.dismissProductClustersAndRefresh(RULINGS)
  const reads = all.calls.filter((call) => call === READ).length
  if (reads !== 1) failures.push(`${reads} re-reads for ${RULINGS.length} rulings (want 1)`)
  if (all.calls.filter((call) => call.startsWith('dismiss ')).join('|') !== 'dismiss barcode:8851|dismiss name:Kind Variant|dismiss leadingzero:8851') failures.push(`the rulings were not stored in order: ${all.calls.join(', ')}`)
  if (all.calls[all.calls.length - 1] !== READ) failures.push('the re-read must come after the last ruling')
  if (done.stored.length !== 3 || done.failed.length !== 0) failures.push('all three should be reported stored')

  const partial = load(source, ['name:Kind Variant'])
  const result = await partial.api.dismissProductClustersAndRefresh(RULINGS)
  if (result.stored.length !== 2 || result.failed.length !== 1) failures.push('a refused ruling is reported, and the others are still stored')
  if (partial.calls.filter((call) => call.startsWith('dismiss ')).length !== 3) failures.push('a failure must not stop the rulings after it')
  if (partial.calls.filter((call) => call === READ).length !== 1) failures.push('a partial bulk still re-reads once')

  const none = load(source, ['barcode:8851', 'name:Kind Variant', 'leadingzero:8851'])
  await none.api.dismissProductClustersAndRefresh(RULINGS)
  if (none.calls.includes(READ)) failures.push('nothing is re-read when nothing was stored')

  const progress: number[] = []
  const hooked = load(source)
  await hooked.api.dismissProductClustersAndRefresh(RULINGS, { before: (index: number) => progress.push(index) })
  if (progress.join() !== '0,1,2') failures.push('before() is called once per ruling, in order')

  const single = load(source)
  await single.api.dismissProductClusterAndRefresh('barcode', '8851')
  if (single.calls.join('|') !== `dismiss barcode:8851|${READ}`) failures.push('the single dismissal still stores one ruling and re-reads once')
  return failures
}

assert.deepEqual(await run(REAL_SOURCE), [], 'the real transport')

const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 're-reads after every ruling (the old bulk)', from: '      stored.push(ruling)\n', to: '      stored.push(ruling)\n      await refreshTwinDismissals()\n' },
  { name: 'stops at the first failure', from: '      failed.push({ ruling, error })\n', to: '      failed.push({ ruling, error })\n      break\n' },
  { name: 're-reads even when nothing was stored', from: '  if (stored.length) await refreshTwinDismissals()', to: '  await refreshTwinDismissals()' },
  { name: 'never re-reads', from: '  if (stored.length) await refreshTwinDismissals()', to: '' },
]
for (const mutant of mutants) {
  assert.ok(REAL_SOURCE.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const failures = await run(REAL_SOURCE.replace(mutant.from, mutant.to))
  assert.ok(failures.length > 0, `mutant survived: ${mutant.name}`)
}

// ---- Keep both when some rulings are refused (round 7 review, info): what WAS stored changes the tags, so the list is refreshed, and the refusal is still reported --------------
async function partialKeepBoth(source: string, failOn: string[], refreshFails = false): Promise<{ refreshes: number; reported: string; notified: number }> {
  const all = load(source, failOn)
  let refreshes = 0, notified = 0, reported = ''
  try { await all.api.keepBothDuplicate([], { key: 'k', barcode: '8851', members: [{ id: 1 }, { id: 2 }] }, () => { notified += 1 }, (key: string) => key, async () => { refreshes += 1; if (refreshFails) throw new Error('refresh failed') }) } catch (error) { reported = String((error as Error).message) }
  return { refreshes, reported, notified }
}
const keepBothRun = async (source: string): Promise<string[]> => {
  const failures: string[] = []
  const some = await partialKeepBoth(source, ['name:Kind Variant'])
  if (some.refreshes !== 1) failures.push(`a partly stored Keep both refreshes the list once (got ${some.refreshes})`)
  if (some.reported !== 'refused name') failures.push(`the refusal is still reported (got "${some.reported}")`)
  if (some.notified !== 0) failures.push('no success toast after a refusal')
  const broken = await partialKeepBoth(source, ['name:Kind Variant'], true)
  if (broken.reported !== 'refused name') failures.push(`a failed refresh must not hide the refusal (got "${broken.reported}")`)
  const none = await partialKeepBoth(source, ['barcode:8851', 'name:Kind Variant', 'leadingzero:8851'])
  if (none.refreshes !== 0) failures.push('nothing stored, nothing refreshed')
  if (none.reported !== 'refused barcode') failures.push('the first refusal is reported')
  const ok = await partialKeepBoth(source, [])
  if (ok.refreshes !== 1 || ok.notified !== 1 || ok.reported !== '') failures.push('a clean Keep both refreshes once and toasts once')
  return failures
}
assert.deepEqual(await keepBothRun(REAL_SOURCE), [], 'the real Keep both on a partial failure')
const partialMutants = [
  { name: 'no refresh after a partial failure (round 7)', from: '    if (stored.length) await refresh().catch(() => undefined)\n', to: '' },
  { name: 'refresh even when nothing was stored', from: '    if (stored.length) await refresh().catch(() => undefined)\n', to: '    await refresh().catch(() => undefined)\n' },
  { name: 'a failed refresh hides the refusal', from: 'await refresh().catch(() => undefined)', to: 'await refresh()' },
]
for (const mutant of partialMutants) {
  assert.ok(REAL_SOURCE.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const failures = await keepBothRun(REAL_SOURCE.replace(mutant.from, mutant.to))
  assert.ok(failures.length > 0, `mutant survived: ${mutant.name}`)
}

// ---- the clusters a pair sits in ---------------------------------------------------------------------------------------------------------------------
const entry = (id: number, name: string, barcode: string) => ({ id, name, barcode, cost_price_usd: 1, selling_price_usd: 2, stock_quantity: 0, image_path: null })
const pair = [entry(1, 'Kind Variant', '8851'), entry(2, 'Kind Variant', '8851')]
const third = entry(3, 'Kind Variant', '8852')
const clusters: PossiblySameCluster[] = [
  { type: 'barcode', value: '8851', severity: 'same_barcode', products: pair },
  { type: 'name', value: 'Kind Variant', severity: 'same_name', products: [...pair, third] },
  { type: 'leadingzero', value: '8851', severity: 'leading_zero', products: [...pair, entry(4, 'Kind Variant', '08851')] },
  { type: 'similar', value: 'Kind Variant', severity: 'similar_name', products: [...pair, entry(5, 'Kind-Variant', '9')] },
  { type: 'barcode', value: '7777', severity: 'same_barcode', products: [entry(8, 'Other', '7777'), entry(9, 'Other', '7777')] },
  { type: 'name', value: 'Half', severity: 'same_name', products: [pair[0], entry(6, 'Half', '1')] },
]
assert.deepEqual(clustersListingProducts(clusters, [1, 2]), [{ type: 'barcode', value: '8851' }, { type: 'name', value: 'Kind Variant' }, { type: 'leadingzero', value: '8851' }],
  'every barcode, name and leading-zero cluster that holds the whole pair, and no cluster that holds only one of them')
assert.deepEqual(clustersListingProducts(clusters, [8, 9]), [{ type: 'barcode', value: '7777' }], 'a pair beside nothing has its barcode cluster only')
assert.deepEqual(clustersListingProducts(clusters, [1]), [], 'a single product is no pair')
assert.deepEqual(clustersListingProducts(clusters, [1, 99]), [], 'a pair no cluster lists has nothing to dismiss')
assert.deepEqual(clustersListingProducts([clusters[0], clusters[0]], [1, 2]), [{ type: 'barcode', value: '8851' }], 'the same cluster listed twice is dismissed once')

// ---- the callers --------------------------------------------------------------------------------------------------------------------------------------
const products = read('components/products/Products.tsx')
assert.match(products, /await keepBothDuplicate\(extractDuplicateClusters\(duplicateClusters\), info,/, "Products' Keep both goes through keepBothDuplicate (tests/keepBothNarrow.test.ts runs it over the real sweep)")
assert.match(read('components/shared/twinDismissalsTransport.ts'), /await dismissProductClustersAndRefresh\(rulings\)/, 'in one call, so the rulings are re-read once')
assert.ok(!/dismissProductClusterAndRefresh\(/.test(products), 'and Products never goes through the one-ruling call')
assert.ok(!/dismissProductDuplicateCluster\(/.test(products), 'nor the bare transport')
const tab = read('components/products/ProductDuplicatesTab.tsx')
assert.match(tab, /await dismissProductClustersAndRefresh\(targets\.map/, "the Conflicts tab's bulk Dismiss makes its rulings in one call")
assert.equal((tab.match(/await dismissProductClusterAndRefresh\(/g) || []).length, 1, 'only the single Dismiss goes through the one-ruling call')
assert.ok(!/for \(const cluster of targets\)/.test(tab.slice(tab.indexOf('const bulkDismiss'), tab.indexOf('const updateGroupRemoval'))), 'and no per-cluster loop in the bulk Dismiss')

console.log(`PASS twin dismissal transport: ${RULINGS.length} rulings are stored in order and read back once, a failure does not stop the rest, nothing is read when nothing was stored; ${mutants.length} mutants killed; a partly refused Keep both still refreshes the list (${partialMutants.length} mutants killed); the pair's clusters are picked; Products and the bulk Dismiss use the one call`)
