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

runTest('Postgres cutover readiness accepts the Postgres compatibility data layer', () => {
  const report = analyzePostgresCutoverReadiness({ repoRoot })
  assert.equal(report.ready, true)
  assert.equal(report.blockerCount, 0)
})

runTest('no retired embedded database files are allowlisted', () => {
  const report = analyzePostgresCutoverReadiness({ repoRoot })
  assert.deepEqual(report.allowedLegacyFiles, [])
})

runTest('missing packaged source never counts as Postgres cutover ready', () => {
  const report = analyzePostgresCutoverReadiness({
    repoRoot,
    srcRoot: path.join(repoRoot, 'backend', 'test', '__missing-src-root__'),
  })
  assert.equal(report.ready, false)
  assert.equal(report.blockerCount, 1)
  assert.equal(report.blockers[0].code, 'source_unavailable')
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
