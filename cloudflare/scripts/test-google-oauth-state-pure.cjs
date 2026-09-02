const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'googleOauth.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText

const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === '../index') return {}
  return originalLoad.call(this, request, parent, isMain)
}
const moduleObj = { exports: {} }
try {
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
} finally {
  Module._load = originalLoad
}

const { OAUTH_STATE_TTL_SECONDS, buildGoogleOauthStartUrl, verifyState } = moduleObj.exports
const values = new Map()
const env = {
  GOOGLE_LOGIN_CLIENT_ID: 'client',
  GOOGLE_LOGIN_CLIENT_SECRET: 'client-secret',
  GOOGLE_LOGIN_REDIRECT_URI: 'https://admin.example.com/api/auth/oauth/callback',
  AUTH_SESSION_SECRET: 'oauth-state-secret',
  BUSINESS_OS_ADMIN_URL: 'https://admin.example.com',
  BUSINESS_OS_PUBLIC_URL: 'https://example.com',
  CACHE: {
    async put(key, value, options) {
      assert.strictEqual(options.expirationTtl, OAUTH_STATE_TTL_SECONDS)
      values.set(key, value)
    },
    async get(key) { return values.get(key) || null },
    async delete(key) { values.delete(key) },
  },
}

async function main() {
  const first = await buildGoogleOauthStartUrl(env, {
    mode: 'login',
    organization: 'shop',
    returnTo: 'https://evil.example/escape',
  })
  assert.strictEqual(first.success, true, first.error)
  const firstUrl = new URL(first.url)
  assert.ok(firstUrl.searchParams.get('state'))
  assert.ok(firstUrl.searchParams.get('code_challenge'))
  assert.strictEqual(firstUrl.searchParams.get('code_challenge_method'), 'S256')
  const verified = await verifyState(env, firstUrl.searchParams.get('state'))
  assert.strictEqual(verified.success, true, verified.error)
  assert.strictEqual(verified.payload.returnOrigin, 'https://admin.example.com')
  const replay = await verifyState(env, firstUrl.searchParams.get('state'))
  assert.strictEqual(replay.success, false, 'Google login OAuth state must be one-time')

  const expiring = await buildGoogleOauthStartUrl(env, { mode: 'login', organization: 'shop' })
  const realNow = Date.now
  Date.now = () => realNow() + ((OAUTH_STATE_TTL_SECONDS + 1) * 1000)
  try {
    const expired = await verifyState(env, new URL(expiring.url).searchParams.get('state'))
    assert.strictEqual(expired.success, false)
    assert.match(expired.error, /expired/i)
  } finally {
    Date.now = realNow
  }

  const tampered = `${firstUrl.searchParams.get('state')}x`
  const rejected = await verifyState(env, tampered)
  assert.strictEqual(rejected.success, false)
  console.log('PASS Google login OAuth state is signed, PKCE-bound, expiring, server-recorded, and one-time')
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exitCode = 1
})
