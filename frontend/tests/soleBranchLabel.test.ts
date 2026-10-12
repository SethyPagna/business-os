// Owner ruling, 12 Oct 2026: with one active branch (LC Store) the branch
// pickers collapse - but where the person used to SEE which branch a thing
// belongs to, they still see it, as a small read-only label with the real
// branch name. The surfaces below hid the picker and showed nothing: Manage
// Received Dates, the Add Variant form, Return to Supplier, a POS cart line and
// the POS product sheet. Two active branches (today) keep the picker and show
// no label; the one-branch case is the thing under test, with both language
// packs for the "Branch" word.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

const labelsOf = (surface: MountedSurface): MemoryNode[] => surface.findAll((node) => node.getAttribute('data-sole-branch') !== null)
const pickerCount = (surface: MountedSurface): number => surface.findAll((node) => node.getAttribute('aria-haspopup') === 'listbox').length

function assertSoleLabel(surface: MountedSurface, lang: string, where: string, name = 'LC Store') {
  const found = labelsOf(surface)
  assert.equal(found.length, 1, `${where} (${lang}): exactly one read-only branch label is shown`)
  assert.equal(found[0].getAttribute('role'), 'group', `${where}: it is a group, not a control`)
  assert.equal(found[0].getAttribute('aria-label'), `${packs[lang].branch}: ${name}`, `${where} (${lang}): named "Branch: name" in the person's language`)
  assert.ok(found[0].textContent.includes(name), `${where}: the real branch name is printed`)
}

const money = (symbol: string) => (value: number) => `${symbol}${value}`

