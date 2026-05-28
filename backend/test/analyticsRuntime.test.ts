'use strict'

const assert = require('node:assert/strict')

const { getDuckDbRuntimeStatus } = require('../src/analytics/duckdbRuntime')

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

runTest('DuckDB runtime reports the configured Parquet staging role without probing optional packages', () => {
  const status = getDuckDbRuntimeStatus({
    analyticsEngine: 'duckdb',
    parquetStore: 'minio',
    probe: false,
  })
  assert.equal(status.engine, 'duckdb')
  assert.equal(status.enabled, true)
  assert.equal(status.available, false)
  assert.equal(status.parquetStore, 'minio')
  assert.equal(status.parquetEnabled, true)
  assert.ok(status.roles.includes('import_staging'))
  assert.ok(status.roles.includes('backup_verification'))
})

runTest('DuckDB runtime stays disabled when analytics engine is none', () => {
  const status = getDuckDbRuntimeStatus({
    analyticsEngine: 'none',
    parquetStore: 'none',
    probe: false,
  })
  assert.equal(status.engine, 'none')
  assert.equal(status.enabled, false)
  assert.equal(status.parquetEnabled, false)
})

if (failed > 0) {
  process.exitCode = 1
}
