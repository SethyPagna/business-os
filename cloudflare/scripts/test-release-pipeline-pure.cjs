const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const full = fs.readFileSync(path.join(root, 'ops', 'scripts', 'powershell', 'full-automation.ps1'), 'utf8')
const verify = fs.readFileSync(path.join(root, 'ops', 'scripts', 'powershell', 'verify-local.ps1'), 'utf8')
const bat = fs.readFileSync(path.join(root, 'run', 'full-automation.bat'), 'utf8')
const frontendPackage = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'package.json'), 'utf8'))
const frontendLock = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'package-lock.json'), 'utf8'))

let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function indexOrFail(text, needle) {
  const index = text.indexOf(needle)
  assert(index >= 0, `missing release step: ${needle}`)
  return index
}

test('fresh frontend install has a compatible ZXing peer pair', () => {
  const browserSpec = frontendPackage.dependencies?.['@zxing/browser']
  const librarySpec = frontendPackage.dependencies?.['@zxing/library']
  const lockedBrowser = frontendLock.packages?.['node_modules/@zxing/browser']
  const lockedLibrary = frontendLock.packages?.['node_modules/@zxing/library']
  assert(browserSpec === '0.2.0', `@zxing/browser must stay pinned to the 0.22-compatible release; got ${browserSpec}`)
  assert(librarySpec === '^0.22.0', `@zxing/library manifest drifted; got ${librarySpec}`)
  assert(lockedBrowser?.version === '0.2.0', `lockfile browser version drifted; got ${lockedBrowser?.version}`)
  assert(lockedBrowser?.peerDependencies?.['@zxing/library'] === '^0.22.0', 'locked browser peer range must accept library 0.22.x')
  assert(lockedLibrary?.version === '0.22.0', `lockfile library version drifted; got ${lockedLibrary?.version}`)
})

test('release scripts reject unsupported Node runtimes before install/deploy', () => {
  assert(full.includes('Check Node.js runtime (24+)'), 'full automation must preflight Node 24+')
  assert(verify.includes('Check Node.js runtime (24+)'), 'local verifier must preflight Node 24+')
  assert(full.includes('$nodeMajor -lt 24'), 'full automation must enforce the frontend Node engine')
  assert(verify.includes('$nodeMajor -lt 24'), 'local verifier must enforce the frontend Node engine')
})

test('full automation blocks remote work behind local regression verification', () => {
  const verifyIndex = indexOrFail(full, 'Pre-deploy verification (typechecks + regression tests)')
  const mainMigrationIndex = indexOrFail(full, 'npm run migrate:remote')
  assert(verifyIndex < mainMigrationIndex, 'local verification must happen before any remote D1 migration')
  assert(full.includes("$env:BUSINESS_OS_SKIP_INSTALL = '1'"), 'child verifier should reuse the dependency install')
  assert(full.includes("$env:BUSINESS_OS_SKIP_BUILD = '1'"), 'child verifier should leave the one production build to the parent')
})

test('full automation migrates both production D1 databases before deploy', () => {
  const mainMigrationIndex = indexOrFail(full, 'npm run migrate:remote')
  const importMigrationIndex = indexOrFail(full, 'npm run migrate:import:remote')
  const deployIndex = indexOrFail(full, 'npm run deploy')
  assert(mainMigrationIndex < importMigrationIndex, 'operational DB migration should run before import staging migration')
  assert(importMigrationIndex < deployIndex, 'both D1 migrations must finish before Worker deployment')
})

test('local verifier can run TypeScript tests on Node 22 and newer', () => {
  assert(verify.includes('node --experimental-strip-types $file.FullName'), 'frontend .ts tests need explicit type stripping for Node 22.x compatibility')
})

test('batch wrapper propagates PowerShell release failures', () => {
  assert(bat.includes('set "EXIT_CODE=%ERRORLEVEL%"'), 'batch wrapper must capture the PowerShell exit code')
  assert(bat.includes('exit /b %EXIT_CODE%'), 'batch wrapper must return the captured exit code')
})

if (failed) {
  console.error(`\n${failed} release-pipeline test(s) failed`)
  process.exit(1)
}
console.log('\nAll release-pipeline checks passed')
