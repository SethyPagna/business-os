'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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

runTest('import job listing caches settled tracker payloads and invalidates on writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/importJobs.js'), 'utf8')
  assert.match(source, /IMPORT_JOB_LIST_CACHE_MS\s*=\s*5_000/)
  assert.match(source, /IMPORT_JOB_LIST_CACHEABLE_STATUSES\s*=\s*new Set\(\['completed', 'completed_with_errors', 'failed', 'cancelled', 'awaiting_review'\]\)/)
  assert.match(source, /const importJobListCache = new Map\(\)/)
  assert.match(source, /function\s+clearImportJobListCache\(/)
  assert.match(source, /function\s+readCachedImportJobList\(/)
  assert.match(source, /function\s+writeCachedImportJobList\(/)
  assert.match(source, /const cached = readCachedImportJobList\(safeLimit\)/)
  assert.match(source, /if \(cached\) return cached/)
  assert.match(source, /return writeCachedImportJobList\(safeLimit, jobs\)/)
  assert.match(source, /clearImportJobListCache\(\)\s*\n\s*return getImportJob\(id\)/)
  assert.match(source, /clearImportJobListCache\(\)\s*\n\s*return db\.prepare\('SELECT \* FROM import_job_files WHERE id = \?'\)/)
  assert.match(source, /clearImportJobListCache\(\)\s*\n\s*broadcast\('runtime'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
