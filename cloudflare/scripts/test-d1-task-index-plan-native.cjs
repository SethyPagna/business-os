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
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exit(1) })
