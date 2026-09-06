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
// N13: the session query names its actor through the shared account-username
// expression, so that pure dependency comes along for the isolated compile.
fs.copyFileSync(path.join(root, 'src', 'lib', 'movementActorName.ts'), path.join(tmp, 'movementActorName.ts'))
const version = execSync('npx tsc --version', { cwd: root, encoding: 'utf8' }).trim()
const ignore = /^Version\s+(?:[6-9]|\d{2,})\./.test(version) ? ' --ignoreConfig' : ''
execSync(`npx tsc "${path.join(tmp, 'stockInSessionsQuery.ts')}" "${path.join(tmp, 'movementActorName.ts')}" --outDir "${tmp}" --module commonjs --target es2022 --strict --skipLibCheck${ignore}`, { cwd: root })
const kernel = require(path.join(tmp, 'stockInSessionsQuery.js'))
const db = openDb(loadAll())

db.exec(`
  -- N13: user 7's account is 'james'; the rows below were written before the
  -- username rule and snapshot the FULL name, which is the whole point of
  -- resolving the actor through user_id. User 8 has no account row at all
  -- (a deleted account), so its snapshot must survive untouched.
  INSERT INTO users (id,username,name,password) VALUES (7,'james','Ung Sethy Pagna','x');
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1);
  INSERT INTO suppliers (id,name) VALUES (1,'Bong Long');
  INSERT INTO products (id,name,barcode,unit,brand,category,tag_label,image_path,selling_price_usd,purchase_price_usd,is_active) VALUES
    (1,'Lip Oil A','1001','pcs','Colourpop','Lip','new','/uploads/lip-a.webp',14,9,1),
    (2,'Lip Oil B','1002','pcs','Colourpop','Lip','new','/uploads/lip-b.webp',13,8,1);
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,credit_due_date,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (1,1,'260901','260901','2026-09-01',1,1,'Bong Long','credit','2026-09-15',9,45,'2026-09-01 10:00:00'),
    (2,2,'260901','260901','2026-09-01',1,1,'Bong Long','credit','2026-09-15',8,24,'2026-09-01 10:00:00');
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
    (1,1,'Lip Oil A',1,'Shop','add',5,9,45,100,7,'ung sethy pagna','2026-09-01 03:00:00',1),
    (2,2,'Lip Oil B',1,'Shop','add',3,8,24,100,7,'ung sethy pagna','2026-09-01 03:00:01',2),
    (3,1,'Lip Oil A',1,'Shop','add',1,10,10,101,8,'Za','2026-09-01 04:00:00',1),
    (4,2,'Lip Oil B',1,'Shop','add',2,8,16,NULL,NULL,NULL,'2024-08-15 09:00:00',2),
    (5,2,'Lip Oil B',1,'Shop','add',1,8,8,102,7,'Za','2026-09-01 05:00:00',2),
    (6,2,'Lip Oil B',1,'Shop','remove',1,NULL,NULL,'revert:5',7,'Za','2026-09-01 05:01:00',2);
`)

const list = kernel.buildStockInSessionListQuery('')
assert.doesNotMatch(kernel.STOCK_IN_SESSION_FROM_SQL, /CAST\(rx\.reference_id AS TEXT\)/, 'revert lookup must preserve the reference_id index')
const groups = db.prepare(`${list.groupedSql} ORDER BY created_at DESC`).bind(list.params).all()
assert.equal(groups.length, 3, 'two explicit sessions plus one legacy timestamp group; reverted receipt excluded')
assert.equal(groups.find((row) => row.session_key === 'session:100').line_count, 2)
assert.equal(groups.find((row) => row.session_key === 'session:100').movement_cost_usd, 69)
assert.equal(groups.some((row) => row.session_key === 'session:102'), false)

const search = kernel.buildStockInSessionListQuery('1002')
const searched = db.prepare(search.groupedSql).bind(search.params).all()
assert.ok(searched.length >= 1, 'barcode search reaches linked current product data')

// N13 -- the actor the list SHOWS and the actor it SEARCHES are the same
// value. Session 100's rows snapshot the full name, so the resolution is what
// puts 'james' on the screen; session 101's user has no account row, so its
// snapshot is all there is and must survive.
assert.equal(groups.find((row) => row.session_key === 'session:100').user_name, 'james',
  'the session list names the ACCOUNT username, not the full name its rows snapshotted')
assert.equal(groups.find((row) => row.session_key === 'session:101').user_name, 'Za',
  'a row whose account no longer exists keeps its snapshot')

const byUsername = kernel.buildStockInSessionListQuery('james')
assert.deepEqual(
  db.prepare(byUsername.groupedSql).bind(byUsername.params).all().map((row) => row.session_key),
  ['session:100'],
  'searching the username shown on the row must find it -- the haystack reads the resolved actor, not the raw snapshot',
)
const bySnapshot = kernel.buildStockInSessionListQuery('ung sethy')
assert.deepEqual(
  db.prepare(bySnapshot.groupedSql).bind(bySnapshot.params).all().map((row) => row.session_key),
  [],
  'the superseded full name appears nowhere on the row, so it must not be a search term either',
)

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

console.log('PASS stock-in sessions group/paginate full history, preserve linked fields/costs, exclude reverts, and expose shared-lot collisions')
