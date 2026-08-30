// Locks the Part-77 HIGH fix (auth audit) on the OTP login flow: POST
// /auth/otp/verify used to be a standalone 6-digit login -- reachable with
// just a guessable numeric userId (never bound to the password / Google
// step), feeding no escalating lockout, and re-running no device-approval
// gate. Tests the REAL transpiled lib/otpChallenge.ts against a fake KV,
// plus ordering source locks on routes/auth.ts and the frontend senders.
//
// Run: node scripts/test-otp-verify-binding-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, require, module)
  return module.exports
}

const { issueOtpChallenge, isLiveOtpChallenge, consumeOtpChallenge } = loadModule('lib/otpChallenge.ts')

// Minimal KV: put/get/delete over a Map (TTL not simulated -- expiry is
// KV's own contract; what this suite pins is the binding logic around it).
function fakeKv() {
  const store = new Map()
  return {
    put: async (key, value) => { store.set(key, String(value)) },
    get: async (key) => (store.has(key) ? store.get(key) : null),
    delete: async (key) => { store.delete(key) },
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {

await check('a minted challenge is live for exactly its user, and for no one else', async () => {
  const env = { CACHE: fakeKv() }
  const token = await issueOtpChallenge(env, 7)
  assert.ok(token.length >= 32, 'token must be long random, not guessable')
  assert.strictEqual(await isLiveOtpChallenge(env, token, 7), true)
  assert.strictEqual(await isLiveOtpChallenge(env, token, 8), false, 'another userId must not ride a stolen challenge')
})

await check('absent, garbage, and oversized tokens are all dead', async () => {
  const env = { CACHE: fakeKv() }
  await issueOtpChallenge(env, 7)
  assert.strictEqual(await isLiveOtpChallenge(env, undefined, 7), false)
  assert.strictEqual(await isLiveOtpChallenge(env, '', 7), false)
  assert.strictEqual(await isLiveOtpChallenge(env, 'not-a-real-token', 7), false)
  assert.strictEqual(await isLiveOtpChallenge(env, 'x'.repeat(500), 7), false)
})

await check('consuming a challenge kills it; a wrong code before that does NOT (retry within the window)', async () => {
  const env = { CACHE: fakeKv() }
  const token = await issueOtpChallenge(env, 7)
  // A failed code attempt never calls consume -- the same challenge stays
  // usable for the retry.
  assert.strictEqual(await isLiveOtpChallenge(env, token, 7), true)
  await consumeOtpChallenge(env, token)
  assert.strictEqual(await isLiveOtpChallenge(env, token, 7), false)
})

await check('source lock: both first factors mint the challenge with their otpRequired answer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8')
  const mintSites = src.match(/otpRequired: true[^}]*otpChallenge: await issueOtpChallenge\(c\.env, /g) || []
  assert.strictEqual(mintSites.length, 2, `expected the /login AND oauth-callback otpRequired answers to mint (found ${mintSites.length})`)
})

await check('source lock: /otp/verify gates in the right order -- challenge, lockout, code+lockout-feed, device, then session', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8')
  const routeAt = src.indexOf("app.post('/otp/verify'")
  assert.ok(routeAt > -1)
  const body = src.slice(routeAt, src.indexOf("app.post('", routeAt + 20))
  const challengeAt = body.indexOf('isLiveOtpChallenge(c.env, body.otpChallenge, body.userId)')
  const userSelectAt = body.indexOf('FROM users u')
  const lockoutCheckAt = body.indexOf('getLoginLockoutState(c.env, user.username)')
  const verifyAt = body.indexOf('verifyTotp(otpSecret')
  const failFeedAt = body.indexOf('recordFailedLogin(c.env, user.username)')
  const deviceAt = body.indexOf('checkDeviceTrust(c.env, user.id, body.deviceId')
  const clearAt = body.indexOf('clearLoginLockout(c.env, user.username)')
  const consumeAt = body.indexOf('consumeOtpChallenge(c.env, body.otpChallenge)')
  const sessionAt = body.indexOf('createSession(c.env, user.id')
  for (const [name, at] of [['challenge', challengeAt], ['user select', userSelectAt], ['lockout check', lockoutCheckAt], ['verify', verifyAt], ['fail feed', failFeedAt], ['device gate', deviceAt], ['lockout clear', clearAt], ['challenge consume', consumeAt], ['session', sessionAt]]) {
    assert.ok(at > -1, `expected the ${name} step in /otp/verify`)
  }
  assert.ok(challengeAt < userSelectAt, 'the challenge check must run before any DB read')
  assert.ok(lockoutCheckAt < verifyAt, 'a locked account must not get a code compare')
  assert.ok(verifyAt < failFeedAt, 'failed codes must feed the escalating lockout')
  assert.ok(deviceAt < sessionAt, 'the device gate must run before the session is created')
  assert.ok(consumeAt < sessionAt && clearAt < sessionAt, 'consume + clear happen on success, before the session')
})

await check('source lock: the frontend sends the challenge and the persistent deviceId', () => {
  const login = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'auth', 'Login.tsx'), 'utf8')
  assert.ok(/otpChallenge: pendingOtpChallenge/.test(login), 'Login.tsx must send the minted challenge to /otp/verify')
  assert.ok(/setPendingOtpChallenge\((callbackResult|result)\.otpChallenge \|\| ''\)/.test(login), 'Login.tsx must capture the challenge from otpRequired answers')
  const transport = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'authTransport.ts'), 'utf8')
  const verifyAt = transport.indexOf('export function otpVerify')
  assert.ok(verifyAt > -1 && /getOrCreatePersistentDeviceId\(\)/.test(transport.slice(verifyAt, verifyAt + 400)), 'otpVerify must carry the persistent deviceId for the re-run device gate')
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
