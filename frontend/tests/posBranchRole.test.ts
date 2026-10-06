// Lane LE (branch cutover): the till decides "can sell" from the branch ROLE
// carried in the product payload, never from the branch NAME.
//
// Before this lane, branchAllowsSale -> branchCanSell(name): after the
// Warehouse is renamed "LC Store" every pill greyed and resolveSaleBranch
// returned `blocked`, so POS could not add to the cart the morning after the
// cutover. These tests:
//   1. PARITY  -- while both branches are active (payload entries with no role
//      yet, or role = the lowercased name after the identity backfill) the new
//      answers equal the bb639041 name-only ones for every shape in a matrix.
//      GOLDEN_* below is that code, verbatim.
//   2. DISCRIMINATION -- rename the branch to "LC Store" in the fixture: the
//      golden refuses (the defect), the role-aware code sells.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { branchAllowsSale, branchIdentityFromProduct, deriveProductSheetState, resolveSaleBranch } from '../src/components/pos/productSheetState.ts'
import type { SaleBranchDecision } from '../src/components/pos/productSheetState.ts'
import { mergeSameDetailRows } from '../src/utils/productGrouping.ts'
import { branchCanSell, branchRoleFromName } from '../src/utils/branchRoles.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const src = (...parts: string[]) => fs.readFileSync(new URL(`../src/${parts.join('/')}`, import.meta.url), 'utf8')

type Entry = { branch_id: number; branch_name: string; quantity: number; branch_role?: string | null; branch_active?: number | boolean | string | null }
type Product = { id: number; branch_stock: Entry[] }

// ---- GOLDEN: bb639041 productSheetState (name-only) -------------------------
function goldenName(product: Product, branchId: unknown): string | null {
  const key = branchId == null ? '' : String(branchId)
  if (!key) return null
  for (const entry of Array.isArray(product?.branch_stock) ? product.branch_stock : []) {
    if (String(entry?.branch_id) === key) return String(entry?.branch_name ?? '')
  }
  return null
}
function goldenAllows(product: Product, branchId: unknown): boolean {
  const name = goldenName(product, branchId)
  return name != null && branchCanSell(name)
}
const toNumber = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function goldenResolve(product: Product, options: { activeBranchFilterId?: unknown; defaultBranchId?: unknown } = {}): SaleBranchDecision {
  const active = options.activeBranchFilterId
  if (active != null && String(active) !== '') {
    const id = Number(active)
    if (Number.isFinite(id)) return goldenAllows(product, id) ? { branchId: id, blocked: false } : { branchId: null, blocked: true }
  }
  const rawPreferred = options.defaultBranchId
  const preferred = rawPreferred == null || String(rawPreferred) === '' ? null : Number(rawPreferred)
  let best: number | null = null
  let bestQuantity = 0
  let unsellableStock = false
  for (const entry of product.branch_stock) {
    const id = Number(entry?.branch_id)
    const quantity = toNumber(entry?.quantity)
    if (!Number.isFinite(id) || quantity <= 0) continue
    if (!goldenAllows(product, id)) { unsellableStock = true; continue }
    if (preferred != null && Number.isFinite(preferred) && id === preferred) return { branchId: id, blocked: false }
    if (quantity > bestQuantity) { best = id; bestQuantity = quantity }
  }
  if (best != null) return { branchId: best, blocked: false }
  if (unsellableStock) return { branchId: null, blocked: true }
  if (preferred != null && Number.isFinite(preferred) && goldenAllows(product, preferred)) return { branchId: preferred, blocked: false }
  return { branchId: null, blocked: false }
}
// -----------------------------------------------------------------------------

const withRole = (entries: Array<[number, string, number]>, mode: 'legacy' | 'backfilled'): Product => ({
  id: 10,
  branch_stock: entries.map(([id, name, quantity]) => {
    const key = name.trim().toLowerCase()
    return mode === 'legacy'
      ? { branch_id: id, branch_name: name, quantity }
      : { branch_id: id, branch_name: name, quantity, branch_role: key === 'shop' || key === 'warehouse' ? key : null, branch_active: 1 }
  }),
})

