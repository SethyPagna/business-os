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
  -- resolving the actor through user_id. Users 8 and 99 have no account row at
  -- all (deleted accounts), so their snapshots must survive untouched.
  --
  -- The session lane's own copy of this fixture gave user 7 the username 'za'
  -- and the snapshot 'Za', which cannot tell the two implementations apart:
  -- resolved and unresolved both read 'Za'-ish. One users row, one account, and
  -- a snapshot that differs from the username is what makes the assertions
  -- below discriminating -- so 'james' is kept and the second id-7 row (a
  -- duplicate primary key the textual merge produced) is dropped.
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
    (4,2,'Lip Oil B',1,'Shop','add',2,8,16,NULL,99,'Deleted Operator','2024-08-15 09:00:00',2),
    (5,2,'Lip Oil B',1,'Shop','add',1,8,8,102,7,'Za','2026-09-01 05:00:00',2),
    (6,2,'Lip Oil B',1,'Shop','remove',1,NULL,NULL,'revert:5',7,'Za','2026-09-01 05:01:00',2),
    (7,1,'Lip Oil A',1,'Shop','stock_in',4,9,36,103,7,'Za','2026-09-02 03:00:00',1),
    (8,2,'Lip Oil B',1,'Shop','stock_in',2,8,16,103,7,'Za','2026-09-02 03:00:01',2),
    -- Free goods: the operator DECLARED a cost, and it was zero. Recorded.
    (9,1,'Lip Oil A',1,'Shop','add',6,0,0,104,7,'Za','2026-09-03 03:00:00',1),
    (10,2,'Lip Oil B',1,'Shop','add',2,8,16,104,7,'Za','2026-09-03 03:00:01',2),
    -- Nobody recorded what this cost. Not recorded, and not free.
    (11,1,'Lip Oil A',1,'Shop','add',6,NULL,NULL,105,7,'Za','2026-09-04 03:00:00',1),
    (12,2,'Lip Oil B',1,'Shop','add',2,8,16,105,7,'Za','2026-09-04 03:00:01',2);
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
assert.doesNotMatch(list.groupedSql, /CAST\(rx\.reference_id AS TEXT\)/, 'revert lookup must preserve the reference_id index')
const groups = db.prepare(`${list.groupedSql} ORDER BY created_at DESC`).bind(list.params).all()
assert.equal(groups.length, 6, 'four explicit sessions (incl. the free-goods and unpriced pair), one legacy-string session and one legacy timestamp group; reverted receipt excluded')
assert.equal(groups.find((row) => row.session_key === 'session:100').line_count, 2)
assert.equal(groups.find((row) => row.session_key === 'session:100').movement_cost_usd, 69)
assert.equal(groups.some((row) => row.session_key === 'session:102'), false)

// Zero cost is a RECORDED value, not a missing one. The two are one column
// apart in the list -- movement_cost_usd is the money, lines_without_movement
// _cost is the 'we never wrote this down' counter that drives the surfaces'
// em-dash -- and a reader that treats `total_cost_usd > 0` as 'recorded'
// answers identically for a free-goods receipt and an unpriced one. Session
// 104 is free goods (declared 0), session 105 is unpriced (NULL): they must
// come back different, and the money must not move either way.
const freeGoodsSession = groups.find((row) => row.session_key === 'session:104')
const unpricedSession = groups.find((row) => row.session_key === 'session:105')
assert.ok(freeGoodsSession && unpricedSession, 'both zero-cost shapes must be listed')
assert.equal(freeGoodsSession.lines_without_movement_cost, 0, 'a declared $0.00 line IS recorded')
assert.equal(unpricedSession.lines_without_movement_cost, 1, 'a NULL-cost line is NOT recorded')
assert.equal(freeGoodsSession.movement_cost_usd, 16, 'a declared zero adds nothing to the money')
assert.equal(unpricedSession.movement_cost_usd, 16, 'an unrecorded cost adds nothing to the money either')
assert.equal(freeGoodsSession.line_count, 2)
assert.equal(unpricedSession.line_count, 2)

const legacyStringSession = groups.find((row) => row.session_key === 'session:103')
assert.ok(legacyStringSession, 'a session written with the legacy stock_in movement type must still appear in the list')
assert.equal(legacyStringSession.line_count, 2)
assert.equal(legacyStringSession.quantity, 6)
assert.equal(legacyStringSession.movement_cost_usd, 52)

// The actor column is the account USERNAME resolved from the id, not the
// display-name snapshot the movement row carries. The session lane asserted
// that here against a fixture where the account was 'za' and the snapshot
// 'Za'; on the merged fixture (account 'james', snapshot 'ung sethy pagna')
// the same rule is asserted below in the N13 block, exactly and by key set,
// so this line would only have restated it against weaker data. What is NOT
// restated below is the fallback for a row whose account row is gone, so that
// keeps its own assertion here.
const orphanActor = groups.find((row) => String(row.session_key).startsWith('legacy:'))
assert.equal(orphanActor.user_name, 'Deleted Operator',
  'a movement whose user row is gone falls back to its snapshot rather than blanking the column')

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
  // Session 103 is the session lane's legacy movement_type='stock_in' pair.
  // Sessions 104/105 are the newer deployed-lineage zero-quantity receipts;
  // all four were written by user 7, so the exact result preserves those
  // sessions while proving the actor search uses the resolved username.
  ['session:100', 'session:103', 'session:104', 'session:105'],
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

// N14 New vs Existing. Movement 1 created its product in the session, movement
// 2 received into a product that already existed, and movement 3 came from a
// path that leaves no member row at all. Before the line query read
// stock_session_members these three were indistinguishable.
db.exec(`
  INSERT INTO stock_session_operations (id,actor_id,request_id,mode,request_json) VALUES
    ('op-100',7,'req-100','stock_in','{}');
  INSERT INTO stock_session_members (operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,movement_id,quantity,unit_cost_usd) VALUES
    ('op-100','line-1','create_receive',1,1,1,1,1,5,9),
    ('op-100','line-2','receive',2,0,1,2,2,3,8);
`)
const taggedLines = db.prepare(kernel.stockInSessionLinesSql(locator)).bind(kernel.stockInSessionLineParams(locator)).all()
assert.equal(taggedLines.find((row) => row.id === 1).created_product, 1, 'a line that created its product reads back as new')
assert.equal(taggedLines.find((row) => row.id === 1).session_command_kind, 'create_receive')
assert.equal(taggedLines.find((row) => row.id === 2).created_product, 0, 'a line that received into an existing product reads back as existing')
assert.equal(taggedLines.find((row) => row.id === 2).session_command_kind, 'receive')

const untaggedLocator = kernel.parseStockInSessionKey('session:101')
const untaggedLines = db.prepare(kernel.stockInSessionLinesSql(untaggedLocator)).bind(kernel.stockInSessionLineParams(untaggedLocator)).all()
assert.equal(untaggedLines.length, 1)
assert.equal(untaggedLines[0].created_product, null,
  'a receipt with no session member row reports "not recorded", never a guessed Existing')

const legacyLocator = kernel.parseStockInSessionKey('session:103')
const legacyLines = db.prepare(kernel.stockInSessionLinesSql(legacyLocator)).bind(kernel.stockInSessionLineParams(legacyLocator)).all()
assert.equal(legacyLines.length, 2, 'opening a legacy stock_in session must return its lines, not an empty receipt')
assert.equal(legacyLines[0].movement_type, 'stock_in')
assert.equal(legacyLines[0].quantity, 4)

console.log('PASS stock-in sessions group/paginate full history, preserve linked fields/costs, exclude reverts, and expose shared-lot collisions')
