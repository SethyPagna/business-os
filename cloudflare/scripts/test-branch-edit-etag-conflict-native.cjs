const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const cache = new Map()
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(rel) {
  rel = path.posix.normalize(rel)
  if (!rel.endsWith('.ts')) rel += '.ts'
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  new Function('require', 'module', 'exports', compile(fs.readFileSync(path.join(root, rel), 'utf8')))(request => {
    assert.ok(request.startsWith('.'), `Unexpected external dependency: ${request}`)
    return load(path.posix.join(path.posix.dirname(rel), request))
  }, mod, mod.exports)
  return mod.exports
}
const lib = name => load(`cloudflare/src/lib/${name}`)
const writes = lib('branchWrites')
const source = fs.readFileSync(path.join(root, 'cloudflare/src/routes/branches.ts'), 'utf8')
const ast = ts.createSourceFile('branches.ts', source, ts.ScriptTarget.Latest, true)
const route = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'app.put' && n.expression.arguments[0]?.text === '/:id')
assert.ok(route)
const dependencies = Object.assign({}, ...['db', 'branchWrites', 'permissions', 'conflictControl', 'canonicalBranchIdentity', 'reviewGate', 'businessMaintenanceGuard', 'actorSnapshot', 'audit'].map(lib), { broadcast: async env => { env.control.broadcasts++ } })
const routeSource = route.expression.arguments[1].getText(ast)
function makeHandler(text) {
  return new Function(...Object.keys(dependencies), 'exports', `${compile(`const handler=${text}`)}\nreturn handler`)(...Object.values(dependencies), {})
}
const handler = makeHandler(routeSource)
function world(old = false) {
  const db = new DatabaseSync(':memory:')
  db.limits.exprDepth = 100
  db.limits.variableNumber = 100
  db.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'cloudflare/migrations')).filter(file => file.endsWith('.sql') && (!old || Number(file.slice(0, 4)) < 223)).sort()) db.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations', file), 'utf8'))
  db.exec("INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','original',1,1,NULL),(2,'Warehouse','bulk',1,0,NULL)")
  const control = { batches: 0, broadcasts: 0, reads: 0, beforeBatch: null, afterBatch: null, failDetail: false }
  function prepared(sql, values = []) {
    assert.ok(values.length <= 100)
    function execute(read) {
      const statement = db.prepare(sql)
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, i) => [String(i + 1), value]))] : values
      if (read) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const result = statement.run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { bind: (...next) => prepared(sql, next), execute: () => execute(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)),
      all: async () => {
        if (/SELECT \* FROM branches WHERE id = \?/i.test(sql) && ++control.reads > 1 && control.failDetail) throw new Error('fixture detail unavailable')
        return execute(true)
      }, run: async () => execute(false) }
  }
  const env = { control, DB: { prepare: prepared, batch: async statements => {
    control.batches++
    if (control.beforeBatch) { const hook = control.beforeBatch; control.beforeBatch = null; hook(db) }
    db.exec('BEGIN IMMEDIATE')
    let results
    try { results = statements.map(s => s.execute()); db.exec('COMMIT') }
    catch (error) { db.exec('ROLLBACK'); throw error }
    if (control.afterBatch) control.afterBatch(db)
    return results
  } } }
  return { db, env, control }
}
const branch = w => w.db.prepare('SELECT * FROM branches WHERE id=1').get()
const audits = w => w.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n
async function request(w, body, tier = true, selectedHandler = handler) {
  return selectedHandler({ env: w.env, get: () => ({ id: 7, username: 'fixture', permissions: JSON.stringify({ branches: tier }) }),
    req: { param: () => '1', json: async () => body }, json: (value, status = 200) => ({ value: JSON.parse(JSON.stringify(value)), status }), executionCtx: { waitUntil: promise => promise.catch(() => {}) } })
}
function detail(response, winner, expected = null) {
  assert.equal(response.status, 409)
  assert.equal(response.value.code, 'branch_edit_conflict')
  assert.equal(response.value.success, false)
  assert.equal(response.value.conflict, true)
  assert.equal(response.value.entity, 'branch')
  assert.equal(response.value.reason, winner ? 'updated' : 'deleted')
  assert.equal(response.value.expectedUpdatedAt, expected)
  assert.deepEqual(response.value.current, winner ? { ...winner } : null)
  assert.equal(response.value.actualUpdatedAt, winner?.updated_at || null)
}
const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1 }
}
async function main() {
  await check('legitimate null timestamp ETag refuses stale edit and returns winning saved details', async () => {
    const w = world()
    try {
      const token = await writes.branchEditEtag(branch(w))
      w.db.exec("UPDATE branches SET notes='winning edit',updated_at='2026-10-03 12:39:42' WHERE id=1")
      const winner = branch(w)
      detail(await request(w, { notes: 'attempted', expectedUpdatedAt: null, expectedEditEtag: token }), winner)
      assert.deepEqual(branch(w), winner); assert.equal(audits(w), 0); assert.equal(w.control.batches, 0)
    } finally { w.db.close() }
  })
  await check('atomic guard conflict rereads winner instead of pre-batch current including deleted row', async () => {
    for (const mutation of ["UPDATE branches SET notes='racing winner',updated_at='2026-10-03 13:00:00' WHERE id=1", "UPDATE branches SET notes='null-time winner' WHERE id=1", 'DELETE FROM branches WHERE id=1']) {
      const w = world()
      try {
        const original = branch(w), token = await writes.branchEditEtag(original)
        w.control.beforeBatch = db => db.exec(mutation)
        const response = await request(w, { notes: 'must not apply', expectedEditEtag: token })
        const winner = branch(w) || null
        detail(response, winner)
        assert.notDeepEqual(winner, original); assert.equal(audits(w), 0); assert.equal(w.control.batches, 1); assert.equal(w.control.broadcasts, 0)
      } finally { w.db.close() }
    }
  })
  await check('equal non-null timestamps still expose ETag-detected winner and original expected timestamp', async () => {
    const w = world()
    try {
      w.db.exec("UPDATE branches SET updated_at='2026-10-03 12:00:00' WHERE id=1")
      const original = branch(w), token = await writes.branchEditEtag(original)
      w.db.exec("UPDATE branches SET notes='same-second winner' WHERE id=1")
      detail(await request(w, { notes: 'attempted', expectedUpdatedAt: original.updated_at, expectedEditEtag: token }), branch(w), original.updated_at)
      assert.equal(audits(w), 0)
    } finally { w.db.close() }
  })
  await check('unreadable conflict details preserve definite 409 without fabricating saved state', async () => {
    const w = world()
    try {
      const token = await writes.branchEditEtag(branch(w))
      w.db.exec("UPDATE branches SET notes='winner' WHERE id=1")
      w.control.failDetail = true
      const response = await request(w, { notes: 'attempted', expectedEditEtag: token })
      assert.equal(response.status, 409); assert.equal(response.value.code, 'branch_edit_conflict'); assert.equal(response.value.current, undefined)
      assert.equal(response.value.reason, undefined); assert.equal(audits(w), 0); assert.equal(branch(w).notes, 'winner')
    } finally { w.db.close() }
  })
  await check('valid null token direct success and review queue are unchanged', async () => {
    for (const tier of [true, 'review']) {
      const w = world()
      try {
        const response = await request(w, { notes: 'valid edit', expectedEditEtag: await writes.branchEditEtag(branch(w)) }, tier)
        assert.equal(response.status, tier === true ? 200 : 202)
        assert.equal(branch(w).notes, tier === true ? 'valid edit' : 'original')
        assert.equal(audits(w), tier === true ? 1 : 0)
        assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM pending_actions').get().n, tier === true ? 0 : 1)
      } finally { w.db.close() }
    }
  })
  await check('review schema required and permission refusal retain distinct responses', async () => {
    const w = world(true)
    try {
      const body = { notes: 'attempted', expectedEditEtag: await writes.branchEditEtag(branch(w)) }
      const response = await request(w, body, 'review')
      assert.equal(response.status, 409); assert.equal(response.value.code, 'branch_review_schema_required'); assert.equal(response.value.current, undefined)
      assert.equal((await request(w, body, false)).status, 403); assert.equal(audits(w), 0); assert.equal(branch(w).notes, 'original')
    } finally { w.db.close() }
  })
  await check('lost acknowledgement stays 503 unknown with exactly one committed write', async () => {
    const w = world()
    try {
      w.control.afterBatch = () => { throw new Error('D1_ERROR: acknowledgement lost') }
      const response = await request(w, { notes: 'committed', expectedEditEtag: await writes.branchEditEtag(branch(w)) })
      assert.equal(response.status, 503); assert.equal(response.value.code, 'branch_edit_outcome_unknown'); assert.equal(response.value.outcome, 'unknown')
      assert.equal(branch(w).notes, 'committed'); assert.equal(audits(w), 1); assert.equal(w.control.batches, 1)
    } finally { w.db.close() }
  })
  await check('missing context and stale-current controls are rejected by the response contract', async () => {
    const w = world()
    try {
      const original = branch(w)
      w.db.exec("UPDATE branches SET notes='winner',updated_at='2026-10-03 13:00:00' WHERE id=1")
      const winner = branch(w)
      assert.throws(() => detail({ status: 409, value: { success: false, code: 'branch_edit_conflict', conflict: true } }, winner), assert.AssertionError)
      assert.throws(() => detail({ status: 409, value: { success: false, code: 'branch_edit_conflict', conflict: true, entity: 'branch', reason: 'updated', expectedUpdatedAt: null, actualUpdatedAt: original.updated_at, current: { ...original } } }, winner), assert.AssertionError)
    } finally { w.db.close() }
  })
  await check('actual handler wrong missing-context and stale-reread implementations fail contract', async () => {
    const mutants = [
      routeSource.replace("if (conflict.code === 'branch_edit_conflict')", 'if (false)'),
      routeSource.replace(/const latest = await db\.prepare\('SELECT \* FROM branches WHERE id = \?'\)\s*\.get<BranchIdentitySnapshot & \{ updated_at: string \| null \}>\(\[id\]\)/, 'const latest = current'),
    ]
    for (const mutant of mutants) {
      assert.notEqual(mutant, routeSource, 'Wrong control must alter actual handler')
      const w = world()
      try {
        const token = await writes.branchEditEtag(branch(w))
        w.control.beforeBatch = db => db.exec("UPDATE branches SET notes='winner',updated_at='2026-10-03 13:00:00' WHERE id=1")
        const response = await request(w, { notes: 'attempted', expectedEditEtag: token }, true, makeHandler(mutant))
        assert.throws(() => detail(response, branch(w)), assert.AssertionError)
        assert.equal(branch(w).notes, 'winner'); assert.equal(audits(w), 0); assert.equal(w.control.batches, 1)
      } finally { w.db.close() }
    }
  })
  console.log(JSON.stringify({ exprDepth: 100, bindLimit: 100, results }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