await runTest('parity: with both branches active the till answers exactly as the name-only code did (legacy and backfilled payloads)', () => {
  const nameSets: Array<Array<[number, string]>> = [
    [[1, 'Warehouse'], [2, 'Shop']],
    [[1, 'Shop'], [2, 'Warehouse']],
    [[1, ' shop '], [2, 'WAREHOUSE']],
    [[1, 'Warehouse'], [2, 'Warehouse']],
    [[1, 'Shop'], [2, 'Shop']],
    [[1, 'Depot'], [2, 'Shop']],
    [[1, 'Kiosk']],
    [],
  ]
  let cases = 0
  for (const mode of ['legacy', 'backfilled'] as const) {
    for (const names of nameSets) {
      for (const quantities of [[0, 0], [5, 0], [0, 7], [3, 9]]) {
        const product = withRole(names.map(([id, name], i) => [id, name, quantities[i] ?? 0]), mode)
        for (const id of [1, 2, 3, null, '2']) {
          assert.equal(branchAllowsSale(product as never, id), goldenAllows(product, id), `${mode} allows ${JSON.stringify(names)} ${id}`)
        }
        for (const activeBranchFilterId of [undefined, 1, 2, '', 9]) {
          for (const defaultBranchId of [undefined, 1, 2, '', 9]) {
            const options = { activeBranchFilterId, defaultBranchId }
            assert.deepEqual(resolveSaleBranch(product as never, options), goldenResolve(product, options), `${mode} resolve ${JSON.stringify(names)} ${JSON.stringify(options)} ${quantities}`)
            cases += 1
          }
        }
        for (const intent of ['sell', 'stock'] as const) {
          const state = deriveProductSheetState({ product: product as never, intent })
          for (const option of state.branchOptions) {
            const goldenSellable = intent !== 'sell' || branchCanSell(option.name)
            assert.equal(option.selectable, goldenSellable, `${mode} ${intent} selectable ${option.name}`)
            assert.equal(option.role, branchRoleFromName(option.name), `${mode} ${intent} role ${option.name}`)
          }
        }
      }
    }
  }
  assert.ok(cases > 1500, `matrix ran ${cases}`)
})

// The cutover end state as the till receives it (Worker: branch_role, branch_active).
const afterRename = (shop: number, store: number): Product => ({
  id: 20,
  branch_stock: [
    { branch_id: 1, branch_name: 'LC Store', branch_role: 'shop', branch_active: 1, quantity: store },
    { branch_id: 2, branch_name: 'Old Shop', branch_role: 'shop', branch_active: 0, quantity: shop },
  ],
})

await runTest('renamed Warehouse: the role-aware till sells from LC Store; the name-only golden is blocked (the defect)', () => {
  const product = afterRename(0, 12)
  assert.deepEqual(goldenResolve(product, {}), { branchId: null, blocked: true }, 'bb639041 control: POS cannot add to cart')
  assert.deepEqual(resolveSaleBranch(product as never, {}), { branchId: 1, blocked: false })
  assert.deepEqual(resolveSaleBranch(product as never, { activeBranchFilterId: 1 }), { branchId: 1, blocked: false })
  assert.deepEqual(resolveSaleBranch(product as never, { defaultBranchId: 1 }), { branchId: 1, blocked: false })
  assert.equal(branchAllowsSale(product as never, 1), true)
  assert.equal(goldenAllows(product, 1), false)
})

await runTest('a retired branch keeps its role but never sells: Old Shop is refused, even holding stock', () => {
  const product = afterRename(4, 0)
  assert.equal(branchAllowsSale(product as never, 2), false)
  assert.deepEqual(resolveSaleBranch(product as never, { activeBranchFilterId: 2 }), { branchId: null, blocked: true })
  assert.deepEqual(resolveSaleBranch(product as never, {}), { branchId: null, blocked: true }, 'stock only at the retired branch: blocked, not booked there')
})

await runTest('unbackfilled rename fails closed; a payload with no entry for the branch is refused', () => {
  const noRole: Product = { id: 21, branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 9 }] }
  assert.equal(branchAllowsSale(noRole as never, 1), false, 'role NULL + name LC Store: the name decides, and it is not a shop')
  assert.deepEqual(resolveSaleBranch(noRole as never, {}), { branchId: null, blocked: true })
  assert.equal(branchAllowsSale(afterRename(0, 1) as never, 7), false, 'unknown id')
  assert.equal(branchIdentityFromProduct(afterRename(0, 1) as never, 7), null)
  assert.deepEqual(branchIdentityFromProduct(afterRename(0, 1) as never, 1), { name: 'LC Store', role: 'shop', is_active: 1 })
})

