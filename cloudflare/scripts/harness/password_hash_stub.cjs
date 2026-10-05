// The lib/passwordHash.ts surface with the `hash:<password>` semantics the
// route tests used for their old bcryptjs stub, for tests whose subject is
// NOT hashing (permissions, rate limits, sessions, profile fields). Hashing
// itself is pinned against the real module by test-password-hash-pure.cjs,
// test-login-password-hash-upgrade-pure.cjs and
// test-portal-password-hash-upgrade-pure.cjs.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const stubHash = (password) => `hash:${password}`

const passwordHashStub = {
  PASSWORD_HASH_ALGORITHM: 'pbkdf2-sha256',
  PASSWORD_HASH_ITERATIONS: 10000,
  currentPasswordHashPrefix: () => '$pbkdf2-sha256$i=10000$',
  passwordPepperStatus: () => ({ configured: false, version: null }),
  describePasswordHash: (stored) => (String(stored ?? '').startsWith('hash:') ? { scheme: 'pbkdf2-sha256', iterations: 10000, pepperVersion: 0 } : { scheme: 'unknown', iterations: null, pepperVersion: null }),
  isCurrentPasswordHash: (stored) => String(stored ?? '').startsWith('hash:'),
  passwordHashScheme: (stored) => (String(stored ?? '').startsWith('hash:') ? 'pbkdf2-sha256' : 'unknown'),
  hashPassword: async (password) => stubHash(String(password ?? '')),
  verifyPassword: async (password, stored) => ({ ok: String(stored ?? '') === stubHash(String(password ?? '')), needsRehash: false, scheme: 'pbkdf2-sha256' }),
  spendDummyPasswordVerify: async () => {},
  upgradePasswordHash: async () => false,
}

// The REAL lib/passwordHash.ts (real bcryptjs, real WebCrypto), for tests
// that read back a row the real routes wrote.
let realModule = null
function loadRealPasswordHash() {
  if (realModule) return realModule
  const sourcePath = path.join(__dirname, '..', '..', 'src', 'lib', 'passwordHash.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  realModule = mod.exports
  return realModule
}

module.exports = { passwordHashStub, stubHash, loadRealPasswordHash }
