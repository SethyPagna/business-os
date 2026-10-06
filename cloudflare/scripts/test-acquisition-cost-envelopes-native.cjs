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
    if (['branchWrites', 'canonicalBranchIdentity', 'branchRoles'].includes(name)) assert.ok(name, 'selected real branch dependency')
    else assert.ok(['permissions', 'actorSnapshot', 'db', 'pendingActions'].includes(name), name)
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
    '../lib/branchWrites': pure('branchWrites'),
    '../lib/auth': { requireAuth: async (c, next) => { if (!user) return c.json({ error: 'Unauthorized' }, 401); c.set('user', user); return next() } },
    '../lib/audit': { audit: async () => { auditWrites++ } }, '../durable-objects/broadcastHub': { broadcast: async () => { broadcasts++ } },
    '../lib/productWrites': { hasProductMoneyPolicy: unused },
    '../lib/reviewApply': { productRemovePendingPointer: () => false, applyApprovedPendingAction: unused },
    '../lib/productImagePermission': {}, '../lib/productDelete': { PRODUCT_REMOVE_ACTION_KIND: 'product.remove' },
    '../lib/undoAppliers': { SALE_ADD_ITEMS_ACTION_KIND: 'sale.items.add', PRODUCT_MERGE_GROUP_ACTION_KIND: 'product.merge.group', branchCutoverClosureRefusal: () => null, ...undoModule.exports },
    '../lib/customerGenderRestoration': { CUSTOMER_GENDER_RESTORATION_KIND: 'customer.gender_restore' },
    '../lib/saleBulkStatus': { BULK_STATUS_KIND: 'sale.status.bulk' }, '../lib/saleBulkUpdate': { SALE_BULK_UPDATE_KINDS: new Set() },
    '../lib/saleCustomerAssignmentGuard': {}, '../lib/returnBulkAction': { RETURN_BULK_ACTION_KIND: 'return.fields.bulk' },
    '../lib/telegram': {}, '../lib/saleSettlementAction': { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement' },
    '../lib/stockSession': { STOCK_SESSION_KIND: 'stock.session' }, '../lib/transferOperation': { TRANSFER_OPERATION_KIND: 'stock.transfer' },
    '../lib/stockLotAdjustment': { STOCK_LOT_SET_KIND: 'stock.quantity_set' }, '../lib/stockInLineEdit': { STOCK_IN_LINE_EDIT_KIND: 'stock.session_line_edit' },
  }
  DB.batch = async statements => {
    native.exec('BEGIN')
    try { const result=[]; for(const statement of statements)result.push(await statement.run());native.exec('COMMIT');return result }
    catch(error){native.exec('ROLLBACK');throw error}
  }
  native.exec(init.match(/CREATE TABLE branches \([\s\S]*?\n\);/)[0])
  for(const table of ['sales','inventory_movements','returns','stock_row_moves'])native.exec('CREATE TABLE '+table+'(branch_id INTEGER,branch_name TEXT,updated_at TEXT)')
  native.exec("INSERT INTO branches(id,name,is_default,is_active,notes)VALUES(1,'Warehouse',1,1,'after'),(2,'Shop',0,1,NULL)")
  const declarations=undoSource.statements.filter(node=>
    (ts.isFunctionDeclaration(node)&&['applierPermissionTier','branchReplayExpectedFields','resolveUndoApplier','isServerReplayable','mergeReplayChoicePermissionError','mergeReplayChangesProductImages','replayRefusalCode'].includes(node.name?.text))
    ||(ts.isClassDeclaration(node)&&node.name?.text==='UndoConflictError')
    ||(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>/^(UNDO_|STOCK_SESSION_UNDO_CLOSED_BY_MERGE$|isUndoClosedByMerge$|PRODUCT_MERGE_GROUP_ACTION_KIND$|PRODUCT_MERGE_APPLIER_KINDS$)/.test(d.name.getText(undoSource)))))
  const registry=undoSource.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations]).find(d=>d.name.getText(undoSource)==='APPLIERS')
  const branch=registry.initializer.properties.find(prop=>prop.name?.getText(undoSource)==="'branch.update'")
  assert.ok(branch)
  const bindings={...pure('permissions'),...pure('db'),...pure('actorSnapshot'),...pure('branchWrites'),audit:stubs['../lib/audit'].audit,broadcast:stubs['../durable-objects/broadcastHub'].broadcast}
  const actual={exports:{}},code=ts.transpileModule(declarations.map(n=>n.getText(undoSource)).join('\n')+'\nconst APPLIERS={'+branch.getText(undoSource)+'};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('module','exports',...Object.keys(bindings),code)(actual,actual.exports,...Object.values(bindings))
  Object.assign(stubs['../lib/undoAppliers'],actual.exports)

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
  async function checkHistoryBoundaryRoles() {
    const cost = JSON.stringify({ cost_price_usd: 73129, count: 2 }), safe = JSON.stringify({ count: 2 })
    const financial = [
      ['root', [cost], [safe]], ['opaque', { opaque: [cost] }, { opaque: [safe] }],
      ['nested', { outer: { opaque: [[cost]] } }, { outer: { opaque: [[safe]] } }],
      ['tuple-member', { names: [[11, { opaque: [cost] }]] }, { names: [[11, { opaque: [safe] }]] }],
      ['malformed', { opaque: ['{unclosed'] }, { opaque: [null] }],
      ['known', { details: [cost] }, { details: [safe] }], ['direct', { cost_price_usd: 73129, count: 2 }, { count: 2 }],
    ]
    const roles = [['denied', false, false], ['view-only', true, false], ['edit-only', false, true], ['both', true, true], ['admin', false, false]]
    const roleUser = ([name, view, edit], branches = true) => ({ id: 7, role_code: name === 'admin' ? 'admin' : 'manager', permissions: JSON.stringify({ products: true, inventory: true, sales: true, branches, audit_log: true, review: true, product_cost_view: view, product_cost_edit: edit }) })
    const reset = () => native.exec('DELETE FROM action_history; DELETE FROM pending_actions')
    const seed = (undo, redo = undo, status = 'undoable') => native.prepare("INSERT INTO action_history(id,scope,entity,label,reversible,status,undo_payload,redo_payload,created_by_id) VALUES(1,'global',NULL,'Saved action',1,?,?,?,7)").run(status, JSON.stringify(undo), JSON.stringify(redo))
    const pending = payload => native.prepare("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,status,requested_by) VALUES(1,'inventory','update','fixture',?,'rejected',7)").run(JSON.stringify(payload))
    const observations = []
    for (const role of roles) {
      for (const [name, payload, redacted] of financial) {
        user = roleUser(role)
        const editable = api.canEditAcquisitionCosts(user), visible = api.canViewAcquisitionCosts(user)
        for (const route of ['history', 'review']) {
          reset(); if (route === 'review') pending({ count: 1 })
          const before = snapshot(), counters = [operations, auditWrites, broadcasts]
          const res = await post(route === 'history' ? '/history' : '/review/1/resubmit', route === 'history' ? { label: 'Boundary financial fixture', undo_payload: payload, redo_payload: payload } : { payload }), response = await res.json()
          const correct = editable ? res.status === 200 : res.status === 403 && snapshot() === before && auditWrites === counters[1] && broadcasts === counters[2]
          observations.push({ kind: 'edited-admission', role: role[0], name, route, status: res.status, editable, correct, operationDelta: operations - counters[0], auditDelta: auditWrites - counters[1], broadcastDelta: broadcasts - counters[2], unchanged: snapshot() === before })
          if (editable) {
            if (route === 'history') assert.equal(native.prepare('SELECT undo_payload FROM action_history').get().undo_payload, JSON.stringify(payload))
            else assert.equal(native.prepare('SELECT payload_json FROM pending_actions').get().payload_json, JSON.stringify(payload))
          }
        }
        for (const direction of ['undo', 'redo']) {
          reset(); seed(payload, payload, direction === 'undo' ? 'undoable' : 'redoable')
          const res = await post('/history/1/' + direction, {}), response = await res.json(), expected = visible ? payload : redacted
          observations.push({ kind: 'legacy-transition-read', role: role[0], name, direction, status: res.status, visible, correct: res.status === 200 && JSON.stringify(response.payload) === JSON.stringify(expected), actual: response.payload, expected })
          assert.equal(native.prepare('SELECT status FROM action_history').get().status, direction === 'undo' ? 'redoable' : 'undoable')
          const fallback=await app.request('/history/1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:direction==='undo'?'undoable':'redoable',last_error:'Forward mutation refused by current permission'})},{DB},context)
          assert.equal(fallback.status,200,'client closure failure can acknowledge original status');assert.equal(native.prepare('SELECT status FROM action_history').get().status,direction==='undo'?'undoable':'redoable')
        }
        reset(); seed(payload)
        const patched = await app.request('/history/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'redoable' }) }, { DB }, context)
        assert.equal(patched.status, 200, 'existing owner status acknowledgement does not acquire invented cost restriction')
      }
      user = roleUser(role)
      for(const ignored of ['ordinary scalar','{"cost_price_usd":73129}',null,17,false]) {
        reset();const res=await post('/history',{label:'Discarded scalar compatibility',undo_payload:ignored,redo_payload:ignored});assert.equal(res.status,200);const stored=native.prepare('SELECT undo_payload,redo_payload FROM action_history').get();assert.equal(stored.undo_payload,'{}');assert.equal(stored.redo_payload,'{}')
      }
      for(const status of ['failed','recorded']){reset();seed(financial[1][1]);const res=await app.request('/history/1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,last_error:'Metadata only'})},{DB},context);assert.equal(res.status,200);assert.equal(native.prepare('SELECT status FROM action_history').get().status,status)}
      for (const body of [null, {}, { summary: 'Please look again' }]) {
        reset(); pending(financial[1][1]); const before = native.prepare('SELECT payload_json FROM pending_actions').get().payload_json
        const res = body === null ? await app.request('/review/1/resubmit', { method: 'POST' }, { DB }, context) : await post('/review/1/resubmit', body), response = await res.json()
        assert.equal(res.status, 200); assert.equal(native.prepare('SELECT payload_json FROM pending_actions').get().payload_json, before)
        assert.equal(native.prepare('SELECT status FROM pending_actions').get().status, 'open')
        assert.equal(response.data.payload_json, JSON.stringify(api.canViewAcquisitionCosts(user) ? financial[1][1] : financial[1][2]))
        observations.push({ kind: 'unchanged-resubmit', role: role[0], body, correct: true })
      }
      for (const payload of literalProducerPayloads()) {
        reset(); const created = await post('/history', { label: 'Literal boundary fixture', undo_payload: payload, redo_payload: payload }); assert.equal(created.status, 200)
        const id = (await created.json()).id, transitioned = await post('/history/' + id + '/undo', {}), response = await transitioned.json()
        assert.equal(transitioned.status, 200); assert.deepEqual(response.payload, payload)
        pending({}); assert.equal((await post('/review/1/resubmit', { payload })).status, 200)
      }
      for (const allowed of [false, true]) for (const direction of ['undo', 'redo']) {
        reset(); user = roleUser(role, allowed)
        const undo = { applier: 'branch.update', id: 1, fields: { notes: 'before' } }, redo = { applier: 'branch.update', id: 1, fields: { notes: 'after' } }
        native.prepare('UPDATE branches SET notes=? WHERE id=1').run(direction === 'undo' ? 'after' : 'before'); seed(undo, redo, direction === 'undo' ? 'undoable' : 'redoable')
        const before = snapshot(), branchBefore = JSON.stringify(native.prepare('SELECT * FROM branches ORDER BY id').all())
        const res = await post('/history/1/' + direction, { require_applied: true }), response = await res.json(), permitted = allowed || role[0] === 'admin'
        assert.equal(res.status, permitted ? 200 : 403); if (permitted) { assert.equal(response.applied, true); assert.equal(native.prepare('SELECT notes FROM branches WHERE id=1').get().notes, direction === 'undo' ? 'before' : 'after') } else { assert.equal(snapshot(), before); assert.equal(JSON.stringify(native.prepare('SELECT * FROM branches ORDER BY id').all()), branchBefore) }
        observations.push({ kind: 'real-branch-applier', role: role[0], allowed, correct: true, status: res.status })
      }
    }
    for(const role of roles){user=roleUser(role);let deep={cost_price_usd:73129};for(let i=0;i<35;i++)deep={nested:deep};reset();const admission=await post('/history',{label:'Deep boundary',undo_payload:deep});assert.equal(admission.status,api.canEditAcquisitionCosts(user)?200:403);reset();seed(deep);const replay=await post('/history/1/undo',{}),body=await replay.json();assert.equal(replay.status,200);assert.equal(JSON.stringify(body.payload).includes('73129'),api.canViewAcquisitionCosts(user))}
    user=roleUser(roles[2]);reset();const largeRow=JSON.stringify({cost_price_usd:73129,count:2,note:'x'.repeat(1000000)}),large=Array(9).fill(largeRow);seed(large)
    const largeResponse=await post('/history/1/undo',{}),largeBody=await largeResponse.json();assert.equal(largeResponse.status,200);assert.ok(!JSON.stringify(largeBody).includes('cost_price_usd'));assert.ok(largeBody.payload.every(row=>row===null),'whole response budget shared after item undo+redo consumes16MiB')
    console.log('HISTORY_BOUNDARY_BUDGET',JSON.stringify({originalPayloadBytes:Buffer.byteLength(JSON.stringify(large)),responseBytes:Buffer.byteLength(JSON.stringify(largeBody)),nullReplayMembers:largeBody.payload.filter(row=>row===null).length}))
    console.log('HISTORY_BOUNDARY_ROLE_OBSERVATIONS', JSON.stringify({ exprDepth: native.limits.exprDepth, observations, total: observations.length, failures: observations.filter(row => !row.correct).length }))
    assert.ok(observations.every(row => row.correct), 'actual route financial envelope admission and no-view replay projection')
  }

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
    encodedCases.push(...literalStructuredCases())
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
    for (const payload of literalProducerPayloads()) {
      user = { ...denied, id: 7 }
      const created = await post('/history', { label: 'Independent ordinary money', undo_payload: payload }), createdBody = await created.json()
      assert.equal(created.status, 200)
      assert.equal(native.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(createdBody.id).undo_payload, JSON.stringify(payload))
      native.prepare("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,status,requested_by) VALUES(1,'inventory','update','fixture','{}','rejected',7)").run()
      assert.equal((await post('/review/1/resubmit', { payload })).status, 200)
      user = { ...denied, id: 9, permissions: JSON.stringify({ audit_log: true, product_cost_view: false, product_cost_edit: false }) }
      const before = snapshot(), visible = await get('/history?scope=global&all=1&limit=20'), visibleBody = await visible.json()
      assert.equal(visible.status, 200)
      assert.deepEqual(visibleBody.items.find(row => row.id === createdBody.id).undo_payload, payload)
      user = { ...user, id: 7 }
      const mine = await get('/review/mine'), mineBody = await mine.json()
      assert.equal(mine.status, 200)
      assert.equal(mineBody.data.find(row => row.id === 1).payload_json, JSON.stringify(payload))
      assert.equal(snapshot(), before)
      console.log('INDEPENDENT_DOMAIN_ROUTE', JSON.stringify({ payload, historyStatus: created.status, reviewStatus: 200, historyReadExact: true, mineReadExact: true }))
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
    await checkHistoryBoundaryRoles()
    console.log('PASS actual actionHistory/reviewQueue admission, native depth100 durable writes/refusals, real permissions/db/pending helpers; identity injected, replay/approval/audit delivery excluded')
  } finally { native.close() }
}

async function checkLiteralEnvelopeRoutes() {
  checkReplayResponseProjectionContract(access)
  await checkAuditProducerLiterals(access)
  await checkEnvelopeRoutes(access)
  await checkLiteralProductGallery(access)
}
checkLiteralEnvelopeRoutes().catch(error => { console.error(error); process.exitCode = 1 })

function literalProducerPayloads() {
  return [
    { keys: ['store_name','telegram_topic_id'], added:['KHQR'], entries:['line_added'], changed_columns:['sales.subtotal_usd'], membership_to_notes:['000012','{"cost_price_usd":7}'] },
    { moved:{products_by_name:[[11,'{"cost_price_usd":7}']],product_batches_by_name:[[12,'ខូច']],supplier_invoices_by_name:[[13,null]],customer_receivables_by_name:[[14,'000012']]} },
    { image_gallery: ['/uploads/rose-1.jpg', '/uploads/rose-2.jpg', '/uploads/rose-3.jpg'], name: 'Rose' },
    { imagePaths: ['/uploads/rose-1.jpg'], imageNames: ['Rose_1.jpg'], currentGallery: ['/uploads/old.jpg'] },
    { absorbedBarcodes: ['00012345'], reparentedTables: ['sale_items:1'], imagesMovedToKeeper: ['/uploads/old.jpg'] },
    { unknown_after_fields: ['customer_id', 'membership_number'], backfilled: ['name'] },
    { configuredBefore: ['cash'], configuredAfter: ['cash', 'KHQR'], configured_methods: ['cash', 'KHQR'] },
    { source_group_keys_json: JSON.stringify(['000012', 'ខូច']), source_ids: ['paid-source'], caseKeys: ['keeper:discarded'] },
  ]
}

function literalStructuredCases() {
  const row = JSON.stringify({ cost_price_usd: 7, count: 2 }), safe = JSON.stringify({ count: 2 })
  return [
    ...['keys','added','entries','membership_to_notes','changed_columns'].map(key=>[{details:{[key]:[{opaque:[row]}]}},{details:{[key]:[{opaque:[safe]}]}}]),
    [{details:{moved:{products_by_name:[[11,{opaque:[row]}]]}}},{details:{moved:{products_by_name:[[11,{opaque:[safe]}]]}}}],
    [{details:{moved:{products_by_name:[['1',row]]}}},{details:{moved:{products_by_name:[[null,safe]]}}}],
    [{ details: { names: [{ opaque: [row] }] } }, { details: { names: [{ opaque: [safe] }] } }],
    [{ details: { tags: [{ opaque: [row] }] } }, { details: { tags: [{ opaque: [safe] }] } }],
    [{ details: { source_ids_json: JSON.stringify([{ opaque: [row] }]) } }, { details: { source_ids_json: JSON.stringify([{ opaque: [safe] }]) } }],
    [{ details: { names: [[row]] } }, { details: { names: [[safe]] } }],
    [{ details: { image_gallery: [{ opaque: [row] }] } }, { details: { image_gallery: [{ opaque: [safe] }] } }],
  ]
}

function compileLiteralModule(source, imports = {}) {
  const mod = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => { assert.ok(Object.hasOwn(imports, name), 'real literal dependency ' + name); return imports[name] }, mod, mod.exports)
  return mod.exports
}

async function checkLiteralProductGallery(api) {
  const { DatabaseSync } = require('node:sqlite'), native = new DatabaseSync(':memory:')
  native.limits.exprDepth = 100
  native.exec("CREATE TABLE product_images(id INTEGER PRIMARY KEY, product_id INTEGER, image_path TEXT, sort_order INTEGER); INSERT INTO product_images VALUES(1,7,'/uploads/front.jpg',0),(2,7,'/uploads/back.jpg',1),(3,7,'/uploads/side.jpg',2)")
  const DB = { prepare(sql) { return { async all(params) { return native.prepare(sql).all(params) } } } }
  const media = compileLiteralModule(fs.readFileSync(path.join(root, 'lib/media.ts'), 'utf8'))
  const sqlBinding = compileLiteralModule(fs.readFileSync(path.join(root, 'lib/sqlBinding.ts'), 'utf8'))
  const productText = fs.readFileSync(path.join(root, 'routes/products.ts'), 'utf8'), ast = ts.createSourceFile('products.ts', productText, ts.ScriptTarget.Latest, true)
  const attachNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'attachImageGallery')
  const searchNode = ast.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).startsWith("app.get('/search',"))
  assert.ok(attachNode); assert.ok(searchNode)
  const limitText = fs.readFileSync(path.join(root, 'lib/importImageMatch.ts'), 'utf8'), limit = Number(limitText.match(/export const ADMIN_MAX_IMAGES_PER_PRODUCT\s*=\s*(\d+)/)[1])
  const attachCode = ts.transpileModule(attachNode.getText(ast) + '\nreturn attachImageGallery;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const attach = new Function('getDb', 'selectInChunks', 'buildInClause', 'sanitizeMediaList', 'ADMIN_MAX_IMAGES_PER_PRODUCT', attachCode)(env => env.DB, sqlBinding.selectInChunks, sqlBinding.buildInClause, media.sanitizeMediaList, limit)
  const frontend = fs.readFileSync(path.resolve(root, '../../frontend/src/components/products/helpers/productGalleryHelpers.ts'), 'utf8'), frontAst = ts.createSourceFile('gallery.ts', frontend, ts.ScriptTarget.Latest, true)
  const selected = frontAst.statements.filter(node => ts.isFunctionDeclaration(node) && ['normalizeProductGallery', 'getProductGalleryImages', 'buildProductThumbnailState'].includes(node.name?.text))
  const cap = frontAst.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(frontAst) === 'MAX_PRODUCT_GALLERY_IMAGES'))
  assert.equal(selected.length, 3); assert.ok(cap)
  const client = compileLiteralModule(cap.getText(frontAst) + '\n' + selected.map(node => node.getText(frontAst)).join('\n'))
  try {
    const products = await attach({ DB }, [{ id: 7, name: 'Gallery fixture', image_path: '/uploads/front.jpg', cost_price_usd: 3 }]), expected = ['/uploads/front.jpg', '/uploads/back.jpg', '/uploads/side.jpg']
    const payload = { items: products, total: 1, page: 1, pageSize: 20, totalPages: 1 }, original = JSON.stringify(payload), before = JSON.stringify(native.prepare('SELECT * FROM product_images ORDER BY id').all())
    for (const who of [denied, viewer, actor({ product_cost_view: false }, {}, 'admin')]) {
      const app = new Hono()
      app.use('*', async (c, next) => { c.set('user', who); await next() }); app.use('*', api.acquisitionCostResponses)
      const handler = ts.transpileModule(searchNode.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
      new Function('app', 'parseProductReadSurface', 'productSurfaceDenialReason', 'productSearchCacheVersion', 'cachedJsonResponse', 'searchProductsWithIndexFallback', 'refreshCachedProductRows', 'isImageOnlyRead', 'restrictListPayloadForImageOnly', handler)(app, () => 'products', () => null, async () => 'fixture', async (_r, _ctx, _version, _ttl, produce) => produce(), async () => payload, () => { throw Error('Unexpected refresh') }, () => false, () => { throw Error('Unexpected image-only restriction') })
      app.get('/detail', c => c.json({ item: products[0] }))
      const res = await app.request('/search', {}, {}, { waitUntil() {}, passThroughOnException() {} }), body = await res.json(), detail = await app.request('/detail'), detailBody = await detail.json()
      console.log('LITERAL_GALLERY_ROUTE', JSON.stringify({ role: who.role_code, viewCost: api.canViewAcquisitionCosts(who), status: res.status, returned: body.items[0].image_gallery, client: client.normalizeProductGallery(body.items[0].image_gallery, body.items[0].image_path) }))
      assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(body.items[0].image_gallery, expected)
      assert.deepEqual(client.getProductGalleryImages(body.items[0]), expected)
      assert.deepEqual(client.buildProductThumbnailState(body.items[0]).gallery, expected)
      assert.deepEqual(detailBody.item.image_gallery, expected)
      assert.equal(body.items[0].cost_price_usd, api.canViewAcquisitionCosts(who) ? 3 : undefined)
      assert.equal(JSON.stringify(payload), original); assert.equal(JSON.stringify(native.prepare('SELECT * FROM product_images ORDER BY id').all()), before)
    }
  } finally { native.close() }
}