await runTest('the product sheet greys by role: LC Store is selectable on a sale, Old Shop and a warehouse-role branch are not', () => {
  const sell = deriveProductSheetState({ product: afterRename(3, 12) as never, intent: 'sell' })
  const byName = (name: string) => sell.branchOptions.find((option) => option.name === name)!
  assert.equal(byName('LC Store').selectable, true)
  assert.equal(byName('LC Store').role, 'shop')
  assert.equal(byName('Old Shop').selectable, false, 'retired')
  assert.equal(sell.effectiveBranchId, '1', 'the sheet opens on LC Store')
  assert.equal(sell.displayedStock, 12)

  const stock = deriveProductSheetState({ product: afterRename(3, 12) as never, intent: 'stock' })
  assert.equal(stock.branchOptions.every((option) => option.selectable), true, 'stock surfaces stay unrestricted')

  const warehouseRole: Product = { id: 22, branch_stock: [{ branch_id: 1, branch_name: 'Main Store', branch_role: 'warehouse', branch_active: 1, quantity: 8 }] }
  const wh = deriveProductSheetState({ product: warehouseRole as never, intent: 'sell' })
  assert.equal(wh.branchOptions[0].selectable, false, 'a renamed warehouse does not start selling')
  assert.equal(wh.branchOptions[0].role, 'warehouse')
  assert.equal(wh.warehouseDisabled, true)
})

await runTest('grouped rows keep the role and activity when branch_stock is merged', () => {
  const row = (id: number, shop: number, store: number) => ({
    id, name: 'Soap', barcode: '8850000000011', selling_price_usd: 2, cost_price_usd: 1, category: 'Care', unit: 'pcs', is_active: 1,
    stock_quantity: shop + store,
    branch_stock: [
      { branch_id: 1, branch_name: 'LC Store', branch_role: 'shop', branch_active: 1, quantity: store },
      { branch_id: 2, branch_name: 'Old Shop', branch_role: 'shop', branch_active: 0, quantity: shop },
    ],
  })
  const merged = mergeSameDetailRows([row(1, 1, 2), row(2, 3, 4)] as never)
  assert.equal(merged.length, 1, 'the two child rows merge into one display row')
  const entries = merged[0].branch_stock as Entry[]
  assert.deepEqual(entries.map((e) => [e.branch_id, e.quantity, e.branch_role, e.branch_active]), [[1, 6, 'shop', 1], [2, 4, 'shop', 0]])
  assert.equal(branchAllowsSale(merged[0] as never, 1), true, 'the merged row still sells from LC Store')
  assert.equal(branchAllowsSale(merged[0] as never, 2), false)
  // legacy payloads (no role/active keys) merge to exactly the old three-key entries
  const legacy = (id: number) => ({ ...row(id, 1, 1), branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 1 }, { branch_id: 2, branch_name: 'Shop', quantity: 1 }] })
  const legacyMerged = mergeSameDetailRows([legacy(3), legacy(4)] as never)
  assert.deepEqual(legacyMerged[0].branch_stock, [
    { branch_id: 1, branch_name: 'Warehouse', quantity: 2 },
    { branch_id: 2, branch_name: 'Shop', quantity: 2 },
  ])
})

await runTest('POS surfaces pass the branch ROW to the role reader, never its name', () => {
  const pos = src('components', 'pos', 'POS.tsx')
  assert.match(pos, /branchCanSellNow\(targetBranch\)/)
  assert.doesNotMatch(pos, /branchCanSell\(/)
  const cart = src('components', 'pos', 'CartItem.tsx')
  assert.match(cart, /disabled: !branchCanSellNow\(branch\)/)
  assert.doesNotMatch(cart, /branchCanSell\(/)
  const sheet = src('components', 'pos', 'productSheetState.ts')
  assert.doesNotMatch(sheet, /branchCanSell\(name\)|branchRoleFromName\(name\)/, 'the sheet no longer derives the role from a bare name')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('posBranchRole tests passed')
