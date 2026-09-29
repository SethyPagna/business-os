// SCAN2 RT-9: the 6-hourly orphan-staging cleanup must never delete the staging
// rows of a job that is live when the delete runs.
//
// The staging tables sit on their own D1, so the cleanup cannot join them to
// import_jobs. The race: a job is created, and its analyze writes staging rows,
// after the cleanup read the live job ids but before it grouped the staging
// table. Real lib/importRetention.ts on the real migration chain (node:sqlite);
// the concurrent job is written at the moment the first staging GROUP BY runs.
//
// Run: node scripts/test-orphan-staging-live-recheck-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')

function loadModule(relPath, resolve) {
  const filePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(loaded.exports, resolve, loaded)
  return loaded.exports
}

const noImports = (relPath) => loadModule(relPath, (id) => { throw new Error(`unexpected import in ${relPath}: ${id}`) })
const r2 = noImports('lib/r2.ts')
const planTier = noImports('lib/planTier.ts')

let currentDb = null
const retention = loadModule('lib/importRetention.ts', (id) => {
  if (id === './db') return { getDb: () => currentDb }
  if (id === './audit') return { audit: async () => {} }
  if (id === './r2') return r2
  if (id === './planTier') return planTier
  throw new Error(`unexpected import in importRetention.ts: ${id}`)
})

const migrationSqls = loadAll()
const bucket = { async delete() {} }

function seedJob(db, id) {
  db.prepare(`INSERT INTO import_jobs (id, type, status, phase, created_at, updated_at) VALUES (@id, 'products', 'analyzing', 'analyzing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run({ id })
}

function seedStaging(db, id) {
  db.prepare(`INSERT INTO import_job_source_rows (job_id, sequence, row_number, data_json) VALUES (@id, 0, 1, '{"name":"row"}')`).run({ id })
  db.prepare(`INSERT INTO import_job_rows (job_id, phase, row_number, action, identifier, result_json) VALUES (@id, 'analyze', 1, 'create', 'x', '{}')`).run({ id })
}

function stagingCount(db, id) {
  return db.prepare(`SELECT (SELECT COUNT(*) FROM import_job_rows WHERE job_id = @id) + (SELECT COUNT(*) FROM import_job_source_rows WHERE job_id = @id) AS n`).get({ id }).n
}

// A job created mid-cleanup: its row and its first staging rows land just
// before the cleanup's first staging GROUP BY reads the table.
function withJobCreatedDuringScan(db, jobId) {
  let created = false
  const staging = {
    prepare(sql) {
      if (!created && /GROUP BY job_id/.test(sql)) {
        created = true
        seedJob(db, jobId)
        seedStaging(db, jobId)
      }
      return db.prepare(sql)
    },
    batch: (items) => db.batch(items),
  }
  return new Proxy(db, { get: (target, key) => key === 'staging' ? staging : Reflect.get(target, key) })
}

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}\n  ${error && error.message}`)
  }
}

async function main() {
  await check('a job created while the cleanup scans keeps its staging rows', async () => {
    const db = openDb(migrationSqls)
    seedJob(db, 'live')
    seedStaging(db, 'live')
    seedStaging(db, 'ghost')
    currentDb = withJobCreatedDuringScan(db, 'fresh')

    const report = await retention.cleanOrphanImportStaging({ ASSETS: bucket }, { apply: true })

    assert.equal(stagingCount(db, 'fresh'), 2, 'the new job lost its staging rows to the orphan cleanup')
    assert.equal(stagingCount(db, 'live'), 2)
    assert.equal(stagingCount(db, 'ghost'), 0, 'a real orphan is still removed')
    assert.equal(report.tables.import_job_source_rows, 1, 'the report counts only the real orphan')
  })

  await check('the dry run reports the same set the apply would delete', async () => {
    const db = openDb(migrationSqls)
    seedStaging(db, 'ghost')
    currentDb = withJobCreatedDuringScan(db, 'fresh')
    const report = await retention.cleanOrphanImportStaging({ ASSETS: bucket }, { apply: false })
    assert.equal(report.applied, false)
    assert.equal(report.tables.import_job_rows, 1)
    assert.equal(report.tables.import_job_source_rows, 1)
    assert.equal(stagingCount(db, 'ghost'), 2, 'a dry run deletes nothing')
  })

  await check('the comment no longer claims the cleanup never runs automatically', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importRetention.ts'), 'utf8')
    assert.doesNotMatch(source, /NEVER automatic/)
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    assert.match(index, /runStep\('orphan-staging-cleanup', \(\) => cleanOrphanImportStaging\(env, \{ apply: true \}\)\)/)
  })

  console.log(`${passed}/${passed + failures.length} passed`)
  if (failures.length) process.exitCode = 1
}

main()
