// Branch cutover through its production operator path (lane CUTOVER-RUNNER): the REAL Hono route
// (src/routes/branchCutoverOperator.ts), the REAL maintenance gate lifted from src/index.ts, the REAL library, and the
// REAL operator loop (ops/scripts/branch-cutover-loop.mjs, the module the ops task runs), on the LB end-to-end fixture
// (native SQLite, every migration). Each scenario is a complete cutover or a deliberate stop:
//   1  the endpoint is dark without the secret, and refuses a missing or wrong token before reading anything;
//   2  begin creates the control incarnation when absent and replays on the same request id;
//   3  a full run through the loop with injected 7429s (read and batch), a crash before commit, a lost acknowledgement
//      inside the Worker, a lost response, a timeout before sending and a 502: the SAME request text is re-sent, the end
//      state equals the LB end-state checks, finalize runs once and a second finalize only reads;
//   4  during the run an ordinary write is refused by the fence and leaves nothing behind, the operator path is not;
//   5  refusals stop the loop at once with a fixed code and no retry: an open shift at begin, a schema change after
//      begin (contract_changed_since_begin, resumed once restored), finalize before ready, a wrong request id, a stale
//      revision, an unknown operation, abort after the first child, retries exhausted on a persistent 5xx;
//   6  abort before the first child releases the fence and a new run completes.
// Controls (RED on purpose): a gate that lets every /api path through during the run.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const ts = require('typescript')
const e2e = require('./test-branch-cutover-parent-e2e-native.cjs')
const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')
const TOKEN = 'cutover-operator-test-token-0123456789abcdef'
const ORIGIN = 'http://operator.test'

function gateSource() {
  const source = ts.createSourceFile('index.ts', fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'app.use' && node.expression.arguments[1]?.getText(source).includes('getMaintenance(c.env)'))
  assert.ok(statement, 'the maintenance gate is in index.ts')
  assert.equal(statement.expression.arguments[0].getText(source), "'/api/*'")
  return statement.expression.arguments[1].getText(source)
}
async function bundleApp(transform = (text) => text) {
  const entry = `
    import { Hono } from 'hono'
    import route from './src/routes/branchCutoverOperator.ts'
    import { getMaintenance, isBranchCutoverOperatorPath, isMaintenanceGatedRequest } from './src/lib/maintenance.ts'
    const app = new Hono()
    app.onError((error, c) => c.json({ success: false, error: 'Something went wrong processing that request. Please try again.' }, 500))
    app.use('/api/*', ${transform(gateSource())})
    app.post('/api/probe/write', async (c) => { await c.env.DB.prepare('INSERT INTO probe_writes DEFAULT VALUES').run(); return c.json({ ok: true }) })
    app.route('/api/internal/branch-cutover', route)
    export default app`
  const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require)
  return module.exports.default
}

const ACTOR_USER = 7
// The fixture's statement objects stop at bind/all/run; the maintenance read (lib/maintenance.ts) also calls first().
function withFirst(d1) {
  const decorate = (statement) => ({ ...statement, bind: (...values) => decorate(statement.bind(...values)),
    first: async (column) => { const row = (await statement.all()).results[0] ?? null; return column ? row?.[column] ?? null : row } })
  return { prepare: (sql) => decorate(d1.prepare(sql)), batch: (statements) => d1.batch(statements) }
}
function harness(w, app, { token = TOKEN, configured = TOKEN, tier } = {}) {
  const env = { DB: withFirst(w.db.d1), ...(tier === undefined ? {} : { PLAN_TIER: tier }), ...(configured === null ? {} : { BRANCH_CUTOVER_OPERATOR_TOKEN: configured }) }
  const log = []
  const raw = async (action, text, { header = token, method = 'POST' } = {}) => {
    const headers = { 'content-type': 'application/json', ...(header === null ? {} : { 'x-cutover-operator-token': header }) }
    const response = await app.fetch(new Request(`${ORIGIN}/api/internal/branch-cutover/${action}`, { method, headers, body: method === 'POST' ? text : undefined }), env)
    let json = null
    try { json = await response.json() } catch { }
    return { status: response.status, json }
  }
  const send = async (action, text) => { log.push({ action, text }); return raw(action, text) }
  const write = async () => {
    const response = await app.fetch(new Request(`${ORIGIN}/api/probe/write`, { method: 'POST' }), env)
    return { status: response.status, json: await response.json() }
  }
  const probes = () => w.raw.prepare('SELECT count(*) n FROM probe_writes').get().n
  return { env, raw, send, write, probes, log }
}

