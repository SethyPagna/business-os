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

runTest('customer membership auto-generation uses the LCMN prefix', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/contacts.js'), 'utf8')
  assert.match(source, /MEMBERSHIP_NUMBER_PREFIX\s*=\s*'LCMN'/)
  assert.match(source, /`\$\{MEMBERSHIP_NUMBER_PREFIX\}-\$\{entropy\.slice\(-8\)\}`/)
  assert.doesNotMatch(source, /normalize\('NFKD'\)/)
})

runTest('portal membership lookup handles new members without raw route failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/portal.js'), 'utf8')
  const routeStart = source.indexOf("router.get('/membership/:membershipNumber'")
  assert.ok(routeStart >= 0, 'missing membership route')
  const routeEnd = source.indexOf("router.post('/submissions'", routeStart)
  const routeSource = source.slice(routeStart, routeEnd)
  assert.match(routeSource, /try\s*\{/)
  assert.match(routeSource, /catch\s*\(error\)/)
  assert.match(routeSource, /portal membership lookup failed/i)
  assert.match(routeSource, /res\.status\(500\)\.json\(\{\s*error:\s*'Membership lookup failed'/)
})

runTest('backup package validation uses streaming checksums for package files', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/backupPackages.js'), 'utf8')
  assert.match(source, /function\s+sha256File\(/)
  assert.match(source, /fs\.createReadStream\(filePath\)/)
  assert.match(source, /async\s+function\s+validateLocalBackupPackage/)
  assert.doesNotMatch(source, /sha256\(fs\.readFileSync\(filePath\)\)/)
  assert.match(source, /writeJsonLinesFileWithChecksum/)
  assert.match(source, /function\s+createDualWriteStream\(/)
  assert.match(source, /const\s+remoteStream\s*=\s*new\s+PassThrough\(\)/)
  assert.match(source, /await\s+Promise\.all\(\[\s*pipeline\(object\.body,\s*fanoutStream\),\s*uploadPromise,\s*\]\)/)
})

runTest('system jobs throttle noisy persistence while forcing major state changes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/systemJobs.js'), 'utf8')
  assert.match(source, /JOB_PERSIST_MIN_INTERVAL_MS\s*=\s*750/)
  assert.match(source, /JOB_PROGRESS_PERSIST_STEP\s*=\s*5/)
  assert.match(source, /function\s+schedulePersistJob\(/)
  assert.match(source, /function\s+flushPersistJob\(/)
  assert.match(source, /forcePersist:\s*true/)
})

runTest('drive sync snapshot work avoids synchronous copies and double hashing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/googleDriveSync/index.js'), 'utf8')
  assert.match(source, /function\s+hashFileMany\(/)
  assert.match(source, /const\s+\{\s*md5,\s*sha256\s*\}\s*=\s*await\s+hashFileMany/)
  assert.match(source, /await\s+fs\.promises\.copyFile/)
  assert.match(source, /await\s+fs\.promises\.stat/)
  assert.doesNotMatch(source, /fs\.copyFileSync/)
  assert.doesNotMatch(source, /fs\.statSync/)
  assert.doesNotMatch(source, /await\s+hashFile\(absolutePath,\s*'md5'\)[\s\S]{0,120}await\s+hashFile\(absolutePath,\s*'sha256'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