function createLiteralAuditLoader() {
 const cache=new Map(),sourceRoot=root
 function read(file){return fs.readFileSync(file,'utf8')}
 function compile(source, imports){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(imports,m,m.exports);return m.exports}
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports=compile(read(file),id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id));cache.set(file,exports);return exports}
 function ast(file){return ts.createSourceFile(file,read(path.join(sourceRoot,file)),ts.ScriptTarget.Latest,true)}
 function find(node,predicate){if(predicate(node))return node;let hit;ts.forEachChild(node,child=>{if(!hit)hit=find(child,predicate)});return hit}
 function evaluate(node,tree,bindings){return new Function(...Object.keys(bindings),'return ('+node.getText(tree)+')')(...Object.values(bindings))}
 return {load,compile,read,ast,find,evaluate,sourceRoot}
}
async function checkAuditProducerLiterals(api) {
 const {load,compile,read,ast,find,evaluate,sourceRoot}=createLiteralAuditLoader(),{DatabaseSync}=require('node:sqlite')
 const wt=path.resolve(root,'../..')
 const access = api, permissions = load(path.join(sourceRoot, 'lib/permissions.ts'))
 const reader = load(path.join(sourceRoot, 'lib/auditLogPage.ts')), query = load(path.join(sourceRoot, 'lib/auditLogQuery.ts'))
 const audit = compile(read(path.join(sourceRoot, 'lib/audit.ts')), id => { assert.equal(id, './db'); return { getDb: () => { throw Error('Unselected audit service') } } })
 const settings = ast('routes/settings.ts'), sales = ast('routes/sales.ts')
 const keysNode = find(settings, n => ts.isObjectLiteralExpression(n) && n.getText(settings) === '{ keys: changedKeys }')
 const addedNode = find(settings, n => ts.isObjectLiteralExpression(n) && n.properties.some(p => p.name?.getText(settings) === 'action' && p.initializer?.getText(settings) === "'payment_methods_backfill'"))
 const entriesNode = find(sales, n => ts.isPropertyAssignment(n) && n.name.getText(sales) === 'entries' && n.initializer.getText(sales).startsWith('ledgerEntries.map'))
 assert.ok(keysNode); assert.ok(addedNode); assert.ok(entriesNode)
 const legacy=ast('lib/legacySubtotalRepair.ts'), changedNode=find(legacy,n=>ts.isPropertyAssignment(n)&&n.name.getText(legacy)==='changed_columns')
 const topic=ast('lib/telegramTopicSetting.ts'),topicNode=find(topic,n=>ts.isObjectLiteralExpression(n)&&n.getText(topic)==='{ keys }')
 assert.ok(changedNode);assert.ok(topicNode)
 const cases = [
  { name: 'legacy-subtotal-field-audit', entity: 'sale', expected: {changed_columns:evaluate(changedNode.initializer,legacy,{})} },
  { name: 'topic-settings-key-audit', entity: 'settings', expected:evaluate(topicNode,topic,{keys:['telegram_topic_id']}) },
  { name: 'settings-key-audit', entity: 'settings', expected: evaluate(keysNode, settings, { changedKeys: ['store_name', 'pos_payment_methods'] }) },
  { name: 'payment-method-backfill-audit', entity: 'settings', expected: evaluate(addedNode, settings, { merged: { added: ['KHQR', 'ABA'] } }) },
  { name: 'sale-amendment-ledger-kind-audit', entity: 'sale', expected: { entries: evaluate(entriesNode.initializer, sales, { ledgerEntries: [{ kind: 'line_added' }, { kind: 'line_updated' }] }) } },
 ]
 const native = new DatabaseSync(':memory:'); native.limits.exprDepth = 100
 const schema = read(path.join(wt, 'cloudflare/migrations/0001_init.sql'))
 for (const table of ['audit_logs', 'users', 'user_sessions']) { const match = schema.match(new RegExp('CREATE TABLE ' + table + ' \\([\\s\\S]*?\\n\\);')); assert.ok(match); native.exec(match[0]) }
 const db = { prepare(sql) { return { async all(params = {}) { return native.prepare(sql).all(params) } } } }
 for (let i = 0; i < cases.length; i++) { const c = cases[i], statement = audit.buildAuditStatement(null, 'fixture actor', 'update', c.entity, String(i + 1), c.expected); native.prepare(statement.sql).run(statement.params) }
 const merge = load(path.join(sourceRoot, 'lib/contactMerge.ts'))
 native.exec('CREATE TABLE returns(id INTEGER PRIMARY KEY,supplier_id INTEGER,customer_id INTEGER); CREATE TABLE products(id INTEGER PRIMARY KEY,supplier TEXT); CREATE TABLE product_batches(id INTEGER PRIMARY KEY,supplier_id INTEGER,supplier_name TEXT); CREATE TABLE supplier_invoices(id INTEGER PRIMARY KEY,supplier_id INTEGER,supplier_name TEXT); CREATE TABLE customer_receivables(id INTEGER PRIMARY KEY,customer_id INTEGER,customer_name TEXT); CREATE TABLE sales(id INTEGER PRIMARY KEY,customer_id INTEGER); CREATE TABLE customer_share_submissions(id INTEGER PRIMARY KEY,customer_id INTEGER); CREATE TABLE loyalty_point_adjustments(id INTEGER PRIMARY KEY,customer_id INTEGER)')
 const named = '{"cost_price_usd":7}', membership = '000012'
 for(const sql of ['INSERT INTO products VALUES(11,?)','INSERT INTO product_batches VALUES(12,NULL,?)','INSERT INTO supplier_invoices VALUES(13,NULL,?)','INSERT INTO customer_receivables VALUES(14,NULL,?)']) native.prepare(sql).run(named)
 for(const table of ['suppliers','customers']) {
  const plan = merge.buildContactMergePlan({table,entity:table,editableColumns:['name','notes',...(table==='customers'?['membership_number']:[])],keeper:{id:1,name:'Keeper',notes:'',membership_number:'chosen'},members:[{id:2,name:named,notes:'',membership_number:membership}],membershipSourceId:1,portalAccounts:[],hasCustomerReceivables:true,hasSupplierInvoices:true,audit:{operationId:'literal-'+table,userId:null,userName:'Fixture',deviceName:null,deviceTz:null}})
  const statement = plan.statements.find(row=>row.sql.startsWith('INSERT INTO audit_logs'))
  assert.ok(statement)
  native.prepare(statement.sql).run(statement.params)
  const stored=native.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').get()
  const prior=JSON.parse(stored.old_value),after=JSON.parse(stored.new_value)
  for(const field of table==='customers'?['customer_receivables_by_name']:['products_by_name','product_batches_by_name','supplier_invoices_by_name']) {
   assert.equal(prior.moved[field].length,1);assert.equal(prior.moved[field][0].length,2);assert.ok(Number.isSafeInteger(prior.moved[field][0][0]));assert.equal(prior.moved[field][0][1],named)
  }
  if(table==='customers')assert.deepEqual(after.membership_to_notes,[membership])
  const columns=table==='customers'?['old_value','new_value']:['old_value']
  for(const column of columns) cases.push({name:table+'-merge-'+column,entity:table,id:String(stored.entity_id),rowId:stored.id,column,expected:JSON.parse(stored[column])})
 }
 const before = JSON.stringify(native.prepare('SELECT * FROM audit_logs').all())
 let user
 const app = new Hono(); app.use('*', async (c, next) => { c.set('user', user); await next() }); app.use('*', access.acquisitionCostResponses)
 const compat = ast('routes/compat.ts'), handler = find(compat, n => ts.isExpressionStatement(n) && n.getText(compat).startsWith("app.get('/system/audit-logs',"))
 assert.ok(handler)
 new Function('app', 'requireAuth', 'getActionTier', 'decodeAuditCursor', 'readAuditLogPage', 'getDb', ts.transpileModule(handler.getText(compat), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(app, async (c, next) => next(), permissions.getActionTier, query.decodeAuditCursor, reader.readAuditLogPage, () => db)
 const roles = [
  { name: 'denied', permissions: { audit_log: true, product_cost_view: false, product_cost_edit: false } },
  { name: 'edit-only', permissions: { audit_log: true, product_cost_view: false, product_cost_edit: true } },
  { name: 'view-only', permissions: { audit_log: true, product_cost_view: true, product_cost_edit: false } },
  { name: 'admin-false', role_code: 'admin', permissions: { audit_log: true, product_cost_view: false, product_cost_edit: false } },
 ]
 assert.equal(cases.length,8)
 const observations = []
 for (const role of roles) {
  user = { id: 7, role_code: role.role_code || 'manager', permissions: JSON.stringify(role.permissions), role_permissions: JSON.stringify({ product_cost_view: true, product_cost_edit: true }) }
  const response = await app.request('/system/audit-logs?counts=none'), body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body))
  for (let i = 0; i < cases.length; i++) { const c = cases[i], row = body.items.find(row => c.rowId ? row.id === c.rowId : row.entity_id === String(i + 1) && row.entity === c.entity); assert.ok(row); observations.push({ role: role.name, case: c.name, expected: c.expected, actual: JSON.parse(row[c.column || 'details']), inputDenied: access.hasAcquisitionCostInput({ details: c.expected }, user), preserved: JSON.stringify(JSON.parse(row[c.column || 'details'])) === JSON.stringify(c.expected) }) }
 }
 assert.equal(JSON.stringify(native.prepare('SELECT * FROM audit_logs').all()), before)
 console.log(JSON.stringify({ label: 'LITERAL_ACTUAL_AUDIT_PRODUCERS', exprDepth: native.limits.exprDepth, method: 'Actual producer AST expressions; real buildAuditStatement + native SQLite; actual compat audit handler + real readAuditLogPage/permissions/projection. Authentication identity injected; no live call.', observations }, null, 2))
 native.close()
 assert.ok(observations.every(row => row.preserved && !row.inputDenied), 'actual producer literal audit bytes and denied admission preserved')
}

