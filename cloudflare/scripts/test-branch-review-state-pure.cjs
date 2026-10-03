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
  return evaluate(`${permissionError}\nconst handler=${statement.expression.arguments[3].getText(tree)}`, {
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
main().catch(error => { console.error(error); process.exitCode = 1 })
