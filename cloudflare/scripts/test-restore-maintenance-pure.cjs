// Regression test for the restore maintenance lock (Part-77 slice C):
// lib/maintenance.ts behavior against a real SQLite database running the
// real migration chain (so 0088_system_flags is the actual table under
// test), plus source locks on the wiring (index.ts write gate, backups.ts
// begin/progress/end + refuse-on-active-imports, backup.ts onProgress).
//
// Run: node scripts/test-restore-maintenance-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-maintenance-'))
const tsPath = path.join(tmpDir, 'maintenance.ts')
// Strip the Env type import so the file compiles standalone (same trick the
// other pure tests use for lib files that only need Env structurally).
const source = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'maintenance.ts'), 'utf8')
  .replace(
    "import type { Env } from '../index'",
    'type Env = { DB: { prepare(sql: string): { bind(...params: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } } }',
  )
fs.writeFileSync(tsPath, source)
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const {
  beginMaintenance, endMaintenance, getMaintenance, updateMaintenance, isMaintenanceGatedRequest,
} = require(path.join(tmpDir, 'maintenance.js'))

// Real migration chain -> real system_flags table.
const db = new Database(':memory:')
const migrationsDir = path.join(cloudflareRoot, 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

// Minimal D1-shaped adapter over better-sqlite3 for the three call shapes
// maintenance.ts uses (prepare().bind().first / .run).
function d1(dbHandle) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => dbHandle.prepare(sql).get(...params) ?? null,
            run: async () => dbHandle.prepare(sql).run(...params),
          }
        },
      }
    },
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

  let token = ''
  await check('begin sets the flag with restore state', async () => {
    const state = await beginMaintenance(env, { backupKey: 'backups/cloudflare/test.json', startedBy: 'admin' })
    token = state.token
    const read = await getMaintenance(env)
    assert.equal(read.backupKey, 'backups/cloudflare/test.json')
    assert.equal(read.phase, 'deleting')
    assert.equal(read.token, token)
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
    assert.match(indexSrc, /isMaintenanceGatedRequest\(c\.req\.method, c\.req\.path\)/)
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
