// Owner, 16 Nov 2026 (F3 ruling "Open, tag both rows"). One rule decides "is this an unmerged twin": the same normalised
// name AND the same real barcode (leading zeros folded). It drives (1) the Duplicate tag on each twin row, (2) the open state
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
const TWIN_B = row(2, ' glow  serum', '08851234567890') // same name once normalised, leading zero on the barcode
const VARIANT_A = row(3, 'Aloe Gel', '8850000000011')
const VARIANT_B = row(4, 'Aloe Gel', '8850000000022') // same name, a different REAL barcode: a variant, not a twin
const NO_CODE_A = row(5, 'Plain Soap', '')
const NO_CODE_B = row(6, 'Plain Soap', '') // empty and placeholder barcodes are nobody's twin
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
  check('rows without a real barcode are nobody\'s twin', () => {
    const g = group('plain soap')
    assert.equal(flag(g, 5), false)
    assert.equal(flag(g, 6), false)
    assert.equal(flag(g, 9), false, 'the literal 0 is a placeholder')
    assert.equal(flag(g, 10), false)
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
  check('a single product never has multiple items, so it is never folded', () => {
    assert.equal(api.startsCollapsedGroup(group('plain soap')) === true, group('plain soap').hasMultipleItems === true)
  })
  return failures
}

const source = read('utils/productGrouping.ts')
const visibility = read('utils/productGroupVisibility.ts')
const real = probe(load(source))
assert.deepEqual(real, [], `unmutated source is red:\n${real.join('\n')}`)

const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'every group starts open (open-all)', from: 'return Boolean(group?.hasMultipleItems) && !groupHasUnmergedTwins(group)', to: 'return false' },
  { name: 'every group starts folded (twins hidden again)', from: 'return Boolean(group?.hasMultipleItems) && !groupHasUnmergedTwins(group)', to: 'return Boolean(group?.hasMultipleItems)' },
  { name: 'tag on variants (twin = same name, any barcode)', from: "return `${normalizeProductGroupName(row.name)}|${identityBarcodeKey(row.barcode)}`", to: 'return normalizeProductGroupName(row.name)' },
  { name: 'tag on placeholder barcodes (no real-barcode guard)', from: "if (!row || !isRealBarcode(row.barcode)) return ''", to: "if (!row) return ''" },
  { name: 'leading zeros not folded', from: 'identityBarcodeKey(row.barcode)}`\n}', to: 'String(row.barcode)}`\n}' },
  { name: 'name compared raw, not normalised', from: 'normalizeProductGroupName(row.name)}|${identityBarcodeKey(row.barcode)}`\n}', to: 'String(row.name)}|${identityBarcodeKey(row.barcode)}`\n}' },
  { name: 'a lone row counts as its own twin', from: '(perKey.get(key) || 0) > 1', to: '(perKey.get(key) || 0) > 0' },
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

console.log(`PASS unmerged twin rule: tag, open state and scan share one key; variants, placeholders and other names are not twins; ${mutants.length} mutants killed`)
