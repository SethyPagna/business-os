// G38 P0 (design S1, owner 27 Sep "the public site never shows admin"): on
// the storefront host the Worker answers only the storefront's own API.
// leangbeauty.com/api/auth/login, /api/products, the staff submission review
// and the /ws live-update socket are 404 there; admin.leangbeauty.com and
// loopback are unchanged.
//
// Runs the REAL lib/publicHostGate.ts, pins that src/index.ts runs it before
// every other API middleware and route, and pins parity with the frontend:
// every /api path the storefront bundle calls must stay reachable.
// Controls: a host-blind gate and a deny-list gate are loaded in the same run
// and must fail. SECURITY_TEST_BASE=<sha> checks that commit (bb639041d has
// no gate, so it must FAIL).
//
// Review F4 (13 Oct): Hono decodes the path before routing, so a gate that
// judged the RAW pathname let /api/portal/%73ubmissions/review reach the staff
// review route on the shop host (401, not 404). The gate now judges the path
// decoded as far as any decoder could take it (%2F, double encoding,
// backslashes, dot segments, any letter case) and fails closed (404) on a
// malformed escape. 0baa53f2f must FAIL the encoded suite; a raw-path mutant of
// the current gate, loaded in the same run, must fail it too.
//
// Run: node scripts/test-public-host-api-gate-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')
const GATE = 'src/lib/publicHostGate.ts'

// Line endings depend on the checkout (core.autocrlf, the Windows runner), so
// every source is compared as LF; the controls also run on a CRLF copy.
const toLf = (text) => text.replace(/\r\n/g, '\n')
function readAt(rel) {
  if (!process.env.SECURITY_TEST_BASE) return toLf(fs.readFileSync(path.join(repo, rel), 'utf8'))
  try {
    return toLf(execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch { return null }
}

// Exactly one occurrence, matched on LF text whatever the input's endings; the
// result keeps the input's endings so the mutant is the same file, mutated.
function inject(source, needle, replacement) {
  const crlf = source.includes('\r\n')
  const lf = toLf(source)
  assert.equal(lf.split(needle).length, 2, `injection point found exactly once: ${JSON.stringify(needle.slice(0, 60))}`)
  const out = lf.replace(needle, replacement)
  return crlf ? out.replace(/\n/g, '\r\n') : out
}

function loadGate(source) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
  return mod.exports
}

let passed = 0
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

const gateSource = readAt(`cloudflare/${GATE}`)
const indexSource = readAt('cloudflare/src/index.ts')

const STAFF_ONLY = ['/api/auth/login', '/api/auth/bootstrap', '/api/products', '/api/products/search', '/api/settings', '/api/sales', '/api/customers', '/api/sync/owner', '/api/telegram/webhook', '/api/portal/submissions/review', '/api/portal/submissions/7/review', '/api/portal/submissions/7/screenshot/0', '/api', '/ws']
const STOREFRONT = ['/api/portal/config', '/api/portal/bootstrap', '/api/portal/auth/signin', '/api/portal/auth/signup', '/api/portal/ai/chat', '/api/portal/catalog/products/search', '/api/portal/submissions', '/api/system/client-error', '/uploads/products/a.jpg', '/', '/login', '/products', '/admin', '/assets/index-abc.js', '/robots.txt', '/health']

function gateSuite(gate) {
  for (const host of ['leangbeauty.com', 'www.leangbeauty.com', 'business-os.example.workers.dev']) {
    for (const p of STAFF_ONLY) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`), true, `${host}${p} must be 404 on the shop host`)
    for (const p of STOREFRONT) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`), false, `${host}${p} must stay reachable on the shop host`)
  }
  for (const host of ['admin.leangbeauty.com', 'localhost:8787', '127.0.0.1:8787', '[::1]:8787']) {
    for (const p of [...STAFF_ONLY, ...STOREFRONT]) assert.equal(gate.isBlockedOnStorefrontHost(`http://${host}${p}`), false, `${host}${p} is unchanged on the staff host`)
  }
}

check('the gate exists and is wired before every other API middleware and route', () => {
  assert.ok(gateSource, `${GATE} exists`)
  assert.ok(indexSource.includes("import { isBlockedOnStorefrontHost } from './lib/publicHostGate'"), 'index.ts imports the gate')
  const gateAt = indexSource.indexOf('if (isBlockedOnStorefrontHost(c.req.url)) return c.json({ error: \'Not found\' }, 404)')
  assert.ok(gateAt > 0, 'index.ts answers 404 from the gate')
  // E3 (G39 item 3) renamed the invariants middleware call to ensureCoreDataInvariantsForRequest.
  for (const later of ["app.use('/api/*', originGuard)", 'ensureCoreDataInvariantsForRequest(c.env)', "app.get('/ws'", "app.route('/api/auth', authRoute)", "app.route('/api/portal', portalRoute)"]) {
    const at = indexSource.indexOf(later)
    assert.ok(at > gateAt, `the gate runs before ${later}`)
  }
})

const gate = gateSource ? loadGate(gateSource) : null

