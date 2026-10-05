// P-public-1 follow-up (2026-09-25): the storefront defaults to Khmer, so its
// <html lang> must say km BEFORE any script (or crawler, or Chrome's own
// translate offer) reads it -- not the static lang="en" until
// PublicCatalogPage mounts. The admin app keeps its own language: the
// bootstrap never touches lang there (AppContext sets it).
//
// Executes the real inline bootstrap from index.html against a DOM double,
// the same way posCommittedCloseDurability.test.ts does for translate="no".
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
assert.match(indexHtml, /<html lang="en">/, 'fixture sanity: the static default is still en, so only the bootstrap can make it km')
const bootstrapMatch = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)
assert.ok(bootstrapMatch, 'the route-aware bootstrap should stay inline in <head>')
const bootstrapSource = bootstrapMatch[1]

function runBootstrap(source: string, hostname: string, pathname: string) {
  const rootAttributes = new Map<string, string>()
  const element = () => ({
    attrs: new Map<string, string>(),
    getAttribute(name: string) { return this.attrs.get(name) ?? null },
    setAttribute(name: string, value: string) { this.attrs.set(name, value) },
  })
  const document = {
    title: '',
    documentElement: { setAttribute(name: string, value: string) { rootAttributes.set(name, value) } },
    head: { appendChild: (node: unknown) => node },
    createElement: () => element(),
    querySelector: () => element(),
    querySelectorAll: () => [],
  }
  vm.runInNewContext(source, { window: { location: { hostname, pathname } }, document })
  return { route: rootAttributes.get('data-business-os-initial-route') ?? null, lang: rootAttributes.get('lang') ?? null }
}

const storefront: Array<[string, string]> = [
  ['leangbeauty.com', '/'],
  ['leangbeauty.com', '/privacy'],
  ['leangbeauty.com', '/leang-beauty-phnom-penh'],
  // G38 P0: staff paths on the shop host are the storefront too.
  ['leangbeauty.com', '/dashboard'],
  ['leangbeauty.com', '/login'],
]
const admin: Array<[string, string]> = [
  ['admin.leangbeauty.com', '/'],
  ['admin.leangbeauty.com', '/pos'],
  ['localhost', '/products'],
]

for (const [hostname, pathname] of storefront) {
  const run = runBootstrap(bootstrapSource, hostname, pathname)
  assert.equal(run.route, 'public', `${hostname}${pathname} should be the storefront`)
  assert.equal(run.lang, 'km', `${hostname}${pathname} must declare lang="km" before the scripts run`)
}
for (const [hostname, pathname] of admin) {
  const run = runBootstrap(bootstrapSource, hostname, pathname)
  assert.equal(run.route, 'admin', `${hostname}${pathname} should be the admin shell`)
  assert.equal(run.lang, null, `${hostname}${pathname}: the admin app keeps its own language; the bootstrap must not set lang`)
}

// Negative control: without the storefront line the public assertion fails,
// so the check above is not vacuous.
const withoutLang = bootstrapSource.replace("document.documentElement.setAttribute('lang', 'km')", '')
assert.notEqual(withoutLang, bootstrapSource, 'the storefront lang line should exist exactly as pinned')
assert.equal(runBootstrap(withoutLang, 'leangbeauty.com', '/').lang, null, 'negative control: the double must not invent a lang')

// It runs in the storefront branch, not before the route is decided.
const publicBranch = bootstrapSource.slice(bootstrapSource.indexOf('if (publicRoute) {'), bootstrapSource.indexOf('} else {', bootstrapSource.indexOf('if (publicRoute) {')))
assert.match(publicBranch, /document\.documentElement\.setAttribute\('lang', 'km'\)/, 'the lang write belongs to the storefront branch only')

// PublicCatalogPage still re-sets it on mount to the visitor's chosen language.
const publicPage = fs.readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx', import.meta.url), 'utf8')
assert.match(publicPage, /document\.documentElement\.lang = /)

console.log('PASS storefront <html lang>: km from the bootstrap on storefront routes, untouched on admin routes')
