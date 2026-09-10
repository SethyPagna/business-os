const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

function compileLib(name, localRequire) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

let actorSnapshot
const localRequire = (request) => {
  if (request === './actorSnapshot') return actorSnapshot
  return require(request)
}
actorSnapshot = compileLib('actorSnapshot', localRequire)
const subject = compileLib('saleCreationSnapshot', localRequire)

const sourceRoot = path.join(__dirname, '..', 'src')
const source = (file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8')
const actor = { id: 71, username: 'creator', name: 'Creator Full Name' }
const validInput = {
  origin: 'pos',
  recordedAt: '2026-09-07T10:11:12.000Z',
  saleAt: '2026-09-07T10:10:00.000Z',
  receiptNumber: '20260907-181000',
  actor,
  cashierId: 19,
  cashierName: 'source-cashier',
  saleStatus: 'completed',
  items: [{
    product_id: 8,
    product_name: 'Original Serum',
    sku: 'SER-8',
    quantity: 2,
    applied_price_usd: 5,
    total_usd: 10,
    cost_price_usd: 999,
  }],
  totalUsd: 12,
  paymentMethod: 'Split',
  paymentDetails: [
    { method: 'Cash', amount_usd: 5, amount_khr: 0, secret: 'drop' },
    { method: 'ABA', amount_usd: 7, amount_khr: 0 },
    'invalid',
  ],
  amountPaidUsd: 12,
  amountPaidKhr: 0,
  changeUsd: 0,
  changeKhr: 0,
  isDelivery: 1,
  deliveryContactName: 'Driver One',
  deliveryContactPhone: '012345678',
  deliveryFeeUsd: 2,
  deliveryActualCostUsd: 1.5,
  customerSnapshot: { id: 42, name: 'Customer At Sale' },
  membershipSnapshot: { number: 'MEM-42', discountUsd: 1, discountKhr: 0, pointsRedeemed: 25 },
}

const serialized = subject.buildSaleCreationSnapshot(validInput)
const snapshot = subject.parseSaleCreationSnapshot(serialized)
assert.equal(snapshot.version, 1)
assert.equal(snapshot.origin, 'pos')
assert.deepEqual(snapshot.actor, { id: 71, username: 'creator' })
assert.deepEqual(snapshot.cashier, { id: 19, username: 'source-cashier' })
assert.deepEqual(snapshot.products, [{
  product_id: 8,
  product: 'Original Serum',
  sku: 'SER-8',
  quantity: 2,
  unit_price_usd: 5,
  line_total_usd: 10,
}])
assert.deepEqual(snapshot.payment_details, [
  { method: 'Cash', amount_usd: 5, amount_khr: 0 },
  { method: 'ABA', amount_usd: 7, amount_khr: 0 },
])
assert.deepEqual(snapshot.delivery, {
  is_delivery: true,
  driver_name: 'Driver One',
  driver_phone: '012345678',
  delivery_fee_usd: 2,
  delivery_actual_cost_usd: 1.5,
})
assert.deepEqual(snapshot.customer, {
  id: 42,
  name: 'Customer At Sale',
})
assert.deepEqual(snapshot.membership, {
  number: 'MEM-42',
  discount_usd: 1,
  discount_khr: 0,
  points_redeemed: 25,
})
const generalSnapshot = JSON.parse(subject.buildSaleCreationSnapshot({
  ...validInput,
  customerSnapshot: null,
  membershipSnapshot: null,
}))
assert.equal(generalSnapshot.customer, null, 'explicit General must remain known anonymous')
assert.equal(generalSnapshot.membership, null, 'explicit no membership must remain known none')
const historicalV1Snapshot = JSON.parse(subject.buildSaleCreationSnapshot({
  ...validInput,
  customerSnapshot: undefined,
  membershipSnapshot: undefined,
}))
assert.ok(!Object.hasOwn(historicalV1Snapshot, 'customer'), 'omitted legacy evidence must remain unknown')
assert.ok(!Object.hasOwn(historicalV1Snapshot, 'membership'), 'omitted legacy evidence must remain unknown')
assert.ok(!serialized.includes('cost_price'), 'snapshot must not retain cost or unrelated source fields')
assert.ok(!serialized.includes('Creator Full Name'), 'actor snapshots use the authenticated username')
assert.equal(subject.parseSaleCreationSnapshot('{bad'), null)
assert.equal(subject.parseSaleCreationSnapshot(JSON.stringify({ ...snapshot, version: 2 })), null)
assert.equal(subject.parseSaleCreationSnapshot(JSON.stringify({ ...snapshot, origin: 'future' })), null)
assert.equal(subject.parseSaleCreationSnapshot(JSON.stringify({ ...snapshot, products: [null] })), null)
assert.throws(
  () => subject.buildSaleCreationSnapshot({ ...validInput, items: [] }),
  /at least one product line/,
)
assert.throws(
  () => subject.buildSaleCreationSnapshot({ ...validInput, origin: 'future' }),
  /origin is invalid/,
)
assert.throws(
  () => subject.buildSaleCreationSnapshot({ ...validInput, saleAt: 'not-a-date' }),
  /sale_at is invalid/,
)
assert.equal(
  JSON.parse(subject.buildSaleCreationSnapshot({ ...validInput, isDelivery: '0' })).delivery.is_delivery,
  false,
  'string zero must not become a delivery sale',
)
assert.throws(
  () => subject.buildSaleCreationSnapshot({
    ...validInput,
    items: Array.from({ length: subject.MAX_SALE_CREATION_SNAPSHOT_LINES + 1 }, () => validInput.items[0]),
  }),
  /line creation-history limit/,
)
assert.throws(
  () => subject.buildSaleCreationSnapshot({ ...validInput, receiptNumber: 'x'.repeat(subject.MAX_SALE_CREATION_SNAPSHOT_BYTES) }),
  /storage safety limit/,
)

const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
const legacy = sqlite.prepare("INSERT INTO sales (receipt_number) VALUES ('LEGACY')").run()
assert.equal(sqlite.prepare('SELECT creation_snapshot_json FROM sales WHERE id = ?').get(legacy.lastInsertRowid).creation_snapshot_json, null)
assert.throws(
  () => sqlite.prepare("INSERT INTO sales (receipt_number, creation_snapshot_json) VALUES ('BAD', '{bad')").run(),
  /CHECK constraint/,
)
const future = sqlite.prepare("INSERT INTO sales (receipt_number, creation_snapshot_json) VALUES ('FUTURE', ?)").run(serialized)
assert.equal(
  sqlite.prepare('SELECT creation_snapshot_json FROM sales WHERE id = ?').get(future.lastInsertRowid).creation_snapshot_json,
  serialized,
)
assert.throws(
  () => sqlite.prepare('UPDATE sales SET creation_snapshot_json = ? WHERE id = ?').run(
    subject.buildSaleCreationSnapshot({ ...validInput, receiptNumber: 'CHANGED' }),
    future.lastInsertRowid,
  ),
  /sale creation snapshot is immutable/,
)
assert.throws(
  () => sqlite.prepare('UPDATE sales SET creation_snapshot_json = ? WHERE id = ?').run(serialized, legacy.lastInsertRowid),
  /sale creation snapshot is immutable/,
)
sqlite.prepare('UPDATE sales SET receipt_number = ? WHERE id = ?').run('CURRENT-MUTABLE', future.lastInsertRowid)
assert.equal(sqlite.prepare('SELECT creation_snapshot_json FROM sales WHERE id = ?').get(future.lastInsertRowid).creation_snapshot_json, serialized)
sqlite.prepare('DELETE FROM sales WHERE id = ?').run(future.lastInsertRowid)
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sales WHERE id = ?').get(future.lastInsertRowid).n, 0, 'compensation may delete the whole sale')

for (const [file, origin] of [
  ['routes/sales.ts', /origin:\s*clientCreatedAt\s*\?\s*'offline_replay'\s*:\s*'pos'/],
  ['routes/returns.ts', /origin:\s*'return_replacement'/],
  ['lib/salesImportCommit.ts', /origin:\s*'sales_import'/],
  ['lib/stockActionCommit.ts', /origin:\s*'stock_action_import'/],
]) {
  const writer = source(file)
  assert.match(writer, origin, `${file} must identify its creation origin`)
  assert.match(writer, /creation_snapshot_json/, `${file} must persist the envelope in the sale insert`)
  assert.match(writer, /customerSnapshot:/, `${file} must decide captured customer evidence explicitly`)
  assert.match(writer, /membershipSnapshot:/, `${file} must decide captured membership evidence explicitly`)
  if (file === 'routes/sales.ts') {
    assert.match(writer, /search_normalized, items, creation_snapshot_json/, 'POS sale inserts must persist compatibility items JSON')
    assert.match(writer, /items:\s*JSON\.stringify\(priced\.map/, 'POS compatibility items must be built from server-priced lines')
  }
}
assert.match(source('lib/backup.ts'), /export const BACKUP_TABLES = \[[\s\S]*?'sales'/, 'sales snapshot column rides the existing sales backup')

console.log('PASS sale creation snapshots are bounded, versioned, immutable, not backfilled, compensation-safe, and wired into all four sale writers')
