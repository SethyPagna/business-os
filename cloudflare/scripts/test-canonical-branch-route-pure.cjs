const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function transpile(relPath) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 1 : 0
}

const roles = loadModule('lib/branchRoles.ts', require)
const identity = loadModule('lib/canonicalBranchIdentity.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './branchRoles') return roles
  throw new Error(`unexpected identity import ${id}`)
})
const writes = loadModule('lib/branchWrites.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './canonicalBranchIdentity') return identity
  throw new Error(`unexpected writer import ${id}`)
})
const transferReceipts = loadModule('lib/transferOperationReceipt.ts', require)

let sqlite
let currentUser
let beforeBatch
let batchCalls
let queueCalls
let audits
let broadcasts

function wrapDb(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        get: async (params) => Array.isArray(params) ? statement.get(...params) : statement.get(params || {}),
        all: async (params) => Array.isArray(params) ? statement.all(...params) : statement.all(params || {}),
        run: async (params) => Array.isArray(params) ? statement.run(...params) : statement.run(params || {}),
      }
    },
    async batch(statements) {
      batchCalls += 1
      if (beforeBatch) {
        const inject = beforeBatch
        beforeBatch = null
        inject(db)
      }
      db.transaction(() => {
        for (const item of statements) {
          const statement = db.prepare(item.sql)
          if (item.params == null) statement.run()
          else if (Array.isArray(item.params)) statement.run(...item.params)
          else statement.run(item.params)
        }
      })()
      return []
    },
  }
}

const dbCompat = () => wrapDb(sqlite)
const branchGuards = loadModule('lib/branchRoleGuards.ts', (id) => {
  if (id === './branchRoles') return roles
  throw new Error(`unexpected guard import ${id}`)
})

