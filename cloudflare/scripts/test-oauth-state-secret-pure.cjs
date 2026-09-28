// OAuth `state` HMAC key selection (security lane S-secrets, Sep 26 2026).
//
// The state for Google sign-in and for the Google Drive connect flow was
// signed with AUTH_SESSION_SECRET, falling back to the OAuth CLIENT SECRET.
// A dedicated OAUTH_STATE_SECRET now takes precedence; the old order is kept
// after it so deployments without it sign exactly as before. The signature
// is recomputed here with node:crypto from the expected key, so the test
// fails if the code signs with any other key.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const nodeCrypto = require('crypto')

function loadTs(relPath, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', relPath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
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
  return moduleObj.exports
}

const login = loadTs('googleOauth.ts', { '../index': {} })
const drive = loadTs('googleDrive.ts', {
  '../index': {},
  './db': { getDb: () => ({}) },
  './secretCrypto': { encryptSecret: async () => '', decryptSecret: async () => '', upgradeLegacySecret: async () => null },
  './backup': {},
})

function makeCache() {
  const values = new Map()
  return {
    async put(key, value) { values.set(key, value) },
    async get(key) { return values.get(key) || null },
    async delete(key) { values.delete(key) },
  }
}

function hmac(secret, data) {
  return nodeCrypto.createHmac('sha256', secret).update(data).digest('base64url')
}

function assertSignedWith(state, secret, label) {
  const [encoded, signature] = state.split('.')
  assert.ok(encoded && signature, `${label}: state has payload.signature shape`)
  assert.strictEqual(signature, hmac(secret, encoded), `${label}: signed with the expected key`)
}

const base = {
  BUSINESS_OS_ADMIN_URL: 'https://admin.example.com',
  BUSINESS_OS_PUBLIC_URL: 'https://example.com',
  GOOGLE_LOGIN_CLIENT_ID: 'login-client',
  GOOGLE_LOGIN_CLIENT_SECRET: 'login-client-secret',
  GOOGLE_LOGIN_REDIRECT_URI: 'https://admin.example.com/api/auth/oauth/callback',
  GOOGLE_DRIVE_CLIENT_ID: 'drive-client',
  GOOGLE_DRIVE_CLIENT_SECRET: 'drive-client-secret',
}

async function loginState(env) {
  const result = await login.buildGoogleOauthStartUrl(env, { mode: 'login', organization: 'shop' })
  assert.strictEqual(result.success, true, result.error)
  return new URL(result.url).searchParams.get('state')
}

async function driveState(env) {
  const result = await drive.buildDriveOauthStartUrl(env, { userId: 7 })
  assert.strictEqual(result.success, true, result.error)
  return new URL(result.url).searchParams.get('state')
}

async function main() {
  // Dedicated key present: it wins over both older keys.
  {
    const env = { ...base, OAUTH_STATE_SECRET: 'dedicated-state-key', AUTH_SESSION_SECRET: 'session-key', CACHE: makeCache() }
    const state = await loginState(env)
    assertSignedWith(state, 'dedicated-state-key', 'login')
    assert.notStrictEqual(state.split('.')[1], hmac('session-key', state.split('.')[0]))
    assert.notStrictEqual(state.split('.')[1], hmac('login-client-secret', state.split('.')[0]))
    assert.strictEqual((await login.verifyState(env, state)).success, true)
    // A state signed with the dedicated key does not verify without it.
    const again = await loginState(env)
    const withoutDedicated = { ...env, OAUTH_STATE_SECRET: undefined }
    assert.strictEqual((await login.verifyState(withoutDedicated, again)).success, false)

    const dState = await driveState(env)
    assertSignedWith(dState, 'dedicated-state-key', 'drive')
    assert.strictEqual((await drive.consumeDriveOauthState(env, dState)).success, true)
  }
  // Fallback 1: AUTH_SESSION_SECRET, exactly as before.
  {
    const env = { ...base, AUTH_SESSION_SECRET: 'session-key', CACHE: makeCache() }
    assertSignedWith(await loginState(env), 'session-key', 'login fallback')
    assertSignedWith(await driveState(env), 'session-key', 'drive fallback')
  }
  // Fallback 2: the client secret, exactly as before (nothing breaks).
  {
    const env = { ...base, CACHE: makeCache() }
    const state = await loginState(env)
    assertSignedWith(state, 'login-client-secret', 'login client-secret fallback')
    assert.strictEqual((await login.verifyState(env, state)).success, true)
    assertSignedWith(await driveState(env), 'drive-client-secret', 'drive client-secret fallback')
  }
  // Blank dedicated key is ignored, not used as an empty HMAC key.
  {
    const env = { ...base, OAUTH_STATE_SECRET: '   ', AUTH_SESSION_SECRET: 'session-key', CACHE: makeCache() }
    assertSignedWith(await loginState(env), 'session-key', 'blank dedicated key')
  }
  console.log('oauth state secret: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
