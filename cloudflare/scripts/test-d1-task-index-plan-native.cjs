'use strict'
// Migration 0318 on the LOCAL D1 ENGINE (Miniflare's workerd D1, the engine the Worker runs on, not node:sqlite): with the real migration chain applied, the statements the count tasks
// make through the Worker's own D1Compat (lib/db.ts) seek inventory_check_sessions_kind_task, for an organization and for a NULL organization (a single-organization shop). The same plans on node:sqlite are
// pinned in test-migration-0318-inventory-check-task-index-pure.cjs; this one proves the engine the Worker actually uses reads an expression index the same way.
//
// Run: node scripts/test-d1-task-index-plan-native.cjs
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

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const d1 = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    const statements = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        statements.push(sql)
      }
    }
    for (let i = 0; i < statements.length; i += 100) await d1.batch(statements.slice(i, i + 100).map((s) => d1.prepare(s)))
    const index = await d1.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='inventory_check_sessions_kind_task'").all()
    assert.equal(index.results.length, 1, 'the migration chain built the index on the local D1 engine')
    const db = new D1Compat(d1)
    const plan = async (sql, params) => (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params)).map((row) => row.detail).join(' | ')
    let listSql = ''
    await tasks.readTaskRows({ prepare(statement) { listSql = statement; return { all: async () => [] } } }, { organization: null, branchId: 1, shown: 30, closedShown: 5 })
    const pickupSql = `SELECT ${tasks.OPEN_PICKUP_SQL('@task', '@org')} AS picked`
    for (const org of [1, null]) {
      const list = await plan(listSql, { org, branchId: 1, shown: 30, closedShown: 5 })
      assert.match(list, /SEARCH s USING INDEX inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\?\)/, `task list on D1 (org ${org}): ${list}`)
      assert.ok((list.match(/USING INDEX inventory_check_sessions_kind_task/g) || []).length >= 3, `open, closed and the pickup join each seek the index: ${list}`)
      const picker = await plan(pickupSql, { org, task: 'x' })
      assert.match(picker, /SEARCH pk USING INDEX inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `one-picker check on D1 (org ${org}): ${picker}`)
    }
    console.log('PASS the task list and the one-picker check seek inventory_check_sessions_kind_task on the local D1 engine, for an organization and for NULL')
    // ---- the AUTO-CLOSE statements (every count writer appends them): their plans, and the rows they read, on the same engine ------------------------------------------------------------------
    const auto = tasks.autoCloseTaskStatements()
    const args = { src: 'write-session', task: null, organization: 1, branchId: 1, actorId: 5, actorName: 'u5', key: 'request-key-0001', hash: 'h', now: '2026-11-20T00:00:00.000Z' }
    const autoParams = tasks.autoCloseParams(args)
    const planOf = async (sql) => plan(`${sql}`, autoParams)
    const [closeEvents, pickupEvents, closeTasks, closePickups] = await Promise.all(auto.statements.map((statement) => planOf(statement.sql)))
    // The candidates: for each product this write made final, the never-counted items of it at the branch (index 0285: product, branch, updated_at NULL: where a task's items are), then the session of each by key.
    // No scan of the organization's task rows, however many tasks it has made.
    assert.match(closeEvents, /SEARCH x USING INDEX inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at\S*\)/, `the candidates are a seek of the 0285 index by product, branch and NULL time: ${closeEvents}`)
    assert.match(closeEvents, /SEARCH t USING INDEX sqlite_autoindex_inventory_check_sessions_1 \(id=\?\)/, `each candidate session is found by its key: ${closeEvents}`)
    assert.doesNotMatch(closeEvents, /SEARCH t USING INDEX inventory_check_sessions_kind_task/, `the organization's task rows are not scanned: ${closeEvents}`)
    assert.match(closeEvents, /SEARCH w USING (COVERING )?INDEX inventory_check_items_state \(session_id=\? AND state=\?\)/, `the write's own counts are read by its session and the Done or Differs state: ${closeEvents}`)
    assert.match(closeEvents, /inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at>\?\)/, `the done check is one seek of the 0285 index per product: ${closeEvents}`)
    for (const [name, text] of [['task update', closeTasks], ['pickup events', pickupEvents], ['pickup update', closePickups]]) {
      assert.match(text, /sqlite_autoindex_inventory_check_events_1 \(actor_id=\? AND request_id>\? AND request_id<\?\)/, `${name} finds the events by this request's key range, not by a scan: ${text}`)
    }
    assert.match(pickupEvents, /inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `the pickups of a closed task by the 0318 index: ${pickupEvents}`)
    console.log('PASS the auto-close candidates come from the 0285 index (never-counted items of the counted products) and the sessions key, the done check seeks 0285, and the follow-ups use the events key range')

    // Rows read, as the engine counts them (meta.rows_read): a branch with the cap (30) of open tasks of 300 products each, 400 closed tasks of the organization (the unbounded part), and a write that counted 40 products.
    // Nothing done but the last product of every task (the worst case for the early stop): every task is a candidate and scans 299 done products before it finds the one that is not.
    const exec = async (sql, params = {}) => (await db.batch([{ sql, params }]))[0]
    const user = 1, at = '2026-11-01T00:00:00.000Z', after = '2026-11-20T00:00:00.000Z'
    // the 300 products the tasks hold (active, so countable)
    await load('lib/stockTransaction.ts').executeStockTransaction(db, [{ sql: "INSERT INTO products(id,name,is_active) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<300) SELECT i,'P'||i,1 FROM p" }], 'once')
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<30) SELECT 'open-'||i,1,1,1,'','open',0,'{\"membership\":\"task\"}',@at,@at FROM n", { at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE t(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM t WHERE k<30), p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<300) SELECT 'open-'||k,i,1,'{}',NULL,'{}' FROM t CROSS JOIN p")
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'closed-'||i,1,1,1,'','closed',1,'{\"membership\":\"task\"}',@at,@at,@at FROM n", { at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'closed-'||i,1,1,'{}',NULL,'{}' FROM n")
    // other sessions that are not tasks (a Submit makes one each): the 0318 index holds them too, under another kind
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'sub-'||i,1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@at,@at,@at FROM n", { at })
    // the counts that tick every product but 300: one session of 299 Done items
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('counts',1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@after,@after,@after)", { after })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<299) SELECT 'counts',i,1,'{}',1,'{}','done',1,1,1,@after FROM p", { after })
    // the write: 40 products (the Free cap of a submission), counted now
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('write-session',1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@now,@now,@now)", { now: args.now })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<40) SELECT 'write-session',i,1,'{}',1,'{}','done',1,1,1,@now FROM p", { now: args.now })
    const read = async (statement, params) => Number((await exec(statement.sql, params)).meta.rows_read)
    const worstEvents = await read(auto.statements[0], autoParams)
    const worstClosed = await exec(auto.statements[2].sql, autoParams)
    assert.equal((await exec('SELECT COUNT(*) AS n FROM inventory_check_events')).results[0].n, 0, 'the worst case closes nothing: the last product of every task is not counted')
    const closedRead = Number(worstClosed.meta.rows_read)
    // a write that counted nothing reads one row (the gate) and nothing more
    const quiet = await read(auto.statements[0], { ...autoParams, src: 'no-such-session' })
    console.log(`     rows read, 30 open tasks x 300 products + 400 closed tasks + 400 submissions in the organization: worst case ${worstEvents}; a write that counted nothing ${quiet}; the task update with no events ${closedRead}`)
    const openTasks = 30, products = 300
    // measured 29558: the cap of tasks x maxProducts x about 3.3 rows (an item, its index entry, the session of the count), plus about 2 rows for every never-counted item of a counted product in any session (here the 400 closed tasks each hold product 1): history does add reads, but only through those items
    assert.ok(worstEvents <= openTasks * products * 4 + 500, `the worst case is bounded by cap x maxProducts x 4: ${worstEvents}`)
    assert.ok(quiet <= 30, `a write that counted nothing reads next to nothing: ${quiet}`)
    assert.ok(closedRead <= 5, `with no events the task update reads only the events key range: ${closedRead}`)
    // now one product of every task is not done in a way that stops at the FIRST: product 1 undone (move every count of it off, the write's too): the early stop reads one product per task
    await exec("UPDATE inventory_check_items SET state='unstarted',counted_quantity=NULL,updated_at=NULL WHERE session_id IN ('counts','write-session') AND product_id=1")
    const early = await read(auto.statements[0], autoParams)
    console.log(`     rows read with product 1 undone (the early stop): ${early}`)
    assert.ok(early < worstEvents / 5, `the first product that is not done stops the check of a task: ${early} against ${worstEvents}`)
    console.log('PASS the auto-close reads are bounded as stated: worst case ' + worstEvents + ' rows, early stop ' + early + ', a write that counted nothing ' + quiet)
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exit(1) })
