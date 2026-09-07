// Focused migration and accounting lock for adding delivery to a recorded sale.
//
// Run from cloudflare/: node scripts/test-sale-delivery-added-migration-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request]
    : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const salesStatus = compile('salesStatus.ts')
const productBatches = compile('productBatches.ts', {
  './db': {},
  './batchCode': compile('batchCode.ts'),
  './sqlBinding': compile('sqlBinding.ts'),
})
const saleTransitions = compile('saleTransitions.ts', {
  './salesStatus': salesStatus,
  './productBatches': productBatches,
})
const saleTotals = compile('saleTotals.ts')
const financialPrecision = compile('financialPrecision.ts')
const saleLineAddition = compile('saleLineAddition.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './financialPrecision': financialPrecision,
})
const saleAmendments = compile('saleAmendments.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './financialPrecision': financialPrecision,
  './saleLineAddition': saleLineAddition,
})
const businessDateWindow = compile('businessDateWindow.ts')
const analytics = compile('salesAnalytics.ts', {
  './db': {},
  '../index': {},
  './businessDateWindow': businessDateWindow,
})

const migration = (name) => fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8')
const MIGRATION_0115 = migration('0115_sale_amendments.sql')
const MIGRATION_0129 = migration('0129_sale_actual_delivery_cost_amendment.sql')
const MIGRATION_0133 = migration('0133_sale_delivery_added_amendment.sql')

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sale_write_revisions (
    sale_id INTEGER PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    sale_status TEXT,
    subtotal_usd REAL,
    subtotal_khr REAL,
    discount_usd REAL,
    membership_discount_usd REAL,
    tax_usd REAL,
    is_delivery INTEGER,
    delivery_contact_id INTEGER,
    delivery_contact_name TEXT,
    delivery_contact_phone TEXT,
    delivery_contact_address TEXT,
    delivery_fee_usd REAL,
    delivery_fee_khr REAL,
    delivery_fee_paid_by TEXT,
    delivery_actual_cost_usd REAL,
    delivery_actual_cost_khr REAL,
    exchange_rate REAL,
    total_usd REAL,
    total_khr REAL,
    amount_paid_usd REAL,
    amount_paid_khr REAL,
    change_usd REAL,
    change_khr REAL,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE fees (id INTEGER PRIMARY KEY, sale_id INTEGER, fee_type TEXT);
`)
sqlite.exec(MIGRATION_0115)
sqlite.exec(MIGRATION_0129)

const priorKinds = [
  'line_added',
  'line_quantity_increased',
  'line_quantity_decreased',
  'line_removed',
  'delivery_fee_changed',
  'delivery_actual_cost_changed',
]
const insertPrior = sqlite.prepare(`
  INSERT INTO sale_amendments (
    id, sale_id, group_id, kind, sale_item_id, product_id, product_name,
    quantity_before, quantity_after, quantity_delta,
    amount_before_usd, amount_after_usd, amount_delta_usd,
    total_before_usd, total_after_usd, units_moved, stock_skipped, via,
    reverses_amendment_id, undo_action_id, note, user_id, user_name, created_at
  ) VALUES (
    @id, @sale_id, @group_id, @kind, @sale_item_id, @product_id, @product_name,
    @quantity_before, @quantity_after, @quantity_delta,
    @amount_before_usd, @amount_after_usd, @amount_delta_usd,
    @total_before_usd, @total_after_usd, @units_moved, @stock_skipped, @via,
    @reverses_amendment_id, @undo_action_id, @note, @user_id, @user_name, @created_at
  )
`)

priorKinds.forEach((kind, index) => {
  const n = index + 1
  insertPrior.run({
    id: n * 10,
    sale_id: 77,
    group_id: `group-${n}`,
    kind,
    sale_item_id: 100 + n,
    product_id: 200 + n,
    product_name: `Product ${n}`,
    quantity_before: n + 0.1,
    quantity_after: n + 0.2,
    quantity_delta: 0.1,
    amount_before_usd: n + 0.3,
    amount_after_usd: n + 0.4,
    amount_delta_usd: 0.1,
    total_before_usd: 20 + n,
    total_after_usd: 21 + n,
    units_moved: n + 0.5,
    stock_skipped: n % 2,
    via: n % 3 === 0 ? 'redo' : n % 2 === 0 ? 'undo' : 'amend',
    reverses_amendment_id: 300 + n,
    undo_action_id: 400 + n,
    note: `full row ${n}`,
    user_id: 500 + n,
    user_name: `Actor ${n}`,
    created_at: `2026-09-0${n} 01:02:03`,
  })
})

const priorColumns = sqlite.prepare('PRAGMA table_info(sale_amendments)').all().map((row) => row.name)
const priorRows = sqlite.prepare('SELECT * FROM sale_amendments ORDER BY id').all()
const priorObjects = sqlite.prepare(`
  SELECT type, name, sql FROM sqlite_master
  WHERE tbl_name = 'sale_amendments' AND type IN ('index', 'trigger') AND sql IS NOT NULL
  ORDER BY type, name
`).all()
const priorSequence = sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='sale_amendments'").get().seq
const priorRevision = sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision

assert.equal(priorRows.length, priorKinds.length)
assert.deepEqual(priorRows.map((row) => row.kind), priorKinds)
assert.equal(priorSequence, 60)
assert.equal(priorRevision, priorKinds.length)

sqlite.exec(MIGRATION_0133)

const migratedRows = sqlite.prepare(`SELECT ${priorColumns.map((name) => `"${name}"`).join(', ')} FROM sale_amendments ORDER BY id`).all()
const migratedObjects = sqlite.prepare(`
  SELECT type, name, sql FROM sqlite_master
  WHERE tbl_name = 'sale_amendments' AND type IN ('index', 'trigger') AND sql IS NOT NULL
  ORDER BY type, name
`).all()
const migratedSequence = sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='sale_amendments'").get().seq

assert.deepEqual(migratedRows, priorRows, '0133 must preserve every value in every prior ledger row')
assert.deepEqual(
  sqlite.prepare('SELECT before_json, after_json FROM sale_amendments ORDER BY id').all(),
  priorKinds.map(() => ({ before_json: null, after_json: null })),
  'new snapshot columns must remain unknown on historical rows',
)
assert.equal(migratedSequence, priorSequence, 'the rebuild must preserve the AUTOINCREMENT high-water mark')
assert.equal(
  sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision,
  priorRevision,
  'the schema rebuild must not manufacture sale revisions',
)
assert.deepEqual(
  migratedObjects.map(({ type, name }) => ({ type, name })),
  priorObjects.map(({ type, name }) => ({ type, name })),
  '0133 must recreate every sale-amendment index and trigger',
)
assert.deepEqual(
  migratedObjects.map((row) => row.name),
  [
    'idx_sale_amendments_sale',
    'idx_sale_amendments_sale_kind',
    'sale_amendments_append_only_delete',
    'sale_amendments_append_only_update',
    'sale_revision_sale_amendments_delete',
    'sale_revision_sale_amendments_insert',
    'sale_revision_sale_amendments_update',
  ],
)

const newEntry = {
  sale_id: 77,
  group_id: 'delivery-77',
  kind: 'delivery_added',
  total_before_usd: 10,
  total_after_usd: 12.5,
  before_json: JSON.stringify({ is_delivery: false, total_usd: 10 }),
  after_json: JSON.stringify({ is_delivery: true, delivery_fee_usd: 2.5, delivery_actual_cost_usd: 4, total_usd: 12.5 }),
  user_id: 9,
  user_name: 'Cashier',
}
const inserted = sqlite.prepare(`
  INSERT INTO sale_amendments (
    sale_id, group_id, kind, total_before_usd, total_after_usd,
    before_json, after_json, user_id, user_name
  ) VALUES (
    @sale_id, @group_id, @kind, @total_before_usd, @total_after_usd,
    @before_json, @after_json, @user_id, @user_name
  )
`).run(newEntry)
assert.equal(inserted.lastInsertRowid, 61)
assert.equal(sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='sale_amendments'").get().seq, 61)
assert.equal(sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision, priorRevision + 1)
assert.deepEqual(
  sqlite.prepare('SELECT kind, before_json, after_json FROM sale_amendments WHERE id=61').get(),
  { kind: 'delivery_added', before_json: newEntry.before_json, after_json: newEntry.after_json },
)

assert.throws(
  () => sqlite.prepare("UPDATE sale_amendments SET note='rewritten' WHERE id=61").run(),
  /append-only/,
)
assert.throws(
  () => sqlite.prepare('DELETE FROM sale_amendments WHERE id=61').run(),
  /immutable|append-only/,
)
assert.equal(sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision, priorRevision + 1)

sqlite.exec('BEGIN')
try {
  sqlite.prepare("INSERT INTO system_flags(key,value) VALUES ('maintenance','{\"mode\":\"restore\"}')").run()
  assert.equal(sqlite.prepare('DELETE FROM sale_amendments WHERE id=61').run().changes, 1)
  assert.equal(
    sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=77').get().revision,
    priorRevision + 1,
    'maintenance restore must not manufacture a revision',
  )
} finally {
  sqlite.exec('ROLLBACK')
}
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sale_amendments WHERE id=61').get().count, 1)

const executeStatements = (statements) => {
  const execute = sqlite.transaction(() => {
    for (const statement of statements) sqlite.prepare(statement.sql).run(statement.params || {})
  })
  execute()
}

function addDeliveryFixture(id, feeUsd, actualCostUsd) {
  const sale = {
    id,
    sale_status: 'completed',
    subtotal_usd: 10,
    subtotal_khr: 40000,
    discount_usd: 0,
    membership_discount_usd: 0,
    tax_usd: 0,
    is_delivery: 0,
    delivery_contact_id: null,
    delivery_contact_name: null,
    delivery_contact_phone: null,
    delivery_contact_address: null,
    delivery_fee_usd: 0,
    delivery_fee_khr: 0,
    delivery_fee_paid_by: 'customer',
    delivery_actual_cost_usd: null,
    delivery_actual_cost_khr: null,
    exchange_rate: 4000,
    total_usd: 10,
    total_khr: 40000,
    amount_paid_usd: 10,
    amount_paid_khr: 0,
    change_usd: 0,
    change_khr: 0,
    created_at: '2026-09-07 02:00:00',
    updated_at: '2026-09-07T02:00:00.000Z',
  }
  sqlite.prepare(`
    INSERT INTO sales (${Object.keys(sale).join(', ')})
    VALUES (${Object.keys(sale).map((key) => `@${key}`).join(', ')})
  `).run(sale)

  const stamp = `2026-09-07T03:00:0${id % 10}.000Z`
  const plan = saleAmendments.planDeliveryAddition({
    saleId: id,
    sale,
    contact: { id: 12, name: 'Driver Dara', phone: '012345678', address: 'Phnom Penh' },
    feeUsd,
    actualCostUsd,
    exchangeRate: 4000,
    stamp,
  })
  const money = saleAmendments.recomputeSaleMoneyAfterAmendment({
    sale,
    subtotalUsd: 10,
    deliveryFeeUsdOverride: feeUsd,
    isDeliveryOverride: true,
    deliveryFeePaidByOverride: 'customer',
    exchangeRateOverride: 4000,
  })
  executeStatements([
    ...plan.statements,
    {
      sql: 'UPDATE sales SET total_usd=@total_usd,total_khr=@total_khr,updated_at=@stamp WHERE id=@id',
      params: { id, total_usd: money.totalUsd, total_khr: money.totalKhr, stamp },
    },
  ])
  return { money, plan }
}

const charged = addDeliveryFixture(88, 2.5, 4)
assert.equal(charged.money.totalUsd, 12.5, 'the customer delivery fee enters the sale total once')
assert.equal(charged.money.totalKhr, 50000)
assert.deepEqual(
  sqlite.prepare(`
    SELECT is_delivery, delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by,
           delivery_actual_cost_usd, delivery_actual_cost_khr, total_usd, total_khr
    FROM sales WHERE id=88
  `).get(),
  {
    is_delivery: 1,
    delivery_fee_usd: 2.5,
    delivery_fee_khr: 10000,
    delivery_fee_paid_by: 'customer',
    delivery_actual_cost_usd: 4,
    delivery_actual_cost_khr: 16000,
    total_usd: 12.5,
    total_khr: 50000,
  },
)

const subsidy = addDeliveryFixture(89, 0, 4)
assert.equal(subsidy.money.totalUsd, 10, 'actual courier cost must not change the customer total')
assert.equal(subsidy.money.totalKhr, 40000)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM fees WHERE sale_id IN (88,89)').get().count, 0)

const contribution = sqlite.prepare(`
  SELECT ${analytics.customerDeliveryFeeExpr('sales.')} AS customer_fee_usd,
         ${analytics.deliveryActualCostExpr('sales.')} AS actual_cost_usd
  FROM sales WHERE id=89
`).get()
assert.deepEqual(contribution, { customer_fee_usd: 0, actual_cost_usd: 4 })

const totals = analytics.deriveTotals({
  tx_count: 1,
  gross_sales_usd: 10,
  store_discount_usd: 0,
  membership_discount_usd: 0,
  tax_usd: 0,
  delivery_usd: 0,
  store_delivery_usd: 0,
  delivery_actual_cost_usd: 4,
  delivery_actual_cost_count: 1,
  delivery_sale_count: 1,
  recognized_net_usd: 10,
  recognized_tax_usd: 0,
  recognized_delivery_usd: contribution.customer_fee_usd,
  recognized_store_delivery_usd: 0,
  recognized_delivery_cost_usd: contribution.actual_cost_usd,
  collected_net_usd: 10,
  collected_tax_usd: 0,
  collected_delivery_usd: 0,
}, 0, 0, { itemDiscountUsd: 0 })

assert.equal(totals.revenue_usd, 10)
assert.equal(totals.store_delivery_usd, 0)
assert.equal(totals.delivery_net_usd, -4)
assert.equal(totals.profit_usd, 6, 'zero charged and actual cost 4 must reduce profit exactly once')

console.log('sale delivery-added migration/accounting: all cases pass')
