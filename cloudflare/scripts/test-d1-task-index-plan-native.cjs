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
// THE MUTANT: the candidate read as it was before migration 0319 (every never-counted item of a product the write made final, in ANY session, then the session of each by key). The history-growth assertion must kill it.
const mutantTasks = (() => {
  const file = path.join(root, 'src', 'lib/inventoryCheckTasks.ts')
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const from = "FROM ${S} t INDEXED BY inventory_check_sessions_open_task WHERE ${candidate}"
  if (text.split(from).length !== 2) throw new Error('mutant anchor')
  const old = "FROM (SELECT x.session_id AS id FROM ${I} w CROSS JOIN ${I} x INDEXED BY inventory_check_items_product_latest ON x.product_id=w.product_id AND x.branch_id=@branchId AND x.updated_at IS NULL WHERE w.session_id=@src AND w.state IN ('done','issue') UNION SELECT @task WHERE @task IS NOT NULL) c CROSS JOIN ${S} t ON t.id=c.id WHERE ${candidate}"
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(text.replace(from, old), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((request) => request.startsWith('.') ? load(path.posix.normalize(path.posix.join('lib', request)) + '.ts') : require(request), module, module.exports)
  return module.exports
})()

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
    const index = await d1.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('inventory_check_sessions_kind_task','inventory_check_sessions_open_task','inventory_check_sessions_task_board')").all()
    assert.equal(index.results.length, 3, 'the migration chain built the three indexes on the local D1 engine')
    const db = new D1Compat(d1)
    const plan = async (sql, params) => (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params)).map((row) => row.detail).join(' | ')
    let listSql = ''
    await tasks.readTaskRows({ prepare(statement) { listSql = statement; return { all: async () => [] } } }, { organization: null, branchId: 1, shown: 30, closedShown: 5 })
    const pickupSql = `SELECT ${tasks.OPEN_PICKUP_SQL('@task', '@org')} AS picked`
    for (const org of [1, null]) {
      const list = await plan(listSql, { org, branchId: 1, shown: 30, closedShown: 5 })
      assert.match(list, /CO-ROUTINE closed_t \| SEARCH s USING INDEX inventory_check_sessions_task_board \(organization_id=\? AND branch_id=\? AND status=\?\)/, `the closed list on D1 (org ${org}) seeks the task index of 0319: ${list}`)
      assert.equal((list.match(/USING INDEX inventory_check_sessions_kind_task/g) || []).length, 1, `only the pickup join seeks the 0318 index (the open and closed lists seek 0319): ${list}`)
      assert.doesNotMatch(list.split('CO-ROUTINE closed_t')[1].split('SCAN closed_t')[0], /TEMP B-TREE|SCAN s/, `the closed list is read in the index's own order: ${list}`)
      const picker = await plan(pickupSql, { org, task: 'x' })
      assert.match(picker, /SEARCH pk USING INDEX inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `one-picker check on D1 (org ${org}): ${picker}`)
    }
    console.log('PASS the closed list seeks inventory_check_sessions_task_board, the pickup join and the one-picker check seek inventory_check_sessions_kind_task, on the local D1 engine, for an organization and for NULL')
    // ---- the AUTO-CLOSE statements (every count writer appends them): their plans, and the rows they read, on the same engine ------------------------------------------------------------------
    const auto = tasks.autoCloseTaskStatements()
    const args = { src: 'write-session', task: null, organization: 1, branchId: 1, actorId: 5, actorName: 'u5', key: 'request-key-0001', hash: 'h', now: '2026-11-20T00:00:00.000Z' }
    const autoParams = tasks.autoCloseParams(args)
    const planOf = async (sql) => plan(`${sql}`, autoParams)
    const [closeEvents, pickupEvents, closeTasks, closePickups] = await Promise.all(auto.statements.map((statement) => planOf(statement.sql)))
    // The candidates are the OPEN tasks of the organization at the branch: a seek of the partial index of migration 0319 (it holds only open sessions), then, for each, one primary-key seek of its item per product the write
    // made final. No closed task, no old session, no never-counted item of a product is ever read, however long the history.
    const OPEN = 'inventory_check_sessions_open_task'
    assert.match(closeEvents, new RegExp(`SEARCH t USING INDEX ${OPEN} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `the candidates are a seek of the open-task index: ${closeEvents}`)
    assert.match(closeEvents, /SEARCH w USING (COVERING )?INDEX inventory_check_items_state \(session_id=\? AND state=\?\)/, `the write's own counts are read by its session and the Done or Differs state: ${closeEvents}`)
    assert.match(closeEvents, /SEARCH m USING (COVERING )?INDEX sqlite_autoindex_inventory_check_items_1 \(session_id=\? AND product_id=\? AND branch_id=\?\)/, `each task's item is found by its primary key: ${closeEvents}`)
    assert.match(closeEvents, /inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at>\?\)/, `the done check is one seek of the 0285 index per product: ${closeEvents}`)
    assert.doesNotMatch(closeEvents, /inventory_check_sessions_kind_task/, `the history index is not used: ${closeEvents}`)
    assert.doesNotMatch(closeEvents, /inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at=\?\)|updated_at IS NULL|updated_at=\?\)/, `the never-counted seek of the old design is gone: ${closeEvents}`)
    assert.doesNotMatch(closeEvents, /SCAN t\b/, `no scan of the sessions: ${closeEvents}`)
    for (const [name, text] of [['task update', closeTasks], ['pickup events', pickupEvents], ['pickup update', closePickups]]) {
      assert.match(text, /sqlite_autoindex_inventory_check_events_1 \(actor_id=\? AND request_id>\? AND request_id<\?\)/, `${name} finds the events by this request's key range, not by a scan: ${text}`)
    }
    assert.match(pickupEvents, /inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `the pickups of a closed task by the 0318 index: ${pickupEvents}`)
    console.log('PLAN candidates:', closeEvents)
    // the cap guard and the board's open read, on the same index
    const capSql = `SELECT (${tasks.OPEN_TASK_COUNT_SQL}) AS n`
    for (const org of [1, null]) {
      const cap = await plan(capSql, { organization: org, branchId: 1 })
      assert.match(cap, new RegExp(`SEARCH s USING INDEX ${OPEN} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `the cap guard (org ${org}) counts the open tasks through the partial index: ${cap}`)
      const list = await plan(listSql, { org, branchId: 1, shown: 30, closedShown: 5 })
      assert.match(list, new RegExp(`SEARCH s USING INDEX ${OPEN} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `the board's open tasks (org ${org}) come from the partial index: ${list}`)
      assert.match(list, /SEARCH pk USING INDEX inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `the pickup of each shown task is a seek by task id (org ${org}): ${list}`)
      if (org === 1) console.log('PLAN cap guard:', cap)
    }
    console.log('PASS the auto-close candidates, the cap guard and the board start from the open-task index (0319); the done check seeks 0285; the follow-ups use the events key range')

    // ---- rows read, as the engine counts them (meta.rows_read), and how they move with HISTORY ------------------------------------------------------------------------------------------------------------
    const exec = async (sql, params = {}) => (await db.batch([{ sql, params }]))[0]
    const at = '2026-11-01T00:00:00.000Z', after = '2026-11-20T00:00:00.000Z'
    await load('lib/stockTransaction.ts').executeStockTransaction(db, [{ sql: "INSERT INTO products(id,name,is_active) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<300) SELECT i,'P'||i,1 FROM p" }], 'once')
    // the write: 40 products (the Free cap of a submission), counted now
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('write-session',1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@now,@now,@now)", { now: args.now })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<40) SELECT 'write-session',i,1,'{}',1,'{}','done',1,1,1,@now FROM p", { now: args.now })
    const measureAll = async (list = auto.statements, params = autoParams) => {
      const each = []
      for (const statement of list) each.push(Number((await exec(statement.sql, params)).meta.rows_read))
      measureAll.last = each
      return each.reduce((x, y) => x + y, 0)
    }
    // history: closed ordinary count sessions whose items (products 1..40) were never counted, and closed tasks; the old design read one index entry and one session row per such item
    let seq = 0
    const oldSessions = async (n, kind) => {
      const from = seq + 1; seq += n
      await exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT @from UNION ALL SELECT i+1 FROM n WHERE i<@to) SELECT 'hist-'||i,1,1,1,'','closed',1,@scope,@at,@at,@at FROM n`, { from, to: seq, scope: JSON.stringify(kind === 'task' ? { membership: 'task' } : {}), at })
      await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE n(i) AS (SELECT @from UNION ALL SELECT i+1 FROM n WHERE i<@to), p(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM p WHERE k<40) SELECT 'hist-'||i,k,1,'{}',NULL,'{}' FROM n CROSS JOIN p", { from, to: seq })
    }
    // the engine charges a fixed overhead per distinct statement (it reads the schema to prepare it); the controls show it, and it is the same at every history size
    const control = Number((await exec('SELECT 1')).meta.rows_read), controlKey = Number((await exec("SELECT id FROM inventory_check_sessions WHERE id='none'")).meta.rows_read)
    console.log('       controls: SELECT 1 reads', control, 'rows; a primary-key miss reads', controlKey)
    // what a write that changes NOTHING still costs on this engine: the INSERT and UPDATE statements on the history tables (they carry triggers) read a fixed number of rows to be prepared; the four auto-close statements are made of these
    const noInsert = Number((await exec("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) SELECT 's',NULL,1,'a','close','x','h','{}','{}','{}','n' WHERE 0")).meta.rows_read)
    const noUpdate = Number((await exec("UPDATE inventory_check_sessions SET status='closed' WHERE id='none' RETURNING id")).meta.rows_read)
    console.log('       controls: an INSERT into the events that inserts nothing reads', noInsert, 'rows; an UPDATE of the sessions that matches nothing reads', noUpdate, '(the fixed cost of the statement itself, whatever the history)')
    await measureAll()
    const growth = [], growthMutant = []
    const mutantStatements = mutantTasks.autoCloseTaskStatements().statements
    growth.push(['K=0 old sessions, no closed task', await measureAll()]); growthMutant.push(await measureAll(mutantStatements)); console.log('       statements 1-4 at K=0:', JSON.stringify(measureAll.last))
    await oldSessions(10, 'count'); growth.push(['K=10 old sessions', await measureAll()]); growthMutant.push(await measureAll(mutantStatements)); console.log('       statements 1-4 at K=10:', JSON.stringify(measureAll.last))
    await oldSessions(90, 'count'); growth.push(['K=100 old sessions', await measureAll()]); growthMutant.push(await measureAll(mutantStatements))
    await oldSessions(100, 'task'); growth.push(['K=100 + 100 closed tasks', await measureAll()]); growthMutant.push(await measureAll(mutantStatements))
    const noTask = growth[0][1]
    console.log('     rows read by the four statements, a write of 40 products, NO open task:'); for (const [name, rows] of growth) console.log(`       ${name}: ${rows}`)
    assert.ok(growth.every(([, rows]) => rows === noTask), `with no open task the rows read are the same at every history size: ${JSON.stringify(growth)}`)
    assert.ok(noTask <= 60, `with no open task a write reads a fixed handful (the engine charges per-statement overhead; no history row is read): ${noTask}`)
    console.log('     the mutant (candidates from the 0285 never-counted seek again), the same four points:', JSON.stringify(growthMutant))
    assert.ok(growthMutant.every((rows, i) => i === 0 || rows > growthMutant[i - 1]) && growthMutant[3] > growthMutant[0] + 1000, `the history-growth assertion kills the old candidate read (its rows grow with history): ${JSON.stringify(growthMutant)}`)
    // the same write, ONE open task of 41 products (the 41st never counted: the task stays open), at every history size
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) VALUES('one-open',1,1,1,'','open',0,'{\"membership\":\"task\"}',@at,@at)", { at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<41) SELECT 'one-open',i,1,'{}',NULL,'{}' FROM p")
    const oneOpen = await measureAll()
    await oldSessions(100, 'count'); await oldSessions(100, 'task')
    const oneOpenAfter = await measureAll()
    console.log(`     one open task of 41 products: ${oneOpen} rows; after 100 more old sessions and 100 more closed tasks: ${oneOpenAfter}`)
    assert.equal(oneOpenAfter, oneOpen, 'with one open task the rows read do not move with history either')
    await exec("UPDATE inventory_check_sessions SET status='closed',closed_at=@at WHERE id='one-open'", { at }) // history is immutable: it closes, and becomes one more closed task

    // ---- the count-check schema probe names the three indexes: still one call, one scan of sqlite_master; the only added rows are the three names the engine walks in json_each -------------------------------
    {
      const probe = load('lib/schemaObjectProbe.ts'), indexes = ['inventory_check_sessions_kind_task', 'inventory_check_sessions_open_task', 'inventory_check_sessions_task_board']
      const withNames = probe.KNOWN_SCHEMA_OBJECT_NAMES, withoutNames = withNames.filter((name) => !indexes.includes(name))
      assert.equal(withNames.length - withoutNames.length, 3, 'the probe lists the three indexes')
      const rowsOf = async (names) => { const answer = await exec(probe.SCHEMA_OBJECTS_PRESENT_SQL, { names: JSON.stringify(names) }); return { rows: Number(answer.meta.rows_read), found: answer.results.map((row) => row.name).sort() } }
      const before = await rowsOf(withoutNames), after = await rowsOf(withNames)
      console.log(`     the schema probe: 1 D1 call; ${before.rows} rows read naming ${withoutNames.length} objects, ${after.rows} naming ${withNames.length}`)
      assert.equal(after.rows, before.rows + 3, 'the probe reads the same scan of sqlite_master and three more rows, one json_each value per name added')
      for (const name of indexes) assert.ok(after.found.includes(name), `the probe finds ${name} once the migrations are applied`)
      assert.ok(!before.found.some((name) => indexes.includes(name)), 'and without the names it does not look for them')
    }

    // ---- the board's CLOSED list: rows read at 10, 100 and 1,000 closed tasks at one branch, with the history of the other branches and the old sessions already in the table ----------------------------
    // THE MUTANT is the closed list as it was before the task index (it seeks the 0318 index by organization and kind, so it reads every task the organization ever made, on every branch).
    const closedSql = /closed_t AS \(([\s\S]*?LIMIT @closedShown)\)/.exec(listSql)[1]
    const oldClosedSql = closedSql.replace('INDEXED BY inventory_check_sessions_task_board', 'INDEXED BY inventory_check_sessions_kind_task'), oldListSql = listSql.replace('INDEXED BY inventory_check_sessions_task_board', 'INDEXED BY inventory_check_sessions_kind_task')
    assert.ok(oldClosedSql !== closedSql && oldListSql !== listSql, 'the mutant anchor: the closed list names the task index')
    const boardArgs = { org: 1, branchId: 7, shown: 30, closedShown: 5 }, closedArgs = { org: 1, branchId: 7, closedShown: 5 }, TASK = '{"membership":"task"}'
    const twice = async (sql, params) => { await exec(sql, params); return Number((await exec(sql, params)).meta.rows_read) }
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3) SELECT 'b7-open-'||i,1,7,1,'','open',0,@scope,@at,@at FROM n", { scope: TASK, at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3) SELECT 'b7-open-'||i,i,7,'{}',NULL,'{}' FROM n")
    let closedMade = 0
    const addClosed = async (to) => {
      const from = closedMade + 1; closedMade = to
      await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT @from UNION ALL SELECT i+1 FROM n WHERE i<@to) SELECT 'b7-'||i,1,7,1,'','closed',1,@scope,@at,@at,printf('2026-11-02T%08d',i) FROM n", { from, to, scope: TASK, at })
      await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE n(i) AS (SELECT @from UNION ALL SELECT i+1 FROM n WHERE i<@to) SELECT 'b7-'||i,1,7,'{}',NULL,'{}' FROM n", { from, to })
    }
    const board = { closed: [], whole: [], oldClosed: [], oldWhole: [] }
    for (const size of [10, 100, 1000]) {
      await addClosed(size)
      board.closed.push(await twice(closedSql, closedArgs)); board.whole.push(await twice(listSql, boardArgs))
      board.oldClosed.push(await twice(oldClosedSql, closedArgs)); board.oldWhole.push(await twice(oldListSql, boardArgs))
    }
    console.log('     board rows read at 10 / 100 / 1,000 closed tasks at the branch (the table also holds the other branches\' history):')
    console.log('       closed list, task index:', JSON.stringify(board.closed), ' whole board:', JSON.stringify(board.whole))
    console.log('       closed list, the old read (0318 index):', JSON.stringify(board.oldClosed), ' whole board:', JSON.stringify(board.oldWhole))
    assert.ok(board.closed[2] <= board.closed[0], `the closed list reads no more at 1,000 closed tasks than at 10: ${JSON.stringify(board.closed)}`)
    assert.ok(board.whole[2] <= board.whole[0], `the whole board reads no more at 1,000 closed tasks than at 10: ${JSON.stringify(board.whole)}`)
    assert.ok(board.oldClosed[2] > board.oldClosed[0] + 500 && board.oldWhole[2] > board.oldWhole[0] + 500, `the growth assertion kills the old closed list (its rows grow with history): ${JSON.stringify([board.oldClosed, board.oldWhole])}`)
    assert.ok(board.closed[2] <= 10, `the closed list reads only the few rows it shows: ${board.closed[2]}`)
    const closedPlan = await plan(closedSql, closedArgs)
    assert.equal(closedPlan, 'SEARCH s USING INDEX inventory_check_sessions_task_board (organization_id=? AND branch_id=? AND status=?)', `the closed list: ${closedPlan}`)
    console.log('PLAN closed list:', closedPlan)
    console.log('PASS the board\'s closed list reads the same few rows at 10, 100 and 1,000 closed tasks (' + board.closed.join(' / ') + ', whole board ' + board.whole.join(' / ') + '); the old read grows (' + board.oldClosed.join(' / ') + ')')

    // ---- the worst case: the cap (30) of open tasks of 300 products each; every task complete but its last product ---------------------------------------------------------------------------------
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<30) SELECT 'open-'||i,1,1,1,'','open',0,'{\"membership\":\"task\"}',@at,@at FROM n", { at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE t(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM t WHERE k<30), p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<300) SELECT 'open-'||k,i,1,'{}',NULL,'{}' FROM t CROSS JOIN p")
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'closed-'||i,1,1,1,'','closed',1,'{\"membership\":\"task\"}',@at,@at,@at FROM n", { at })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'closed-'||i,1,1,'{}',NULL,'{}' FROM n")
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400) SELECT 'sub-'||i,1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@at,@at,@at FROM n", { at })
    // the counts that tick every product but 300: one closed session of 299 Done items
    await exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('counts',1,1,1,'','closed',0,'{\"membership\":\"submission\"}',@after,@after,@after)", { after })
    await exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) WITH RECURSIVE p(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM p WHERE i<299) SELECT 'counts',i,1,'{}',1,'{}','done',1,1,1,@after FROM p", { after })
    const read = async (statement, params) => Number((await exec(statement.sql, params)).meta.rows_read)
    const worstEvents = await read(auto.statements[0], autoParams)
    assert.equal((await exec('SELECT COUNT(*) AS n FROM inventory_check_events')).results[0].n, 0, 'the worst case closes nothing: the last product of every task is not counted')
    const worstAll = await measureAll()
    const quiet = await read(auto.statements[0], { ...autoParams, src: 'no-such-session' })
    const closedRead = Number((await exec(auto.statements[2].sql, autoParams)).meta.rows_read)
    console.log(`     worst case: 30 open tasks x 300 products, a write of 40 products, ${200 + 400 + 400 + 200 + 2} history sessions: statement 1 ${worstEvents} rows, the four statements ${worstAll}; a write that counted nothing ${quiet}; the task update with no events ${closedRead}`)
    const openTasks = 30, products = 300, written = 40
    // the cap x (the products of a task x about 3.3 rows: an item, its 0285 entry, the session of the count + one primary-key seek of the item per written product x 2)
    assert.ok(worstEvents <= openTasks * (products * 4 + written * 3) + 100, `the worst case is bounded by cap x (maxProducts x 4 + written x 3): ${worstEvents}`)
    assert.ok(quiet <= openTasks * 2 + 30, `a write that holds none of the tasks' products reads 2 rows per open task (its index entry, the empty counts seek) and the fixed overhead: ${quiet}`)
    assert.ok(closedRead <= 5, `with no events the task update reads only the events key range: ${closedRead}`)
    // the cap guard on the open index (0319) or on the task index: the cheaper one is the one the Worker names
    const capOnTaskIndex = capSql.replace('INDEXED BY inventory_check_sessions_open_task', 'INDEXED BY inventory_check_sessions_task_board')
    assert.notEqual(capOnTaskIndex, capSql)
    const capRows = await twice(capSql, { organization: 1, branchId: 1 }), capRowsOnTaskIndex = await twice(capOnTaskIndex, { organization: 1, branchId: 1 })
    console.log(`     cap guard at 30 open tasks and 400+ closed tasks at the branch: ${capRows} rows on the open index, ${capRowsOnTaskIndex} on the task index`)
    assert.ok(capRows <= capRowsOnTaskIndex, `the cap guard reads no more on the index the Worker names than on the other: ${capRows} against ${capRowsOnTaskIndex}`)
    // history does not move the worst case either: 100 more old sessions and 100 more closed tasks
    await oldSessions(100, 'count'); await oldSessions(100, 'task')
    const worstAfter = await read(auto.statements[0], autoParams)
    assert.equal(worstAfter, worstEvents, 'the worst case does not move with 200 more history sessions')
    // now one product of every task is not done in a way that stops at the FIRST: product 1 undone (every count of it off, the write's too): the early stop reads one product per task
    await exec("UPDATE inventory_check_items SET state='unstarted',counted_quantity=NULL,updated_at=NULL WHERE session_id IN ('counts','write-session') AND product_id=1")
    const early = await read(auto.statements[0], autoParams)
    console.log(`     rows read with product 1 undone (the early stop): ${early}`)
    assert.ok(early < worstEvents / 5, `the first product that is not done stops the check of a task: ${early} against ${worstEvents}`)
    console.log('PASS the auto-close reads do not move with history (' + noTask + ' rows with no open task at K=0, 10, 100 and 100 closed tasks); worst case ' + worstEvents + ' rows, early stop ' + early + ', a write that counted nothing ' + quiet)
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exit(1) })
