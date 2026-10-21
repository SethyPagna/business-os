// A Worker default of "today" must be the Cambodia business day (UTC+7), never the UTC date: between 00:00 and 07:00
// in Phnom Penh the UTC date still names yesterday. Pins the places that defaulted to `new Date().toISOString()`:
//   - lib/productWrites.ts: the opening lot of a new product (lot_code is the date code of the day it was received)
//   - routes/products.ts:   the default end of the product detail report range
//   (the default received_date of an imported row that carries no date is pinned in test-import-engine-pure.cjs)
//
// The clock is fixed at 17:30 UTC on 20 Oct 2026 = 00:30 on 21 Oct 2026 in Cambodia.
//
// Run: node scripts/test-worker-business-day-defaults-pure.cjs
const assert = require('node:assert/strict')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const RealDate = Date
const NOW = RealDate.UTC(2026, 9, 20, 17, 30, 0)
// `new Date()` and Date.now() both read the frozen clock; the SQLite/Hono harness keeps working on a Date subclass.
const freeze = () => { globalThis.Date = class extends RealDate { constructor(...args) { if (args.length) super(...args); else super(NOW) } static now() { return NOW } } }

;(async () => {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  seedStockFixture(h.raw.db, () => h.raw.db.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, selling_price_usd, stock_quantity, is_active) VALUES (1, 'Existing', '8850000000011', 5, 0, 1);`))
  const { dateToBatchCode } = h.load('lib/batchCode.ts')
  const { businessToday } = h.load('lib/businessDateWindow.ts')
  freeze()
  try {
    assert.equal(new Date(NOW).toISOString().slice(0, 10), '2026-10-20', 'control: the UTC date is still the 20th')
    assert.equal(businessToday(), '2026-10-21', 'control: the Cambodia business day is the 21st')

    const created = await h.request('POST', '/', { name: 'Night Product', selling_price_usd: 4, stock_quantity: 3, barcode: '8850000000099' })
    assert.equal(created.status, 200, JSON.stringify(created.json))
    const lot = h.raw.prepare("SELECT lot_code FROM product_batches WHERE variant_product_id = ? AND batch_key LIKE 'initial:%'").get([created.json.id])
    assert.equal(lot.lot_code, dateToBatchCode('2026-10-21'), 'the opening lot carries the business day, not the UTC day')

    const report = await h.request('GET', '/1/detail-report')
    assert.equal(report.status, 200, JSON.stringify(report.json))
    assert.equal(report.json.range.endDate, '2026-10-21', 'the default report range ends on the business day')
  } finally {
    globalThis.Date = RealDate
  }
  console.log('test-worker-business-day-defaults-pure.cjs: 2 defaults use the Cambodia business day')
})().catch((error) => { globalThis.Date = RealDate; console.error(error); process.exitCode = 1 })
