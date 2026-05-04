import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const methodsSource = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
const appContextSource = fs.readFileSync(new URL('../src/AppContext.jsx', import.meta.url), 'utf8')
const loginSource = fs.readFileSync(new URL('../src/components/auth/Login.jsx', import.meta.url), 'utf8')
const profileSource = fs.readFileSync(new URL('../src/components/users/UserProfileModal.jsx', import.meta.url), 'utf8')
const backupSource = fs.readFileSync(new URL('../src/components/utils-settings/Backup.jsx', import.meta.url), 'utf8')
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
  assert.match(packageSource, /ownedGoogleAuth\.test\.mjs/)
})

if (failed > 0) {
  process.exitCode = 1
}
