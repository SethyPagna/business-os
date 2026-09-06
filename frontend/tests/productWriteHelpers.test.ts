import assert from 'node:assert/strict'
import {
  buildDeletedProductIdSet,
  buildDefinedProductUpdates,
  buildProductBranchMovePlan,
  buildProductBranchStockAdjustments,
  buildProductBulkInfoUpdates,
  buildProductBulkPricingUpdates,
  buildProductBulkUpdatePayload,
  buildProductClearStockAdjustments,
  buildProductStockAdjustmentPayload,
  buildProductTransferStockPayload,
  buildProductWritePayload,
  getDefaultProductRestoreBranchId,
  getPreferredProductRestoreBranchId,
  resolveRestoredProductParentId,
  summarizeProductBulkRun,
} from '../src/components/products/helpers/productWriteHelpers.ts'

const basePayload = buildProductWritePayload({
  name: 'Product A',
  sku: 'SKU-A',
  unit: '',
  selling_price_usd: '10',
  selling_price_khr: '41000',
  cost_price_usd: '4',
  cost_price_khr: '16400',
  image_gallery: [' /uploads/a.png ', '', '/uploads/a.png', '/uploads/b.png'],
  image_path: 'fallback.png',
  low_stock_threshold: '5',
  out_of_stock_threshold: '',
  is_active: true,
  is_group: true,
}, { id: 7, name: 'Owner' })

assert.equal(basePayload.name, 'Product A')
assert.equal(basePayload.unit, 'pcs', 'blank unit falls back to pieces')
assert.equal(basePayload.selling_price_usd, 10)
// This assertion used to read "special price falls back to selling price",
// pinning the defect rather than the behaviour: a snapshot with no tier price
// silently shipped the SELLING price into the tier column, so any writer
// building a payload from a partial record overwrote the server's value with
// a client-composed one. The 2026-09-04 ruling moved the tier to wholesale
// and there is no fallback any more -- absent means 0, which reads as "no
// wholesale price set" and offers no tier at the POS.
assert.equal(basePayload.wholesale_price_usd, 0, 'a missing wholesale price must NOT inherit the selling price')
assert.equal(basePayload.purchase_price_usd, 4, 'purchase price falls back to cost price')
assert.equal(basePayload.cost_price_usd, 4)
assert.deepEqual(basePayload.image_gallery, ['/uploads/a.png', '/uploads/b.png'])
assert.equal(basePayload.image_path, '/uploads/a.png')
assert.equal(basePayload.low_stock_threshold, 5)
assert.equal(basePayload.out_of_stock_threshold, 0)
assert.equal(basePayload.is_active, 1)
assert.equal(basePayload.is_group, 1)
assert.equal(basePayload.parent_id, null)
assert.equal(basePayload.userId, 7)
assert.equal(basePayload.userName, 'Owner')

const variantPayload = buildProductWritePayload({
  parent_id: '42',
  is_group: true,
  image_gallery: [],
  image_path: 'main.jpg',
  purchase_price_usd: '',
  cost_price_usd: '2.50',
}, { id: 'admin', name: 'Admin' })

assert.equal(variantPayload.is_group, 0, 'variants cannot be restored as product groups')
assert.equal(variantPayload.parent_id, 42)
assert.deepEqual(variantPayload.image_gallery, ['main.jpg'])
assert.equal(variantPayload.image_path, 'main.jpg')
assert.equal(variantPayload.purchase_price_usd, 2.5)
assert.equal(variantPayload.userId, 'admin')
assert.equal(variantPayload.userName, 'Admin')

assert.deepEqual(
  buildProductBranchStockAdjustments(
    {
      branch_stock: [
        { branch_id: '1', quantity: '8' },
        { branch_id: 2, quantity: '0' },
        { branch_id: 0, quantity: 99 },
        { branch_id: 'bad', quantity: 99 },
      ],
    },
    {
      branch_stock: [
        { branch_id: 1, quantity: 5 },
        { branch_id: '2', quantity: 4 },
        { branch_id: 3, quantity: 2 },
      ],
    },
  ),
  [
    { branchId: 1, type: 'add', quantity: 3 },
    { branchId: 2, type: 'remove', quantity: 4 },
    { branchId: 3, type: 'remove', quantity: 2 },
  ],
  'branch stock adjustment planning returns only valid add/remove deltas',
)

