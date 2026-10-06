// Real Hono route regression for manual expense creation with no courier.
// Proves the normal snake_case null reaches the atomic D1-shaped write, exact
// retries replay, changed retries conflict, and malformed non-null ids fail.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  return {
    sourcePath,
    outputText: ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: sourcePath,
    }).outputText,
  }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const raw = new DatabaseSync(':memory:')
raw.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE branches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL,
    role TEXT,
    successor_branch_id INTEGER
  );
  CREATE TABLE sale_bulk_guards (id INTEGER PRIMARY KEY, guard_value INTEGER NOT NULL CHECK(guard_value = 1));
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    branch_id INTEGER,
    receipt_number TEXT
  );
  CREATE TABLE delivery_contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_type TEXT NOT NULL,
    label TEXT,
    amount_usd REAL NOT NULL,
    amount_khr REAL NOT NULL,
    fee_date TEXT NOT NULL,
    sale_id INTEGER,
    branch_id INTEGER,
    branch_name TEXT,
    delivery_contact_id INTEGER,
    notes TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE fee_operation_receipts (
    id TEXT PRIMARY KEY,
    actor_id INTEGER NOT NULL,
    fee_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE(actor_id, request_id)
  );
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    table_name TEXT,
    record_id TEXT,
    new_value TEXT
  );
  INSERT INTO branches(id,name,is_active) VALUES(2,'Shop',1);
  INSERT INTO branches(id,name,is_active) VALUES(3,'Shop',1);
  INSERT INTO sales(id,branch_id,receipt_number) VALUES(11,3,'SALE-11');
  INSERT INTO delivery_contacts(id,name) VALUES(9,'Valid courier');
