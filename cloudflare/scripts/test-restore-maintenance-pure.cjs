// Regression test for the restore maintenance lock (Part-77 slice C):
// lib/maintenance.ts behavior against a real SQLite database running the
// real migration chain (so 0088_system_flags is the actual table under
// test), plus source locks on the wiring (index.ts write gate, backups.ts
// begin/progress/end + refuse-on-active-imports, backup.ts onProgress).
//
// Run: node scripts/test-restore-maintenance-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const ts = require('typescript')

const cloudflareRoot = path.join(__dirname, '..')
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', name + '.ts'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`)
    return dependencies[id]
  }, mod, mod.exports)
  return mod.exports
}
const stockTransaction = load('stockTransaction')
const {
  beginMaintenance, endMaintenance, getMaintenance, updateMaintenance, isMaintenanceGatedRequest,
} = load('maintenance', { './stockTransaction': stockTransaction })

// Real migration chain -> real system_flags table.
const db = new Database(':memory:')
const migrationsDir = path.join(cloudflareRoot, 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

function d1(dbHandle) {
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    first: async () => dbHandle.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: dbHandle.prepare(sql).run(...params).changes } }),
  })
  return {
    prepare,
    batch: async statements => dbHandle.transaction(() => statements.map(({ sql, params }) => {
      const result = dbHandle.prepare(sql).run(...params)
      return { success: true, meta: { changes: result.changes } }
    }))(),
  }
}
const env = { DB: d1(db) }

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

;(async () => {
  await check('no flag -> no maintenance', async () => {
    assert.equal(await getMaintenance(env), null)
  })

  await check('raw maintenance setup refuses without stock admission', async () => {
    assert.throws(() => db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{}')").run(), /stock_transaction_required/)
    assert.equal(await getMaintenance(env), null)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  })

  let token = ''
  await check('begin sets the flag with restore state', async () => {
    const state = await beginMaintenance(env, { backupKey: 'backups/cloudflare/test.json', startedBy: 'admin' })
    token = state.token
    const read = await getMaintenance(env)
    assert.equal(read.backupKey, 'backups/cloudflare/test.json')
    assert.equal(read.phase, 'deleting')
    assert.equal(read.token, token)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  })

  await check('a second begin refuses while the first holds', async () => {
    await assert.rejects(() => beginMaintenance(env, { backupKey: 'x', startedBy: 'other' }), /already in progress/)
  })

  await check('progress updates persist (and a wrong token is a no-op)', async () => {
    await updateMaintenance(env, token, { phase: 'inserting', table: 'sales', rowsDone: 800 })
    let read = await getMaintenance(env)
    assert.equal(read.table, 'sales')
    assert.equal(read.rowsDone, 800)
    await updateMaintenance(env, 'wrong-token', { phase: 'failed', error: 'nope' })
    read = await getMaintenance(env)
    assert.equal(read.phase, 'inserting')
  })

  await check('end with the wrong token refuses; holder token clears; force clears regardless', async () => {
    assert.equal(await endMaintenance(env, 'wrong-token'), false)
    assert.notEqual(await getMaintenance(env), null)
    assert.equal(await endMaintenance(env, token), true)
    assert.equal(await getMaintenance(env), null)
    const again = await beginMaintenance(env, { backupKey: 'y', startedBy: 'admin' })
    assert.equal(await endMaintenance(env, null, { force: true }), true)
    assert.equal(await getMaintenance(env), null)
    void again
  })

  await check('fail-open: a database without system_flags reads as no-maintenance', async () => {
    const bare = new Database(':memory:')
    assert.equal(await getMaintenance({ DB: d1(bare) }), null)
  })

  await check('unrelated database failures are not reported as no maintenance', async () => {
    const unavailable = { DB: { prepare() { throw new Error('D1 unavailable') } } }
    await assert.rejects(getMaintenance(unavailable), /D1 unavailable/)
    for (const message of ['no such table: system_flags-other', 'no such table: system_flags.other', 'no such table: other']) {
      await assert.rejects(getMaintenance({ DB: { prepare() { throw new Error(message) } } }), error => error.message === message)
    }
  })

  await check('the write gate matches state-changing /api requests only, with the allowlist', () => {
    assert.equal(isMaintenanceGatedRequest('POST', '/api/sales'), true)
    assert.equal(isMaintenanceGatedRequest('DELETE', '/api/products/5'), true)
    assert.equal(isMaintenanceGatedRequest('GET', '/api/sales'), false)
    assert.equal(isMaintenanceGatedRequest('POST', '/api/auth/login'), false)
    assert.equal(isMaintenanceGatedRequest('POST', '/api/backups'), false)
    assert.equal(isMaintenanceGatedRequest('POST', '/api/backups/maintenance/clear'), false)
    assert.equal(isMaintenanceGatedRequest('POST', '/uploads/x'), false)
  })

  await check('wiring: index.ts gates writes + skips the scheduled tick under maintenance', () => {
    const indexSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'index.ts'), 'utf8')
    assert.match(indexSrc, /if \(isMaintenanceGatedRequest\(c\.req\.method, c\.req\.path, 'branch-cutover'\)\) \{\s*const maintenance = await getMaintenance\(c\.env\)/)
    assert.match(indexSrc, /if \(maintenance && !operatorStep && isMaintenanceGatedRequest\(c\.req\.method, c\.req\.path, maintenance\.mode\)\) \{/)
    assert.match(indexSrc, /if \(await getMaintenance\(env\)\) return/)
  })

  await check('wiring: backups.ts wraps the restore (begin/progress/end, crash leaves the flag, active imports refuse)', () => {
    const backupsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'backups.ts'), 'utf8')
    assert.match(backupsSrc, /beginMaintenance\(c\.env/)
    assert.match(backupsSrc, /updateMaintenance\(c\.env, maintenance\.token, progress\)/)
    assert.match(backupsSrc, /phase: 'failed', error: message/)
    assert.match(backupsSrc, /endMaintenance\(c\.env, maintenance\.token\)/)
    assert.match(backupsSrc, /import_jobs WHERE status IN/)
    assert.match(backupsSrc, /force !== true/)
  })

  await check('wiring: restoreCloudflareBackup reports progress and system_flags stays OUT of BACKUP_TABLES', () => {
    const backupSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'backup.ts'), 'utf8')
    assert.match(backupSrc, /onProgress\?: \(progress: RestoreProgress\) => Promise<void>/)
    assert.match(backupSrc, /onProgress\?\.\(\{ phase: 'deleting' \}\)/)
    assert.match(backupSrc, /onProgress\?\.\(\{ phase: 'assets' \}\)/)
    const tablesBlock = backupSrc.slice(backupSrc.indexOf('export const BACKUP_TABLES'), backupSrc.indexOf(']', backupSrc.indexOf('export const BACKUP_TABLES')))
    assert.ok(!tablesBlock.includes("'system_flags'"), 'system_flags must never join BACKUP_TABLES')
  })

  if (failed > 0) process.exitCode = 1
})()