/** Faults keyed '<action>#<n>', n = the n-th distinct logical call of that action. */
function faulty(w, base, plan, fired) {
  const last = {}, count = {}
  return async (action, text) => {
    if (last[action] !== text) { last[action] = text; count[action] = (count[action] || 0) + 1 }
    const key = `${action}#${count[action]}`, fault = plan[key]
    if (!fault || fired.includes(key)) return base(action, text)
    fired.push(key)
    if (fault === 'timeout-before') throw new Error('timeout before sending')
    if (fault === '502') return { status: 502, json: null }
    if (fault === 'lost-response') { await base(action, text); throw new Error('response lost') }
    if (fault.startsWith('cpu-read-')) w.stats.cpuRead = Number(fault.slice('cpu-read-'.length))
    if (fault === 'cpu-batch') w.stats.cpuBatch = true
    if (fault === 'crash-before') w.stats.before = () => { throw Error('injected crash before commit') }
    if (fault === 'lost-ack-inside') w.stats.after = () => { throw Error('injected lost acknowledgement') }
    const response = await base(action, text)
    // the first read of a request is the gate's own maintenance read: a 7429 there is the app's generic 500, which the loop retries too
    const gateRead = fault === 'cpu-read-0'
    assert.equal(response.status, gateRead ? 500 : 503, key + ' ' + fault + ' answers retryable: ' + JSON.stringify(response))
    if (!gateRead) assert.equal(response.json.code, 'retryable')
    if (fault.startsWith('cpu-read-')) assert.equal(w.stats.cpuRead, null, key + ' the 7429 fired')
    if (fault === 'cpu-batch') assert.equal(w.stats.cpuBatch, false, key + ' the batch 7429 fired')
    if (fault === 'crash-before') assert.equal(w.stats.before, null, key + ' the crash fired')
    if (fault === 'lost-ack-inside') assert.equal(w.stats.after, null, key + ' the lost ack fired')
    return response
  }
}

async function modules() {
  const load = (file) => import(pathToFileURL(path.join(repo, 'ops', 'scripts', file)).href)
  return { loop: await load('branch-cutover-loop.mjs'), script: await load('ops-branch-cutover.mjs'), common: await load('ops-common.mjs') }
}
const instant = () => Promise.resolve()
const phases = (w) => w.raw.prepare('SELECT operation_id,phase,revision,committed_children,next_sequence FROM branch_cutovers ORDER BY rowid').all()
const flag = (w) => w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n
const stockText = (w) => JSON.stringify([w.raw.prepare('SELECT * FROM branch_stock ORDER BY rowid').all(), w.raw.prepare('SELECT * FROM branch_batch_stock ORDER BY rowid').all()])
function newWorld(generatedProducts = 28) {
  const w = e2e.world({ generatedProducts })
  w.raw.exec('CREATE TABLE probe_writes(id INTEGER PRIMARY KEY)')
  return w
}
function beforeOf(w) {
  const raw = w.raw
  return { batches: raw.prepare('SELECT * FROM product_batches ORDER BY id').all(), history: raw.prepare('SELECT * FROM action_history ORDER BY id').all(),
    legacy: raw.prepare('SELECT * FROM branches WHERE id=3').get(), branches: raw.prepare('SELECT * FROM branches ORDER BY id').all(),
    stock: raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),
    sourceUnits: raw.prepare('SELECT sum(quantity) n FROM branch_stock WHERE branch_id=2').get().n,
    movingProducts: raw.prepare('SELECT count(*) n FROM branch_stock WHERE branch_id=2 AND quantity>0').get().n,
    productCost: raw.prepare('SELECT id,cost_price_usd FROM products ORDER BY id').all() }
}
const bookmark = async () => ({ bookmark: '00000085-0000024c-00004c6d-8e61117bf38d7adb71b55be26ba38a30', capturedAt: 'now', info: '' })

