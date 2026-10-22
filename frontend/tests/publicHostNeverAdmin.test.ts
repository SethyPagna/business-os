// G38 P0 (owner 27 Sep 2026): "the public site never shows admin".
// On the shop host (leangbeauty.com, or any non-admin host such as the e2e
// storefront origin 127.0.0.2) every document is the storefront: /login is
// the CUSTOMER sign-in (the account drawer opens), and /pos, /admin,
// /products, /index.html or a stray /x.php show the shop. admin.* and
// loopback keep the staff app exactly as before, and so does a deployment's
// configured staff host (BM Shop's bm-admin.khshop.workers.dev, 22 Oct 2026),
// which the document's identity block carries.
//
// Runs the real src/app/pathRouting.ts under a window double per host, and
// the real inline bootstrap from index.html, and requires the two to agree on
// every path. Control: the pre-G38 host-blind router must fail the shop-host
// assertions. The Worker half (staff API 404 on the shop host) is
// cloudflare/scripts/test-public-host-api-gate-pure.cjs.
//
// Run: node tests/publicHostNeverAdmin.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as clientIdentity from '../src/app/clientIdentity.ts'
import { clientIdentityJson, resolveClientIdentity, type ClientIdentity } from '../../cloudflare/src/lib/clientIdentity.ts'

const NEUTRAL = resolveClientIdentity({})
const BM_SHOP = resolveClientIdentity({ BUSINESS_OS_ADMIN_URL: 'https://bm-admin.khshop.workers.dev', BUSINESS_OS_PUBLIC_URL: 'https://bm.khshop.workers.dev' })

const routingSource = fs.readFileSync(new URL('../src/app/pathRouting.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
type Routing = { isPublicCatalogPath: (p: unknown) => boolean; isStorefrontSignInPath?: (p: unknown) => boolean; isAdminAppPath: (p: unknown) => boolean }
// The real router and the real host rule, reading the identity this host's
// document carries.
function loadRouting(source: string, hostname: string, identity: ClientIdentity = NEUTRAL): Routing {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Routing }
  const identityModule = { ...clientIdentity, isStaffHostname: (host: unknown) => clientIdentity.isStaffHostname(host, identity) }
  const requireModule = (id: string) => {
    if (id === './clientIdentity.ts') return identityModule
    throw new Error(`pathRouting.ts imports ${id}`)
  }
  vm.runInNewContext(output, { module, exports: module.exports, require: requireModule, window: { location: { hostname } } })
  return module.exports
}

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const bootstrapSource = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)?.[1] || ''
assert.ok(bootstrapSource, 'the inline route bootstrap is in index.html')
function bootstrapRoute(hostname: string, pathname: string, identity: ClientIdentity = NEUTRAL): string | null {
  const attributes = new Map<string, string>()
  const element = () => ({ attrs: new Map<string, string>(), getAttribute() { return null }, setAttribute() {} })
  const document = {
    title: '', documentElement: { setAttribute(name: string, value: string) { attributes.set(name, value) } },
    head: { appendChild: (node: unknown) => node }, createElement: () => element(), querySelector: () => element(), querySelectorAll: () => [],
    getElementById: (id: string) => (id === 'business-os-identity' ? { textContent: clientIdentityJson(identity) } : null),
  }
  vm.runInNewContext(bootstrapSource, { window: { location: { hostname, pathname } }, document })
  return attributes.get('data-business-os-initial-route') ?? null
}

let passed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${(error as Error).message}`) }
}

const STAFF_PATHS = ['/login', '/login/reset', '/admin', '/app', '/pos', '/products', '/products/new', '/dashboard', '/settings', '/contacts', '/catalog', '/index.html', '/wp-login.php']
const SHOP_PATHS = ['/', '/privacy', '/some-shop']
const NEVER_DOCUMENTS = ['/api/auth/login', '/api/portal/config', '/uploads/a.jpg', '/health']

// [host, the identity its document carries]
const SHOP_HOSTS: ReadonlyArray<readonly [string, ClientIdentity]> = [
  ['leangbeauty.com', NEUTRAL],
  ['127.0.0.2', NEUTRAL],
  ['bm.khshop.workers.dev', BM_SHOP],
  ['bm-admin.khshop.workers.dev.evil.com', BM_SHOP],
  ['xbm-admin.khshop.workers.dev', BM_SHOP],
  ['bm-admin.khshop.workers.dev', NEUTRAL],
]
const STAFF_HOSTS: ReadonlyArray<readonly [string, ClientIdentity]> = [
  ['admin.leangbeauty.com', NEUTRAL],
  ['localhost', NEUTRAL],
  ['127.0.0.1', NEUTRAL],
  ['bm-admin.khshop.workers.dev', BM_SHOP],
]

function shopHostSuite(source: string) {
  for (const [host, identity] of SHOP_HOSTS) {
    const routing = loadRouting(source, host, identity)
    for (const p of [...STAFF_PATHS, ...SHOP_PATHS]) assert.equal(routing.isPublicCatalogPath(p), true, `${host}${p} renders the storefront`)
    for (const p of NEVER_DOCUMENTS) assert.equal(routing.isPublicCatalogPath(p), false, `${host}${p} is not a storefront document`)
  }
}

check('shop host: every document path is the storefront, staff paths included', () => shopHostSuite(routingSource))

check('staff hosts are unchanged: / and staff paths are the staff app, unknown paths the storefront', () => {
  for (const [host, identity] of STAFF_HOSTS) {
    const routing = loadRouting(routingSource, host, identity)
    for (const p of ['/', '/login', '/admin', '/pos', '/products/new', '/index.html']) assert.equal(routing.isPublicCatalogPath(p), false, `${host}${p} stays the staff app`)
    assert.equal(routing.isPublicCatalogPath('/some-shop'), true, `${host}/some-shop is the storefront preview`)
  }
})

check('/login (and below) is the storefront sign-in path, nothing else is', () => {
  const routing = loadRouting(routingSource, 'leangbeauty.com')
  assert.equal(typeof routing.isStorefrontSignInPath, 'function')
  for (const p of ['/login', '/LOGIN', '/login/', '/login/reset']) assert.equal(routing.isStorefrontSignInPath?.(p), true, p)
  for (const p of ['/', '/loginx', '/admin', '/products']) assert.equal(routing.isStorefrontSignInPath?.(p), false, p)
  const page = fs.readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /useState\(\(\) => typeof window !== 'undefined' && isStorefrontSignInPath\(window\.location\?\.pathname\)\)/, 'arriving on /login opens the account drawer')
})

check('index.html bootstrap agrees with pathRouting on every host and path', () => {
  for (const [host, identity] of [...SHOP_HOSTS, ...STAFF_HOSTS]) {
    const routing = loadRouting(routingSource, host, identity)
    for (const p of [...STAFF_PATHS, ...SHOP_PATHS]) {
      const expected = routing.isPublicCatalogPath(p) ? 'public' : 'admin'
      assert.equal(bootstrapRoute(host, p, identity), expected, `${host}${p}: bootstrap and router disagree`)
    }
  }
})

check('control: the pre-G38 host-blind router fails the shop-host suite', () => {
  const hostBlind = routingSource.replace('  if (!isAdminHostname()) return true\n  if (value === \'/\') return false\n', '  if (value === \'/\') return !isAdminHostname()\n')
  assert.notEqual(hostBlind, routingSource, 'control injection point found')
  assert.throws(() => shopHostSuite(hostBlind), /leangbeauty\.com\/login renders the storefront/)
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
