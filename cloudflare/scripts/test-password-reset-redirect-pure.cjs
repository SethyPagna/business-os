// Locks the Part-77 HIGH fix (auth audit): the password-reset email's link
// base comes from resolvePasswordResetBase, which only honors a redirectTo
// on one of the app's own configured origins -- anything else (an attacker
// host, garbage, a relative path) falls back to the admin URL, so the
// single-use recovery token can never be delivered to a caller-chosen host.
// Tests the REAL transpiled lib/verification.ts.
//
// Run: node scripts/test-password-reset-redirect-pure.cjs

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

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

// verification.ts pulls in db + env types; only resolvePasswordResetBase is
// exercised here, so stub the heavy imports out.
const verification = loadModule('lib/verification.ts', (id) => {
  if (id === './db') return { getDb: () => { throw new Error('db not needed here') } }
  return require(id)
})
const { resolvePasswordResetBase } = verification

const env = {
  BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
  BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com',
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('an attacker-controlled host falls back to the admin URL', () => {
  assert.strictEqual(resolvePasswordResetBase(env, 'https://evil.example/steal'), 'https://admin.leangbeauty.com')
  assert.strictEqual(resolvePasswordResetBase(env, 'https://admin.leangbeauty.com.evil.example/'), 'https://admin.leangbeauty.com')
})

check('the app\'s own origins keep origin + pathname, dropping query and hash', () => {
  assert.strictEqual(resolvePasswordResetBase(env, 'https://admin.leangbeauty.com/login?next=/x#frag'), 'https://admin.leangbeauty.com/login')
  assert.strictEqual(resolvePasswordResetBase(env, 'https://leangbeauty.com/'), 'https://leangbeauty.com/')
})

check('a same-host different-scheme or different-port origin does NOT pass', () => {
  assert.strictEqual(resolvePasswordResetBase(env, 'http://admin.leangbeauty.com/login'), 'https://admin.leangbeauty.com')
  assert.strictEqual(resolvePasswordResetBase(env, 'https://admin.leangbeauty.com:8443/login'), 'https://admin.leangbeauty.com')
})

check('garbage, relative and empty redirectTo all fall back', () => {
  for (const bad of ['', '   ', '/login', 'javascript:alert(1)', 'not a url']) {
    assert.strictEqual(resolvePasswordResetBase(env, bad), 'https://admin.leangbeauty.com', `fallback for ${JSON.stringify(bad)}`)
  }
})

check('source lock: issuePasswordResetLink builds the link from the resolver, never raw redirectTo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'verification.ts'), 'utf8')
  const issueAt = src.indexOf('export async function issuePasswordResetLink')
  assert.ok(issueAt > -1)
  const body = src.slice(issueAt)
  assert.ok(/const base = resolvePasswordResetBase\(env, redirectTo\)/.test(body), 'the link base must come from resolvePasswordResetBase')
  assert.ok(!/String\(redirectTo \|\| ''\)\.trim\(\)/.test(body), 'raw redirectTo must not feed the link')
})

console.log(`\n${passed} check(s) passed.`)
