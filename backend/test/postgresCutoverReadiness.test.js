'use strict'

const assert = require('node:assert/strict')
const path = require('path')

const { analyzePostgresCutoverReadiness } = require('../src/db/cutoverReadiness')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const repoRoot = path.resolve(__dirname, '..', '..')

runTest('Postgres cutover readiness reports current live SQLite blockers', () => {
  const report = analyzePostgresCutoverReadiness({ repoRoot })
  assert.equal(report.ready, false)
  assert.ok(report.blockerCount > 25, 'expected existing route/service SQLite blockers to be visible')
  assert.ok(report.summary.byFile.some((item) => item.file === 'backend/src/routes/products.js'), 'products route blocker missing')
  assert.ok(report.summary.byFile.some((item) => item.file === 'backend/src/services/importJobs.js'), 'import jobs blocker missing')
  assert.ok(report.summary.byCode.some((item) => item.code === 'sqlite_prepare'), 'sqlite_prepare blocker missing')
})

runTest('migration-only SQLite files are explicitly allowed', () => {
  const report = analyzePostgresCutoverReadiness({ repoRoot })
  assert.ok(!report.summary.byFile.some((item) => item.file === 'backend/src/database.js'), 'legacy database module should be allowed as migration input')
  assert.ok(!report.summary.byFile.some((item) => item.file === 'backend/src/workers/migrationWorker.js'), 'migration worker should be allowed as migration-only code')
  assert.ok(report.allowedLegacyFiles.includes('backend/src/database.js'))
  assert.ok(report.allowedLegacyFiles.includes('backend/src/workers/migrationWorker.js'))
})

runTest('missing packaged source never counts as Postgres cutover ready', () => {
  const report = analyzePostgresCutoverReadiness({
    repoRoot,
    srcRoot: path.join(repoRoot, 'backend', 'test', '__missing-src-root__'),
  })
  assert.equal(report.ready, false)
  assert.equal(report.blockerCount, 1)
  assert.equal(report.blockers[0].code, 'cutover_source_unavailable')
})

runTest('compiled runtime requires an explicit verified cutover manifest', () => {
  const report = analyzePostgresCutoverReadiness({
    repoRoot,
    packagedRuntime: true,
  })
  assert.equal(report.ready, false)
  assert.equal(report.blockers[0].code, 'cutover_manifest_missing')
})

if (failed > 0) {
  process.exitCode = 1
}