assert.deepEqual(
  buildProductBranchStockAdjustments(
    { branch_stock: [{ branch_id: 5, quantity: 'not-a-number' }] },
    { branch_stock: [{ branch_id: 5, quantity: 0 }] },
  ),
  [],
  'invalid quantities are treated as zero to avoid unsafe stock mutations',
)

assert.deepEqual(
  buildProductClearStockAdjustments({
    purchase_price_usd: 3,
    cost_price_usd: 4,
    purchase_price_khr: 12000,
    branch_stock: [
      { branch_id: 1, quantity: '5' },
      { branch_id: 2, quantity: 0 },
      { branch_id: 3, quantity: 'not-a-number' },
      { branch_id: 'bad', quantity: 8 },
    ],
  }),
  [
    {
      branchId: 1,
      quantity: 5,
      unitCostUsd: 3,
      unitCostKhr: 12000,
    },
  ],
  'clear-stock planning returns valid positive branch stock rows with unit costs',
)

assert.deepEqual(
  buildProductClearStockAdjustments({
    cost_price_usd: 4,
    cost_price_khr: 16000,
    branch_stock: [{ branch_id: 2, quantity: 6 }],
  }),
  [
    {
      branchId: 2,
      quantity: 6,
      unitCostUsd: 4,
      unitCostKhr: 16000,
    },
  ],
  'clear-stock planning falls back to cost price when purchase price is absent',
)

assert.deepEqual(
  buildProductStockAdjustmentPayload(
    {
      id: 5,
      name: 'Stocked Product',
      purchase_price_usd: 3,
      purchase_price_khr: 12000,
      cost_price_usd: 4,
      cost_price_khr: 16000,
    },
    {
      type: 'add',
      quantity: '8',
      branchId: '2',
      reason: 'Bulk add stock',
      user: { id: 7, name: 'Owner' },
    },
  ),
  {
    productId: 5,
    productName: 'Stocked Product',
    type: 'add',
    quantity: 8,
    branchId: 2,
    // N14-D. This used to read 3 / 12000 -- the product's stored purchase
    // price, forwarded as though it were the cost of THIS delivery. A receipt
    // states what was actually paid or it is refused server-side; a stored
    // catalogue price is not evidence of either.
    unitCostUsd: undefined,
    unitCostKhr: undefined,
    reason: 'Bulk add stock',
    userId: 7,
    userName: 'Owner',
    supplierId: undefined,
    supplierName: undefined,
    attribution: undefined,
  },
  'stock adjustment payload forwards branch id, quantity and user attribution -- and invents no cost',
)

assert.deepEqual(
  buildProductStockAdjustmentPayload(
    {
      id: 5,
      name: 'Stocked Product',
      cost_price_usd: 4,
      cost_price_khr: 16000,
    },
    {
      productId: '9',
      type: 'remove',
      quantity: 'bad',
      branchId: 'bad',
      unitCostUsd: 2,
      unitCostKhr: 8200,
      reason: 'Clear stock',
      user: { id: 8, name: 'Admin' },
    },
  ),
  {
    productId: 9,
    productName: 'Stocked Product',
    type: 'remove',
    quantity: 0,
    branchId: null,
    unitCostUsd: 2,
    unitCostKhr: 8200,
    reason: 'Clear stock',
    userId: 8,
    userName: 'Admin',
    supplierId: undefined,
    supplierName: undefined,
    attribution: undefined,
  },
  'stock adjustment payload accepts explicit product id and unit-cost overrides',
)

