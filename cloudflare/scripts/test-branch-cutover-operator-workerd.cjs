// The branch-cutover operator endpoint on local workerd (Miniflare: real D1, real Request/Response/crypto.subtle, in-memory,
// random port; never 8787 and never .wrangler/state). The real Hono route and the real maintenance gate lifted from
// src/index.ts are bundled for workerd; the production-shaped fixture (scale CUTOVER_SCALE, default 0.02) is loaded through
// the D1 binding; the real operator loop then drives a whole cutover over HTTP: inspect, start, resume-until-ready with a lost
// response every 40th call, finalize. Checked on the way and at the end: a dark endpoint and a wrong token on workerd, an
// ordinary write refused by the fence during the run and accepted after, per-product totals conserved to the unit, the source
// branch empty, the directory final, the journal completed with the maintenance flag released.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const fixture = require('./branch-cutover-scale-fixture.cjs')
const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')
const TOKEN = 'workerd-operator-test-token-0123456789abcdef'
const SCALE = Number(process.env.CUTOVER_SCALE || 0.02)

function gateSource() {
  const source = ts.createSourceFile('index.ts', fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'app.use' && node.expression.arguments[1]?.getText(source).includes('getMaintenance(c.env)'))
  assert.ok(statement)
  return statement.expression.arguments[1].getText(source)
}

