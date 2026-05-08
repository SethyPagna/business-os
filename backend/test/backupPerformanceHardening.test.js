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
  assert.match(source, /await\s+pipeline\(object\.body,\s*localStream\)/)
  assert.match(source, /const\s+localStats\s*=\s*await\s+fs\.promises\.stat\(localObjectPath\)/)
  assert.match(source, /await\s+putObject\(`\$\{prefix\}\/\$\{relativeKey\}`,\s*fs\.createReadStream\(localObjectPath\),\s*\{/)
  assert.match(source, /contentLength:\s*localStats\.size/)
  assert.match(source, /function\s+getManagedWritableState\(/)
  assert.match(source, /__businessOsManagedWritableState/)
  assert.doesNotMatch(source, /function\s+createDualWriteStream\(/)
  assert.doesNotMatch(source, /new\s+PassThrough\(\)/)
  assert.doesNotMatch(source, /stream\.once\('error', reject\)/)
  assert.doesNotMatch(source, /destination\.once\('error', reject\)/)
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
  assert.match(source, /DRIVE_SYNC_DEFAULT_INTERVAL_SECONDS\s*=\s*6\s*\*\s*60\s*\*\s*60/)
  assert.match(source, /DRIVE_SYNC_REUSE_BACKUP_MAX_AGE_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/)
  assert.match(source, /queuedTimer:\s*null/)
  assert.match(source, /periodicTimer:\s*null/)
  assert.match(source, /function\s+hashFileMany\(/)
  assert.match(source, /const\s+\{\s*md5,\s*sha256\s*\}\s*=\s*await\s+hashFileMany/)
  assert.match(source, /findReusableLocalBackupPackage\(\{\s*maxAgeMs:\s*DRIVE_SYNC_REUSE_BACKUP_MAX_AGE_MS\s*\}\)/)
  assert.match(source, /Reusing recent backup package/)
  assert.match(source, /await\s+fs\.promises\.copyFile/)
  assert.match(source, /await\s+fs\.promises\.stat/)
  assert.match(source, /if \(runtimeState\.queuedTimer\) clearTimeout\(runtimeState\.queuedTimer\)/)
  assert.match(source, /if \(runtimeState\.periodicTimer\) return runtimeState\.periodicTimer/)
  assert.match(source, /runtimeState\.periodicTimer = setInterval\(/)
  assert.doesNotMatch(source, /scheduleDriveSync\('preferences-updated'/)
  assert.doesNotMatch(source, /fs\.copyFileSync/)
  assert.doesNotMatch(source, /fs\.statSync/)
  assert.doesNotMatch(source, /await\s+hashFile\(absolutePath,\s*'md5'\)[\s\S]{0,120}await\s+hashFile\(absolutePath,\s*'sha256'\)/)
})

runTest('backup version listing reads enough objects for recent package pages and can reuse local packages', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/backupPackages.js'), 'utf8')
  const objectStoreSource = fs.readFileSync(path.join(__dirname, '../src/objectStore.js'), 'utf8')
  assert.match(source, /function\s+findReusableLocalBackupPackage\(/)
  assert.match(source, /function\s+listLocalBackupVersions\(/)
  assert.match(source, /catch\s*\(error\)\s*{\s*console\.warn\(`\[Backup\] R2 backup version listing unavailable:/)
  assert.match(source, /safeLimit\s*\*\s*32/)
  assert.match(source, /Math\.max\(100,\s*Math\.min\(5000,\s*safeLimit\s*\*\s*32\)\)/)
  assert.match(objectStoreSource, /socketAcquisitionWarningTimeout:\s*15000/)
  assert.match(objectStoreSource, /maxSockets:\s*200/)
  assert.match(objectStoreSource, /abortSignal:\s*controller\.signal/)
  assert.match(objectStoreSource, /function\s+canUseCloudflareR2Api\(/)
  assert.match(objectStoreSource, /Cloudflare R2 API fallback is not configured/)
  assert.match(objectStoreSource, /shouldFallbackToR2Api\(error\)/)
})

runTest('system jobs recover stale queued or running rows after restart', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/systemJobs.js'), 'utf8')
  assert.match(source, /Recovered after server restart/)
  assert.match(source, /WHERE status IN \('queued', 'running', 'cancelling'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
