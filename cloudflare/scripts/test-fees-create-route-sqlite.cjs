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
    is_active INTEGER NOT NULL
  );
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
  '../lib/branchRoles': { branchCanSell: (name) => name === 'Shop' },
  '../lib/batchCode': { normalizeTypedDate: (value) => String(value || '').slice(0, 10) || null },
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/feeOperationReceipt': feeOperationReceipt,
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
  assert.match(mismatch.body.error, /same Shop branch/)
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

  raw.close()
  console.log('PASS fee route accepts explicit null courier, replays exactly, conflicts changed data, rejects malformed/nonexistent ids, and writes once')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
