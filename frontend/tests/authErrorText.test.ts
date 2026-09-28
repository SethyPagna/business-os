// I18N-4: a refused sign-in reads in the operator's language.
//
// The Worker sends a stable `code` with every /login and /otp/verify refusal
// (cloudflare/scripts/test-auth-error-codes-pure.cjs). This follows one from
// the wire to the sentence on the sign-in screen, running the REAL code at
// each hop, lifted out of its file:
//   http.ts createApiError -> AppContext login()'s catch -> Login.tsx
//   handleLogin / handleOtp setError(...)
// with a Khmer translator built from km.json. It used to show the Worker's
// English sentence (or the bare literal "Login failed") whatever the language.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const flatten = (input: any, prefix = '', out: Record<string, string> = {}) => {
  for (const [key, value] of Object.entries(input || {})) {
    const next = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, next, out)
    else out[next] = String(value)
  }
  return out
}
const km = flatten(JSON.parse(read('../src/lang/km.json')))
const en = flatten(JSON.parse(read('../src/lang/en.json')))
const trKm = (key: string, fallback: string) => km[key] || fallback
const KHMER = /[ក-៿]/

// The helper is loaded lazily so that, before it existed, this file still
// failed on the screen's wiring rather than on a missing import.
let helper: typeof import('../src/utils/authErrorText.ts') | null = null
try { helper = await import('../src/utils/authErrorText.ts') } catch (_) { helper = null }
const localizeAuthError = helper?.localizeAuthError
const authErrorDetail = helper?.authErrorDetail

