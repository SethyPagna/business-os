// Owner, 16 Nov 2026: an unmerged duplicate is its own row and "show them next to each other, so it is easier to notice".
// Three corners of the client order that the first pass missed (review findings F5, F6, F8):
//   F5  the name is compared as the identity key reads it (trimmed, spaces collapsed, lower case), not as raw text;
//   F6  an old-style explicit family (a parent row with parent_id children) keeps its parent first, which used to leave a
//       parentless twin of one child on the far side of the parent row;
//   F8  "Hide out-of-stock rows" judges unmerged twins by their combined branches, as it did when they were one folded row.
// Every case runs under all input orders. Mutants edit the real source and must each turn it red.
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
const permutations = <T,>(xs: T[]): T[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]))

const stock = (branches: Array<[number, number]>) => branches.map(([id, quantity]) => ({ branch_id: id, branch_name: `B${id}`, quantity }))
const row = (id: number, name: string, barcode: string, branches: Array<[number, number]> = [[1, 5]], extra: Record<string, unknown> = {}) => ({
  id, name, barcode, selling_price_usd: 4, created_at: '2026-01-01', branch_stock: stock(branches), stock_quantity: branches.reduce((s, [, q]) => s + q, 0), ...extra,
})

function probe(api: Record<string, any>): string[] {
  const failures: string[] = []
  const check = (name: string, fn: () => void) => { try { fn() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) } }
  const idsOf = (items: any[], productsById = new Map()) => (api.buildProductGroups(items, productsById) as any[]).flatMap((g) => g.rows.map((r: any) => Number(r.id)))
  const adjacent = (ids: number[], wanted: number[]) => {
    const at = wanted.map((id) => ids.indexOf(id)).sort((a, b) => a - b)
    assert.ok(at[0] >= 0, `all of ${wanted} are listed in ${ids}`)
    assert.deepEqual(at, at.map((_, i) => at[0] + i), `${wanted} must be consecutive in ${ids}`)
  }

  // F5: three spellings of one name; a real variant with a smaller barcode must not land between the twins (raw text sorts the padded name first).
  const F5 = [row(1, 'Glow Serum', '8851234567890'), row(2, ' Glow  Serum ', '08851234567890'), row(3, 'glow serum', '8840000000001'), row(4, 'GLOW SERUM', '8851234567890')]
  check('F5 padded, doubled-space and upper-case names sort as one name: twins 1, 2, 4 consecutive under all 24 orders', () => {
    for (const order of permutations(F5)) adjacent(idsOf(order), [1, 2, 4])
  })

  check('F5 the exported row comparator alone keeps the twins together (the gather pass in buildProductGroups would hide a raw-name comparator)', () => {
    for (const order of permutations(F5)) adjacent([...order].sort(api.compareProductsByNameBarcodeId).map((r) => r.id), [1, 2, 4])
  })

  // F6: explicit family P(10) with children 11 and 12; parentless 13 is the twin of child 11.
  const F6 = [row(10, 'Glow Serum', '', [[1, 0]], { is_group: 1 }), row(11, 'Glow Serum', '8851234567890', [[1, 4]], { parent_id: 10 }), row(12, 'Glow Serum', '8852222222222', [[1, 6]], { parent_id: 10 }), row(13, 'Glow Serum', '8851234567890', [[1, 9]])]
  check('F6 a parentless twin of a family child sits next to that child, under all 24 orders (both with and without the id map)', () => {
    const byId = new Map(F6.map((p) => [p.id, p]))
    for (const order of permutations(F6)) {
      adjacent(idsOf(order, byId), [11, 13])
      adjacent(idsOf(order), [11, 13])
      const ids = idsOf(order, byId)
      assert.equal(ids.length, 4)
      assert.equal(ids[0], 10, `the family parent still comes first: ${ids}`)
    }
  })

  // F8: zero twins judged across their branches.
  const sectionsOf = (items: any[]) => api.hideZeroStockGroupedChildRows(api.buildProductCategorySections(items)) as any[]
  const visibleIds = (items: any[]) => sectionsOf(items).flatMap((s) => s.groups.flatMap((g: any) => g.rows.map((r: any) => Number(r.id)))).sort((a: number, b: number) => a - b)
  check('F8 an all-zero twin pair tracked at two different branches is hidden', () => {
    const pair = [row(1, 'Aloe', '8851234567890', [[1, 0]]), row(2, 'Aloe', '8851234567890', [[2, 0]]), row(3, 'Aloe', '8850000000009', [[1, 5]])]
    assert.deepEqual(visibleIds(pair), [3], 'the zero pair is hidden, the stocked variant stays')
  })
  check('F8 twins tracked at the same single branch stay visible (one branch is not "all branches")', () => {
    const pair = [row(1, 'Aloe', '8851234567890', [[1, 0]]), row(2, 'Aloe', '8851234567890', [[1, 0]]), row(3, 'Aloe', '8850000000009', [[1, 5]])]
    assert.deepEqual(visibleIds(pair), [1, 2, 3])
  })
  check('F8 a twin with stock keeps its zero twin visible', () => {
    const pair = [row(1, 'Aloe', '8851234567890', [[1, 0]]), row(2, 'Aloe', '8851234567890', [[2, 7]]), row(3, 'Aloe', '8850000000009', [[1, 5]])]
    assert.deepEqual(visibleIds(pair), [1, 2, 3])
  })
  check('F8 a lone zero row at one branch stays visible; a zero row spanning two branches is hidden', () => {
    const rows = [row(1, 'Aloe', '8851234567890', [[1, 0]]), row(2, 'Aloe', '8850000000009', [[1, 0], [2, 0]]), row(3, 'Aloe', '8850000000010', [[1, 5]])]
    assert.deepEqual(visibleIds(rows), [1, 3])
  })
  check('F8 the hidden count is reported', () => {
    const pair = [row(1, 'Aloe', '8851234567890', [[1, 0]]), row(2, 'Aloe', '8851234567890', [[2, 0]]), row(3, 'Aloe', '8850000000009', [[1, 5]])]
    assert.equal(sectionsOf(pair)[0].groups[0].hiddenZeroStockRowCount, 2)
  })
  // R2-2: a name group that is ONLY a zero twin pair shows exactly as one record with the same per-branch stock would.
  check('R2-2 a group that is only an all-zero twin pair stays listed, as the one folded row it replaces did', () => {
    const only = [row(1, 'Lip Balm', '8851234567890', [[1, 0]]), row(2, 'Lip Balm', '8851234567890', [[2, 0]]), row(9, 'Zeta', '8850000000009', [[1, 3]])]
    assert.deepEqual(visibleIds(only), [1, 2, 9])
    const single = [row(1, 'Lip Balm', '8851234567890', [[1, 0], [2, 0]]), row(9, 'Zeta', '8850000000009', [[1, 3]])]
    assert.deepEqual(visibleIds(single), [1, 9], 'control: one record, zero at two branches, is listed')
    assert.equal(sectionsOf(only).flatMap((s) => s.groups).find((g: any) => g.rows.some((r: any) => r.id === 1)).hiddenZeroStockRowCount || 0, 0)
  })
  check('R2-2 the same pair beside a stocked variant is hidden, exactly as the single zero record would be', () => {
    const withVariant = [row(1, 'Lip Balm', '8851234567890', [[1, 0]]), row(2, 'Lip Balm', '8851234567890', [[2, 0]]), row(3, 'Lip Balm', '8850000000009', [[1, 5]])]
    const single = [row(1, 'Lip Balm', '8851234567890', [[1, 0], [2, 0]]), row(3, 'Lip Balm', '8850000000009', [[1, 5]])]
    assert.deepEqual(visibleIds(withVariant), [3])
    assert.deepEqual(visibleIds(single), [3])
  })
  return failures
}