async function main() {
  const entry = `
    import { Hono } from 'hono'
    import route from './src/routes/branchCutoverOperator.ts'
    import { getMaintenance, isBranchCutoverOperatorPath, isMaintenanceGatedRequest } from './src/lib/maintenance.ts'
    const app = new Hono()
    app.onError((error, c) => c.json({ success: false, error: 'Something went wrong processing that request. Please try again.' }, 500))
    app.use('/api/*', ${gateSource()})
    app.post('/api/probe/write', async (c) => { await c.env.DB.prepare('INSERT INTO probe_writes DEFAULT VALUES').run(); return c.json({ ok: true }) })
    app.route('/api/internal/branch-cutover', route)
    export default { fetch: (request, env, ctx) => app.fetch(request, env, ctx) }`
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' })
  const make = (bindings) => new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', port: 0, d1Databases: ['DB'], bindings, log: new Log(LogLevel.ERROR) })
  const dark = make({})
  const mf = make({ BRANCH_CUTOVER_OPERATOR_TOKEN: TOKEN })
  try {
    const url = (action) => `http://operator.test/api/internal/branch-cutover/${action}`
    const post = async (target, action, text, header) => {
      const response = await target.dispatchFetch(url(action), { method: 'POST', headers: { 'content-type': 'application/json', ...(header === undefined ? {} : { 'x-cutover-operator-token': header }) }, body: text })
      let json = null; try { json = await response.json() } catch { }
      return { status: response.status, json }
    }
    assert.deepEqual(await post(dark, 'status', '{}', TOKEN), { status: 404, json: { ok: false, code: 'not_found' } }, 'no secret on the Worker: dark')
    for (const header of [undefined, '', 'wrong', TOKEN.slice(0, -1), TOKEN + 'x']) assert.deepEqual(await post(mf, 'status', '{}', header), { status: 401, json: { ok: false, code: 'unauthorized' } }, JSON.stringify(header))

    const db = await mf.getD1Database('DB')
    const t0 = Date.now()
    const migrations = []
    for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        migrations.push(db.prepare(sql))
      }
    }
    for (let i = 0; i < migrations.length; i += 50) await db.batch(migrations.slice(i, i + 50))
    const data = fixture.rows({ scale: SCALE })
    const inserts = fixture.statements(data, 60000, 250).map(statement => db.prepare(statement.sql).bind(...(statement.params || [])))
    for (let i = 0; i < inserts.length; i += 10) await db.batch(inserts.slice(i, i + 10))
    await db.prepare('CREATE TABLE probe_writes(id INTEGER PRIMARY KEY)').run()
    await db.prepare("DELETE FROM system_flags WHERE key='branch_cutover_control_incarnation'").run()
    console.log(`seeded scale ${SCALE} in ${Math.round((Date.now() - t0) / 1000)} s`)
    const first = async (sql) => (await db.prepare(sql).first())
    const totals = async () => Object.fromEntries((await db.prepare('SELECT product_id,sum(quantity) q FROM branch_stock WHERE branch_id IN (1,2) GROUP BY product_id').all()).results.map(r => [r.product_id, r.q]))
    const before = await totals()
    const lotTotal = (await first('SELECT sum(quantity) q FROM branch_batch_stock WHERE branch_id IN (1,2)')).q
    const sourceUnits = (await first('SELECT sum(quantity) q FROM branch_stock WHERE branch_id=2')).q
    const moving = (await first('SELECT count(*) n FROM branch_stock WHERE branch_id=2 AND quantity>0')).n

    const loop = await import(pathToFileURL(path.join(repo, 'ops/scripts/branch-cutover-loop.mjs')).href)
    let calls = 0
    const send = async (action, text) => {
      const response = await post(mf, action, text, TOKEN)
      if (action === 'resume' && ++calls % 40 === 0 && !send.lost.has(text)) { send.lost.add(text); throw new Error('response lost') }
      return response
    }
    send.lost = new Set()
    const client = loop.createClient({ send, sleep: async () => {} })
    const write = async () => { const r = await mf.dispatchFetch('http://operator.test/api/probe/write', { method: 'POST' }); return { status: r.status, json: await r.json() } }

    const inspected = await loop.inspectCutover(client, { actorUserId: 7 })
    assert.equal(inspected.verdict.ready, true, JSON.stringify(inspected.inspect.capabilities))
    assert.equal((await write()).status, 200, 'before the run an ordinary write is accepted')
    const started = await loop.startCutover(client, { actorUserId: 7, requestId: 'cutover_begin_workerd_1' })
    assert.equal(started.state.phase, 'capturing')
    assert.match((await first("SELECT value FROM system_flags WHERE key='branch_cutover_control_incarnation'")).value, /^[0-9a-f-]{36}$/, 'begin created the incarnation on real D1')
    const refused = await write()
    assert.equal(refused.status, 503); assert.equal(refused.json.maintenance.mode, 'branch-cutover')
    assert.equal((await first('SELECT count(*) n FROM probe_writes')).n, 1, 'the refused write left nothing')
    const t1 = Date.now()
    let steps = 0
    const resumed = await loop.resumeUntilReady(client, { operationId: started.state.operationId, onStep: async () => { if (++steps % 150 === 1) assert.equal((await write()).status, 503) } })
    assert.equal(resumed.state.phase, 'ready')
    console.log(`resume-until-ready: ${resumed.steps} steps in ${Math.round((Date.now() - t1) / 1000)} s, ${client.stats.retries} retries, ${client.stats.replayed} replays`)
    assert.ok(client.stats.retries >= 1 || resumed.steps < 40, 'a lost response was retried')
    const finalized = await loop.finalizeCutover(client, { operationId: started.state.operationId })
    assert.equal(finalized.state.phase, 'completed')
    assert.equal((await loop.finalizeCutover(client, { operationId: started.state.operationId })).replayed, true)

    assert.equal((await first("SELECT count(*) n FROM system_flags WHERE key='maintenance'")).n, 0)
    assert.equal((await write()).status, 200, 'ordinary writes are back'); assert.equal((await first('SELECT count(*) n FROM probe_writes')).n, 2)
    const after = await totals()
    for (const [product, quantity] of Object.entries(before)) assert.ok(Math.abs((after[product] || 0) - quantity) <= 1e-9, 'product ' + product)
    assert.equal((await first('SELECT count(*) n FROM branch_stock WHERE branch_id=2 AND quantity<>0')).n, 0)
    assert.equal((await first('SELECT count(*) n FROM branch_batch_stock WHERE branch_id=2 AND quantity<>0')).n, 0)
    assert.ok(Math.abs((await first('SELECT sum(quantity) q FROM branch_batch_stock WHERE branch_id IN (1,2)')).q - lotTotal) <= 1e-6)
    assert.equal((await first("SELECT count(*) n FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\'")).n, moving)
    assert.ok(Math.abs((await first("SELECT sum(quantity) q FROM transfer_operation_members WHERE receipt_id IN (SELECT id FROM transfer_operation_receipts WHERE request_id LIKE 'bc\\_%' ESCAPE '\\')")).q - sourceUnits) <= 1e-6)
    const branches = (await db.prepare('SELECT id,name,is_active,is_default,successor_branch_id FROM branches WHERE id IN (1,2) ORDER BY id').all()).results
    assert.deepEqual(branches.map(b => [b.id, b.name, b.is_active, b.is_default, b.successor_branch_id]), [[1, 'LC Store', 1, 1, null], [2, 'Old Shop', 0, 0, 1]])
    const journal = await first("SELECT phase,committed_children FROM branch_cutovers WHERE operation_id='" + started.state.operationId + "'")
    assert.deepEqual([journal.phase, journal.committed_children], ['completed', moving])
    console.log('test-branch-cutover-operator-workerd: PASS (' + moving + ' products moved through the real endpoint on workerd D1)')
  } finally { await mf.dispose(); await dark.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
