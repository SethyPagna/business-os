const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const schema = fs.readFileSync(path.join(__dirname, '../src/db/postgresSchema.sql'), 'utf8')
const pgRuntime = fs.readFileSync(path.join(__dirname, '../src/postgresDatabase.ts'), 'utf8')
const inventory = fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8')

runTest('RFID schema extends products and branch stock without replacing barcode stock', () => {
  assert.match(schema, /rfid_confirmed_qty/)
  assert.match(schema, /CREATE TABLE public\.rfid_tags/)
  assert.match(schema, /CREATE TABLE public\.rfid_scan_sessions/)
  assert.match(schema, /CREATE TABLE public\.rfid_events/)
  assert.match(schema, /CREATE TABLE public\.rfid_session_items/)
  assert.match(schema, /CREATE UNIQUE INDEX idx_rfid_events_dedupe_key_unique/)
  assert.match(pgRuntime, /ALTER TABLE products ADD COLUMN IF NOT EXISTS rfid_confirmed_qty/)
  assert.match(pgRuntime, /ALTER TABLE branch_stock ADD COLUMN IF NOT EXISTS rfid_confirmed_qty/)
  assert.match(pgRuntime, /idx_rfid_events_dedupe_key_unique/)
})

runTest('RFID routes enforce branch-locked review before master stock apply', () => {
  assert.match(inventory, /router\.get\('\/rfid\/status'/)
  assert.match(inventory, /router\.post\('\/rfid\/tags'/)
  assert.match(inventory, /router\.post\('\/rfid\/sessions'[\s\S]*branchId/)
  assert.match(inventory, /router\.post\('\/rfid\/sessions\/:id\/events'[\s\S]*wrong_location/)
  assert.match(inventory, /ON CONFLICT \(dedupe_key\)[\s\S]*DO NOTHING/)
  assert.match(inventory, /router\.get\('\/rfid\/sessions\/:id\/review'/)
  assert.match(inventory, /router\.post\('\/rfid\/sessions\/:id\/apply'[\s\S]*Branch mismatch/)
  assert.match(inventory, /movement_type[\s\S]*rfid/)
  assert.match(inventory, /audit\(actor\.userId, actor\.userName, 'rfid_stock_apply'/)
})

runTest('RFID apply reuses prepared statements outside the product loop', () => {
  assert.match(inventory, /const branch = db\.prepare\('SELECT id, name FROM branches WHERE id = \?'\)\.get\(branchId\)/)
  assert.match(inventory, /const productById = db\.prepare\('SELECT id, name, purchase_price_usd, purchase_price_khr FROM products WHERE id = \?'\)/)
  assert.match(inventory, /const insertRfidMovement = db\.prepare\(`[\s\S]*INSERT INTO inventory_movements/)
  assert.match(inventory, /const markRfidSessionApplied = db\.prepare\("UPDATE rfid_scan_sessions SET status = 'applied'/)
  assert.match(inventory, /insertRfidMovement\.run\([\s\S]*branch\.name \|\| ''/)
  assert.match(inventory, /markRfidSessionApplied\.run\(sessionId\)/)
  assert.doesNotMatch(inventory, /db\.prepare\('SELECT name FROM branches WHERE id = \?'\)\.get\(branchId\)\?\.name/)
})

if (failed > 0) {
  process.exitCode = 1
}