async function main() {
  const { loop, script, common } = await modules()
  const app = await bundleApp()
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
  const OpsErrorCode = async (promise) => { try { await promise } catch (error) { return error.code } return 'no error' }
  const body = (value) => JSON.stringify(value)

  await check('the endpoint is dark without the secret and refuses a missing or wrong token before reading the body', async () => {
    const w = newWorld(2)
    const h = harness(w, app)
    const before = stockText(w)
    for (const action of ['inspect', 'begin', 'resume', 'status', 'abort', 'finalize']) {
      assert.deepEqual(await harness(w, app, { configured: null }).raw(action, body({ actorUserId: ACTOR_USER })), { status: 404, json: { ok: false, code: 'not_found' } }, action + ' dark')
      assert.equal((await harness(w, app, { configured: 'short-secret' }).raw(action, body({}))).status, 404, action + ' dark when the secret is too short')
      for (const header of [null, '', 'x', TOKEN.slice(0, -1), TOKEN + 'x', TOKEN.toUpperCase(), 'cutover-operator-test-token-0123456789abcdeg']) {
        const response = await h.raw(action, 'this is not json at all', { header })
        assert.deepEqual([response.status, response.json], [401, { ok: false, code: 'unauthorized' }], action + ' ' + JSON.stringify(header))
      }
    }
    assert.equal((await h.raw('nonsense', body({}))).status, 404)
    assert.equal((await h.raw('status', '{not json')).status, 400)
    assert.equal((await h.raw('status', body({ pad: 'x'.repeat(20000) }))).status, 400)
    assert.equal((await h.raw('status', body([1]))).status, 400)
    assert.equal(stockText(w), before); assert.equal(phases(w).length, 0); assert.equal(flag(w), 0)
    assert.equal((await h.raw('status', body({}), { method: 'GET' })).status, 404, 'GET is no route')
    const ok = await h.raw('status', body({}))
    assert.deepEqual([ok.status, ok.json.phase], [200, 'none'])
    assert.equal(JSON.stringify(ok.json).includes(TOKEN), false)
    w.raw.close()
  })

  await check('X1: begin and resume are refused on the free plan with a coded refusal and no effect; paid, unset and garbage tiers are unchanged', async () => {
    const w = newWorld(2)
    const before = stockText(w)
    for (const tier of ['free', ' FREE ']) {
      const h = harness(w, app, { tier })
      for (const action of ['begin', 'resume']) {
        const refused = await h.raw(action, body({ actorUserId: ACTOR_USER, requestId: 'cutover_free_1', operationId: 'bco_none' }))
        assert.deepEqual([refused.status, refused.json.code, refused.json.refusal], [409, 'refused', 'plan_tier_free'], action + ' on ' + JSON.stringify(tier))
      }
      assert.equal((await h.raw('status', body({}))).status, 200, 'status still answers on free')
    }
    assert.equal(stockText(w), before); assert.equal(phases(w).length, 0); assert.equal(flag(w), 0)
    for (const tier of ['paid', undefined, 'garbage', '']) {
      const refused = await harness(w, app, { tier }).raw('begin', body({ actorUserId: ACTOR_USER, requestId: 'cutover_paid_1' }))
      assert.notEqual(refused.json && refused.json.refusal, 'plan_tier_free', 'tier ' + JSON.stringify(tier) + ' is not free')
    }
    w.raw.close()
  })

  await check('begin creates the control incarnation when absent and replays on the same request id; the response carries no data', async () => {
    const w = newWorld(4)
    w.raw.prepare("DELETE FROM system_flags WHERE key='branch_cutover_control_incarnation'").run()
    const h = harness(w, app)
    const client = loop.createClient({ send: h.send, sleep: instant })
    const first = await loop.startCutover(client, { actorUserId: ACTOR_USER, requestId: 'cutover_begin_replay_1' })
    assert.equal(first.state.phase, 'capturing'); assert.equal(first.state.revision, 0); assert.equal(first.state.replayed, false)
    assert.deepEqual(Object.keys(first.state).sort(), ['committedChildren', 'next', 'nextSequence', 'operationId', 'phase', 'replayed', 'requestId', 'revision', 'ok'].sort())
    const incarnation = w.raw.prepare("SELECT value FROM system_flags WHERE key='branch_cutover_control_incarnation'").get().value
    assert.match(incarnation, /^[0-9a-f-]{36}$/)
    const again = await loop.startCutover(loop.createClient({ send: h.send, sleep: instant }), { actorUserId: ACTOR_USER, requestId: 'cutover_begin_replay_1' })
    assert.equal(again.state.replayed, true); assert.equal(again.state.operationId, first.state.operationId); assert.equal(phases(w).length, 1)
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='branch_cutover_control_incarnation'").get().value, incarnation)
    // a second, different begin while one is unfinished is refused with no effect
    const second = await h.raw('begin', body({ actorUserId: ACTOR_USER, requestId: 'cutover_begin_other_1', expectedSourceJson: first.inspect.sourcePreimageJson,
      expectedTargetJson: first.inspect.targetPreimageJson, expectedSchemaDigest: first.inspect.schemaDigest }))
    assert.equal(second.status >= 400 && second.status < 600, true, JSON.stringify(second)); assert.equal(phases(w).length, 1)
    w.raw.close()
  })

  await check('a full run through the real endpoint and loop under injected 7429s, crashes and lost acknowledgements ends exactly like a clean run; finalize runs once', async () => {
    const w = newWorld()
    const base = e2e.snapshot(w.raw), before = beforeOf(w)
    const h = harness(w, app)
    // an earlier attempt stopped by the operator during capture: effect-free abort, flag released, ordinary writes return
    {
      const client = loop.createClient({ send: h.send, sleep: instant })
      const first = await loop.startCutover(client, { actorUserId: ACTOR_USER, requestId: 'cutover_begin_attempt_1' })
      assert.equal(await OpsErrorCode(loop.resumeUntilReady(client, { operationId: first.state.operationId, stepLimit: 3 })), 'step-limit-reached')
      assert.equal((await h.write()).status, 503, 'fence held between the two')
      const aborted = await loop.abortCutover(client, { operationId: first.state.operationId })
      assert.equal(aborted.state.phase, 'aborted'); assert.equal(flag(w), 0)
      assert.equal((await h.write()).status, 200); assert.equal(h.probes(), 1)
      assert.equal((await loop.abortCutover(client, { operationId: first.state.operationId })).replayed, true, 'a second abort only reads')
      assert.equal(await OpsErrorCode(loop.resumeUntilReady(client, { operationId: first.state.operationId })), 'operation-aborted')
    }
    const fired = []
    const plan = { 'resume#2': 'cpu-read-0', 'resume#4': 'cpu-batch', 'resume#6': 'crash-before', 'resume#8': 'lost-ack-inside', 'resume#10': 'lost-response', 'resume#12': 'timeout-before',
      'resume#14': '502', 'resume#16': 'cpu-read-3', 'resume#40': 'lost-response', 'resume#60': 'lost-ack-inside', 'resume#80': 'cpu-batch', 'resume#100': 'timeout-before', 'resume#120': 'crash-before',
      'resume#140': 'cpu-read-1', 'resume#160': 'lost-response', 'resume#175': 'lost-ack-inside', 'finalize#1': 'lost-response' }
    const client = loop.createClient({ send: faulty(w, h.send, plan, fired), sleep: instant })
    const result = await script.executeMode('start', { client, env: { OPS_ACTOR_USER_ID: String(ACTOR_USER) }, bookmark, run: '777' })
    assert.equal(result.state.phase, 'capturing')
    const id = result.state.operationId
    const writes = h.probes()
    let fenceChecks = 0, steps = 0
    const resumed = await loop.resumeUntilReady(client, { operationId: id, onStep: async () => {
      steps++
      if (steps % 20 === 1) {
        fenceChecks++
        const refused = await h.write()
        assert.equal(refused.status, 503); assert.equal(refused.json.maintenance.mode, 'branch-cutover'); assert.equal(h.probes(), writes)
      }
      for (const [p, q] of base.product) assert.ok(Math.abs((e2e.snapshot(w.raw).product.get(p) || 0) - q) <= 1e-9, 'product ' + p + ' conserved at step ' + steps)
    } })
    assert.equal(resumed.state.phase, 'ready'); assert.ok(fenceChecks >= 5)
    for (const key of Object.keys(plan).filter(k => k.startsWith('resume#') && Number(k.slice(7)) <= resumed.steps)) assert.ok(fired.includes(key), key + ' fired')
    assert.ok(Object.keys(plan).filter(k => k.startsWith('resume#')).filter(k => !fired.includes(k)).every(k => Number(k.slice(7)) > resumed.steps), 'every scheduled fault inside the run fired')
    assert.ok(client.stats.retries >= 10, 'retries ' + client.stats.retries); assert.ok(client.stats.replayed >= 1)
    // the same request text and request id on every retry; every id follows the deterministic rule
    const byKey = new Map()
    for (const { action, text } of h.log) {
      const parsed = JSON.parse(text)
      if (!parsed.requestId || action === 'begin') continue
      assert.equal(parsed.requestId, `bcr_${parsed.operationId}_${parsed.expectedRevision}`)
      const key = action + parsed.operationId + parsed.expectedRevision
      byKey.set(key, new Set([...(byKey.get(key) || []), text]))
    }
    assert.ok([...byKey.values()].every(set => set.size === 1), 'one request text per (action, revision)')
    // P9: finalize once. The lost response is retried with the same request, then a later finalize only reads.
    const early = await h.raw('resume', body({ operationId: id, expectedRevision: resumed.state.revision, requestId: loop.stepRequestId(id, resumed.state.revision) }))
    assert.equal(early.json.refusal, 'ready_use_finalize')
    const before1 = w.raw.prepare('SELECT count(*) n FROM action_history').get().n, audits = w.raw.prepare('SELECT count(*) n FROM audit_logs').get().n
    const finalized = await loop.finalizeCutover(client, { operationId: id })
    assert.equal(finalized.state.phase, 'completed'); assert.equal(flag(w), 0)
    const afterFinal = [w.raw.prepare('SELECT count(*) n FROM action_history').get().n, w.raw.prepare('SELECT count(*) n FROM audit_logs').get().n]
    assert.equal(afterFinal[0], before1 + 1, 'exactly one summary row'); assert.ok(afterFinal[1] > audits)
    const again = await loop.finalizeCutover(loop.createClient({ send: h.send, sleep: instant }), { operationId: id })
    assert.equal(again.replayed, true)
    const direct = await h.raw('finalize', body({ operationId: id, expectedRevision: resumed.state.revision, requestId: loop.stepRequestId(id, resumed.state.revision) }))
    assert.deepEqual([direct.status, direct.json.phase, direct.json.replayed], [200, 'completed', true], 'a stale finalize replays the terminal state')
    assert.deepEqual([w.raw.prepare('SELECT count(*) n FROM action_history').get().n, w.raw.prepare('SELECT count(*) n FROM audit_logs').get().n], afterFinal, 'no second finalize effect')
    assert.equal((await h.write()).status, 200, 'ordinary writes are back')
    // end state: the LB end-state checks, on the journal row the endpoint produced
    const final = w.raw.prepare("SELECT * FROM branch_cutovers WHERE phase='completed'").get()
    e2e.verifyEndState({ w, base, before, final })
    assert.equal(w.raw.prepare("SELECT count(*) n FROM branch_cutovers WHERE phase='aborted'").get().n, 1)
    w.raw.close()
  })

  await check('refusals stop the loop at once with a fixed code and no retry; nothing changes and the fence stays held', async () => {
    const w = newWorld(8)
    const h = harness(w, app)
    const mk = (extra = {}) => loop.createClient({ send: h.send, sleep: instant, ...extra })
    // an open shift refuses begin: no journal row, no flag, exactly one attempt
    w.raw.exec("INSERT INTO shift_sessions(id,shift_code,user_id,branch_id,branch_name,business_date,opened_at) VALUES(910001,'OPEN1',7,2,'Shop','2026-10-01','2026-10-01 08:00:00')")
    let client = mk()
    const code = await OpsErrorCode(loop.startCutover(client, { actorUserId: ACTOR_USER, requestId: 'cutover_begin_shift_1' }))
    assert.equal(code, 'refused-open-shift-exists'); assert.equal(client.stats.retries, 0); assert.equal(phases(w).length, 0); assert.equal(flag(w), 0)
    // the library's own in-batch guard is the authority: with the named pre-check bypassed, begin still writes nothing and stops after a few identical retries
    {
      const seen = []
      const direct = loop.createClient({ send: async (action, text) => { seen.push(text); return { status: 503, json: { ok: false, code: 'retryable' } } }, sleep: instant })
      assert.equal(await OpsErrorCode(direct.call('begin', {})), 'begin-not-confirmed'); assert.equal(seen.length, loop.BEGIN_ATTEMPTS); assert.equal(new Set(seen).size, 1)
    }
    w.raw.exec("UPDATE shift_sessions SET closed_at='2026-10-01 20:00:00' WHERE id=910001")
    // an actor with no grant is refused
    assert.equal(await OpsErrorCode(loop.startCutover(mk(), { actorUserId: 9999, requestId: 'cutover_begin_actor_1' })), 'refused-actor-not-permitted')
    client = mk()
    const started = await loop.startCutover(client, { actorUserId: ACTOR_USER, requestId: 'cutover_begin_shift_1' })
    const id = started.state.operationId
    const read = async (extra) => (await h.raw('resume', body({ operationId: id, ...extra }))).json
    const rev = started.state.revision
    assert.equal((await read({ expectedRevision: rev, requestId: 'bcr_wrong_request_id_1' })).refusal, 'bad_request_id')
    assert.equal((await read({ expectedRevision: rev + 5, requestId: loop.stepRequestId(id, rev + 5) })).refusal, 'revision_ahead')
    assert.equal((await read({ expectedRevision: -1, requestId: loop.stepRequestId(id, -1) })).refusal, 'bad_revision')
    assert.equal((await h.raw('resume', body({ operationId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, requestId: 'x' }))).json.refusal, 'unknown_operation')
    assert.equal((await h.raw('resume', body({ expectedRevision: 0, requestId: 'x' }))).json.refusal, 'unknown_operation')
    assert.equal(await OpsErrorCode(loop.finalizeCutover(mk(), { operationId: id })), 'not-ready')
    const stale = await h.raw('resume', body({ operationId: id, expectedRevision: rev, requestId: loop.stepRequestId(id, rev) }))
    assert.equal(stale.status, 200)
    // a stale revision after the step committed replays and does nothing more
    const replay = await h.raw('resume', body({ operationId: id, expectedRevision: rev, requestId: loop.stepRequestId(id, rev) }))
    assert.deepEqual([replay.json.replayed, replay.json.revision], [true, rev + 1])
    // contract_changed_since_begin: a schema change after begin stops the loop, writes nothing, keeps the fence
    await loop.resumeUntilReady(mk(), { operationId: id, stepLimit: 5 }).catch(() => {})
    const stateBefore = phases(w)[0]
    w.raw.exec('ALTER TABLE sales ADD COLUMN zz_probe TEXT')
    client = mk()
    assert.equal(await OpsErrorCode(loop.resumeUntilReady(client, { operationId: id })), 'refused-contract-changed-since-begin')
    assert.equal(client.stats.retries, 0, 'a refusal is never retried'); assert.deepEqual(phases(w)[0], stateBefore, 'nothing written by the refusal')
    assert.equal((await h.write()).status, 503, 'fence still held after the refusal'); assert.equal(flag(w), 1)
    w.raw.exec('ALTER TABLE sales DROP COLUMN zz_probe')
    // restored: the same operation continues; abort is refused once the first child committed
    let moved = null
    await loop.resumeUntilReady(mk(), { operationId: id, onStep: ({ state }) => { if (state.committedChildren >= 1 && !moved) moved = state }, stepLimit: 4000, deadline: Infinity }).catch(() => {})
    const mid = await loop.readStatus(mk(), id)
    assert.ok(mid.next === 'ready' || mid.committedChildren >= 1)
    const abortLate = await h.raw('abort', body({ operationId: id, expectedRevision: mid.revision, requestId: loop.stepRequestId(id, mid.revision) }))
    assert.equal(abortLate.status, 409, 'abort after the first child is refused: ' + JSON.stringify(abortLate.json)); assert.equal(phases(w)[0].phase !== 'aborted', true); assert.equal(flag(w), 1)
    // finish: the run completes once the operator has restored the contract and continues forward
    const done = await loop.resumeUntilReady(mk(), { operationId: id })
    assert.equal(done.state.phase, 'ready')
    assert.equal(await OpsErrorCode(loop.abortCutover(mk(), { operationId: id })), 'refused-branch-cutover-journal-conflict', 'abort at ready is refused')
    await loop.finalizeCutover(mk(), { operationId: id })
    assert.equal(phases(w)[0].phase, 'completed'); assert.equal(flag(w), 0)
    w.raw.close()
  })

  await check('a persistent 5xx exhausts the bounded retries with the same request text and changes nothing', async () => {
    const w = newWorld(2)
    const h = harness(w, app)
    const seen = []
    const client = loop.createClient({ send: async (action, text) => { seen.push(text); return { status: 500, json: { ok: false, code: 'internal' } } }, sleep: instant, maxAttempts: 4 })
    assert.equal(await OpsErrorCode(loop.inspectCutover(client, { actorUserId: ACTOR_USER })), 'retries-exhausted')
    assert.equal(seen.length, 4); assert.equal(new Set(seen).size, 1)
    for (const [status, code] of [[401, 'unauthorized'], [404, 'endpoint-disabled']]) {
      const c = loop.createClient({ send: async () => ({ status, json: { ok: false } }), sleep: instant })
      assert.equal(await OpsErrorCode(c.call('status', {})), code); assert.equal(c.stats.retries, 0)
    }
    assert.equal(stockText(w).length > 0 && phases(w).length, 0); void h
    w.raw.close()
  })

  await check('the fence refuses ordinary writes in restore mode too, and lets the operator path through only during a branch-cutover run', async () => {
    const w = newWorld(2)
    const h = harness(w, app)
    const held = JSON.stringify({ mode: 'restore', token: 'held', backupKey: 'k', startedAt: new Date().toISOString(), startedBy: 'admin', phase: 'deleting', updatedAt: new Date().toISOString() })
    w.raw.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(held)
    assert.equal((await h.write()).status, 503)
    const blocked = await h.raw('status', body({}))
    assert.equal(blocked.status, 503, 'the operator endpoint is not reachable during a restore'); assert.equal(blocked.json.maintenance.mode, 'restore')
    w.raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    const client = loop.createClient({ send: h.send, sleep: instant })
    await loop.startCutover(client, { actorUserId: ACTOR_USER, requestId: 'cutover_begin_fence_1' })
    assert.equal((await h.write()).status, 503)
    assert.equal((await h.raw('status', body({}))).status, 200, 'operator path passes the fence during the run')
    const sibling = await app.fetch(new Request(`${ORIGIN}/api/internal/branch-cutover/status/extra`, { method: 'POST', headers: { 'x-cutover-operator-token': TOKEN }, body: '{}' }), h.env)
    assert.equal(sibling.status, 503, 'only the six exact paths are exempt')
    const other = await app.fetch(new Request(`${ORIGIN}/api/internal/branch-cutover-x/status`, { method: 'POST', body: '{}' }), h.env)
    assert.equal(other.status, 503)
    w.raw.close()
  })

  await check('CONTROL: a gate that exempts every path during the run would let an ordinary write through (the fence test would go red)', async () => {
    const leaky = await bundleApp(text => { assert.ok(text.includes('isBranchCutoverOperatorPath(c.req.path)')); return text.replace('isBranchCutoverOperatorPath(c.req.path)', 'true') })
    const w = newWorld(2)
    const h = harness(w, leaky)
    await loop.startCutover(loop.createClient({ send: h.send, sleep: instant }), { actorUserId: ACTOR_USER, requestId: 'cutover_begin_control_1' })
    assert.equal((await h.write()).status, 200, 'the leaky gate lets the write in: the real fence assertion above would fail on it')
    assert.equal(h.probes(), 1)
    w.raw.close()
  })

  console.log(`test-branch-cutover-operator-native: ${checks} checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