assert.deepEqual(
  buildProductStockAdjustmentPayload(
    {
      id: 4,
      name: 'Current Product',
      purchase_price_usd: 0,
      purchase_price_khr: 0,
      cost_price_usd: 2,
      cost_price_khr: 8200,
    },
    {
      productName: 'Snapshot Product',
      type: 'add',
      quantity: 0,
      branchId: 6,
      reason: 'Initialize branch',
      user: { id: 9, name: 'Restorer' },
    },
  ),
  {
    productId: 4,
    productName: 'Snapshot Product',
    type: 'add',
    quantity: 0,
    branchId: 6,
    // Same rule: cost_price_usd 2 is the catalogue's number, not this
    // movement's, and no longer leaks onto the wire as one.
    unitCostUsd: undefined,
    unitCostKhr: undefined,
    reason: 'Initialize branch',
    userId: 9,
    userName: 'Restorer',
    supplierId: undefined,
    supplierName: undefined,
    attribution: undefined,
  },
  'stock adjustment payload supports snapshot name overrides and zero-quantity branch initialization',
)

assert.deepEqual(
  buildProductBranchMovePlan(
    { branch_stock: [{ branch_id: 1, quantity: 5 }] },
    2,
  ),
  {
    action: 'transfer',
    fromBranchId: 1,
    toBranchId: 2,
    quantity: 5,
  },
  'branch move planning transfers positive stock from a different branch',
)

assert.deepEqual(
  buildProductTransferStockPayload(
    { id: 7, name: 'Move Product' },
    {
      action: 'transfer',
      fromBranchId: '1',
      toBranchId: '2',
      quantity: '5',
    } as unknown as Parameters<typeof buildProductTransferStockPayload>[1],
    {
      reason: 'Bulk branch change',
      user: { id: 11, name: 'Mover' },
    },
  ),
  {
    fromBranchId: 1,
    toBranchId: 2,
    productId: 7,
    productName: 'Move Product',
    quantity: 5,
    note: 'Bulk branch change',
    userId: 11,
    userName: 'Mover',
  },
  'transfer stock payload uses the move plan, product identity, reason, and user attribution',
)

assert.deepEqual(
  buildProductTransferStockPayload(
    { id: 7, name: 'Move Product' },
    {
      fromBranchId: 'bad',
      toBranchId: '',
      quantity: 'bad',
    } as unknown as Parameters<typeof buildProductTransferStockPayload>[1],
    {
      productId: '9',
      productName: 'Override Product',
      user: { id: 12, name: 'Admin' },
    },
  ),
  {
    fromBranchId: 0,
    toBranchId: 0,
    productId: 9,
    productName: 'Override Product',
    quantity: 0,
    note: '',
    userId: 12,
    userName: 'Admin',
  },
  'transfer stock payload normalizes invalid plan values and accepts identity overrides',
)

assert.equal(
  buildProductBranchMovePlan(
    { branch_stock: [{ branch_id: 2, quantity: 5 }] },
    2,
  ),
  null,
  'branch move planning no-ops when stock is already in the target branch',
)

assert.deepEqual(
  buildProductBranchMovePlan(
    { branch_stock: [{ branch_id: 'bad', quantity: 5 }, { branch_id: 1, quantity: 0 }] },
    3,
  ),
  {
    action: 'initialize',
    branchId: 3,
  },
  'branch move planning initializes branch presence when no valid positive stock exists',
)

assert.equal(buildProductBranchMovePlan({}, 'bad'), null)

assert.deepEqual(
  summarizeProductBulkRun({
    successes: [{ item: '1' }, { item: 2 }, { item: 'bad' }],
    failures: [{ item: 3 }, { item: '4' }, { item: null }],
  }),
  {
    done: 2,
    failed: 2,
    failedIds: [3, 4],
    updatedIds: [1, 2],
  },
  'bulk run summaries keep only finite success and failure ids',
)

assert.deepEqual(
  summarizeProductBulkRun({}),
  {
    done: 0,
    failed: 0,
    failedIds: [],
    updatedIds: [],
  },
  'bulk run summaries tolerate missing run arrays',
)

assert.deepEqual(
  buildDefinedProductUpdates({
    category: 'Retail',
    brand: undefined,
    supplier: null,
    unit: '',
  }),
  {
    category: 'Retail',
    supplier: null,
    unit: '',
  },
  'defined product updates remove only undefined fields',
)

