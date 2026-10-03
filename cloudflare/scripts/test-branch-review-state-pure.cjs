const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const ts = require('typescript')
const moduleCache = new Map()
let currentDb
let beforeBatch
let afterBatch
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
function evaluate(source, dependencies, result) {
  return new Function(...Object.keys(dependencies), 'exports', `${compile(source)};return ${result}`)(...Object.values(dependencies), {})
}
function sourceTree(relative) {
  return ts.createSourceFile(relative, fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), ts.ScriptTarget.Latest, true)
}
function functionSource(tree, name) {
  return tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree)
}
const toDbBool = evaluate(functionSource(sourceTree('lib/db.ts'), 'toDbBool'), {}, 'toDbBool')
function adapter(db) {
  return {
    prepare: sql => ({
      get: async params => Array.isArray(params) ? db.prepare(sql).get(...params) : db.prepare(sql).get(params || {}),
      all: async params => Array.isArray(params) ? db.prepare(sql).all(...params) : db.prepare(sql).all(params || {}),
      run: async params => { const result = db.prepare(sql).run(params || {}); return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) } },
    }),
    batch: async statements => {
      if (beforeBatch) { const inject = beforeBatch; beforeBatch = null; inject(db) }
      const results = execute(db, statements)
      if (afterBatch) { const inject = afterBatch; afterBatch = null; inject(db) }
      return results
    },
    batchOnce: async statements => adapter(db).batch(statements),
  }
}
function load(name) {
  if (moduleCache.has(name)) return moduleCache.get(name)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compile(fs.readFileSync(path.join(__dirname, '../src/lib', `${name}.ts`), 'utf8')))(request => {
    if (request === './db') return { toDbBool, getDb: () => adapter(currentDb) }
    if (request.startsWith('./')) return load(request.slice(2))
    throw new Error(`Unexpected import ${request}`)
  }, module, module.exports)
  moduleCache.set(name, module.exports)
  return module.exports
}
function execute(db, statements) {
  db.exec('BEGIN')
  try {
    const results = statements.map(({ sql, params }) => {
      const statement = db.prepare(sql)
      if (/^\s*SELECT/i.test(sql)) return { results: statement.all(params || {}), success: true }
      const result = statement.run(params || {})
      return { results: [], success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    })
    db.exec('COMMIT')
    return results
  }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
function world() {
  beforeBatch = null
  afterBatch = null
  currentDb = openDb(loadAll()).db
  currentDb.exec("INSERT INTO branches(id,name,location,notes,is_active,is_default,updated_at) VALUES(1,'Shop','Market','before',1,1,'same'),(2,'Warehouse','Depot','bulk',1,0,'same')")
  return currentDb
}
const writes = load('branchWrites')
function routeHandler(method, routePath, dependencies = {}) {
  const tree = sourceTree('routes/branches.ts')
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === `app.${method}` && node.expression.arguments[0]?.text === routePath)
  assert.ok(statement, `actual ${method} ${routePath}`)
  const callback = statement.expression.arguments[1].getText(tree)
  return evaluate(`const handler = ${callback}`, {
    ...writes, ...load('permissions'), ...load('conflictControl'), ...load('canonicalBranchIdentity'), ...load('reviewGate'),
    ...load('businessMaintenanceGuard'), ...load('audit'), getDb: () => adapter(currentDb), broadcast: async () => {}, actorSnapshot: () => 'User', ...dependencies,
  }, 'handler')
}
function context(body, user = { id: 7, permissions: JSON.stringify({ branches: true }) }) {
  return { env: {}, req: { param: () => '1', json: async () => body }, get: () => user,
    json: (value, status = 200) => ({ status, value }), executionCtx: { waitUntil: () => {} } }
}
function approvalHandler(dependencies = {}) {
  const tree = sourceTree('lib/reviewApply.ts')
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'registerApplier'
    && node.expression.arguments.slice(0, 3).map(arg => arg.text).join('/') === 'branches/update/branch')
  const permissionError = tree.statements.find(node => node.name?.text === 'ReviewRequesterPermissionError').getText(tree)
  return evaluate(`${permissionError}\n${functionSource(tree, 'recoverApprovedBranchAction')}\nconst handler=${statement.expression.arguments[3].getText(tree)}`, {
    ...writes, ...load('permissions'), ...load('conflictControl'), ...load('audit'), getDb: () => adapter(currentDb), notify: async () => {}, ...dependencies,
  }, 'handler')
}
async function queuedBranch(db, body = { notes: 'approved' }) {
  db.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(3,'Requester','employee','{"branches":"review"}');
    INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(7,'requester','Requester','fixture',3,'{}',1);`)
  const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
  const id = await load('pendingActions').createPendingAction({}, { section: 'branches', actionType: 'update', entityType: 'branch', entityId: 1,
    payload: body, expectedEntityStateJson: writes.branchExpectedStateJson(current), requestedBy: 7 })
  return db.prepare('SELECT * FROM pending_actions WHERE id=?').get(id)
}
function resubmitHandler() {
  const tree = sourceTree('routes/reviewQueue.ts')
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'app.post' && node.expression.arguments[0]?.text === '/:id/resubmit')
  return evaluate(`const handler=${statement.expression.arguments[1].getText(tree)}`, {
    ...writes, ...load('pendingActions'), getDb: () => adapter(currentDb), hasAcquisitionCostInput: () => false,
    productRemovePendingPointer: () => null, audit: async () => {}, broadcast: async () => {}, actorSnapshot: () => 'Requester',
  }, 'handler')
}

const migrationPath = path.join(__dirname, '../migrations/0223_branch_lifecycle_identity.sql')
let failures = 0
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
}

async function main() {
  await check('0223 preserves every prior table value and accepts legacy fresh seeding', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const d1 = openDb(loadAll({ through: 222 }))
    const db = d1.db
    db.exec(`INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','sales',1,1,'same'),(2,'Warehouse','stock',1,0,'same');
      INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json) VALUES('branches','update','branch',1,'{"notes":"waiting"}');
      INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES('keep',1,'keep','stock_in','{}');`)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name) }))
    const snapshot = () => JSON.stringify(tables.map(({ name, columns }) => db.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${name}"`).all()))
    const before = snapshot()
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.equal(sql.includes('\r'), false)
    db.exec(sql)
    assert.equal(snapshot(), before)
    assert.deepEqual(db.prepare('SELECT role,canonical_key,successor_branch_id FROM branches').all().map(row => Object.values(row)), [[null, null, null], [null, null, null]])
    assert.equal(db.prepare('SELECT expected_entity_state_json FROM pending_actions').get().expected_entity_state_json, null)
    db.exec("INSERT INTO branches(name,is_active,is_default) VALUES('Legacy',1,0)")
    assert.equal(db.prepare("SELECT role FROM branches WHERE name='Legacy'").get().role, null)
    db.close()
  })
  await check('0223 rejects malformed lifecycle identity and keeps stable keys', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const db = openDb(loadAll()).db
    db.exec("PRAGMA foreign_keys=ON; INSERT INTO branches(id,name,is_active,is_default,canonical_key) VALUES(1,'Shop',1,1,'shop'),(2,'Warehouse',1,0,'warehouse')")
    for (const sql of ["UPDATE branches SET role='bad' WHERE id=1", "UPDATE branches SET canonical_key='warehouse' WHERE id=1", "INSERT INTO branches(name,canonical_key) VALUES('duplicate','shop')", "UPDATE branches SET successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=99 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1.5 WHERE id=2"]) assert.throws(() => db.exec(sql), sql)
    db.exec('UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1')
    assert.equal(db.prepare('SELECT successor_branch_id FROM branches WHERE id=1').get().successor_branch_id, 2)
    assert.throws(() => db.exec("INSERT INTO pending_actions(section,action_type,entity_type,expected_entity_state_json) VALUES('branches','update','branch','not JSON')"))
    db.close()
  })
  await check('same-second read-to-batch metadata race rolls back', () => {
    const db = world()
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const statements = writes.branchUpdateStatements(1, { notes: 'stale' }, current)
    db.exec("UPDATE branches SET notes='later' WHERE id=1")
    assert.throws(() => execute(db, statements))
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'later')
    db.close()
  })
  await check('content token rejects same-second and missing client expectations', async () => {
    const db = world()
    const before = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const token = await writes.branchEditEtag(before)
    await writes.assertBranchEditEtag(before, token)
    db.exec("UPDATE branches SET notes='later' WHERE id=1")
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    await assert.rejects(writes.assertBranchEditEtag(current, token), error => error.code === 'branch_edit_conflict')
    await assert.rejects(writes.assertBranchEditEtag(current, undefined), error => error.code === 'branch_edit_conflict')
    db.close()
  })
  await check('real review gate stores server expectation outside client payload', async () => {
    const db = world()
    const expected = JSON.stringify({ kind: 'branch-edit-state', version: 1, entity_id: 1, state: { id: 1 } })
    const gate = load('reviewGate')
    const id = await gate.maybeQueueForReview({}, { id: 7, permissions: JSON.stringify({ branches: 'review', 'branches:edit': true }) }, 'branches', {
      actionType: 'update', entityType: 'branch', entityId: 1, payload: { notes: 'desired', expected_entity_state_json: 'forged' }, expectedEntityStateJson: expected,
    })
    const row = db.prepare('SELECT * FROM pending_actions WHERE id=?').get(id)
    assert.equal(row.expected_entity_state_json, expected)
    assert.equal(JSON.parse(row.payload_json).expected_entity_state_json, 'forged')
    assert.equal(await gate.maybeQueueForReview({}, { id: 7, permissions: JSON.stringify({ branches: true, 'branches:edit': 'review' }) }, 'branches', { actionType: 'update', entityType: 'branch', payload: {} }), null)
    db.close()
  })
  await check('actual branch PUT refuses missing or stale content token and real review gate uses server baseline', async () => {
    const db = world()
    const put = routeHandler('put', '/:id')
    const original = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const expectedEditEtag = await writes.branchEditEtag(original)
    assert.equal((await put(context({ notes: 'missing' }))).status, 409)
    db.exec("UPDATE branches SET notes='same-second later' WHERE id=1")
    assert.equal((await put(context({ notes: 'stale', expectedEditEtag }))).status, 409)
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const response = await put(context({ notes: 'queued', expectedEditEtag: await writes.branchEditEtag(current), expected_entity_state_json: 'forged' }, { id: 7, permissions: JSON.stringify({ branches: 'review', 'branches:edit': true }) }))
    assert.equal(response.status, 202)
    const row = db.prepare('SELECT * FROM pending_actions').get()
    assert.equal(row.expected_entity_state_json, writes.branchExpectedStateJson(current))
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'same-second later')
    db.close()
  })
  await check('direct PUT returns its committed state even after a postcommit edit', async () => {
    const db = world()
    const row = db.prepare('SELECT * FROM branches WHERE id=1').get()
    afterBatch = db => db.exec("UPDATE branches SET notes='postcommit other writer' WHERE id=1")
    const response = await routeHandler('put', '/:id')(context({ notes: 'mine', expectedEditEtag: await writes.branchEditEtag(row) }))
    assert.equal(response.status, 200)
    assert.equal(response.value.success, true)
    assert.equal(response.value.branch.notes, 'mine')
    assert.equal(response.value.branch.edit_etag, await writes.branchEditEtag(response.value.branch))
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'postcommit other writer')
    assert.deepEqual({ ...db.prepare("SELECT user_id,user_name,action,entity,CAST(entity_id AS INTEGER) AS entity_id FROM audit_logs WHERE entity='branch'").get() },
      { user_id: 7, user_name: 'User', action: 'update', entity: 'branch', entity_id: 1 })
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='branch'").get().n, 1)
    db.close()
  })
  await check('approval atomically changes metadata and pending status using trusted baseline', async () => {
    const db = world()
    const row = await queuedBranch(db)
    const result = await approvalHandler()({}, row, { id: 8, name: 'Reviewer' })
    assert.equal(result.pendingActionMarkedAtomically, true)
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'approved')
    assert.equal(db.prepare('SELECT status FROM pending_actions').get().status, 'approved')
    assert.deepEqual({ ...db.prepare("SELECT user_id,user_name,action,entity,CAST(entity_id AS INTEGER) AS entity_id FROM audit_logs WHERE entity='branch'").get() },
      { user_id: 8, user_name: 'Reviewer', action: 'update', entity: 'branch', entity_id: 1 })
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='branch'").get().n, 1)
    await assert.rejects(approvalHandler()({}, row, { id: 8, name: 'Reviewer' }))
    db.close()
  })
  await check('approval refuses legacy baseline and same-second changed branch without changing pending history', async () => {
    for (const mutation of ['UPDATE pending_actions SET expected_entity_state_json=NULL', "UPDATE branches SET notes='later' WHERE id=1"]) {
      const db = world(); const row = await queuedBranch(db)
      db.exec(mutation)
      const saved = db.prepare('SELECT * FROM pending_actions WHERE id=?').get(row.id)
      const before = JSON.stringify(db.prepare('SELECT * FROM branches').all())
      await assert.rejects(approvalHandler()({}, saved, { id: 8, name: 'Reviewer' }), error => error.code === 'branch_edit_conflict')
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM branches').all()), before)
      assert.deepEqual(db.prepare('SELECT * FROM pending_actions WHERE id=?').get(row.id), saved)
      db.close()
    }
  })
  await check('approval requester denial or commit-time authority and pending changes abort', async () => {
    for (const mutation of ["UPDATE users SET permissions='{\"branches:edit\":false}' WHERE id=7", 'UPDATE users SET is_active=0 WHERE id=7', "UPDATE users SET deleted_at='gone' WHERE id=7", 'DELETE FROM users WHERE id=7']) {
      const db = world(); const row = await queuedBranch(db); db.exec(mutation)
      await assert.rejects(approvalHandler()({}, row, { id: 8, name: 'Reviewer' }), error => error.code === 'request_permission_revoked')
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'before')
      assert.equal(db.prepare('SELECT status FROM pending_actions').get().status, 'open'); db.close()
    }
    for (const mutation of ["UPDATE roles SET permissions='{\"branches\":false}' WHERE id=3", "UPDATE users SET permissions='{\"branches:edit\":false}' WHERE id=7", "UPDATE pending_actions SET status='rejected'", "UPDATE pending_actions SET payload_json='{}'", 'UPDATE pending_actions SET requested_by=99', 'UPDATE pending_actions SET expected_entity_state_json=NULL']) {
      const db = world(); const row = await queuedBranch(db)
      beforeBatch = db => db.exec(mutation)
      await assert.rejects(approvalHandler()({}, row, { id: 8, name: 'Reviewer' }), error => error.code === 'branch_edit_conflict')
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'before')
      assert.notEqual(db.prepare('SELECT status FROM pending_actions').get().status, 'approved'); db.close()
    }
  })
  await check('resubmit keeps DB baseline and refuses stale or legacy baseline without losing pending history', async () => {
    const db = world(); const row = await queuedBranch(db)
    db.exec("UPDATE pending_actions SET status='rejected'")
    const edited = await resubmitHandler()(context({ payload: { notes: 'changed desired', expected_entity_state_json: 'forged' } }))
    assert.equal(edited.status, 200)
    assert.equal(db.prepare('SELECT expected_entity_state_json FROM pending_actions').get().expected_entity_state_json, row.expected_entity_state_json)
    db.exec("UPDATE pending_actions SET status='rejected'")
    assert.equal((await resubmitHandler()(context({}))).status, 200)
    for (const mutation of ["UPDATE branches SET notes='later' WHERE id=1", 'UPDATE pending_actions SET expected_entity_state_json=NULL']) {
      db.exec("UPDATE pending_actions SET status='rejected'"); db.exec(mutation)
      const saved = db.prepare('SELECT * FROM pending_actions').get()
      assert.equal((await resubmitHandler()(context({ payload: { notes: 'must not reopen' } }))).status, 409)
      assert.deepEqual(db.prepare('SELECT * FROM pending_actions').get(), saved)
    }
    db.close()
  })
  await check('old schema supports generic queues and direct edits, review readiness refreshes after migration', async () => {
    currentDb = openDb(loadAll({ through: 222 })).db
    const db = currentDb
    db.exec("INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','old schema',1,1,'same'),(2,'Warehouse','bulk',1,0,'same')")
    const generic = await load('pendingActions').createPendingAction({}, { section: 'fees', actionType: 'delete', entityType: 'fee', payload: {} })
    assert.ok(generic > 0)
    const get = routeHandler('get', '/')
    const legacy = (await get(context({}))).value.find(row => row.id === 1)
    assert.equal(typeof legacy.edit_etag, 'string')
    const put = routeHandler('put', '/:id')
    const user = { id: 7, permissions: '{"branches":"review"}' }
    const refused = await put(context({ notes: 'waiting', expectedEditEtag: legacy.edit_etag }, user))
    assert.equal(refused.status, 409)
    assert.equal(refused.value.code, 'branch_review_schema_required')
    const direct = await put(context({ notes: 'direct', expectedEditEtag: legacy.edit_etag }))
    assert.equal(direct.status, 200)
    db.exec(fs.readFileSync(migrationPath, 'utf8'))
    assert.equal((await put(context({ notes: 'stale schema', expectedEditEtag: direct.value.branch.edit_etag }, user))).status, 409)
    const fresh = (await get(context({}))).value.find(row => row.id === 1)
    assert.equal((await put(context({ notes: 'now queued', expectedEditEtag: fresh.edit_etag }, user))).status, 202)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_actions WHERE section='branches'").get().n, 1)
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'direct')
    db.close()
  })
  await check('malformed or foreign baseline refuses and content state explicitly permits exact ABA', async () => {
    const db = world()
    const row = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const baseline = JSON.parse(writes.branchExpectedStateJson(row))
    for (const invalid of [null, '{}', '[]', 'broken', JSON.stringify({ ...baseline, version: 2 }), JSON.stringify({ ...baseline, entity_id: 2 }), JSON.stringify({ ...baseline, state: { id: 1 } }), JSON.stringify({ ...baseline, state: [] })]) {
      assert.throws(() => writes.assertBranchExpectedState(row, invalid), error => error.code === 'branch_edit_conflict')
    }
    const token = await writes.branchEditEtag(row)
    db.exec("UPDATE branches SET notes='B' WHERE id=1; UPDATE branches SET notes='before' WHERE id=1")
    await writes.assertBranchEditEtag(db.prepare('SELECT * FROM branches WHERE id=1').get(), token)
    db.close()
  })
  await check('full requester remains approvable and trailing pending failure rolls back metadata', async () => {
    for (const fail of [false, true]) {
      const db = world(); const row = await queuedBranch(db)
      db.exec("UPDATE roles SET permissions='{\"branches\":true}' WHERE id=3")
      if (fail) db.exec("CREATE TRIGGER refuse_pending_approval BEFORE UPDATE OF status ON pending_actions WHEN NEW.status='approved' BEGIN SELECT RAISE(ABORT,'fixture trailing refusal'); END")
      if (fail) {
        await assert.rejects(approvalHandler()({}, row, { id: 8, name: 'Reviewer' }), /fixture trailing refusal/)
        assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'before')
        assert.deepEqual(db.prepare('SELECT * FROM pending_actions').get(), row)
      } else {
        assert.equal((await approvalHandler()({}, row, { id: 8, name: 'Reviewer' })).pendingActionMarkedAtomically, true)
        assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'approved')
      }
      db.close()
    }
  })
  await check('wrong-helper controls expose the stale direct and queued writes the regressions reject', async () => {
    {
      const db = world(); const row = db.prepare('SELECT * FROM branches WHERE id=1').get()
      const token = await writes.branchEditEtag(row)
      db.exec("UPDATE branches SET notes='later' WHERE id=1")
      const unsafe = routeHandler('put', '/:id', { assertBranchEditEtag: async () => {} })
      assert.equal((await unsafe(context({ notes: 'unsafe stale', expectedEditEtag: token }))).status, 200)
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'unsafe stale')
      db.close()
    }
    {
      const db = world(); const row = await queuedBranch(db)
      db.exec("UPDATE branches SET notes='later' WHERE id=1")
      const unsafe = approvalHandler({ assertBranchExpectedState: () => {} })
      assert.equal((await unsafe({}, row, { id: 8, name: 'Reviewer' })).pendingActionMarkedAtomically, true)
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'approved')
      db.close()
    }
  })
  await check('schema installation between pre-read and direct batch refuses the old presence mask', async () => {
    currentDb = openDb(loadAll({ through: 222 })).db
    const db = currentDb
    db.exec("INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','before',1,1,'same'),(2,'Warehouse','bulk',1,0,'same')")
    const original = db.prepare('SELECT * FROM branches WHERE id=1').get()
    beforeBatch = db => db.exec(fs.readFileSync(migrationPath, 'utf8'))
    const response = await routeHandler('put', '/:id')(context({ notes: 'must not save', expectedEditEtag: await writes.branchEditEtag(original) }))
    assert.equal(response.status, 409)
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'before')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0)
    db.close()
  })
  for (const mode of ['direct', 'approval']) {
    await check(`real audit insert failure rolls ${mode} branch writes back`, async () => {
      const db = world()
      const pending = mode === 'approval' ? await queuedBranch(db) : null
      const original = db.prepare('SELECT * FROM branches WHERE id=1').get()
      db.exec("CREATE TRIGGER refuse_branch_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='branch' BEGIN SELECT RAISE(ABORT,'fixture audit refusal'); END")
      if (pending) await assert.rejects(approvalHandler()({}, pending, { id: 8, name: 'Reviewer' }), /fixture audit refusal/)
      else await assert.rejects(routeHandler('put', '/:id')(context({ notes: 'must not save', expectedEditEtag: await writes.branchEditEtag(original) })), /fixture audit refusal/)
      assert.deepEqual(db.prepare('SELECT * FROM branches WHERE id=1').get(), original)
      if (pending) assert.deepEqual(db.prepare('SELECT * FROM pending_actions').get(), pending)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0)
      db.close()
    })
  }
  if (failures) process.exitCode = 1
}
async function receiptTransportTests() {
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const root = path.resolve(__dirname, '../..')
const ts = require(path.join(root, 'cloudflare/node_modules/typescript'))
const results = []
const sources = new Map()
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function read(rel) {
  const file = path.join(root, rel)
  const bytes = fs.readFileSync(file)
  sources.set(rel, { sha256: sha(bytes), bytes: bytes.length })
  return bytes.toString('utf8')
}
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
const cache = new Map()
function load(rel) {
  rel = path.posix.normalize(rel.replaceAll('\\', '/'))
  if (!rel.endsWith('.ts')) rel += '.ts'
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  new Function('require', 'module', 'exports', compile(read(rel)))(request => {
    if (!request.startsWith('.')) throw new Error(`Unexpected dependency ${rel}: ${request}`)
    return load(path.posix.join(path.posix.dirname(rel), request))
  }, mod, mod.exports)
  return mod.exports
}
const lib = name => load(`cloudflare/src/lib/${name}`)
function tree(rel) { return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true) }
function named(rel, names) {
  const ast = tree(rel)
  return names.map(name => {
    const node = ast.statements.find(n => n.name?.text === name || n.declarationList?.declarations.some(d => d.name?.text === name))
    assert.ok(node, `Declaration exists: ${rel}/${name}`)
    return node.getText(ast)
  }).join('\n')
}
function evaluate(source, deps, result) {
  return new Function(...Object.keys(deps), 'exports', `${compile(source)}\nreturn ${result}`)(...Object.values(deps), {})
}
function selectRoute(rel, method, route) {
  const ast = tree(rel)
  const node = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && n.expression.expression.getText(ast) === `app.${method}` && n.expression.arguments[0]?.text === route)
  assert.ok(node, `Route exists ${method} ${route}`)
  return node.expression.arguments[1].getText(ast)
}
function nativeD1(db) {
  const control = { beforeBatch: null, afterBatch: null, beforeRun: null, beforeRead: null, afterRead: null, batches: 0, broadcasts: [], broadcastFailure: false }
  function prepared(sql, values = []) {
    function args() { return /\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values }
    function runSync(readOnly) {
      const statement = db.prepare(sql)
      if (readOnly) return { success: true, results: statement.all(...args()), meta: { changes: 0 } }
      const value = statement.run(...args())
      return { success: true, results: [], meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }
    }
    return { sql, values, bind: (...next) => prepared(sql, next), _execute: () => runSync(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)),
      all: async () => { if (control.beforeRead) await control.beforeRead(sql, db); const value = runSync(true); if (control.afterRead) await control.afterRead(sql, db); return value },
      run: async () => { if (control.beforeRun) await control.beforeRun(sql, db); return runSync(false) } }
  }
  const d1 = { prepare: prepared, batch: async statements => {
    control.batches++
    if (control.beforeBatch) { const hook = control.beforeBatch; control.beforeBatch = null; await hook(db) }
    db.exec('BEGIN IMMEDIATE')
    let values
    try { values = statements.map(s => s._execute()); db.exec('COMMIT') }
    catch (error) { db.exec('ROLLBACK'); throw error }
    if (control.afterBatch) { const hook = control.afterBatch; control.afterBatch = null; await hook(db) }
    return values
  } }
  const env = { DB: d1, BROADCAST_HUB: { idFromName: name => name, get: () => ({ fetch: async (_url, init) => {
    control.broadcasts.push(JSON.parse(init.body)); if (control.broadcastFailure) throw new Error('fixture broadcast unavailable'); return new Response('{}')
  } }) } }
  return { db, env, control }
}
const migrations = fs.readdirSync(path.join(root, 'cloudflare/migrations')).filter(n => n.endsWith('.sql')).sort()
function world(old = false) {
  const db = new DatabaseSync(':memory:')
  db.limits.exprDepth = 100
  db.exec('PRAGMA foreign_keys=OFF')
  for (const migration of migrations.filter(n => !old || Number(n.slice(0, 4)) < 223)) db.exec(read(`cloudflare/migrations/${migration}`))
  db.exec(`INSERT INTO branches(id,name,location,phone,manager,notes,is_active,is_default,updated_at) VALUES
    (1,'Shop','Market','123','Manager','before',1,1,'2026-10-03 00:00:00'),(2,'Warehouse','Depot',NULL,NULL,'bulk',1,0,'2026-10-03 00:00:00');
    INSERT INTO roles(id,name,code,permissions) VALUES(3,'Requester','employee','{"branches":"review"}'),(4,'Reviewer','manager','{"review":true}');
    INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(7,'requester','Requester','admin123',3,'{}',1),(8,'reviewer','Reviewer','admin123',4,'{}',1);`)
  return nativeD1(db)
}
const writes = lib('branchWrites')
const permissions = lib('permissions')
const broadcast = load('cloudflare/src/durable-objects/broadcastHub').broadcast
const branchDeps = { ...lib('db'), ...writes, ...permissions, ...lib('conflictControl'), ...lib('canonicalBranchIdentity'), ...lib('reviewGate'), ...lib('businessMaintenanceGuard'), ...lib('actorSnapshot'), ...lib('audit'), broadcast }
function branchRoute(method, route, overrides = {}) {
  return evaluate(`const handler=${selectRoute('cloudflare/src/routes/branches.ts', method, route)}`, { ...branchDeps, ...overrides }, 'handler')
}
const reviewRel = 'cloudflare/src/lib/reviewApply.ts'
function reviewCode() {
  const ast = tree(reviewRel)
  const registrations = ast.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'registerApplier'
    && ['branches/update/branch', 'fees/delete/fee'].includes(n.expression.arguments.slice(0, 3).map(a => a.text).join('/'))).map(n => n.getText(ast)).join('\n')
  return named(reviewRel, ['NoReviewApplierError', 'ReviewRequesterPermissionError', 'notify', 'appliers', 'applierKey', 'registerApplier', 'productRemovePendingPointer', 'applyApprovedPendingAction', 'recoverApprovedBranchAction']) + '\n' + registrations
}
function review(overrides = {}) {
  return evaluate(reviewCode(), { ...branchDeps, ...lib('productDelete'), applyApprovedProductRemove: () => { throw new Error('Out of scope product removal invoked') }, ...overrides },
    '{ applyApprovedPendingAction, NoReviewApplierError, ReviewRequesterPermissionError, productRemovePendingPointer, recoverApprovedBranchAction }')
}
const moneyErrors = evaluate(named('cloudflare/src/lib/productWrites.ts', ['ProductMoneyWriteError']), {}, '{ProductMoneyWriteError}')
const imageErrors = evaluate(named('cloudflare/src/lib/productImagePermission.ts', ['ProductImageAssetError']), {}, '{ProductImageAssetError}')
function reviewRoute(route, overrides = {}, reviewOverrides = {}) {
  return evaluate(`const handler=${selectRoute('cloudflare/src/routes/reviewQueue.ts', 'post', route)}`, {
    ...branchDeps, ...lib('pendingActions'), ...review(reviewOverrides), ...moneyErrors, ...imageErrors, ...lib('productDelete'),
    ...lib('acquisitionCostAccess'), hasProductMoneyPolicy: () => { throw new Error('Out of scope product money path invoked') }, ...overrides,
  }, 'handler')
}
const directUser = { id: 7, name: 'Requester', permissions: '{"branches":true}' }
const reviewUser = { id: 8, name: 'Reviewer', permissions: '{"review":true}' }
const requestUser = { id: 7, name: 'Requester', permissions: '{"branches":"review"}' }
function ctx(w, body = {}, user = directUser, id = 1) {
  return { env: w.env, req: { param: () => String(id), json: async () => body, query: () => undefined }, get: () => user,
    json: (value, status = 200) => ({ status, value }), executionCtx: { waitUntil: promise => { promise.catch(error => { throw error }) } } }
}
const branch = w => w.db.prepare('SELECT * FROM branches WHERE id=1').get()
const pending = w => w.db.prepare('SELECT * FROM pending_actions ORDER BY id DESC LIMIT 1').get()
async function queue(w, body = {}) {
  const response = await branchRoute('put', '/:id')(ctx(w, { notes: 'approved', expectedEditEtag: await writes.branchEditEtag(branch(w)), ...body }, requestUser))
  assert.equal(response.status, 202)
  return pending(w)
}
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, status: 'PASS', detail }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1 }

}
async function main() {
  await check('lost acknowledgement recovers exact same-actor receipt with one batch and one branch audit', async () => {
    const w = world(); const row = await queue(w)
    w.control.afterBatch = () => { throw new Error('D1_ERROR: internal error acknowledgement lost') }
    const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
    assert.equal(response.status, 200)
    assert.equal(response.value.replayed, true)
    assert.equal(response.value.data.id, row.id)
    assert.equal(w.control.batches, 1)
    assert.equal(branch(w).notes, 'approved')
    assert.equal(pending(w).status, 'approved')
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='branch'").get().n, 1)
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='pending_action'").get().n, 0)
    w.db.close()
  })
  await check('same-ID same actor retry acknowledges retained receipt after later legitimate branch change without writes', async () => {
    const w = world(); const row = await queue(w)
    assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))).status, 200)
    w.db.exec("UPDATE branches SET notes='later legitimate' WHERE id=1")
    const before = { branch: branch(w), pending: pending(w), audits: w.db.prepare('SELECT * FROM audit_logs').all(), batches: w.control.batches }
    const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
    assert.equal(response.status, 200)
    assert.equal(response.value.replayed, true)
    assert.deepEqual(response.value.data, before.pending)
    assert.deepEqual(branch(w), before.branch)
    assert.deepEqual(w.db.prepare('SELECT * FROM audit_logs').all(), before.audits)
    assert.equal(w.control.batches, before.batches)
    w.db.close()
  })
  await check('precommit failure refuses with no writes and no retry', async () => {
    const w = world(); const row = await queue(w)
    const before = { branch: branch(w), pending: pending(w) }
    w.control.beforeBatch = () => { throw new Error('fixture precommit unavailable') }
    const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
    assert.notEqual(response.status, 200); assert.equal(w.control.batches, 1)
    assert.deepEqual(branch(w), before.branch); assert.deepEqual(pending(w), before.pending)
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0); w.db.close()
  })
  await check('unreadable committed receipt reports explicit uncertainty without retrying write', async () => {
    const w = world(); const row = await queue(w)
    w.control.afterBatch = () => {
      w.control.beforeRead = sql => { if (/FROM pending_actions/i.test(sql)) throw new Error('fixture receipt unavailable') }
      throw new Error('D1_ERROR: internal error acknowledgement lost')
    }
    const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
    assert.equal(response.status, 503); assert.equal(response.value.code, 'unknown_outcome')
    assert.equal(response.value.action, 'retry_same_request'); assert.equal(w.control.batches, 1)
    assert.equal(pending(w).status, 'approved'); assert.equal(branch(w).notes, 'approved'); w.db.close()
  })
  await check('same-turn receipt tuple substitution and other approving actor cannot recover', async () => {
    for (const mutation of ["payload_json='{}'", "summary='changed'", 'expected_entity_state_json=NULL', 'requested_by=99', "section='fees'", "action_type='create'", "entity_type='fee'", 'entity_id=2', 'reviewed_by=99', "reviewed_at=''", "status='rejected'"]) {
      const w = world(); const row = await queue(w)
      w.control.afterBatch = db => { db.exec(`UPDATE pending_actions SET ${mutation}`); throw new Error('D1_ERROR: internal error acknowledgement lost') }
      const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
      assert.notEqual(response.status, 200, mutation); assert.equal(w.control.batches, 1)
      assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='pending_action'").get().n, 0); w.db.close()
    }
  })
  await check('recovery reloads current reviewer grants and active user state', async () => {
    for (const mutation of ["UPDATE users SET permissions='{\"review\":false}' WHERE id=8", "UPDATE roles SET permissions='{\"review\":false}' WHERE id=4", 'UPDATE users SET is_active=0 WHERE id=8', "UPDATE users SET deleted_at='gone' WHERE id=8", 'DELETE FROM users WHERE id=8', "UPDATE roles SET code='employee',permissions='{}' WHERE id=4"]) {
      const w = world(); const row = await queue(w)
      w.control.afterBatch = db => { db.exec(mutation); throw new Error('D1_ERROR: internal error acknowledgement lost') }
      const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
      assert.equal(response.status, 403, mutation); assert.equal(response.value.code, 'review_permission_revoked')
      assert.equal(pending(w).status, 'approved'); assert.equal(w.control.batches, 1); w.db.close()
    }
  })
  await check('final receipt reread detects replacement between proof and response', async () => {
    const w = world(); const row = await queue(w)
    w.control.afterBatch = () => {
      let reads = 0
      w.control.afterRead = (sql, db) => { if (/FROM pending_actions/i.test(sql) && ++reads === 1) db.exec("UPDATE pending_actions SET summary='interposed'") }
      throw new Error('D1_ERROR: internal error acknowledgement lost')
    }
    assert.notEqual((await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))).status, 200)
    assert.equal(w.control.batches, 1); w.db.close()
  })
  await check('legacy or malformed approved baselines and other actor cannot replay', async () => {
    for (const baseline of [null, '{}', '[]', '{"kind":"branch-edit-state","version":2}', '{"kind":"branch-edit-state","version":1,"entity_id":1,"state":{}}']) {
      const w = world(); const row = await queue(w)
      assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))).status, 200)
      w.db.prepare('UPDATE pending_actions SET expected_entity_state_json=?').run(baseline)
      const audits = w.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n
      assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))).status, 409)
      assert.equal(w.control.batches, 1); assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, audits); w.db.close()
    }
    const w = world(); const row = await queue(w)
    assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))).status, 200)
    assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, {...reviewUser,id:99}, row.id))).status, 409)
    assert.equal((await reviewRoute('/:id/approve')(ctx(w, {}, {...reviewUser,permissions:'{}'}, row.id))).status, 403)
    assert.equal(w.control.batches, 1); w.db.close()
  })
  await check('broadcast failure cannot invalidate a proven recovered receipt', async () => {
    const w = world(); const row = await queue(w); w.control.broadcastFailure = true
    w.control.afterBatch = () => { throw new Error('D1_ERROR: internal error acknowledgement lost') }
    const response = await reviewRoute('/:id/approve')(ctx(w, {}, reviewUser, row.id))
    assert.equal(response.status, 200); assert.equal(response.value.replayed, true); assert.equal(w.control.batches, 1); w.db.close()
  })
}

await main()
if (results.some(result => result.status === 'FAIL')) throw new Error('Branch approval receipt transport checks failed')
}
main().then(receiptTransportTests).catch(error => { console.error(error); process.exitCode = 1 })
