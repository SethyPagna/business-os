const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-in-sessions-'))
fs.copyFileSync(path.join(root, 'src', 'lib', 'stockInSessionsQuery.ts'), path.join(tmp, 'stockInSessionsQuery.ts'))
const version = execSync('npx tsc --version', { cwd: root, encoding: 'utf8' }).trim()
const ignore = /^Version\s+(?:[6-9]|\d{2,})\./.test(version) ? ' --ignoreConfig' : ''
execSync(`npx tsc "${path.join(tmp, 'stockInSessionsQuery.ts')}" --outDir "${tmp}" --module commonjs --target es2022 --strict --skipLibCheck${ignore}`, { cwd: root })
const kernel = require(path.join(tmp, 'stockInSessionsQuery.js'))
const db = openDb(loadAll())

db.exec(`
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1);
  INSERT INTO suppliers (id,name) VALUES (1,'Bong Long');
  INSERT INTO products (id,name,barcode,unit,brand,category,tag_label,image_path,selling_price_usd,purchase_price_usd,is_active) VALUES
    (1,'Lip Oil A','1001','pcs','Colourpop','Lip','new','/uploads/lip-a.webp',14,9,1),
    (2,'Lip Oil B','1002','pcs','Colourpop','Lip','new','/uploads/lip-b.webp',13,8,1);
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,credit_due_date,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (1,1,'260901','260901','2026-09-01',1,1,'Bong Long','credit','2026-09-15',9,45,'2026-09-01 10:00:00'),
    (2,2,'260901','260901','2026-09-01',1,1,'Bong Long','credit','2026-09-15',8,24,'2026-09-01 10:00:00');
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
    (1,1,'Lip Oil A',1,'Shop','add',5,9,45,100,7,'Za','2026-09-01 03:00:00',1),
    (2,2,'Lip Oil B',1,'Shop','add',3,8,24,100,7,'Za','2026-09-01 03:00:01',2),
    (3,1,'Lip Oil A',1,'Shop','add',1,10,10,101,7,'Za','2026-09-01 04:00:00',1),
    (4,2,'Lip Oil B',1,'Shop','add',2,8,16,NULL,NULL,NULL,'2024-08-15 09:00:00',2),
    (5,2,'Lip Oil B',1,'Shop','add',1,8,8,102,7,'Za','2026-09-01 05:00:00',2),
    (6,2,'Lip Oil B',1,'Shop','remove',1,NULL,NULL,'revert:5',7,'Za','2026-09-01 05:01:00',2),
    (7,1,'Lip Oil A',1,'Shop','stock_in',4,9,36,103,7,'Za','2026-09-02 03:00:00',1),
    (8,2,'Lip Oil B',1,'Shop','stock_in',2,8,16,103,7,'Za','2026-09-02 03:00:01',2);
`)

// The unified "Add products" session (POST /api/inventory/sessions, migration
// 0124) wrote its movement rows as movement_type='stock_in' -- its session
// mode leaked into the ledger's type column, where every other receipt writer
// (POST /adjust, POST /batches) writes 'add'. The writer now emits the
// canonical 'add', but rows already committed under the old string must stay
// visible, so both readers below accept either. Rows 7/8 above are exactly
// those legacy rows: without the widened filter this group does not exist and
// its lines come back empty.
assert.ok(
  Array.isArray(kernel.STOCK_RECEIPT_MOVEMENT_TYPES) && kernel.STOCK_RECEIPT_MOVEMENT_TYPES.includes('add') && kernel.STOCK_RECEIPT_MOVEMENT_TYPES.includes('stock_in'),
  'the receipt-type vocabulary must name both the canonical and the legacy session string',
)

const list = kernel.buildStockInSessionListQuery('')
assert.doesNotMatch(kernel.STOCK_IN_SESSION_FROM_SQL, /CAST\(rx\.reference_id AS TEXT\)/, 'revert lookup must preserve the reference_id index')
const groups = db.prepare(`${list.groupedSql} ORDER BY created_at DESC`).bind(list.params).all()
assert.equal(groups.length, 4, 'two explicit sessions, one legacy-string session and one legacy timestamp group; reverted receipt excluded')
assert.equal(groups.find((row) => row.session_key === 'session:100').line_count, 2)
assert.equal(groups.find((row) => row.session_key === 'session:100').movement_cost_usd, 69)
assert.equal(groups.some((row) => row.session_key === 'session:102'), false)

const legacyStringSession = groups.find((row) => row.session_key === 'session:103')
assert.ok(legacyStringSession, 'a session written with the legacy stock_in movement type must still appear in the list')
assert.equal(legacyStringSession.line_count, 2)
assert.equal(legacyStringSession.quantity, 6)
assert.equal(legacyStringSession.movement_cost_usd, 52)

const search = kernel.buildStockInSessionListQuery('1002')
const searched = db.prepare(search.groupedSql).bind(search.params).all()
assert.ok(searched.length >= 1, 'barcode search reaches linked current product data')

const locator = kernel.parseStockInSessionKey('session:100')
assert.deepEqual(locator, { kind: 'reference', referenceId: '100' })
const lines = db.prepare(kernel.stockInSessionLinesSql(locator)).bind(kernel.stockInSessionLineParams(locator)).all()
assert.equal(lines.length, 2)
assert.equal(lines[0].brand, 'Colourpop')
assert.equal(lines[0].batch_payment_status, 'credit')
assert.equal(lines[0].image_path, '/uploads/lip-a.webp')
assert.equal(lines[0].selling_price_usd, 14)
assert.equal(lines[0].purchase_price_usd, 9)
assert.equal(kernel.parseStockInSessionKey('legacy:2026-09-01 06:02:02:1:2:23').createdAt, '2026-09-01 06:02:02')

const legacyLocator = kernel.parseStockInSessionKey('session:103')
const legacyLines = db.prepare(kernel.stockInSessionLinesSql(legacyLocator)).bind(kernel.stockInSessionLineParams(legacyLocator)).all()
assert.equal(legacyLines.length, 2, 'opening a legacy stock_in session must return its lines, not an empty receipt')
assert.equal(legacyLines[0].movement_type, 'stock_in')
assert.equal(legacyLines[0].quantity, 4)

console.log('PASS stock-in sessions group/paginate full history, preserve linked fields/costs, exclude reverts, and expose shared-lot collisions')
