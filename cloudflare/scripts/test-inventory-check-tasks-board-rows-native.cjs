'use strict'
// Count tasks, round 8b (DESIGN-task-reopen P2.1 + P2.2, review finding F4): the ROWS the task board reads, on the LOCAL D1 ENGINE (Miniflare's workerd D1) with the real migration chain: rows_read is the engine's own meta.
//   P2.1  closed tasks stop recomputing: 5 closed tasks of 300 products read <= 5 x 4 + 20 rows (their close events carry the figures); before: ~10.5K. A task closed before the figures were recorded falls back to the live walk
//         (the same figures).
//   P2.2  one walk for total, done and removed: the cold board of 30 open x 300 + 5 closed x 300 (half the products counted) reads <= 3.6 per open item + 100 rows; before: ~7 per open item. The figures equal the
//         three counts of the old statement on every row.
//   F4    the board's open list grows with the reopens (a take-back is never refused by the cap): 30 open + 15 reopened tasks read in proportion to the OPEN tasks only, whatever history of closed tasks there is.
// The 'before' figures are the old statement rebuilt from the same SQL helpers (three correlated counts, closed rows live), so the assertions below fail on the old reader.
//
// Run: node scripts/test-inventory-check-tasks-board-rows-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const file = path.join(root, 'src', rel), module = { exports: {} }
  cache.set(rel, module)
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((request) => {
    if (!request.startsWith('.')) return request.startsWith('cloudflare:') ? {} : require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }, module, module.exports)
  return module.exports
}
const { D1Compat } = load('lib/db.ts')
const tasks = load('lib/inventoryCheckTasks.ts')
const S = 'inventory_check_sessions', I = 'inventory_check_items'
const EV = 'INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)'
const iso = (s) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString()
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i)
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const d1 = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations'), statements = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        statements.push(sql)
      }
    }
    for (let i = 0; i < statements.length; i += 100) await d1.batch(statements.slice(i, i + 100).map((s) => d1.prepare(s)))
    const db = new D1Compat(d1)
    const exec = async (sql, params = {}) => (await db.batch([{ sql, params }]))[0]
    const measure = async (sql, params) => { const t0 = performance.now(); const r = await exec(sql, params); return { rows: Number(r.meta.rows_read), ms: performance.now() - t0, results: r.results } }
    const stock = (sql) => load('lib/stockTransaction.ts').executeStockTransaction(db, [{ sql }], 'once')
    await stock("INSERT INTO products(id,name,is_active) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<300) SELECT i,'P'||i,1 FROM p")

    let listSql = ''
    await tasks.readTaskRows({ prepare(statement) { listSql = statement; return { all: async () => [] } } }, { organization: null, branchId: 1, closedShown: 5 })
    // THE OLD STATEMENT: the three correlated counts, a closed row computed live like any other.
    const countable = tasks.taskItemCountableSql('t'), done = tasks.taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')
    const figuresStart = listSql.indexOf("CASE WHEN page.status='closed' THEN COALESCE("), figuresEnd = listSql.indexOf(' END AS figures,') + ' END AS figures,'.length
    assert.ok(figuresStart > 0 && figuresEnd > figuresStart, 'the figures anchor')
    const oldSql = listSql.slice(0, figuresStart) + `(SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${countable}) AS total,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND ${done} AND ${countable}) AS done,
      (SELECT COUNT(*) FROM ${I} t WHERE t.session_id=page.id AND NOT ${countable}) AS removed,` + listSql.slice(figuresEnd)

    const session = (id, org, b, status, scope, started, closed) => exec(`INSERT INTO ${S}(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(@id,@org,@b,1,'',@status,@rev,@scope,@started,@upd,@closed)`,
      { id, org, b, status, rev: status === 'closed' ? 1 : 0, scope: JSON.stringify(scope), started, upd: closed ?? started, closed: closed ?? null })
    const taskItems = (id, b, products) => exec(`INSERT INTO ${I}(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) SELECT @id,value,@b,'{}',NULL,'{}' FROM json_each(@p)`, { id, b, p: JSON.stringify(products) })
    const countItems = (id, b, products, at) => exec(`INSERT INTO ${I}(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT @id,value,@b,'{}',1,'{}','done',1,NULL,1,1,@at FROM json_each(@p)`, { id, b, p: JSON.stringify(products), at })
    const closeEvent = (task, at, figures) => exec(`${EV} VALUES(@task,NULL,1,'u1','close',@rid,'seed',json_object('status','open','revision',0),@after,json_object('sessionRevision',1),@at)`,
      { task, rid: `seed-close-${task}`, after: JSON.stringify({ status: 'closed', revision: 1, auto: 1, ...(figures ?? {}) }), at })
    const TASK = { membership: 'task' }
    // One world = one organization and branch: `open` open tasks of 300 products issued early, `closed` closed ones (frozen figures, or legacy: none), a closed count session of products 1..150 after them.
    let world = 0
    const build = async ({ open, closed, legacy = false, reopened = 0, deactivated = false }) => {
      const w = ++world, org = w, b = w, out = { org, b, openIds: [], closedIds: [] }
      for (let k = 1; k <= open + reopened; k++) { const id = `o-${w}-${k}`; await session(id, org, b, 'open', TASK, iso(100 + k), null); await taskItems(id, b, range(1, 300)); out.openIds.push(id) }
      for (let k = 1; k <= closed; k++) {
        const id = `c-${w}-${k}`; await session(id, org, b, 'closed', TASK, iso(10 + k), iso(60 + k)); await taskItems(id, b, range(1, 300)); out.closedIds.push(id)
        await closeEvent(id, iso(60 + k), legacy ? undefined : { total: 300, done: 300, removed: 0 })
      }
      // reopened tasks: a closed task that reopened is an open row whose newest event is the reopen (its older close event is not read for an open row)
      for (let k = 1; k <= reopened; k++) { const id = out.openIds[open + k - 1]; await closeEvent(id, iso(50 + k), { total: 300, done: 300, removed: 0 }); await exec(`${EV} VALUES(@id,NULL,1,'u1','resume',@rid,'seed','{}',json_object('status','open','revision',2,'reopened',1,'cause','resumed','by','x'),'{}',@at)`, { id, rid: `seed-reopen-${id}`, at: iso(80 + k) }) }
      await session(`cnt-${w}`, org, b, 'closed', { membership: 'submission' }, iso(200), iso(200)); await countItems(`cnt-${w}`, b, range(1, 150), iso(200))
      if (deactivated) await stock('UPDATE products SET is_active=0 WHERE id>290')
      return out
    }
    const args = (x) => ({ org: x.org, branchId: x.b, closedShown: 5 })
    const decode = (f) => tasks.decodeTaskFigures(f)

    // ---- the closed part alone (P2.1) ------------------------------------------------------------------------------------------------------------------------
    const closedOnly = await build({ open: 0, closed: 5 }), legacyOnly = await build({ open: 0, closed: 5, legacy: true })
    const frozen = await measure(listSql, args(closedOnly)), legacy = await measure(listSql, args(legacyOnly)), oldClosed = await measure(oldSql, args(closedOnly))
    console.log(`     5 closed x 300: frozen ${frozen.rows} rows / ${frozen.ms.toFixed(0)} ms, legacy (no figures in the event) ${legacy.rows} / ${legacy.ms.toFixed(0)} ms, the old statement ${oldClosed.rows} / ${oldClosed.ms.toFixed(0)} ms`)
    check('P2.1: five closed tasks of 300 products read <= 5 x 4 + 20 rows from their close events (before: every item of every closed task again); the figures are the close figures', () => {
      assert.ok(frozen.rows <= 5 * 4 + 20, `closed part ${frozen.rows} rows`)
      assert.ok(oldClosed.rows > 5000, `the old statement walked the closed tasks: ${oldClosed.rows}`)
      for (const row of frozen.results) assert.deepEqual(decode(row.figures), { total: 300, done: 300, removed: 0 })
    })
    check('P2.1: a task closed before the figures were recorded falls back to the live walk, with the same figures (and pays the walk)', () => {
      assert.ok(legacy.rows > 5000, `the fallback walked: ${legacy.rows}`)
      assert.equal(legacy.results.length, 5)
      for (const row of legacy.results) assert.deepEqual(decode(row.figures), { total: 300, done: 150, removed: 0 }, 'live: 150 of the 300 products have a count since')
    })

    // ---- the cold board (P2.2) --------------------------------------------------------------------------------------------------------------------------------
    const board = await build({ open: 30, closed: 5 })
    const afterBoard = await measure(listSql, args(board)), beforeBoard = await measure(oldSql, args(board))
    console.log(`     board 30 open x 300 + 5 closed x 300: one pass + frozen ${afterBoard.rows} rows (${(afterBoard.rows / 9000).toFixed(2)} per open item, ${afterBoard.ms.toFixed(0)} ms); the old three walks ${beforeBoard.rows} rows (${(beforeBoard.rows / 9000).toFixed(2)}, ${beforeBoard.ms.toFixed(0)} ms)`)
    check('P2.2: the cold board of 30 open x 300 reads <= 3.6 rows per open item + 100 (before: ~7 per open item)', () => {
      assert.ok(afterBoard.rows <= 3.6 * 9000 + 100, `${afterBoard.rows} rows`)
      assert.ok(beforeBoard.rows > 6 * 9000, `the old reader read ${beforeBoard.rows}`)
    })
    check('P2.2: the one-pass figures equal the three counts of the old statement on every open row, and a closed row shows its close figures', () => {
      const old = new Map(beforeBoard.results.map((r) => [r.id, r]))
      assert.equal(afterBoard.results.length, 35)
      for (const row of afterBoard.results) {
        const f = decode(row.figures)
        if (row.status === 'open') assert.deepEqual(f, { total: Number(old.get(row.id).total), done: Number(old.get(row.id).done), removed: Number(old.get(row.id).removed) }, row.id)
        else assert.deepEqual(f, { total: 300, done: 300, removed: 0 }, row.id)
        if (row.status === 'open') assert.deepEqual(f, { total: 300, done: 150, removed: 0 })
      }
    })
    const removed = await build({ open: 3, closed: 1, deactivated: true })
    const removedAfter = await measure(listSql, args(removed)), removedBefore = await measure(oldSql, args(removed))
    check('P2.2: with products that left the total (deactivated) the one pass still equals the three counts: total, done and removed', () => {
      const old = new Map(removedBefore.results.map((r) => [r.id, r]))
      for (const row of removedAfter.results.filter((r) => r.status === 'open')) {
        const o = old.get(row.id)
        assert.deepEqual(decode(row.figures), { total: Number(o.total), done: Number(o.done), removed: Number(o.removed) })
        assert.deepEqual(decode(row.figures), { total: 290, done: 150, removed: 10 })
      }
    })

    // ---- F4: the open list grows with the reopens, the rows with the OPEN tasks only ----------------------------------------------------------------------------
    const grown = await build({ open: 30, reopened: 15, closed: 5 })
    const afterGrown = await measure(listSql, args(grown))
    const perOpen = afterGrown.rows / (45 * 300)
    console.log(`     F4 board 30 open + 15 reopened (45 open x 300) + 5 closed: ${afterGrown.rows} rows (${perOpen.toFixed(2)} per open item), ${afterGrown.ms.toFixed(0)} ms laptop; the 30-open board: ${afterBoard.rows} rows, ${afterBoard.ms.toFixed(0)} ms`)
    check('F4: the board with 30 open + 15 reopened tasks reads in proportion to the OPEN tasks (<= 3.6 per open item + 100), the closed history adds ~4 rows per closed task', () => {
      assert.ok(afterGrown.rows <= 3.6 * 13500 + 100, `${afterGrown.rows} rows`)
      assert.equal(afterGrown.results.filter((r) => r.status === 'open').length, 45)
      const reopenedShown = afterGrown.results.filter((r) => r.status === 'open' && r.reopened)
      assert.equal(reopenedShown.length, 15, 'the reopened field shows on exactly the reopened tasks')
    })
    // history does not grow the board: 200 more closed tasks at the branch change nothing it reads (the closed list is the newest 5)
    await Promise.all(range(1, 1).map(() => null))
    for (let k = 1; k <= 200; k++) { const id = `h-${grown.org}-${k}`; await session(id, grown.org, grown.b, 'closed', TASK, iso(-1000 - k), iso(-900 - k)); await taskItems(id, grown.b, [1, 2, 3]); await closeEvent(id, iso(-900 - k), { total: 3, done: 3, removed: 0 }) }
    const withHistory = await measure(listSql, args(grown))
    check('F4: 200 older closed tasks of the branch add no rows to the board (the closed list is the newest five, frozen)', () => { assert.ok(withHistory.rows <= afterGrown.rows + 20, `${withHistory.rows} vs ${afterGrown.rows}`) })

    console.log(`${passed} checks passed`)
  } finally { await mf.dispose() }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
