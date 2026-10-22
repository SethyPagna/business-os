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
// 6.0.956 (owner, 22 Oct 2026): a deployment's staff host can be configured
// (BUSINESS_OS_ADMIN_URL; BM Shop's bm-admin.khshop.workers.dev, since a
// *.workers.dev name cannot start with admin.). It is staff by EXACT hostname
// only: the public host, look-alikes and an unset var stay the storefront.
// Controls: a gate blind to the configured host and one that matches it
// loosely both fail.
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
const IDENTITY = 'src/lib/clientIdentity.ts'
const { wranglerVars } = require('./harness/wrangler_vars.cjs')

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
  const gateAt = indexSource.indexOf('if (isBlockedOnStorefrontHost(c.req.url, staffHostFrom(c.env.BUSINESS_OS_ADMIN_URL, c.env.BUSINESS_OS_PUBLIC_URL))) return c.json({ error: \'Not found\' }, 404)')
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
    const hostBlind = inject(source, '  if (isStaffHostname(parsed.hostname, staffHost)) return false\n', '')
    assert.throws(() => gateSuite(loadGate(hostBlind)), /unchanged on the staff host/, `${label}: a host-blind gate must fail`)
    const denyList = inject(source, "if (lower === '/api' || lower.startsWith('/api/')) return !isStorefrontApiPath(path)", "if (lower.startsWith('/api/auth/')) return true")
    assert.throws(() => gateSuite(loadGate(denyList)), /must be 404 on the shop host/, `${label}: a deny-list gate must fail`)
  }
})

// --- the configured staff host -------------------------------------------

const BM_STAFF_HOST = 'bm-admin.khshop.workers.dev'
const LOOK_ALIKES = ['bm.khshop.workers.dev', 'bm-admin.khshop.workers.dev.evil.com', 'xbm-admin.khshop.workers.dev', 'admin-bm.khshop.workers.dev', 'bm-admin.khshop.workers.dev.', 'evil.com']

function configuredHostSuite(gate) {
  for (const p of [...STAFF_ONLY, ...STOREFRONT]) {
    assert.equal(gate.isBlockedOnStorefrontHost(`https://${BM_STAFF_HOST}${p}`, BM_STAFF_HOST), false, `${BM_STAFF_HOST}${p} is the staff app when configured`)
    assert.equal(gate.isBlockedOnStorefrontHost(`https://BM-Admin.khshop.workers.dev${p}`, BM_STAFF_HOST), false, `any letter case of ${BM_STAFF_HOST}${p} is the staff app`)
  }
  for (const host of LOOK_ALIKES) {
    for (const p of STAFF_ONLY) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`, BM_STAFF_HOST), true, `${host}${p} must be 404: not the configured staff host`)
    for (const p of STOREFRONT) assert.equal(gate.isBlockedOnStorefrontHost(`https://${host}${p}`, BM_STAFF_HOST), false, `${host}${p} must stay reachable on the shop host`)
  }
  for (const unset of ['', undefined, null]) {
    for (const p of STAFF_ONLY) assert.equal(gate.isBlockedOnStorefrontHost(`https://${BM_STAFF_HOST}${p}`, unset), true, `${BM_STAFF_HOST}${p} must be 404 when no staff host is configured (${String(unset)})`)
  }
}

check('a configured staff host is staff by exact hostname; the public host, look-alikes and an unset var are not', () => {
  assert.ok(gate, 'gate loaded')
  configuredHostSuite(gate)
  gateSuite({ isBlockedOnStorefrontHost: (url) => gate.isBlockedOnStorefrontHost(url, BM_STAFF_HOST) })
})

check('control: a gate blind to the configured host, and one that matches it loosely, both fail', () => {
  assert.ok(gateSource, 'gate source loaded')
  const exact = "    || (configured !== '' && host === configured)\n"
  const blind = inject(gateSource, exact, '')
  assert.throws(() => configuredHostSuite(loadGate(blind)), /is the staff app when configured/)
  for (const loose of ['host.includes(configured)', 'host.startsWith(configured)', 'host.endsWith(configured)']) {
    const mutant = inject(gateSource, exact, `    || (configured !== '' && ${loose})\n`)
    assert.throws(() => configuredHostSuite(loadGate(mutant)), /must be 404: not the configured staff host/, loose)
  }
})

const identitySource = readAt(`cloudflare/${IDENTITY}`)
const identity = identitySource ? loadGate(identitySource) : null

check('the staff host comes from BUSINESS_OS_ADMIN_URL and is never the public host', () => {
  assert.ok(identity && typeof identity.staffHostFrom === 'function', `${IDENTITY} exports staffHostFrom`)
  const leang = wranglerVars('wrangler.toml')
  assert.equal(identity.staffHostFrom(leang.BUSINESS_OS_ADMIN_URL, leang.BUSINESS_OS_PUBLIC_URL), 'admin.leangbeauty.com', "Leang's configured staff host")
  assert.equal(identity.resolveClientIdentity(leang).staffHost, 'admin.leangbeauty.com', 'the identity the documents carry')
  assert.equal(identity.staffHostFrom('https://BM-Admin.khshop.workers.dev/', 'https://bm.khshop.workers.dev'), BM_STAFF_HOST)
  for (const [adminUrl, publicUrl] of [
    ['https://bm.khshop.workers.dev', 'https://bm.khshop.workers.dev/'],
    ['https://BM.khshop.workers.dev:443/x', 'https://bm.khshop.workers.dev'],
    ['https://www.bm.khshop.workers.dev', 'https://bm.khshop.workers.dev'],
    ['ftp://bm-admin.khshop.workers.dev', 'https://bm.khshop.workers.dev'],
    ['javascript:alert(1)', 'https://bm.khshop.workers.dev'],
    ['bm-admin.khshop.workers.dev', 'https://bm.khshop.workers.dev'],
    ['', 'https://bm.khshop.workers.dev'],
    [undefined, undefined],
  ]) {
    assert.equal(identity.staffHostFrom(adminUrl, publicUrl), '', `${String(adminUrl)} with public ${String(publicUrl)}: no staff host`)
  }
  for (const p of STAFF_ONLY) {
    const sameAsPublic = identity.staffHostFrom('https://bm.khshop.workers.dev', 'https://bm.khshop.workers.dev')
    assert.equal(gate.isBlockedOnStorefrontHost(`https://bm.khshop.workers.dev${p}`, sameAsPublic), true, `a staff URL equal to the public one never opens ${p} on the shop host`)
  }
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
