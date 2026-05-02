'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-db-runtime-'))
process.env.BUSINESS_OS_RUNTIME_DIR = tempRoot
process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES = '0'
process.env.JOB_QUEUE_DRIVER = 'sqlite'
process.env.SQLITE_BUSY_TIMEOUT_MS = '10000'
process.env.SQLITE_CACHE_SIZE_KB = '65536'
process.env.SQLITE_MMAP_SIZE_MB = '256'
process.env.SQLITE_WAL_AUTOCHECKPOINT = '4000'
process.env.SQLITE_JOURNAL_SIZE_LIMIT_MB = '128'
process.env.SQLITE_SYNCHRONOUS = 'NORMAL'

const { db, runDatabaseMaintenance } = require('../src/database')

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

runTest('SQLite runtime pragmas use WAL and bounded wait/cache settings', () => {
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal')
  assert.equal(Number(db.pragma('foreign_keys', { simple: true })), 1)
  assert.equal(Number(db.pragma('busy_timeout', { simple: true })), 10000)
  assert.equal(Number(db.pragma('cache_size', { simple: true })), -65536)
  assert.equal(Number(db.pragma('wal_autocheckpoint', { simple: true })), 4000)
  assert.equal(Number(db.pragma('journal_size_limit', { simple: true })), 128 * 1024 * 1024)
})

runTest('database maintenance can optimize and checkpoint without throwing', () => {
  assert.doesNotThrow(() => runDatabaseMaintenance({ checkpoint: 'PASSIVE', optimize: true }))
})

runTest('BUSINESS_OS_DISABLE_SQLITE blocks the legacy database module', () => {
  const childRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-db-disabled-'))
  const child = spawnSync(process.execPath, ['-e', `
    process.env.BUSINESS_OS_RUNTIME_DIR = ${JSON.stringify(childRoot)}
    process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES = '0'
    process.env.BUSINESS_OS_DISABLE_SQLITE = '1'
    try {
      require(${JSON.stringify(path.join(__dirname, '../src/database'))})
      process.exit(1)
    } catch (error) {
      if (String(error && error.message || '').includes('disables SQLite')) process.exit(42)
      console.error(error && error.stack || error)
      process.exit(2)
    }
  `], { env: { ...process.env } })
  try { fs.rmSync(childRoot, { recursive: true, force: true }) } catch (_) {}
  assert.equal(child.status, 42, child.stderr?.toString() || child.stdout?.toString())
})

try { db.close() } catch (_) {}
try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch (_) {}

if (failed > 0) process.exitCode = 1