check('shop host: staff API and /ws are 404; storefront API, uploads and documents stay; staff host unchanged', () => {
  assert.ok(gate, 'gate loaded')
  gateSuite(gate)
})

check('parity: every /api path the storefront bundle calls is reachable on the shop host', () => {
  assert.ok(gate, 'gate loaded')
  const files = ['frontend/src/api/portalPublicTransport.ts', 'frontend/src/utils/clientCrashReport.ts']
  const paths = new Set()
  for (const file of files) {
    for (const match of fs.readFileSync(path.join(repo, file), 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_/.-]*)/g)) paths.add(match[1])
  }
  assert.ok(paths.size >= 12, `expected the storefront's API set, found ${paths.size}`)
  for (const p of paths) assert.equal(gate.isBlockedOnStorefrontHost(`https://leangbeauty.com${p.endsWith('/') ? `${p}LC-00001` : p}`), false, `storefront call ${p} must not be blocked`)
})

// What a router or a later decoder could turn into a staff path, and the
// malformed escapes nothing should guess at. All 404 on the shop host.
const ENCODED_STAFF = [
  '/api/portal/%73ubmissions/review', // %73 = s: Hono routes this to the staff review
  '/api/portal/%73ubmissions/1/review',
  '/api/portal/%73ubmissions/7/screenshot/0',
  '/api/portal/submissions%2F1%2Freview', // %2F
  '/api/portal/submissions%2f1%2freview', // lower-case hex
  '/api/portal%2Fsubmissions/1/review',
  '/api%2Fauth/login',
  '/api/%61uth/login', // %61 = a
  '/%61pi/products',
  '/api/portal/%2573ubmissions/1/review', // double encoding
  '/api/portal/%25%37%33ubmissions/review',
  '/api/portal/%252e%252e/auth/login', // double-encoded dot segments
  '/api/portal/%2e%2e/auth/login',
  '/api/portal/submissions%5C1%5Creview', // backslash
  '/api/portal/%53ubmissions/1/review', // %53 = S: mixed case
  '/api/portal/SUBMISSIONS/1/review',
  '/API/auth/login',
  '/Api/portal/config',
  '/%77s', // %77 = w: the socket
  '/WS',
]
const MALFORMED = ['/api/portal/%zz/review', '/api/portal/config%', '/api/portal/%E0%A4%A/x', '/%E0%A4%A', '/products/%zz']
// Encoded but harmless: decoding must not over-block the storefront.
const ENCODED_STOREFRONT = ['/api/portal/membership/LC%2D00001', '/api/portal/catalog/products/search', '/uploads/products/a%20b.jpg', '/uploads/products/50%25off.jpg', '/products/%E1%9E%80%E1%9E%B6']

function encodedSuite(gate) {
  for (const host of ['leangbeauty.com', 'business-os.example.workers.dev']) {
    for (const p of ENCODED_STAFF) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`), true, `${host}${p} must be 404 on the shop host (encoded)`)
    for (const p of MALFORMED) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`), true, `${host}${p} must fail closed on the shop host (malformed)`)
    for (const p of ENCODED_STOREFRONT) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`), false, `${host}${p} must stay reachable on the shop host`)
  }
  for (const p of [...ENCODED_STAFF, ...MALFORMED, ...ENCODED_STOREFRONT]) {
    assert.equal(gate.isBlockedOnStorefrontHost(`https://admin.leangbeauty.com${p}`), false, `admin.leangbeauty.com${p} is unchanged on the staff host`)
  }
}

check('shop host: encoded, double-encoded, backslash, dot-segment and any-case staff paths are 404; malformed escapes fail closed', () => {
  assert.ok(gate, 'gate loaded')
  encodedSuite(gate)
})

check('control: a gate that judges the raw pathname fails the encoded suite', () => {
  assert.ok(gateSource, 'gate source loaded')
  const raw = inject(gateSource, '  const path = gatePath(parsed.pathname)\n', '  const path = parsed.pathname\n')
  assert.throws(() => encodedSuite(loadGate(raw)), /must be 404 on the shop host \(encoded\)/)
})

check('control: a host-blind gate and a deny-list gate both fail the suite, from LF and CRLF checkouts', () => {
  assert.ok(gateSource, 'gate source loaded')
  for (const [label, source] of [['LF', gateSource], ['CRLF', gateSource.replace(/\n/g, '\r\n')]]) {
    assert.equal(source.includes('\r\n'), label === 'CRLF', `${label} copy really has ${label} endings`)
    assert.doesNotThrow(() => gateSuite(loadGate(source)), `the unmutated ${label} gate passes`)
    const hostBlind = inject(source, '  if (isStaffHostname(parsed.hostname)) return false\n', '')
    assert.throws(() => gateSuite(loadGate(hostBlind)), /unchanged on the staff host/, `${label}: a host-blind gate must fail`)
    const denyList = inject(source, "if (lower === '/api' || lower.startsWith('/api/')) return !isStorefrontApiPath(path)", "if (lower.startsWith('/api/auth/')) return true")
    assert.throws(() => gateSuite(loadGate(denyList)), /must be 404 on the shop host/, `${label}: a deny-list gate must fail`)
  }
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
