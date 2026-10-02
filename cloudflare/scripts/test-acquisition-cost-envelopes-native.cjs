const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
function loadAccess(transform = source => source) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    const source = fs.readFileSync(file, 'utf8')
    const code = ts.transpileModule(file.endsWith('acquisitionCostAccess.ts') ? transform(source) : source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    new Function('require', 'module', 'exports', code)(name => name.startsWith('.')
      ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name), mod, mod.exports)
    return mod.exports
  }
  return load(path.join(root, 'lib/acquisitionCostAccess.ts'))
}
const actor = (own = {}, role = {}, role_code = 'manager') => ({ role_code, permissions: JSON.stringify(own), role_permissions: JSON.stringify(role) })
const denied = actor({ products: true, inventory: true, sales: true, product_cost_view: false, product_cost_edit: false }, { product_cost_view: true, product_cost_edit: true })
const viewer = actor({}, { product_cost_view: true })
const editor = actor({ product_cost_edit: true })
const access = loadAccess()
async function checkEnvelopeRoutes(api) {
  const { DatabaseSync } = require('node:sqlite')
  const native = new DatabaseSync(':memory:')
  native.limits.exprDepth = 100
  const init = fs.readFileSync(path.join(__dirname, '../migrations/0001_init.sql'), 'utf8')
  const schema = init.match(/CREATE TABLE action_history \([\s\S]*?\n\);/)
  assert.ok(schema)
  native.exec(schema[0])
  native.exec(fs.readFileSync(path.join(__dirname, '../migrations/0025_pending_actions.sql'), 'utf8'))
  let user = { ...denied, id: 7, name: 'Fixture' }, operations = 0, auditWrites = 0, broadcasts = 0
  const DB = { prepare(sql) {
    operations++
    const stmt = native.prepare(sql); let values = []
    return { bind(...args) { values = args; return this }, async all() { return { results: stmt.all(...values), meta: {} } },
      async run() { const result = stmt.run(...values); return { meta: { changes: result.changes, last_row_id: result.lastInsertRowid } } } }
  } }
  const modules = new Map()
  function pure(name) {
    if (modules.has(name)) return modules.get(name).exports
    assert.ok(['permissions', 'actorSnapshot', 'db', 'pendingActions'].includes(name), name)
    const m = { exports: {} }; modules.set(name, m)
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'lib', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', code)(id => {
      if (id === './importMaintenanceFence') return {}
      if (id.startsWith('./')) return pure(id.slice(2))
      throw new Error('Unexpected pure route dependency ' + id)
    }, m, m.exports)
    return m.exports
  }
  const unused = () => { throw new Error('Unselected replay/approval helper executed') }
  const undoSource = ts.createSourceFile('undoAppliers.ts', fs.readFileSync(path.join(root, 'lib/undoAppliers.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const undoFunctions = undoSource.statements.filter(node => ts.isFunctionDeclaration(node) && ['resolveUndoApplier', 'isServerReplayable'].includes(node.name?.text))
  assert.equal(undoFunctions.length, 2)
  const undoModule = { exports: {} }
  const undoCode = ts.transpileModule(undoFunctions.map(node => node.getText(undoSource)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('APPLIERS', 'module', 'exports', undoCode)(new Proxy({}, { get: unused }), undoModule, undoModule.exports)
  const stubs = {
    '../lib/acquisitionCostAccess': api, '../lib/permissions': pure('permissions'), '../lib/db': pure('db'),
    '../lib/actorSnapshot': pure('actorSnapshot'), '../lib/pendingActions': pure('pendingActions'),
    '../lib/auth': { requireAuth: async (c, next) => { if (!user) return c.json({ error: 'Unauthorized' }, 401); c.set('user', user); return next() } },
    '../lib/audit': { audit: async () => { auditWrites++ } }, '../durable-objects/broadcastHub': { broadcast: async () => { broadcasts++ } },
    '../lib/productWrites': { hasProductMoneyPolicy: unused },
    '../lib/reviewApply': { productRemovePendingPointer: () => false, applyApprovedPendingAction: unused },
    '../lib/productImagePermission': {}, '../lib/productDelete': { PRODUCT_REMOVE_ACTION_KIND: 'product.remove' },
    '../lib/undoAppliers': { SALE_ADD_ITEMS_ACTION_KIND: 'sale.items.add', PRODUCT_MERGE_GROUP_ACTION_KIND: 'product.merge.group', ...undoModule.exports },
    '../lib/customerGenderRestoration': { CUSTOMER_GENDER_RESTORATION_KIND: 'customer.gender_restore' },
    '../lib/saleBulkStatus': { BULK_STATUS_KIND: 'sale.status.bulk' }, '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() },
    '../lib/saleCustomerAssignmentGuard': {}, '../lib/returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk' },
    '../lib/telegram': {}, '../lib/saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement' },
    '../lib/stockSession': { STOCK_SESSION_KIND: 'stock.session' }, '../lib/transferOperation': { TRANSFER_OPERATION_KIND: 'stock.transfer' },
    '../lib/stockLotAdjustment': { STOCK_LOT_SET_KIND: 'stock.quantity_set' }, '../lib/stockInLineEdit': { STOCK_IN_LINE_EDIT_KIND: 'stock.session_line_edit' },
  }
  const app = new Hono()
  for (const [file, mount] of [['actionHistory', '/history'], ['reviewQueue', '/review']]) {
    const m = { exports: {} }, code = ts.transpileModule(fs.readFileSync(path.join(root, 'routes', file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', code)(id => {
      if (id === 'hono') return { Hono }
      if (Object.hasOwn(stubs, id)) return stubs[id]
      throw new Error('Unexpected route dependency ' + id)
    }, m, m.exports)
    app.route(mount, m.exports.default)
  }
  const context = { waitUntil(promise) { Promise.resolve(promise).catch(error => { throw error }) }, passThroughOnException() {} }
  const post = (url, payload) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { DB }, context)
  const get = url => app.request(url, {}, { DB }, context)
  const snapshot = () => JSON.stringify({ history: native.prepare('SELECT * FROM action_history ORDER BY id').all(), pending: native.prepare('SELECT * FROM pending_actions ORDER BY id').all() })
  const specimens = [{ cost_price_usd: 73 }, { costPriceUsd: 73 }, { nested: { cost_price_khr: 28000 } }]
  try {
    for (const payload of specimens) {
      native.prepare("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,status,requested_by) VALUES(1,'inventory','update','fixture','{}','rejected',7)").run()
      const before = snapshot(), counters = [operations, auditWrites, broadcasts]
      const history = await post('/history', { label: 'Fixture edit', undo_payload: payload })
      const review = await post('/review/1/resubmit', { payload })
      console.log('CANONICAL_ADMISSION', JSON.stringify({ payload, historyStatus: history.status, reviewStatus: review.status, unchanged: snapshot() === before, operations: operations - counters[0], auditWrites: auditWrites - counters[1], broadcasts: broadcasts - counters[2] }))
      assert.equal(history.status, 403, 'actual history admission denies canonical private input')
      assert.equal(review.status, 403, 'actual review admission denies canonical private input')
      assert.equal((await review.json()).code, 'product_cost_edit_required')
      assert.equal(snapshot(), before)
      assert.deepEqual([operations, auditWrites, broadcasts], counters, 'refusal precedes every database/audit/broadcast operation')
      native.prepare('DELETE FROM pending_actions WHERE id=1').run()
    }
    const encodedCases = [
  [
    {
      "details": "[\"{\\\"cost_price_usd\\\":73129,\\\"count\\\":2}\"]"
    },
    {
      "details": "[\"{\\\"count\\\":2}\"]"
    }
  ],
  [
    {
      "scope": "supplier",
      "details": [
        "{\"total_usd\":91329,\"count\":2}"
      ]
    },
    {
      "scope": "supplier",
      "details": [
        "{\"count\":2}"
      ]
    }
  ],
  [
    {
      "undo_payload": "[\"{\\\"cost_price_usd\\\":73129,\\\"count\\\":2}\"]"
    },
    {
      "undo_payload": "[\"{\\\"count\\\":2}\"]"
    }
  ],
  [
    {
      "details": {
        "opaque": [
          [
            "{\"cost_price_usd\":73129,\"count\":2}"
          ]
        ]
      }
    },
    {
      "details": {
        "opaque": [
          [
            "{\"count\":2}"
          ]
        ]
      }
    }
  ],
  [
    {
      "rows": [
        "\"{\\\"cost_price_usd\\\":73129,\\\"count\\\":2}\""
      ]
    },
    {
      "rows": [
        "\"{\\\"count\\\":2}\""
      ]
    }
  ],
  [
    {
      "scope": "supplier",
      "rows": "{\"opaque\":[[\"{\\\"total_usd\\\":91329,\\\"count\\\":2}\"]]}"
    },
    {
      "scope": "supplier",
      "rows": "{\"opaque\":[[\"{\\\"count\\\":2}\"]]}"
    }
  ],
  [
    {
      "scope": "supplier",
      "details": "\"{\\\"scope\\\":\\\"customer\\\",\\\"total_usd\\\":91329,\\\"count\\\":2}\""
    },
    {
      "scope": "supplier",
      "details": "\"{\\\"scope\\\":\\\"customer\\\",\\\"count\\\":2}\""
    }
  ],
  [
    {
      "periodSupplierReturns": [
        "{\"total_usd\":91329,\"count\":2}"
      ]
    },
    {
      "periodSupplierReturns": [
        "{\"count\":2}"
      ]
    }
  ],
  [
    {
      "snapshot_json": "{\"rows\":[\"{\\\"cost_price_usd\\\":73129,\\\"count\\\":2}\"]}"
    },
    {
      "snapshot_json": "{\"rows\":[\"{\\\"count\\\":2}\"]}"
    }
  ]
]
    const encodedObservations = []
    for (const [payload, expected] of encodedCases) {
      user = { ...editor, id: 7 }
      const created = await post('/history', { label: 'Encoded fixture', undo_payload: payload }), createdBody = await created.json()
      assert.equal(created.status, 200)
      assert.equal(native.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(createdBody.id).undo_payload, JSON.stringify(payload))
      native.prepare("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,status,requested_by) VALUES(1,'inventory','update','fixture',?,'rejected',7)").run(JSON.stringify(payload))
      for (const granted of [
        { role_code: 'manager', permissions: JSON.stringify({ audit_log: true, product_cost_view: true, product_cost_edit: true }) },
        { role_code: 'admin', permissions: JSON.stringify({ product_cost_view: false, product_cost_edit: false }) },
      ]) {
        user = { ...granted, id: 9 }
        const visible = await get('/history?scope=global&all=1&limit=20'), visibleBody = await visible.json()
        assert.equal(visible.status, 200)
        assert.deepEqual(visibleBody.items.find(row => row.id === createdBody.id).undo_payload, payload)
        user = { ...granted, id: 7 }
        const visibleMine = await get('/review/mine'), visibleMineBody = await visibleMine.json()
        assert.equal(visibleMine.status, 200)
        assert.equal(visibleMineBody.data.find(row => row.id === 1).payload_json, JSON.stringify(payload))
      }
      const beforeRead = snapshot()
      user = { ...denied, id: 9, permissions: JSON.stringify({ audit_log: true, product_cost_view: false, product_cost_edit: false }) }
      const historyRead = await get('/history?scope=global&all=1&limit=20'), historyBody = await historyRead.json()
      assert.equal(historyRead.status, 200, JSON.stringify(historyBody))
      const row = historyBody.items.find(row => row.id === createdBody.id)
      assert.ok(row)
      user = { ...user, id: 7 }
      const mine = await get('/review/mine'), mineBody = await mine.json()
      assert.equal(mine.status, 200)
      const pending = mineBody.data.find(row => row.id === 1)
      assert.ok(pending)
      assert.equal(snapshot(), beforeRead)
      assert.equal(historyRead.headers.get('cache-control'), 'private, no-store')
      const before = snapshot(), counters = [operations, auditWrites, broadcasts]
      const history = await post('/history', { label: 'Denied encoded fixture', undo_payload: payload })
      const review = await post('/review/1/resubmit', { payload })
      const observation = { payload, expected, historyOutput: row.undo_payload, mineOutput: JSON.parse(pending.payload_json), historyStatus: history.status, reviewStatus: review.status, unchanged: snapshot() === before, operationDelta: operations - counters[0], auditDelta: auditWrites - counters[1], broadcastDelta: broadcasts - counters[2] }
      encodedObservations.push(observation)
      console.log('ENCODED_ROUTE', JSON.stringify(observation))
      native.prepare('DELETE FROM pending_actions WHERE id=1').run()
    }
    for (const observation of encodedObservations) {
      assert.deepEqual(observation.historyOutput, observation.expected, 'different denied actor actual history retrieval')
      assert.deepEqual(observation.mineOutput, observation.expected, 'denied requester actual review/mine retrieval')
      assert.equal(observation.historyStatus, 403, 'actual encoded history admission')
      assert.equal(observation.reviewStatus, 403, 'actual encoded review admission')
      assert.equal(observation.unchanged, true)
      assert.deepEqual([observation.operationDelta, observation.auditDelta, observation.broadcastDelta], [0, 0, 0])
    }
    for (const who of [{ ...denied, id: 7 }, { ...editor, id: 7 }, { role_code: 'admin', permissions: '{"product_cost_edit":false}', id: 7 }]) {
      user = who
      const payload = !api.canEditAcquisitionCosts(who) ? { FIELD: 'sellingPriceUsd', old_value: 10, new_value: 11 } : specimens[0]
      const history = await post('/history', { label: 'Fixture edit', undo_payload: payload })
      assert.equal(history.status, 200, 'legitimate retail/edit/admin history admission')
      const stored = native.prepare('SELECT undo_payload FROM action_history ORDER BY id DESC LIMIT 1').get()
      assert.equal(stored.undo_payload, JSON.stringify(payload))
      native.prepare("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,status,requested_by) VALUES(1,'inventory','update','fixture','{}','rejected',7)").run()
      assert.equal((await post('/review/1/resubmit', { payload })).status, 200)
      assert.equal(native.prepare('SELECT payload_json,status FROM pending_actions WHERE id=1').get().payload_json, JSON.stringify(payload))
      assert.equal(native.prepare('SELECT status FROM pending_actions WHERE id=1').get().status, 'open')
      native.prepare('DELETE FROM pending_actions WHERE id=1').run()
    }
    user = null
    assert.equal((await post('/history', { label: 'Fixture edit' })).status, 401)
    console.log('PASS actual actionHistory/reviewQueue admission, native depth100 durable writes/refusals, real permissions/db/pending helpers; identity injected, replay/approval/audit delivery excluded')
  } finally { native.close() }
}

checkEnvelopeRoutes(access).catch(error => { console.error(error); process.exitCode = 1 })
