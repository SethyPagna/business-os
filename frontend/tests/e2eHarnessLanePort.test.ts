// The e2e harness must never test another checkout's build, and its admin
// sign-in helper must wait for the identity the app really stores.
//
// 6 Oct 2026 (DATE-UI lane): Playwright's webServer used the shared port 4318
// with reuseExistingServer on, so a run in one worktree silently talked to the
// fixture server another worktree had left running and screenshotted THAT
// build. And E2E_ACCOUNTS.admin expected the stored username "admin" while the
// fixture session names its user "e2e_admin", so signIn(admin) always timed out.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const config = read('../playwright.config.ts')
const session = read('../e2e/support/session.ts')
const fixtureSession = JSON.parse(read('../e2e/fixtures/admin-session.json')) as { user: { username: string } }

let failed = 0
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

check('the default port is per checkout, not the shared 4318', () => {
  assert.doesNotMatch(config, /process\.env\.E2E_PORT \|\| 4318/, 'the shared default is gone')
  assert.match(config, /process\.env\.E2E_PORT \|\| defaultLanePort\(\)/)
  assert.match(config, /createHash\('sha256'\)\.update\(here\)/, 'derived from the checkout directory')
  assert.match(config, /env: \{ E2E_PORT: String\(E2E_PORT\) \}/, 'the fixture server is started on the same port the specs use')
})

check('an already-running server is reused only when E2E_REUSE=1', () => {
  assert.match(config, /reuseExistingServer: process\.env\.E2E_REUSE === '1'/)
  assert.doesNotMatch(config, /reuseExistingServer: !process\.env\.CI/)
})

check('the admin account names the username the fixture session actually stores', () => {
  const stored = fixtureSession.user.username
  assert.equal(stored, 'e2e_admin', 'control: the fixture session user')
  assert.match(session, new RegExp(`admin: \{ username: 'admin', storedUsername: '${stored}'`))
  assert.match(session, /\.toBe\(storedUsername\)/, 'signIn compares the stored identity, not the typed one')
})

if (failed > 0) process.exitCode = 1
