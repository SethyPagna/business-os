import assert from 'node:assert/strict'
import fs from 'node:fs'
import { listTestFiles } from './runTests.ts'

type TestCallback = () => void | Promise<void>

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const methodsSource = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const loginSource = fs.readFileSync(new URL('../src/components/auth/Login.tsx', import.meta.url), 'utf8')
const profileSource = fs.readFileSync(new URL('../src/components/users/UserProfileModal.tsx', import.meta.url), 'utf8')
const backupSource = fs.readFileSync(new URL('../src/components/utils-settings/Backup.tsx', import.meta.url), 'utf8')
const enSource = fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')
const kmSource = fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')
const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

await runTest('frontend uses owned Google OAuth API names and no Supabase OAuth helpers', () => {
  assert.match(methodsSource, /startGoogleOauth/)
  assert.match(methodsSource, /completeGoogleOauth/)
  assert.match(methodsSource, /unlinkGoogleOauth/)
  assert.doesNotMatch(methodsSource, /SupabaseOauth/)
  assert.doesNotMatch(appContextSource, /SupabaseOauth/)
  assert.match(appContextSource, /completeGoogleOauth/)
  assert.match(appContextSource, /const APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS = 20000/)
  assert.match(appContextSource, /withLoaderTimeout\(\s*\(\) => api\.completeGoogleOauth\?\.\(\{[\s\S]*mode: 'link'[\s\S]*\}\),\s*'Complete Google OAuth',\s*APP_GOOGLE_OAUTH_COMPLETE_TIMEOUT_MS,\s*\)/)
  assert.match(loginSource, /startGoogleOauth/)
  assert.match(profileSource, /startGoogleOauth/)
  assert.match(profileSource, /unlinkGoogleOauth/)
})

await runTest('visible auth and diagnostics copy no longer mentions Supabase', () => {
  ;[loginSource, profileSource, backupSource, enSource, kmSource].forEach((source) => {
    assert.doesNotMatch(source, /Supabase/i)
  })
  assert.match(backupSource, /Google login/)
  assert.match(enSource, /google_oauth_ready/)
  assert.match(kmSource, /google_oauth_ready/)
})

await runTest('owned Google auth test is part of the utility suite', () => {
  // test:utils no longer lists test files by name (2026-09-06: that
  // hand-maintained `&&` chain grew past this harness's Windows command-line
  // launch ceiling -- see tests/runTests.ts and tests/testChainCoverage.test.ts)
  // -- it runs tests/runTests.ts, which globs tests/*.test.ts. Check this
  // file is still part of that glob instead of grepping package.json for its
  // own filename.
  assert.match(packageSource, /tests\/runTests\.ts/)
  assert.ok(
    listTestFiles().includes('ownedGoogleAuth.test.ts'),
    'ownedGoogleAuth.test.ts must be discoverable by the test:utils runner glob',
  )
})

if (failed > 0) {
  process.exitCode = 1
}