const harness = await createHarness()
try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const t = (key: string) => words[key] || key
    const app = { t, user: { id: 1, role_code: 'admin', role_permissions: { all: true } }, notify() {}, getPermissionTier: () => 'none' }
    type BranchFixture = { id: number; name: string; is_default?: boolean; is_active: number }
    const one: BranchFixture[] = [{ id: 1, name: 'LC Store', is_default: true, is_active: 1 }]
    const two: BranchFixture[] = [{ id: 1, name: 'Warehouse', is_default: true, is_active: 1 }, { id: 2, name: 'Shop', is_active: 1 }]

    // 1. Manage Received Dates
    const manageProps = (options: Array<{ value: string; label: string }>) => ({
      product: { id: 7, name: 'Synthetic serum', unit: 'pcs' }, branchSelectOptions: options, defaultBranchId: options[0].value,
      notify() {}, onClose() {}, onChanged() {}, t, tr: (_key: string, fallback = '') => fallback,
    })
    const lotDoubles = { 'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }) } }
    const manageOne = await harness.mount({ component: 'components/inventory/ManageBatchesModal.tsx', props: manageProps([{ value: '1', label: 'LC Store' }]), app, doubles: lotDoubles })
    assertSoleLabel(manageOne, lang, 'Manage Received Dates')
    assert.equal(pickerCount(manageOne), 0, 'Manage Received Dates: no one-option picker')
    await manageOne.unmount()
    const manageTwo = await harness.mount({ component: 'components/inventory/ManageBatchesModal.tsx', props: manageProps([{ value: '1', label: 'Warehouse' }, { value: '2', label: 'Shop' }]), app, doubles: lotDoubles })
    assert.equal(labelsOf(manageTwo).length, 0, 'CONTROL: two branches keep the picker and show no label')
    assert.ok(pickerCount(manageTwo) >= 1, 'CONTROL: the picker is there')
    await manageTwo.unmount()

    // 2. Add Variant
    const variantProps = (branches: BranchFixture[]) => ({
      parent: { id: 5, name: 'Synthetic serum', unit: 'pcs', selling_price_usd: 3 }, units: [{ id: 1, name: 'pcs' }], branches,
      user: { id: 1 }, onClose() {}, onDone() {}, t, usdSymbol: '$',
    })
    const variantOne = await harness.mount({ component: 'components/products/forms/VariantFormModal.tsx', props: variantProps(one), app, doubles: {} })
    assertSoleLabel(variantOne, lang, 'Add Variant')
    await variantOne.unmount()
    const variantTwo = await harness.mount({ component: 'components/products/forms/VariantFormModal.tsx', props: variantProps(two), app, doubles: {} })
    assert.equal(labelsOf(variantTwo).length, 0, 'CONTROL: Add Variant with two branches keeps the picker')
    await variantTwo.unmount()

    // 3. POS cart line
    const cartProps = (branches: BranchFixture[]) => ({
      item: { id: 9, cart_line_id: 'line-9', name: 'Synthetic serum', quantity: 1, branch_id: 1, applied_price_usd: 3, applied_price_khr: 12300 },
      branches, t, onQtyChange() {}, onPriceChange() {}, onDiscountChange() {}, onBranchChange() {}, onToggleTierTag() {}, onRemove() {}, onShowDetails() {},
      fmtUSD: money('$'), fmtKHR: money('R'), usdSymbol: '$', khrSymbol: 'R',
    })
    const cartOne = await harness.mount({ component: 'components/pos/CartItem.tsx', props: cartProps(one), app, doubles: {} })
    assertSoleLabel(cartOne, lang, 'POS cart line')
    await cartOne.unmount()
    const cartTwo = await harness.mount({ component: 'components/pos/CartItem.tsx', props: cartProps(two), app, doubles: {} })
    assert.equal(labelsOf(cartTwo).length, 0, 'CONTROL: a cart line with two branches keeps its picker')
    await cartTwo.unmount()

    // 4. POS product sheet
    const sheetProps = (branch_stock: unknown[]) => ({
      posPresentation: true,
      product: { id: 5, name: 'Synthetic serum', unit: 'pcs', selling_price_usd: 3, selling_price_khr: 12300, stock_quantity: 12, branch_stock },
      exchangeRate: 4100, t, fmtUSD: money('$'), fmtKHR: money('R'), asNumber: Number, posCopy: (english: string) => english,
      activeBranchId: 2, trackedBatchProductIds: new Set<number>(), getDisplayStock: () => 12, getPrimaryProductImage: () => '',
      getVariantChoices: () => [], hasVariantChoices: () => false, onAddToCart() {}, onClose() {}, onOpenImageLightbox() {}, intent: 'sell',
    })
    const sheetDoubles = {
      'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }), getTrackedBatchProductIds: async () => ({ productIds: [] }) },
      'api/damagedLotsTransport.ts': { getDamagedLots: async () => ({ lots: [] }) },
    }
    const shopLine = { branch_id: 2, branch_name: 'LC Store', branch_role: 'shop', branch_active: 1, quantity: 12 }
    const sheetOne = await harness.mount({ component: 'components/pos/ProductDetailSheet.tsx', props: sheetProps([shopLine]), app, doubles: sheetDoubles })
    assertSoleLabel(sheetOne, lang, 'POS product sheet')
    await sheetOne.unmount()
    const sheetTwo = await harness.mount({
      component: 'components/pos/ProductDetailSheet.tsx',
      props: sheetProps([shopLine, { branch_id: 1, branch_name: 'Warehouse', branch_role: 'warehouse', branch_active: 1, quantity: 40 }]),
      app, doubles: sheetDoubles,
    })
    assert.equal(labelsOf(sheetTwo).length, 0, 'CONTROL: two branches keep the Branch step and show no label')
    await sheetTwo.unmount()

    // 5. Return to Supplier
    const supplierDoubles = (branches: BranchFixture[]) => ({
      'api/branchTransport.ts': { getBranches: async () => branches },
      'api/contactReadTransport.ts': { getSuppliers: async () => [] },
      'api/inventoryTransport.ts': { getInventorySummary: async () => [] },
    })
    const supplierProps = { onClose() {}, onSuccess() {}, notify() {}, fmtUSD: money('$'), fmtKHR: money('R') }
    const supplierOne = await harness.mount({ component: 'components/returns/NewSupplierReturnModal.tsx', props: supplierProps, app, doubles: supplierDoubles(one) })
    await supplierOne.waitFor(() => labelsOf(supplierOne).length === 1, 'the branch label')
    assertSoleLabel(supplierOne, lang, 'Return to Supplier')
    await supplierOne.unmount()
    const supplierTwo = await harness.mount({ component: 'components/returns/NewSupplierReturnModal.tsx', props: supplierProps, app, doubles: supplierDoubles(two) })
    assert.equal(labelsOf(supplierTwo).length, 0, 'CONTROL: Return to Supplier with two branches keeps the picker')
    await supplierTwo.unmount()
  }
  console.log('PASS the one-branch label is shown, named in both languages, on Manage Received Dates, Add Variant, a POS cart line, the POS product sheet and Return to Supplier; two branches keep their picker')
} finally {
  await harness.close()
}