function sourceTree(rel: string) {
  const text = read(rel)
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}
function find<T extends ts.Node>(root: ts.Node, test: (node: ts.Node) => node is T): T[] {
  const found: T[] = []
  const visit = (node: ts.Node) => { if (test(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(root)
  return found
}
const js = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

// --- hop 1: http.ts createApiError keeps the code and the wait -------------
const http = sourceTree('../src/api/http.ts')
const createApiErrorNode = find(http, (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'createApiError')[0]
assert.ok(createApiErrorNode, 'http.ts createApiError')
const createApiError = new Function('isTransientGatewayError', `${js(createApiErrorNode.getText(http))}; return createApiError`)(() => false)
const lockedError = createApiError(429, { error: 'Too many failed login attempts. Please wait 120 seconds and try again.', code: 'login_locked', locked: true, retryAfterSeconds: 120 }, '')
assert.equal(lockedError.code, 'login_locked')
assert.equal(lockedError.retryAfterSeconds, 120, 'createApiError carries retryAfterSeconds, so the screen can state the wait')

// --- hop 2: AppContext login() keeps them when it turns the throw into a result
const app = sourceTree('../src/AppContext.tsx')
const loginDecl = find(app, (n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(app) === 'login')[0]
assert.ok(loginDecl, 'AppContext login')
const loginCatch = find(loginDecl, ts.isCatchClause)[0]
assert.ok(loginCatch, 'AppContext login catch')
const appGetErrorMessage = (error: unknown, fallback = '') => (error instanceof Error ? error.message : fallback)
const loginCatchBody = new Function('getErrorMessage', 'authErrorDetail', loginCatch.variableDeclaration!.name.getText(app), js(loginCatch.block.getText(app)).replace(/^\{|\}\s*$/g, ''))
const loginResult = (error: unknown) => loginCatchBody(appGetErrorMessage, authErrorDetail, error)
const lockedResult = loginResult(lockedError)
assert.equal(lockedResult.success, false)
assert.equal(lockedResult.code, 'login_locked', 'login() passes the server code on')
assert.equal(lockedResult.retryAfterSeconds, 120, 'login() passes the wait on')
assert.match(loginResult(new TypeError('Failed to fetch')).error, /Cannot reach sync server/, 'the network sentence is unchanged')

// --- hop 3: Login.tsx says it in the operator's language -------------------
const login = sourceTree('../src/components/auth/Login.tsx')
const handler = (name: string) => {
  const node = find(login, (n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(login) === name)[0]
  assert.ok(node, name)
  return node
}
const setErrorArg = (scope: ts.Node) => {
  const call = find(scope, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(login) === 'setError')[0]
  assert.ok(call, 'setError call')
  return js(`(${call.arguments[0].getText(login)})`).trim().replace(/;$/, '')
}
const loginGetErrorMessage = (error: unknown, fallback: string) => String((error as { message?: unknown })?.message || fallback)
const evaluate = (expression: string, name: string, value: unknown, tr = trKm) =>
  new Function('localizeAuthError', 'getErrorMessage', 'tr', name, `return ${expression}`)(localizeAuthError, loginGetErrorMessage, tr, value)

const handleLogin = handler('handleLogin')
const notSuccess = find(handleLogin, (n): n is ts.IfStatement => ts.isIfStatement(n) && n.expression.getText(login) === '!result?.success')[0]
assert.ok(notSuccess, 'handleLogin: if (!result?.success)')
const loginFailureText = setErrorArg(notSuccess.thenStatement)
const loginCatchClause = find(handleLogin, ts.isCatchClause)[0]
const loginThrowText = setErrorArg(loginCatchClause.block)
const loginThrowName = loginCatchClause.variableDeclaration!.name.getText(login)

const handleOtp = handler('handleOtp')
const otpSuccess = find(handleOtp, (n): n is ts.IfStatement => ts.isIfStatement(n) && n.expression.getText(login) === 'verifyResult?.success && verifyResult?.user')[0]
assert.ok(otpSuccess?.elseStatement, 'handleOtp: else after a successful verify')
const otpFailureText = setErrorArg(otpSuccess.elseStatement)
const otpCatchClause = find(handleOtp, ts.isCatchClause)[0]
const otpThrowText = setErrorArg(otpCatchClause.block)
const otpThrowName = otpCatchClause.variableDeclaration!.name.getText(login)

const shown = {
  wrongPassword: evaluate(loginFailureText, 'result', loginResult(createApiError(401, { error: 'Invalid username or password', code: 'invalid_credentials', failedAttempts: 1 }, ''))),
  locked: evaluate(loginFailureText, 'result', lockedResult),
  rejected: evaluate(loginFailureText, 'result', loginResult(createApiError(403, { error: 'This device was denied access by an administrator. Contact your admin if this is unexpected.', code: 'device_rejected', deviceStatus: 'rejected' }, ''))),
  bare: evaluate(loginFailureText, 'result', { success: false }),
  loginThrow: evaluate(loginThrowText, loginThrowName, createApiError(429, { error: 'Too many login attempts from this network. Please try again later.', code: 'login_rate_limited_network' }, '')),
  otpWrong: evaluate(otpThrowText, otpThrowName, createApiError(401, { error: 'Invalid OTP code. Enter the current code and make sure your authenticator device uses automatic date and time.', code: 'otp_invalid', failedAttempts: 1 }, '')),
  otpExpired: evaluate(otpThrowText, otpThrowName, createApiError(401, { error: 'Your sign-in step expired. Please enter your password again.', code: 'otp_challenge_expired' }, '')),
  otpLocked: evaluate(otpThrowText, otpThrowName, createApiError(429, { error: 'Too many failed login attempts. Please wait 300 seconds and try again.', code: 'login_locked', locked: true, retryAfterSeconds: 300 }, '')),
  otpReturned: evaluate(otpFailureText, 'verifyResult', { success: false, error: 'Invalid OTP code.', code: 'otp_invalid' }),
}
for (const [name, text] of Object.entries(shown)) {
  assert.match(String(text), KHMER, `${name}: the sign-in screen shows Khmer, not "${text}"`)
  assert.doesNotMatch(String(text), /\{seconds\}/, `${name}: no unfilled placeholder`)
}
assert.equal(shown.wrongPassword, km.auth_error_invalid_credentials)
assert.equal(shown.rejected, km.device_rejected)
assert.equal(shown.bare, km.login_failed_try_again, 'no code and no sentence: the translated generic failure, not the literal "Login failed"')
assert.equal(shown.otpWrong, km.auth_error_otp_invalid)
assert.equal(shown.otpExpired, km.auth_error_otp_challenge_expired)
assert.ok(String(shown.locked).includes('120'), `the wait is stated: ${shown.locked}`)
assert.ok(String(shown.otpLocked).includes('300'), `the wait is stated: ${shown.otpLocked}`)

// Answers with no code keep what they said before.
assert.equal(evaluate(loginFailureText, 'result', { success: false, error: 'Cannot reach sync server. Check the URL in Settings -> Server, or clear it to use local mode.' }), 'Cannot reach sync server. Check the URL in Settings -> Server, or clear it to use local mode.')
assert.equal(evaluate(otpThrowText, otpThrowName, new Error('OTP verification timed out')), 'OTP verification timed out')
assert.equal(evaluate(loginFailureText, 'result', { success: false, error: 'Something new', code: 'a_code_this_build_does_not_know' }), 'Something new')

// --- the helper on its own --------------------------------------------------
assert.ok(helper, 'src/utils/authErrorText.ts')
const { AUTH_ERROR_KEYS } = helper!
assert.equal(localizeAuthError!({ code: 'login_locked', error: 'Please wait 60 seconds.' }, trKm, 'x'), 'Please wait 60 seconds.', 'a lockout without its wait keeps the server sentence, never a hole')
assert.equal(localizeAuthError!({ code: 'login_locked', retryAfterSeconds: 59.2 }, (_k, f) => f, 'x'), 'Too many failed sign-in attempts. Please wait 60 seconds and try again.')
assert.equal(localizeAuthError!({ code: 'toString' }, trKm, 'fallback'), 'fallback', 'only own codes map')
assert.equal(localizeAuthError!(null, trKm, 'fallback'), 'fallback')
assert.deepEqual(authErrorDetail!({ code: 'otp_invalid', retryAfterSeconds: null }), { code: 'otp_invalid' })

// --- every code the Worker sends is mapped, and both packs carry each key ---
const worker = fs.readFileSync(new URL('../../cloudflare/src/routes/auth.ts', import.meta.url), 'utf8')
const workerCodes = new Set<string>()
for (const route of ["app.post('/login'", "app.post('/otp/verify'"]) {
  const start = worker.indexOf(route)
  assert.ok(start >= 0, route)
  const body = worker.slice(start, worker.indexOf('\napp.', start + route.length))
  const literal = [...body.matchAll(/\bcode:\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1])
  assert.equal([...body.matchAll(/\bcode\s*:/g)].length, literal.length, `${route}: every refusal code is a literal this test can read`)
  for (const code of literal) workerCodes.add(code)
}
assert.ok(workerCodes.size >= 10, `worker codes found: ${[...workerCodes].join(', ')}`)
for (const code of workerCodes) assert.ok(Object.prototype.hasOwnProperty.call(AUTH_ERROR_KEYS, code), `the Worker's ${code} has a translation key`)
for (const [code, [key, english]] of Object.entries(AUTH_ERROR_KEYS) as Array<[string, readonly [string, string]]>) {
  assert.equal(en[key], english, `${code}: en.json ${key} matches the helper's fallback`)
  assert.match(km[key] || '', KHMER, `${code}: km.json ${key} is Khmer`)
  assert.equal(en[key].includes('{seconds}'), (km[key] || '').includes('{seconds}'), `${code}: both packs agree on {seconds}`)
}

console.log(`authErrorText: ${Object.keys(shown).length} screen answers in Khmer; ${workerCodes.size} Worker codes mapped`)