assert.deepEqual(
  buildProductBulkUpdatePayload(
    { category: 'Retail', supplier: undefined },
    { updated_at: '2026-05-18T09:00:00.000Z' },
    { id: 7, name: 'Owner' },
    '2026-05-17T09:00:00.000Z',
  ),
  {
    category: 'Retail',
    updated_at: '2026-05-18T09:00:00.000Z',
    expectedUpdatedAt: '2026-05-18T09:00:00.000Z',
    userId: 7,
    userName: 'Owner',
  },
  'bulk update payload prefers the current optimistic-lock timestamp',
)

assert.deepEqual(
  buildProductBulkUpdatePayload(
    { brand: 'Fresh', unit: undefined },
    {},
    { id: 8, name: 'Admin' },
    '2026-05-17T09:00:00.000Z',
  ),
  {
    brand: 'Fresh',
    updated_at: '2026-05-17T09:00:00.000Z',
    expectedUpdatedAt: '2026-05-17T09:00:00.000Z',
    userId: 8,
    userName: 'Admin',
  },
  'bulk update payload falls back to the snapshot timestamp for redo',
)

assert.deepEqual(
  buildProductBulkInfoUpdates({
    category: 'QA',
    unit: '',
    supplier: 'Supplier A',
    brand: undefined,
    low_stock_threshold: '7',
  }),
  {
    category: 'QA',
    supplier: 'Supplier A',
    low_stock_threshold: 7,
  },
  'bulk info updates keep populated fields and parse the stock threshold',
)

assert.deepEqual(
  buildProductBulkInfoUpdates({
    category: '',
    unit: null,
    supplier: '',
    brand: 0,
    low_stock_threshold: 'not-a-number',
  }),
  {},
  'bulk info updates ignore blank fields and unsafe threshold values',
)

assert.deepEqual(
  buildProductBulkPricingUpdates({
    selling_price_usd: '10.111',
    selling_price_khr: '',
    wholesale_price_usd: undefined,
    wholesale_price_khr: '4000.001',
    purchase_price_usd: '3',
    purchase_price_khr: null,
  }),
  {
    selling_price_usd: 10.12,
    wholesale_price_khr: 4000.01,
    purchase_price_usd: 3,
    purchase_price_khr: 0,
  },
  'bulk pricing updates normalize provided price fields and preserve existing null behavior',
)

assert.equal(
  getDefaultProductRestoreBranchId([{ id: 1 }, { id: '2', is_default: true }]),
  2,
  'default restore branch prefers the branch marked as default',
)

assert.equal(
  getDefaultProductRestoreBranchId([{ id: '9' }]),
  9,
  'default restore branch falls back to the first valid branch',
)

assert.equal(getDefaultProductRestoreBranchId([{ id: 'bad', is_default: true }]), 0)

assert.deepEqual(
  [...buildDeletedProductIdSet([{ id: 5 }, { id: '6' }, { id: 0 }, { id: 'bad' }])],
  [5, 6],
  'deleted product id set keeps only positive numeric ids',
)

assert.equal(
  getPreferredProductRestoreBranchId(
    { branch_stock: [{ branch_id: 'bad', quantity: 10 }, { branch_id: '4', quantity: '2' }] },
    3,
  ),
  3,
  'preferred restore branch falls back when the first positive-stock branch id is invalid',
)

assert.equal(
  getPreferredProductRestoreBranchId(
    { branch_stock: [{ branch_id: '4', quantity: '2' }] },
    3,
  ),
  4,
  'preferred restore branch uses a positive-stock branch when it is valid',
)

assert.equal(
  resolveRestoredProductParentId(
    { parent_id: '10' },
    new Set([10]),
    new Map([[10, 99]]),
  ),
  99,
  'restore parent id is remapped when the parent was restored in the same batch',
)

assert.equal(
  resolveRestoredProductParentId(
    { parent_id: '10' },
    new Set([20]),
    new Map([[10, 99]]),
  ),
  10,
  'restore parent id keeps the original parent when it was not deleted in the batch',
)

assert.equal(resolveRestoredProductParentId({ parent_id: 'bad' }), 0)

console.log('productWriteHelpers tests passed')
