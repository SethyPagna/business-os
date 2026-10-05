// G38 P0 (WEB-threat P1-11): the rate-limit client key comes from Cloudflare's
// CF-Connecting-IP only. getClientIp used to fall back to X-Forwarded-For,
// which the caller writes, so a script could pick a fresh limiter key per
// request. Also pins clientNetworkKey: one IPv6 /64 is one network.
//
// Runs the REAL lib/rateLimit.ts. Positive control: a mutant that restores
// the X-Forwarded-For fallback is loaded in the same run and must FAIL the
// forged-header check, so a green run cannot come from a blind assertion.
// SECURITY_TEST_BASE=<sha> runs the suite against that commit's file (the
// pre-fix base bb639041d must report FAIL).
//
// Run: node scripts/test-client-ip-trust-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const file = path.join(root, 'src/lib/rateLimit.ts')

function loadFrom(source) {
  const output = ts.transpileModule(source, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, (request) => {
    if (request === './db') return { getDb: () => { throw new Error('no db in this test') } }
    throw new Error(`Unexpected dependency: ${request}`)
  }, mod)
  return mod.exports
}

const source = process.env.SECURITY_TEST_BASE
  ? execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/lib/rateLimit.ts`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(file, 'utf8')
const real = loadFrom(source)

const req = (headers) => new Request('https://leangbeauty.com/api/portal/auth/signin', { headers })

function forgedHeaderSuite(lib) {
  assert.equal(lib.getClientIp(req({ 'CF-Connecting-IP': '203.0.113.7' })), '203.0.113.7')
  assert.equal(lib.getClientIp(req({ 'X-Forwarded-For': '198.51.100.1' })), 'unknown-ip', 'a forged X-Forwarded-For alone must not become the key')
  assert.equal(lib.getClientIp(req({ 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '198.51.100.1, 10.0.0.1' })), '203.0.113.7')
  const rotating = new Set(['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => lib.getClientIp(req({ 'X-Forwarded-For': ip }))))
  assert.equal(rotating.size, 1, 'rotating X-Forwarded-For values must all share one key')
  assert.equal(lib.getClientIp(req({})), 'unknown-ip')
}

let passed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

check('only CF-Connecting-IP becomes the client key', () => forgedHeaderSuite(real))

check('control: the old X-Forwarded-For fallback fails the same suite', () => {
  const mutantSource = fs.readFileSync(file, 'utf8').replace(
    "return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-ip'",
    "return request.headers.get('CF-Connecting-IP')?.trim() || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown-ip'",
  )
  assert.notEqual(mutantSource, fs.readFileSync(file, 'utf8'), 'mutant injection point not found')
  assert.throws(() => forgedHeaderSuite(loadFrom(mutantSource)), /forged X-Forwarded-For/)
})

check('IPv6 addresses in one /64 share a network key; IPv4 stays exact', () => {
  const key = real.clientNetworkKey
  assert.equal(typeof key, 'function', 'clientNetworkKey is exported')
  const a = key('2001:db8:85a3:12::1')
  assert.equal(a, '2001:db8:85a3:12::/64')
  assert.equal(key('2001:0db8:85a3:0012:ffff:ffff:ffff:fffe'), a, 'another address in the same /64')
  assert.equal(key('2001:DB8:85A3:12:0:0:0:9'), a, 'case and zero-padding do not split a network')
  assert.notEqual(key('2001:db8:85a3:13::1'), a, 'the neighbouring /64 is a different network')
  assert.equal(key('::1'), '0:0:0:0::/64')
  assert.equal(key('203.0.113.7'), '203.0.113.7')
  assert.notEqual(key('203.0.113.7'), key('203.0.113.8'), 'IPv4 is never widened')
  assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7', 'an IPv4-mapped address is its IPv4')
  assert.equal(key(''), 'unknown-ip')
  assert.equal(key('unknown-ip'), 'unknown-ip')
  assert.equal(real.getClientNetworkKey(req({ 'CF-Connecting-IP': '2001:db8:85a3:12::abcd' })), a)
  assert.equal(real.getClientNetworkKey(req({ 'X-Forwarded-For': '2001:db8::1' })), 'unknown-ip')
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
