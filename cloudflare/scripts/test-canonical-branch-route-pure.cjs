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
const branchRoute = loadModule('routes/branches.ts', (id) => {
  if (id === 'hono') return require('hono')
  if (id === '../lib/db') return { getDb: dbCompat }
  if (id === '../lib/sqlBinding') return { buildInClause: noop, chunkForBinding: noop, selectInChunks: noop }
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
  if (id === '../lib/telegram') return { formatTransferTelegramLines: noop, sendTelegramEvent: async () => {} }
  if (id === '../lib/conflictControl') return {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (error) => ({ body: { error: error.message }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  }
  if (id === '../lib/productIdentity') return { findIdentityMatch: noop, findIdentityMatches: noop }
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
  sqlite.exec(`
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT, phone TEXT,
      manager TEXT, notes TEXT, is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT
    );
    CREATE TABLE sales (branch_id INTEGER, branch_name TEXT, updated_at TEXT);
    CREATE TABLE inventory_movements (
      id INTEGER PRIMARY KEY, product_id INTEGER, product_name TEXT,
      branch_id INTEGER, branch_name TEXT, movement_type TEXT, quantity REAL,
      reason TEXT, user_id INTEGER, user_name TEXT, created_at TEXT, batch_id INTEGER
    );
    CREATE TABLE returns (branch_id INTEGER, branch_name TEXT);
    CREATE TABLE stock_row_moves (branch_id INTEGER, branch_name TEXT);
    CREATE TABLE pending_actions (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT,
      cost_price_usd REAL, cost_price_khr REAL,
      selling_price_usd REAL, selling_price_khr REAL
    );
    CREATE TABLE branch_stock (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0, UNIQUE(product_id, branch_id)
    );
    CREATE TABLE stock_transfers (
      id INTEGER PRIMARY KEY, product_id INTEGER, product_name TEXT,
      from_branch_id INTEGER, to_branch_id INTEGER, quantity REAL, notes TEXT,
      user_id INTEGER, user_name TEXT, created_at TEXT
    );
    INSERT INTO branches(id,name,location,is_default,is_active,updated_at) VALUES
      (1,'Shop','shop old',1,1,'2026-09-08 00:00:00'),
      (2,'Warehouse','warehouse old',0,1,'2026-09-08 00:00:00');
    INSERT INTO products(id,name) VALUES (10,'Transfer product');
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

  await check('duplicate active canonical rows return 409 before transfer effects', async () => {
    sqlite.prepare("INSERT INTO branches(id,name,is_active) VALUES (3,' shop ',1)").run()
    const result = await request('POST', '/transfer', {
      productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'restock shop',
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
      productId: 10, fromBranchId: 2, toBranchId: 1, quantity: 2, reason: 'restock shop',
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
