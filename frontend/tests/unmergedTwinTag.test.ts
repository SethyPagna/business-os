// Owner, 16 Nov 2026 (F3 ruling "Open, tag both rows"). One rule decides "is this an unmerged twin": the owner's identity rule of
// 15 Sep 2026, the Worker's clusterRowsByBarcodeIdentity (cloudflare/scripts/test-twin-rule-parity-pure.cjs runs the Worker and this
// side over one table): same name, unless two genuinely different REAL barcodes separate the rows; an empty, word-like, short or
// placeholder barcode does not. It drives (1) the Duplicate tag on each twin row, (2) the open state
// of a Products name group (twins start OPEN, variants-only groups stay folded) and (3) the scan hit (scanExactHit.test.ts).
// Mutants edit the real source and must each turn it red. The mounted pages and the rendered tag are in
// scannerExactHitMounted.test.ts and unmergedTwinTagLayout.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function load(source: string, visibilitySource = read('utils/productGroupVisibility.ts')): Record<string, any> {
  const run = (code: string, resolve: (id: string) => unknown): Record<string, any> => {
    const mod: { exports: Record<string, any> } = { exports: {} }
    new Function('require', 'module', 'exports', transformSync(code, { loader: 'ts', format: 'cjs' }).code)(resolve, mod, mod.exports)
    return mod.exports
  }
  const grouping = run(source, (id: string) => require(id.replace(/^\.\//, '../src/utils/')))
  // The staff-only group rules live in productGroupVisibility.ts (kept out of the storefront closure); they read the grouping module under test.
  const visibility = run(visibilitySource, (id: string) => id.endsWith('productGrouping.ts') ? grouping : require(id.replace(/^\.\//, '../src/utils/')))
  return { ...grouping, ...visibility }
}

const row = (id: number, name: string, barcode: string) => ({ id, name, barcode, stock_quantity: 5, branch_stock: [{ branch_id: 1, branch_name: 'B1', quantity: 5 }] })
const TWIN_A = row(1, 'Glow Serum', '8851234567890')
const TWIN_B = row(2, ' glow serum', '08851234567890') // same name_key (the Worker's lower(trim(name)): case and edge spaces), leading zero on the barcode
const VARIANT_A = row(3, 'Aloe Gel', '8850000000011')
const VARIANT_B = row(4, 'Aloe Gel', '8850000000022') // same name, a different REAL barcode: a variant, not a twin
const NO_CODE_A = row(5, 'Plain Soap', '')
const NO_CODE_B = row(6, 'Plain Soap', '') // empty and placeholder barcodes never separate same-name rows: they are twins of each other
const PLACEHOLDER_A = row(9, 'Plain Soap', '0')
const PLACEHOLDER_B = row(10, 'Plain Soap', '0')
const OTHER_NAME = row(7, 'Glow Serum Mini', '8851234567890') // same code, other name: a different product
const ALL = [TWIN_A, TWIN_B, VARIANT_A, VARIANT_B, NO_CODE_A, NO_CODE_B, PLACEHOLDER_A, PLACEHOLDER_B, OTHER_NAME]

function probe(api: Record<string, any>): string[] {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  const groups = () => api.buildProductGroups(ALL, new Map(), { preserveInputOrder: false }) as any[]
  const group = (name: string) => groups().find((g) => g.name.toLowerCase().trim().replace(/\s+/g, ' ') === name)
  const flag = (g: any, id: number) => g.rows.find((r: any) => r.id === id).__unmergedTwin
  check('both twins are flagged, and only they', () => {
    const g = group('glow serum')
    assert.equal(flag(g, 1), true)
    assert.equal(flag(g, 2), true, 'a leading zero and a loose name are still the same product')
  })
  check('two variants (different real barcodes) are not twins', () => {
    const g = group('aloe gel')
    assert.equal(flag(g, 3), false)
    assert.equal(flag(g, 4), false)
  })
  check('empty and placeholder barcodes never separate same-name rows: the owner rule: both empty merge into one empty', () => {
    const g = group('plain soap')
    for (const id of [5, 6, 9, 10]) assert.equal(flag(g, id), true, 'row ' + id)
  })
  check('a real barcode and an empty or word barcode on one name are twins; two different real barcodes plus an empty one tag the empty row with the ranked winner', () => {
    const pair = api.buildProductGroups([row(21, 'Lip Balm', '8851234567890'), row(22, 'Lip Balm', ''), row(23, 'Lip Tint', '8851234567891'), row(24, 'Lip Tint', 'NoBox188')], new Map()) as any[]
    for (const g of pair) for (const r of g.rows) assert.equal(r.__unmergedTwin, true, r.name + ' ' + r.id)
    const three = api.buildProductGroups([{ ...row(31, 'Mask', '8851234567890'), stock_quantity: 9 }, row(32, 'Mask', '8859999999999'), row(33, 'Mask', '')], new Map()) as any[]
    assert.deepEqual(three[0].rows.map((r: any) => [r.id, r.__unmergedTwin]).sort(), [[31, true], [32, false], [33, true]])
  })
  check('the same code under another name is a different product, not a twin', () => {
    const g = group('glow serum mini')
    assert.equal(flag(g, 7), false)
  })
  check('a group holding twins starts open, a variants-only group starts folded', () => {
    assert.equal(api.startsCollapsedGroup(group('glow serum')), false, 'twins: open')
    assert.equal(api.startsCollapsedGroup(group('aloe gel')), true, 'variants only: folded')
  })
  check('twins plus a real variant in one group still start open', () => {
    const mixed = api.buildProductGroups([TWIN_A, TWIN_B, row(8, 'Glow Serum', '8859999999999')], new Map()) as any[]
    assert.equal(mixed.length, 1)
    assert.equal(api.startsCollapsedGroup(mixed[0]), false)
    assert.deepEqual(mixed[0].rows.map((r: any) => [r.id, r.__unmergedTwin]).sort(), [[1, true], [2, true], [8, false]])
  })
  check('a group row or an inactive row is not a twin: the Conflicts sweep lists active, non-group products only', () => {
    const g = api.buildProductGroups([row(41, 'Sun Gel', '8851234567890'), { ...row(42, 'Sun Gel', '8851234567890'), is_active: 0 }, { ...row(43, 'Sun Gel', ''), is_group: 1 }], new Map()) as any[]
    assert.deepEqual(g[0].rows.map((r: any) => r.__unmergedTwin), [false, false, false])
  })
  check('a group of only twins starts open; a single product has one row and is never a twin', () => {
    assert.equal(api.startsCollapsedGroup(group('plain soap')), false)
    assert.equal(group('glow serum mini').hasMultipleItems, false)
    assert.equal(flag(group('glow serum mini'), 7), false)
  })
  return failures
}

const source = read('utils/productGrouping.ts')
const visibility = read('utils/productGroupVisibility.ts')
const real = probe(load(source))
assert.deepEqual(real, [], `unmutated source is red:\n${real.join('\n')}`)

const CLUSTER = 'for (const cluster of clusterRowsByBarcodeIdentity(rows)) {'
const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'every group starts open (open-all)', from: 'return Boolean(group?.hasMultipleItems) && !groupHasUnmergedTwins(group)', to: 'return false' },
  { name: 'every group starts folded (twins hidden again)', from: 'return Boolean(group?.hasMultipleItems) && !groupHasUnmergedTwins(group)', to: 'return Boolean(group?.hasMultipleItems)' },
  { name: 'tag on variants (twin = same name, any barcode)', from: CLUSTER, to: 'for (const cluster of [rows]) {' },
  { name: 'the old real-barcode-only rule (an empty or word barcode is nobody\'s twin)', from: CLUSTER, to: 'for (const cluster of clusterRowsByBarcodeIdentity(rows.filter((row) => isRealBarcode(row.barcode)))) {' },
  { name: 'leading zeros not folded (clusters by the raw barcode text)', from: CLUSTER, to: 'for (const cluster of [...Map.groupBy(rows, (row) => String(row.barcode ?? \'\')).values()]) {' },
  { name: 'name compared raw, not normalised', from: 'const name = serverNameKey(item?.name)', to: 'const name = String(item?.name ?? \'\')' },
  { name: 'a lone row counts as its own twin', from: 'if (cluster.length < 2) continue', to: 'if (cluster.length < 1) continue' },
  { name: 'a group row or an inactive row counts', from: "if (!name || Number(group || 0) || active === 0 || active === false) return", to: 'if (!name) return' },
]
for (const mutant of mutants) {
  const inVisibility = visibility.includes(mutant.from)
  assert.ok(inVisibility || source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  const mutated = inVisibility ? probe(load(source, visibility.replace(mutant.from, mutant.to))) : probe(load(source.replace(mutant.from, mutant.to)))
  assert.ok(mutated.length > 0, `mutant survived: ${mutant.name}`)
}

// Wiring: the three surfaces read the one rule, not a copy of it.
const products = read('components/products/Products.tsx')
const inventory = read('components/inventory/InventoryProductsSurface.tsx')
assert.match(products, /if \(!startsCollapsedGroup\(group\)\) return/, 'Products opens a group by the shared rule')
assert.equal((products.match(/<UnmergedTwinTag /g) || []).length, 2, 'Products tags the desktop row and the phone card')
assert.equal((inventory.match(/twinTag\(product\)/g) || []).length, 2, 'Inventory tags the desktop row and the phone card')
assert.match(inventory, /product\.__unmergedTwin/, 'Inventory reads the flag ownRows set')

console.log(`PASS unmerged twin rule: tag, open state and scan share one key; variants and other names are not twins, empty and word barcodes are; ${mutants.length} mutants killed`)
