'use strict'
// POST /api/auth/logout tells the browser to empty its HTTP cache for the origin (`Clear-Site-Data: "cache"`), so no
// /api body outlives the sign-out on a shared till. The value is exactly "cache": "storage" or "*" would also wipe the
// PWA's app-code cache and the drafts the owner keeps, and "cookies" is already handled by the cookie clear.
//
//   sent on  - a completed sign-out (guarded or legacy) and the guarded 401 for a session that is already gone
//   never on - 400 (malformed owner) and 409 (signed-in account changed): nothing was signed out
//
// Real transpiled routes/auth.ts under real Hono. Each MUTANT is the route with one defect and must FAIL the same
// assertions.
//
// Run (from cloudflare/): node scripts/test-logout-clear-site-data-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

function loadAuthRoute(dependencies, rewrite = (source) => source) {
  const filename = path.join(__dirname, '..', 'src', 'routes', 'auth.ts')
  const output = ts.transpileModule(rewrite(fs.readFileSync(filename, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  const module = { exports: {} }
  const poisoned = new Proxy({}, { get: (_, key) => {
    if (key === '__esModule') return true
    return () => { throw new Error(`Unexpected dependency effect: ${String(key)}`) }
  } })
  new Function('require', 'module', 'exports', output)((name) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'hono') return { Hono }
    return poisoned
  }, module, module.exports)
  return module.exports.default
}

const SIGNED_IN = { id: 7, organization_id: 3 }

function logoutAs(rewrite) {
  let sessionUser = null
  const revoked = []
  const route = loadAuthRoute({
    '../lib/auth': {
      getSessionUser: async () => sessionUser,
      revokeSession: async () => { revoked.push(sessionUser && sessionUser.id) },
      clearSessionCookie: (c) => c.header('Set-Cookie', 'bos_session=; Max-Age=0; Path=/'),
    },
  }, rewrite)
  return async (user, body) => {
    sessionUser = user
    revoked.length = 0
    const response = await route.fetch(new Request('https://unit.test/logout', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'bos_session=tok' }, body: body === undefined ? undefined : JSON.stringify(body),
    }), {}, { waitUntil() {}, passThroughOnException() {} })
    return { status: response.status, csd: response.headers.get('clear-site-data'), cookie: response.headers.get('set-cookie'), revoked: [...revoked] }
  }
}

async function assertLogoutHeaders(logout) {
  const done = await logout(SIGNED_IN, { expected_actor_id: 7, expected_organization_id: 3 })
  assert.equal(done.status, 200)
  assert.equal(done.csd, '"cache"', 'a guarded sign-out empties the HTTP cache, and only the HTTP cache')
  assert.match(done.cookie, /Max-Age=0/)
  assert.deepEqual(done.revoked, [7])

  const legacy = await logout(SIGNED_IN, {})
  assert.equal(legacy.status, 200)
  assert.equal(legacy.csd, '"cache"', 'a legacy sign-out (no owner in the body) does the same')

  const noBody = await logout(SIGNED_IN, undefined)
  assert.equal(noBody.status, 200)
  assert.equal(noBody.csd, '"cache"', 'a sign-out with no body does the same')

  const gone = await logout(null, { expected_actor_id: 7, expected_organization_id: 3 })
  assert.equal(gone.status, 401)
  assert.equal(gone.csd, '"cache"', 'a guarded sign-out whose session is already gone still empties the cache')
  assert.deepEqual(gone.revoked, [])

  const changed = await logout({ id: 8, organization_id: 3 }, { expected_actor_id: 7, expected_organization_id: 3 })
  assert.equal(changed.status, 409)
  assert.equal(changed.csd, null, 'signout_actor_changed: nobody was signed out, the cache stays')
  assert.equal(changed.cookie, null)
  assert.deepEqual(changed.revoked, [])

  const otherOrg = await logout({ id: 7, organization_id: 4 }, { expected_actor_id: 7, expected_organization_id: 3 })
  assert.equal(otherOrg.status, 409)
  assert.equal(otherOrg.csd, null)

  for (const body of [{ expected_actor_id: 7 }, { expected_organization_id: 3 }, { expected_actor_id: '7', expected_organization_id: 3 }]) {
    const malformed = await logout(SIGNED_IN, body)
    assert.equal(malformed.status, 400)
    assert.equal(malformed.csd, null, 'invalid_signout_owner: nothing was signed out, the cache stays')
    assert.equal(malformed.cookie, null)
  }
}

const MUTANTS = {
  'sends "storage" as well': (source) => source.replace(`const CLEAR_HTTP_CACHE = '"cache"'`, `const CLEAR_HTTP_CACHE = '"cache", "storage"'`),
  'sends "*"': (source) => source.replace(`const CLEAR_HTTP_CACHE = '"cache"'`, `const CLEAR_HTTP_CACHE = '"*"'`),
  'sends it on the 409 refusal': (source) => source.replace(`return c.json({ error: 'The signed-in account changed.`, `c.header('Clear-Site-Data', CLEAR_HTTP_CACHE)\n      return c.json({ error: 'The signed-in account changed.`),
  'sends it on the 400 refusal': (source) => source.replace(`return c.json({ error: 'The original sign-out account is required.'`, `c.header('Clear-Site-Data', CLEAR_HTTP_CACHE)\n      return c.json({ error: 'The original sign-out account is required.'`),
  'forgets the 401 no-session path': (source) => source.replace(/    if \(!user\) \{\n      c\.header\('Clear-Site-Data', CLEAR_HTTP_CACHE\)\n/, '    if (!user) {\n'),
  'forgets the success path': (source) => source.replace(/  clearSessionCookie\(c\)\n  c\.header\('Clear-Site-Data', CLEAR_HTTP_CACHE\)\n/, '  clearSessionCookie(c)\n'),
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('logout: Clear-Site-Data "cache" on a completed sign-out and the 401, never on the 400 and 409 refusals', async () => {
    await assertLogoutHeaders(logoutAs())
  })

  for (const [name, mutate] of Object.entries(MUTANTS)) {
    await check(`MUTANT ${name}: the same assertions fail`, async () => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8').split('\r\n').join('\n')
      assert.notEqual(mutate(source), source, 'the mutation must actually change routes/auth.ts')
      await assert.rejects(() => assertLogoutHeaders(logoutAs((text) => mutate(text.split('\r\n').join('\n')))), { name: 'AssertionError' })
    })
  }

  console.log(`\n${passed} logout Clear-Site-Data checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