`)
const db = new D1Compat(raw)
const broadcasts = []
const telegrams = []

const actorSnapshot = loadReal('lib/actorSnapshot.ts')
const feeOperationReceipt = loadReal('lib/feeOperationReceipt.ts')
const route = loadReal('routes/fees.ts', {
  hono: require('hono'),
  '../lib/db': { getDb: () => db },
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', { id: 7, username: 'fee-cashier', name: 'Fee Cashier' })
      return next()
    },
  },
  '../lib/audit': { audit: async () => { throw new Error('POST must use its atomic audit statement') } },
  '../lib/permissions': { getPermissionTier: () => 'full', getActionTier: () => 'full' },
  '../durable-objects/broadcastHub': { broadcast: async (...args) => { broadcasts.push(args) } },
  '../lib/conflictControl': loadReal('lib/conflictControl.ts'),
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../lib/businessDateWindow': { businessToday: () => '2026-09-11' },
  '../lib/telegram': {
    sendTelegramEvent: async (...args) => { telegrams.push(args) },
    telegramMoney: () => '$2.50',
  },
  // The real role helpers: "selling" is a branch ROLE (name only as the pre-0229 fallback), so the cutover
  // scenarios below can rename and retire branches.
  '../lib/branchRoles': loadReal('lib/branchRoles.ts'),
  '../lib/branchEffect': loadReal('lib/branchEffect.ts', { './branchRoles': loadReal('lib/branchRoles.ts'), './sqlBinding': loadReal('lib/sqlBinding.ts') }),
  '../lib/batchCode': { normalizeTypedDate: (value) => String(value || '').slice(0, 10) || null },
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/feeOperationReceipt': feeOperationReceipt,
  '../lib/moneyPrecision': loadReal('lib/moneyPrecision.ts'),
  '../index': {},
}).default

const executionCtx = {
  waitUntil(promise) { return promise },
  passThroughOnException() {},
}

async function create(body) {
  const response = await route.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {}, executionCtx)
  return { status: response.status, body: await response.json() }
}

function counts() {
  return {
    fees: Number(raw.prepare('SELECT COUNT(*) AS n FROM fees').get().n),
    receipts: Number(raw.prepare('SELECT COUNT(*) AS n FROM fee_operation_receipts').get().n),
    audits: Number(raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='create' AND entity='fee'").get().n),
  }
}

async function main() {
  const normalBody = {
    client_request_id: 'fee-null-route-0001',
    fee_type: 'expense',
    label: 'Packing tape',
    amount_usd: 2.5,
    amount_khr: 0,
    fee_date: '2026-09-11',
    sale_id: null,
    branch_id: 2,
    delivery_contact_id: null,
    notes: 'counter',
  }

  const receiptSchema = raw.prepare("SELECT sql FROM sqlite_master WHERE name='fee_operation_receipts'").get().sql
  raw.exec('DROP TABLE fee_operation_receipts')
  const preSchema = await create(normalBody)
  assert.equal(preSchema.status,503)
  assert.equal(preSchema.body.code,'release_upgrade_in_progress')
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM fees').get().n,0)
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
  raw.exec(receiptSchema)
  const partialSchema = await create(normalBody)
  assert.equal(partialSchema.status,503)
  assert.deepEqual(counts(),{fees:0,receipts:0,audits:0})
  // The full production migration chain is independently exercised by the
  // readiness and transfer suites; this focused fee schema needs its sentinel.
  raw.exec('CREATE TRIGGER transfer_receipts_require_provenance_insert BEFORE INSERT ON fee_operation_receipts BEGIN SELECT 1; END')
  const originalPrepare = db.prepare
  db.prepare = function(sql) { if(sql.includes('sqlite_master')) throw new Error('lookup unavailable'); return originalPrepare.call(this,sql) }
  const lookupFailure = await create(normalBody)
  assert.equal(lookupFailure.status,503)
  assert.equal(lookupFailure.body.code,'release_upgrade_in_progress')
  db.prepare = originalPrepare
  assert.deepEqual(counts(),{fees:0,receipts:0,audits:0})
  const created = await create(normalBody)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.fee.delivery_contact_id, null)
  assert.deepEqual(counts(), { fees: 1, receipts: 1, audits: 1 })

  // CUTOVER-LD: a fee carries the branch name it was recorded under; retiring/renaming the branch later (Shop ->
  // "Old Shop") must not relabel it. The live directory name is only the fallback for a blank snapshot.
  assert.equal(raw.prepare('SELECT branch_name FROM fees').get().branch_name, 'Shop')
  raw.exec("UPDATE branches SET name='Old Shop', is_active=0 WHERE id=2")
  const detail = await (await route.request(`/${created.body.fee.id}`, {}, {}, executionCtx)).json()
  assert.equal(detail.fee.branch_name, 'Shop', 'a historical fee still says Shop after the rename')
  const listed = await (await route.request('/', {}, {}, executionCtx)).json()
  assert.equal(listed.fees[0].branch_name, 'Shop')
  raw.prepare('UPDATE fees SET branch_name=NULL').run()
  const blank = await (await route.request(`/${created.body.fee.id}`, {}, {}, executionCtx)).json()
  assert.equal(blank.fee.branch_name, 'Old Shop', 'blank snapshot: the live name fills in')
  raw.exec("UPDATE branches SET name='Shop', is_active=1 WHERE id=2")
  raw.prepare("UPDATE fees SET branch_name='Shop'").run()

  const replay = await create(normalBody)
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.deepEqual(replay.body, created.body)
  assert.deepEqual(counts(), { fees: 1, receipts: 1, audits: 1 })

  const changed = await create({ ...normalBody, amount_usd: 3 })
  assert.equal(changed.status, 409, JSON.stringify(changed.body))
  assert.equal(changed.body.code, 'idempotency_conflict')
  assert.deepEqual(counts(), { fees: 1, receipts: 1, audits: 1 })

  for (const [field, value] of [
    ['delivery_contact_id', 'not-an-id'],
    ['deliveryContactId', -4],
    ['deliveryContactId', 404],
  ]) {
    const body = { ...normalBody, client_request_id: `fee-invalid-${field}-${String(value)}` }
    delete body.delivery_contact_id
    body[field] = value
    const invalid = await create(body)
    assert.equal(invalid.status, 400, `${field}=${value}: ${JSON.stringify(invalid.body)}`)
    assert.equal(invalid.body.error, 'Invalid delivery contact')
  }
  assert.deepEqual(counts(), { fees: 1, receipts: 1, audits: 1 })

  const mismatch = await create({
    ...normalBody,
    client_request_id: 'fee-sale-mismatch-0001',
    sale_id: 11,
    branch_id: 2,
  })
  assert.equal(mismatch.status, 400, JSON.stringify(mismatch.body))
  // Role-neutral since the cutover ("same branch": the branches are Old Shop and LC Store then) and coded, so the client
  // restates it from the pack key fee_sale_branch_mismatch.
  assert.match(mismatch.body.error, /same branch/)
  assert.equal(mismatch.body.code, 'fee_sale_branch_mismatch')
  assert.deepEqual(counts(), { fees: 1, receipts: 1, audits: 1 })

  const legacyBody = {
    ...normalBody,
    client_request_id: 'fee-camel-contact-0001',
  }
  delete legacyBody.delivery_contact_id
  legacyBody.deliveryContactId = 9
  const legacyCreated = await create(legacyBody)
  assert.equal(legacyCreated.status, 201, JSON.stringify(legacyCreated.body))
  assert.equal(legacyCreated.body.fee.delivery_contact_id, 9)
  assert.deepEqual(counts(), { fees: 2, receipts: 2, audits: 2 })
  assert.equal(broadcasts.length, 2, 'only the two distinct commits broadcast')
  assert.equal(telegrams.length, 2, 'only the two distinct commits send notifications')

  const v1 = { ...normalBody, fee_money_version: 1, client_request_id: 'fee-money-v1-0001', amount_usd: '1.005', amount_khr: '20.5' }
  const fresh = await create(v1)
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body))
  assert.equal(fresh.body.fee.amount_usd, 1.01)
  assert.equal(fresh.body.fee.amount_khr, 21)
  const once = counts()
  // Lost acknowledgement / double submit returns the same original receipt.
  for (const result of await Promise.all([create(v1), create(v1)])) {
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, fresh.body)
  }
  assert.deepEqual(counts(), once)
  const versionConflict = await create({ ...v1, fee_money_version: undefined, amount_usd: 1.01, amount_khr: 21 })
  assert.equal(versionConflict.status, 409)
  assert.equal(versionConflict.body.code, 'idempotency_conflict')
  assert.deepEqual(counts(), once)
  for (const input of [
    ...['amount_usd', 'amount_khr'].flatMap(field => [null, '', ' ', 'NaN', 'Infinity', true, {}, '-0.000000001', '100000000000.0001'].map(value => ({ [field]: value }))),
    ...[null, 0, 2, '1', false].map(value => ({ fee_money_version: value })),
    { amount_usd: '0.004999', amount_khr: '0.499999' },
  ]) {
    const result = await create({ ...v1, client_request_id: 'fee-money-invalid-0001', ...input })
    assert.equal(result.status, 400, JSON.stringify(input))
    assert.equal(result.body.code, 'invalid_fee_money')
    assert.deepEqual(counts(), once)
  }
  const onlyKhr = { ...v1, client_request_id: 'fee-money-khr-only-0001', amount_usd: undefined, amount_khr: '20.499999' }
  const khr = await create(onlyKhr)
  assert.equal(khr.status, 201)
  assert.equal(khr.body.fee.amount_usd, 0)
  assert.equal(khr.body.fee.amount_khr, 20)
  const old = { ...normalBody, client_request_id: 'fee-legacy-fraction-0001', amount_khr: 20.49 }
  const oldCreated = await create(old)
  assert.equal(oldCreated.status, 201, 'uncommitted old requests retain admission')
  assert.equal(oldCreated.body.fee.amount_khr, 20.49)
  const stored = raw.prepare('SELECT request_json FROM fee_operation_receipts WHERE request_id=?').get(old.client_request_id).request_json
  assert.equal(stored, JSON.stringify({ fee_type: old.fee_type, label: old.label, amount_usd: old.amount_usd,
    amount_khr: old.amount_khr, fee_date: old.fee_date, sale_id: old.sale_id, branch_id: old.branch_id,
    delivery_contact_id: old.delivery_contact_id, notes: old.notes }), 'legacy canonical bytes do not gain a policy marker')
  assert.deepEqual((await create(old)).body, oldCreated.body)
  const beforeRace = counts()
  const racing = { ...v1, client_request_id: 'fee-v1-concurrent-0001' }
  const racers = await Promise.all([create(racing), create(racing)])
  assert.deepEqual(racers.map(result => result.status).sort(), [200, 201])
  assert.deepEqual(racers[0].body, racers[1].body)
  assert.deepEqual(counts(), { fees: beforeRace.fees + 1, receipts: beforeRace.receipts + 1, audits: beforeRace.audits + 1 })
  // ---- CUTOVER-LC G-G: the expense guard follows the branch ROLE, and an old Shop sale still takes an expense ----
  // Before: both Shop rows above are plain names (NULL role) and already behaved as before. Now consolidate:
  // branch 2 becomes "LC Store" (role shop), branch 3 (which holds sale 11) is retired as "Old Shop" -> LC Store.
  raw.exec("UPDATE branches SET name='LC Store', role='shop' WHERE id=2");
  raw.exec("UPDATE branches SET name='Old Shop', role='shop', is_active=0, successor_branch_id=2 WHERE id=3");
  raw.exec("INSERT INTO branches(id,name,is_active,role) VALUES(4,'Stock room',1,'warehouse'),(5,'Lost Shop',0,'shop')");
  raw.exec("INSERT INTO sales(id,branch_id,receipt_number) VALUES(12,5,'SALE-12'),(13,4,'SALE-13')");
  const feeBody = (id, extra) => ({ ...normalBody, client_request_id: id, label: id, ...extra })
  const lcStoreFee = await create(feeBody('fee-cut-lc-store-0001', { branch_id: 2 }))
  assert.equal(lcStoreFee.status, 201, 'a selling branch named LC Store takes an expense (the old name test refused it): ' + JSON.stringify(lcStoreFee.body))
  const oldShopSaleFee = await create(feeBody('fee-cut-old-sale-0001', { sale_id: 11, branch_id: 3 }))
  assert.equal(oldShopSaleFee.status, 201, 'an expense on an old Shop sale is accepted after the cutover: ' + JSON.stringify(oldShopSaleFee.body))
  // The cash leaves the LC Store drawer and Old Shop has none: the expense is BOOKED to the active successor (the sale link
  // keeps the Shop provenance). The reader's shift reconciliation filters fees by the shift's branch.
  assert.deepEqual({ branch_id: oldShopSaleFee.body.fee.branch_id, sale_id: oldShopSaleFee.body.fee.sale_id },
    { branch_id: 2, sale_id: 11 }, 'booked to LC Store, linked to the old Shop sale')
  assert.equal(raw.prepare('SELECT branch_name FROM fees WHERE id=?').get(oldShopSaleFee.body.fee.id).branch_name, 'LC Store')
  const successorSaleFee = await create(feeBody('fee-cut-old-sale-successor-0001', { sale_id: 11, branch_id: 2 }))
  assert.equal(successorSaleFee.status, 201, 'a client that already names the successor is accepted too: ' + JSON.stringify(successorSaleFee.body))
  assert.equal(successorSaleFee.body.fee.branch_id, 2)
  const replayed = await create(feeBody('fee-cut-old-sale-0001', { sale_id: 11, branch_id: 3 }))
  assert.deepEqual(replayed.body, oldShopSaleFee.body, 'the same request id replays the recorded expense')
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM fees WHERE label='fee-cut-old-sale-0001'").get().n, 1, 'and books it once')
  const beforeUnlinked = raw.prepare('SELECT COUNT(*) n FROM fees').get().n
  raw.exec("UPDATE branches SET successor_branch_id=NULL WHERE id=3")
  assert.equal((await create(feeBody('fee-cut-old-sale-orphaned-0001', { sale_id: 11, branch_id: 3 }))).status, 400, 'once the retired branch has no selling successor the expense refuses')
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM fees').get().n, beforeUnlinked, 'and writes nothing')
  raw.exec("UPDATE branches SET successor_branch_id=2 WHERE id=3")
  const oldShopDirect = await create(feeBody('fee-cut-old-direct-0001', { branch_id: 3 }))
  assert.equal(oldShopDirect.status, 400, 'a NEW expense cannot be recorded at the retired branch itself')
  assert.equal((await create(feeBody('fee-cut-old-sale-mismatch-0001', { sale_id: 11, branch_id: 4 }))).status, 400, 'the sale branch (or its successor) and the expense branch must still agree')
  assert.equal((await create(feeBody('fee-cut-warehouse-0001', { branch_id: 4 }))).status, 400, 'a warehouse-role branch never takes an expense')
  assert.equal((await create(feeBody('fee-cut-warehouse-sale-0001', { sale_id: 13, branch_id: 4 }))).status, 400, 'nor through a sale at it')
  assert.equal((await create(feeBody('fee-cut-orphan-sale-0001', { sale_id: 12, branch_id: 5 }))).status, 400, 'a retired branch with no successor cannot carry one')
  // Wrong implementation: the name-literal test the route used before, over these same rows.
  const byName = (row) => String(row.name).trim().toLowerCase() === 'shop'
  assert.equal(byName(raw.prepare('SELECT * FROM branches WHERE id=2').get()), false, 'control: by name LC Store is not a Shop, so the old guard refused every post-cutover expense')
  raw.close()
  console.log('PASS fee route accepts explicit null courier, replays exactly, conflicts changed data, rejects malformed/nonexistent ids, and writes once')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