const source = read('utils/productGrouping.ts')
const visibility = read('utils/productGroupVisibility.ts')
const real = probe(load(source))
assert.deepEqual(real, [], `unmutated source is red:\n${real.join('\n')}`)

const mutants: Array<{ name: string; from: string; to: string }> = [
  { name: 'F5 name compared raw again', from: 'const nameDelta = normalizeProductGroupName(left?.name).localeCompare(normalizeProductGroupName(right?.name), undefined, { sensitivity: \'base\' })', to: 'const nameDelta = String(left?.name || \'\').localeCompare(String(right?.name || \'\'), undefined, { sensitivity: \'base\' })' },
  { name: 'F6 twins are not gathered', from: 'const items = gatherUnmergedTwins([...group.items].sort(', to: 'const items = (([...group.items].sort(' },
  { name: 'F6 twins gathered behind the first member, not the family child', from: 'members.find((member) => toProductId(member?.parent_id) > 0) ?? members[0]', to: 'members[0]' },
  { name: 'F8 each row judged alone (the first-pass behaviour)', from: "const members = twinsByKey.get(String(row.__twinKey || '')) || [row]", to: 'const members = [row]' },
  { name: 'F8 twins pooled by name only', from: "const members = twinsByKey.get(String(row.__twinKey || '')) || [row]", to: 'const members = [...twinsByKey.values()].flat()' },
  { name: 'R2-2 a twin-only group is judged as two rows', from: 'if (productCount <= 1) return [group]', to: 'if (false) return [group]' },
  { name: 'F8 branches not distinguished (one branch counts as many)', from: 'const key = String(entry?.branch_id ?? entry?.branch_name ?? \'\')', to: 'const key = String(Math.random())' },
]
for (const mutant of mutants) {
  const inVisibility = visibility.includes(mutant.from)
  assert.ok(inVisibility || source.includes(mutant.from), `mutant "${mutant.name}" no longer matches the source (stale mutant)`)
  if (inVisibility) { assert.ok(probe(load(source, visibility.replace(mutant.from, mutant.to))).length > 0, `mutant survived: ${mutant.name}`); continue }
  let mutated = source.replace(mutant.from, mutant.to)
  // The F6 "not gathered" mutant needs a balanced replacement: sort, then skip the gather pass.
  if (mutant.name === 'F6 twins are not gathered') mutated = source.replace('gatherUnmergedTwins([...group.items].sort((left, right) => compareProductsWithinGroup(left, right, productsById)))', '[...group.items].sort((left, right) => compareProductsWithinGroup(left, right, productsById))')
  assert.ok(probe(load(mutated)).length > 0, `mutant survived: ${mutant.name}`)
}
console.log(`PASS unmerged twin order: padded names, explicit-family twins and hide-out-of-stock twins; all input orders; ${mutants.length} mutants killed`)