function checkReplayResponseProjectionContract(api) {
 const source=ts.createSourceFile('actionHistory.ts',fs.readFileSync(path.join(root,'routes/actionHistory.ts'),'utf8'),ts.ScriptTarget.Latest,true)
 const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='visibleHistoryReplayResponse');assert.ok(node)
 const code=ts.transpileModule(node.getText(source)+'\nreturn visibleHistoryReplayResponse',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,project=new Function('projectAcquisitionCosts',code)(api.projectAcquisitionCosts)
 const privateRow=JSON.stringify({cost_price_usd:73129,count:2}),safeRow=JSON.stringify({count:2})
 const raw={success:true,undo_payload:{names:['existing undo slot']},response_json:{names:['existing response slot']},original_json:{labels:['existing original slot']},item:{undo_payload:{opaque:[privateRow]},redo_payload:{opaque:[privateRow]}},payload:{opaque:[privateRow]},names:['000012',privateRow]},before=JSON.stringify(raw)
 for(const who of [denied,viewer,editor,actor({product_cost_view:true,product_cost_edit:true}),actor({product_cost_view:false,product_cost_edit:false},{},'admin')]){
  const result=project(raw,who);assert.deepEqual(Object.keys(result),Object.keys(raw));assert.deepEqual(result.undo_payload,raw.undo_payload);assert.deepEqual(result.response_json,raw.response_json);assert.deepEqual(result.original_json,raw.original_json);assert.deepEqual(result.names,raw.names)
  if(api.canViewAcquisitionCosts(who))assert.equal(JSON.stringify(result),before,'authorized response bytes/order unchanged');else{assert.deepEqual(result.payload,{opaque:[safeRow]});assert.deepEqual(result.item,{undo_payload:{opaque:[safeRow]},redo_payload:{opaque:[safeRow]}})}
  assert.equal(JSON.stringify(raw),before,'raw response and applier payload not mutated')
 }
 console.log('PASS actual response projector collision/authorized bytes/ordinary literals/raw immutability')
}