const noop = () => null
const buildInClause = (prefix, values) => ({
  sql: values.map((_, index) => `@${prefix}${index}`).join(', '),
  params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])),
})
const selectInChunks = async (values, _reserved, query) => values.length ? query(values) : []
const branchRoute = loadModule('routes/branches.ts', (id) => {
  if (id === 'hono') return require('hono')
  if (id === '../lib/db') return { getDb: dbCompat }
  if (id === '../lib/sqlBinding') return { buildInClause, chunkForBinding: (values) => [values], selectInChunks }
  if (id === '../lib/familyPagination') return { paginateProductFamilies: noop }
  if (id === '../lib/familyStockStats') return { getFamilyStockStats: noop }
  if (id === '../lib/lowStockSettings') return { loadLowStockConfig: noop, lowStockThresholdSql: noop }
  if (id === '../lib/auth') return {
    requireAuth: async (c, next) => {
      if (!currentUser) return c.json({ error: 'Unauthorized' }, 401)
      c.set('user', currentUser)
      return next()
    },
  }
  if (id === '../lib/permissions') return {
    getPermissionTier: (user) => user?.tier || 'none',
    getActionTier: (user) => user?.tier || 'none',
  }
  if (id === '../lib/reviewGate') return {
    maybeQueueForReview: async () => { queueCalls += 1; return null },
  }
  if (id === '../durable-objects/broadcastHub') return {
    broadcast: async (...args) => { broadcasts.push(args) },
  }
  if (id === '../lib/cache') return { bumpVersion: async () => {} }
  if (id === '../lib/audit') return { audit: async (...args) => { audits.push(args) } }
  if (id === '../lib/transferOperation') return loadModule('lib/transferOperation.ts', dep => {
    if (dep === './movementCostSnapshot') return loadModule('lib/movementCostSnapshot.ts', require)
    if (dep === './db') return {getDb:dbCompat}
    if (dep === './permissions') return {getActionTier:user=>user?.tier || 'none'}
    if (dep === './actorSnapshot') return {actorSnapshot:user=>user?.name || null}
    if (dep === './productBatches') return {readFifoLotAvailability:async()=>[],allocateAcrossLots:(_lots,quantity)=>({takes:[],uncovered:quantity})}
    if (dep === './canonicalBranchIdentity') return identity
    if (dep === './transferOperationReceipt') return transferReceipts
    if (dep === './cache') return {bumpVersion:async()=>{}}
    if (dep === '../durable-objects/broadcastHub') return {broadcast:async()=>{}}
    throw new Error('unexpected transfer dependency '+dep)
  })
  if (id === '../lib/transferOperationReceipt') return transferReceipts
  if (id === '../lib/telegram') return { formatTransferTelegramLines: noop, sendTelegramEvent: async () => {} }
  if (id === '../lib/conflictControl') return {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (error) => ({ body: { error: error.message }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  }
  if (id === '../lib/productIdentity') return { findIdentityMatch: async () => null, findIdentityMatches: async () => new Map() }
  if (id === '../lib/productBatches') return {
    decrementBatchStockStatement: noop,
    decrementBatchStockStrictStatement: noop,
    incrementBatchStockStatement: noop,
    resolveDestinationBatch: noop,
    readFifoLotAvailability: async () => [],
    allocateAcrossLots: (_lots, quantity) => ({ takes: [], uncovered: quantity }),
  }
  if (id === '../lib/branchWrites') return writes
  if (id === '../lib/canonicalBranchIdentity') return identity
  if (id === '../lib/branchRoleGuards') return branchGuards
  if (id === '../lib/productSearchQuery') return { buildFamilyRelevanceOrderSql: noop, buildProductSearchQuery: noop }
  if (id === '../lib/actorSnapshot') return { actorSnapshot: (user) => user?.name || null }
  if (id === '../index') return {}
  throw new Error(`unexpected route import ${id}`)
})
const app = branchRoute.default
app.onError(() => new Response(JSON.stringify({ error: 'Internal error' }), {
  status: 500,
  headers: { 'Content-Type': 'application/json' },
}))

function reset() {
  sqlite = new Database(':memory:')
  for (const file of fs.readdirSync(path.join(__dirname,'../migrations')).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'))
  sqlite.exec(`
    INSERT INTO branches(id,name,location,is_default,is_active,updated_at) VALUES
      (1,'Shop','shop old',1,1,'2026-09-08 00:00:00'),
      (2,'Warehouse','warehouse old',0,1,'2026-09-08 00:00:00');
    INSERT INTO products(id,name,stock_quantity) VALUES (10,'Transfer product',5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES (10,2,5);
  `)
  currentUser = { id: 7, name: 'Branch editor', tier: 'full' }
  beforeBatch = null
  batchCalls = 0
  queueCalls = 0
  audits = []
  broadcasts = []
}

async function request(method, url, body) {
  const response = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  }, {}, { waitUntil: () => {}, passThroughOnException: () => {} })
  return { status: response.status, json: await response.json().catch(() => null) }
}

let passed = 0
async function check(name, fn) {
  reset()
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('full-authority create and delete return 409 without queue or write', async () => {
    const before = sqlite.prepare('SELECT * FROM branches ORDER BY id').all()
    for (const [method, url, body] of [['POST', '/', { name: 'Depot' }], ['DELETE', '/2', null]]) {
      const result = await request(method, url, body)
      assert.equal(result.status, 409)
      assert.equal(result.json.code, identity.CANONICAL_BRANCH_IDENTITY_CODE)
    }
    assert.deepStrictEqual(sqlite.prepare('SELECT * FROM branches ORDER BY id').all(), before)
    assert.equal(queueCalls, 0)
    assert.equal(batchCalls, 0)
    assert.equal(audits.length, 0)
  })

  await check('permission checks still return 403 before canonical refusal', async () => {
    currentUser = { id: 8, name: 'Viewer', tier: 'none' }
    assert.equal((await request('POST', '/', { name: 'Depot' })).status, 403)
    assert.equal((await request('PUT', '/1', { name: 'Shop', location: 'x' })).status, 403)
    assert.equal((await request('DELETE', '/1')).status, 403)
    assert.equal(queueCalls, 0)
    assert.equal(batchCalls, 0)
  })

  await check('canonical metadata and default update succeeds', async () => {
    const result = await request('PUT', '/2', {
      name: ' warehouse ', is_active: 1, location: 'new warehouse', phone: '012',
      manager: 'Manager', notes: 'metadata', is_default: 1,
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.deepStrictEqual(sqlite.prepare('SELECT name,location,phone,manager,notes,is_default,is_active FROM branches WHERE id=2').get(), {
      name: 'Warehouse', location: 'new warehouse', phone: '012', manager: 'Manager', notes: 'metadata', is_default: 1, is_active: 1,
    })
    assert.equal(sqlite.prepare('SELECT is_default FROM branches WHERE id=1').get().is_default, 0)
    assert.equal(queueCalls, 1)
    assert.equal(batchCalls, 1)
    assert.equal(audits.length, 1)
  })

  await check('rename and deactivate return 409 before queue or write', async () => {
    for (const body of [{ name: 'Depot', location: 'forbidden' }, { name: 'Shop', is_active: 0, location: 'forbidden' }]) {
      const result = await request('PUT', '/1', body)
      assert.equal(result.status, 409)
      assert.equal(result.json.code, identity.CANONICAL_BRANCH_IDENTITY_CODE)
    }
    assert.equal(sqlite.prepare('SELECT location FROM branches WHERE id=1').get().location, 'shop old')
    assert.equal(queueCalls, 0)
    assert.equal(batchCalls, 0)
    assert.equal(audits.length, 0)
  })

  await check('interposed identity rename or deletion aborts all route effects', async () => {
    beforeBatch = (db) => db.prepare("UPDATE branches SET name='Changed elsewhere' WHERE id=1").run()
    let result = await request('PUT', '/1', { name: 'Shop', location: 'raced', is_default: 1, is_active: 1 })
    assert.equal(result.status, 500)
    assert.deepStrictEqual(sqlite.prepare('SELECT name,location FROM branches WHERE id=1').get(), { name: 'Changed elsewhere', location: 'shop old' })
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)

    reset()
    beforeBatch = (db) => db.prepare('DELETE FROM branches WHERE id=1').run()
    result = await request('PUT', '/1', { name: 'Shop', location: 'raced', is_default: 1, is_active: 1 })
    assert.equal(result.status, 500)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM branches WHERE id=1').get().count, 0)
    assert.equal(sqlite.prepare('SELECT is_default FROM branches WHERE id=2').get().is_default, 0, 'default clear rolled back')
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('single transfer supports forward, undo, and redo across both canonical directions', async () => {
    let result = await request('POST', '/transfer', {
      transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'restock shop', client_request_id: 'transfer-forward-1',
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.deepStrictEqual(
      sqlite.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=10 ORDER BY branch_id').all(),
      [{ branch_id: 1, quantity: 2 }, { branch_id: 2, quantity: 3 }],
    )

    result = await request('POST', '/transfer', {
      transfer_provenance_version: 1, productId: 10, fromBranchId: 1, toBranchId: 2, quantity: 2, reason: 'Undo: restock shop', client_request_id: 'transfer-undo-1',
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.deepStrictEqual(
      sqlite.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=10 ORDER BY branch_id').all(),
      [{ branch_id: 1, quantity: 0 }, { branch_id: 2, quantity: 5 }],
    )

    result = await request('POST', '/transfer', {
      transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'Redo: restock shop', client_request_id: 'transfer-redo-1',
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(sqlite.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE product_id=10').get().total, 5)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 3)
    assert.deepStrictEqual(
      sqlite.prepare('SELECT movement_type,branch_id,quantity FROM inventory_movements ORDER BY id').all(),
      [
        { movement_type: 'transfer_out', branch_id: 2, quantity: 2 },
        { movement_type: 'transfer_in', branch_id: 1, quantity: 2 },
        { movement_type: 'transfer_out', branch_id: 1, quantity: 2 },
        { movement_type: 'transfer_in', branch_id: 2, quantity: 2 },
        { movement_type: 'transfer_out', branch_id: 2, quantity: 2 },
        { movement_type: 'transfer_in', branch_id: 1, quantity: 2 },
      ],
    )
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 3)
  })

  await check('bulk transfer supports both canonical directions and conserves stock', async () => {
    let result = await request('POST', '/transfer-bulk', {
      transfer_provenance_version: 1, fromBranchId: 2, toBranchId: 1, reason: 'bulk to shop', items: [{ productId: 10, quantity: 3 }], client_request_id: 'transfer-bulk-1',
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(result.json.transferredCount, 1)

    result = await request('POST', '/transfer-bulk', {
      transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'bulk back to warehouse', items: [{ productId: 10, quantity: 1 }], client_request_id: 'transfer-bulk-2',
    })
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(result.json.transferredCount, 1)
    assert.deepStrictEqual(
      sqlite.prepare('SELECT branch_id,quantity FROM branch_stock WHERE product_id=10 ORDER BY branch_id').all(),
      [{ branch_id: 1, quantity: 2 }, { branch_id: 2, quantity: 3 }],
    )
    assert.equal(sqlite.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE product_id=10').get().total, 5)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 2)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 4)
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 2)
  })

  await check('transfer replay returns the original receipt without a second stock movement', async () => {
    const body = { transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'replay-safe move', client_request_id: 'transfer-replay-1' }
    const first = await request('POST', '/transfer', body)
    assert.equal(first.status, 200, JSON.stringify(first.json))
    assert.equal(first.json.replayed, false)
    const replay = await request('POST', '/transfer', body)
    assert.equal(replay.status, 200, JSON.stringify(replay.json))
    assert.equal(replay.json.replayed, true)
    assert.deepStrictEqual(replay.json, { ...first.json, replayed: true })
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 3)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 2)
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 1)
    const conflict = await request('POST', '/transfer', { ...body, quantity: 1 })
    assert.equal(conflict.status, 409, JSON.stringify(conflict.json))
    assert.equal(conflict.json.code, 'idempotency_conflict')
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 3)
  })

  await check('bulk transfer replay is request-scoped and does not duplicate its lines', async () => {
    const body = { transfer_provenance_version: 1, fromBranchId: 2, toBranchId: 1, reason: 'bulk replay-safe move', items: [{ productId: 10, quantity: 2 }], client_request_id: 'bulk-replay-1' }
    const first = await request('POST', '/transfer-bulk', body)
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const replay = await request('POST', '/transfer-bulk', body)
    assert.equal(replay.status, 200, JSON.stringify(replay.json))
    assert.equal(replay.json.replayed, true)
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 3)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 2)
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 1)
  })

  await check('same branch, noncanonical branches, reasons, and lower permissions fail with zero effects', async () => {
    sqlite.prepare("INSERT INTO branches(id,name,is_active) VALUES (3,'Depot',1)").run()
    const initialStock = sqlite.prepare('SELECT * FROM branch_stock ORDER BY id').all()
    const cases = [
      { body: { transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 2, quantity: 1, reason: 'same', client_request_id: 'invalid-same' }, status: 400 },
      { body: { transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 3, quantity: 1, reason: 'other', client_request_id: 'invalid-other' }, status: 400 },
      { body: { transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 1 }, status: 400 },
    ]
    for (const item of cases) assert.equal((await request('POST', '/transfer', item.body)).status, item.status)

    currentUser = { id: 8, name: 'Reviewer', tier: 'review' }
    assert.equal((await request('POST', '/transfer', {
      productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 1, reason: 'review refused', client_request_id: 'invalid-review',
    })).status, 403)
    currentUser = { id: 9, name: 'Viewer', tier: 'none' }
    assert.equal((await request('POST', '/transfer-bulk', {
      fromBranchId: 2, toBranchId: 1, reason: 'none refused', items: [{ productId: 10, quantity: 1 }], client_request_id: 'invalid-none',
    })).status, 403)

    assert.deepStrictEqual(sqlite.prepare('SELECT * FROM branch_stock ORDER BY id').all(), initialStock)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 0)
    assert.equal(batchCalls, 0)
    assert.equal(audits.length, 0)
  })

  await check('duplicate active canonical rows return 409 before transfer effects', async () => {
    sqlite.prepare("INSERT INTO branches(id,name,is_active) VALUES (3,' shop ',1)").run()
    const result = await request('POST', '/transfer', {
      transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'restock shop', client_request_id: 'transfer-duplicate-canonical',
    })
    assert.equal(result.status, 409, JSON.stringify(result.json))
    assert.equal(result.json.code, identity.CANONICAL_BRANCH_CONFIGURATION_CODE)
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 5)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 0)
    assert.equal(batchCalls, 0)
    assert.equal(audits.length, 0)
  })

  await check('an interposed canonical duplicate aborts the actual transfer batch', async () => {
    beforeBatch = (db) => db.prepare("INSERT INTO branches(id,name,is_active) VALUES (3,'Warehouse',1)").run()
    const result = await request('POST', '/transfer', {
      transfer_provenance_version: 1, productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'restock shop', client_request_id: 'transfer-interposed',
    })
    assert.equal(result.status, 500)
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 5)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM branch_stock WHERE product_id=10 AND branch_id=1').get().total, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 0)
    assert.equal(audits.length, 0)
    assert.equal(broadcasts.length, 0)
  })

  console.log(`\n${passed} canonical branch route checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
