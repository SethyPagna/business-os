import assert from 'node:assert/strict'
import type { Plugin } from 'vite'
import config from '../vite.config.ts'

const plugins = (await Promise.all((config.plugins ?? []) as unknown[])).flat(Infinity) as Plugin[]
const plugin = plugins.find(p => p.name === 'business-os-build-manifest')!
assert.ok(plugin)
const chunk = (name: string, imports: string[] = [], css: string[] = []) => ({
  type: 'chunk', name, fileName: `${name}.js`, imports, dynamicImports: ['optional.js'],
  isEntry: name === 'entry', viteMetadata: { importedCss: new Set(css) },
})
const bundle = Object.fromEntries([
  chunk('entry', ['shared.js']), chunk('PublicCatalogRoot', ['public-data.js'], ['public.css']),
  chunk('public-data', ['shared.js'], ['shared.css']), chunk('shared', ['public-data.js']),
  chunk('optional'), chunk('AdminRoot'), chunk('auth-login'), chunk('POS'), chunk('vendor'), chunk('lang-en'), chunk('lang-km'),
  { type: 'asset', fileName: 'public.css' }, { type: 'asset', fileName: 'shared.css' }, { type: 'asset', fileName: 'khmer-400.woff2' },
].map(item => [item.fileName, item]))
const outputs: any[] = []
const hook = plugin.generateBundle as Function
hook.call({ emitFile: (file: unknown) => outputs.push(file) }, {}, bundle)
const manifest = JSON.parse(outputs.find(file => file.fileName === 'business-os-precache.json').source)
const required = ['/PublicCatalogRoot.js', '/entry.js', '/public-data.js', '/public.css', '/shared.css', '/shared.js']
const { admin, shop } = manifest.hosts
for (const plan of [admin, shop]) {
  assert.deepEqual(plan.required, required)
  for (const file of plan.required) assert.ok(plan.eager.includes(file), file)
  assert.ok(!plan.required.includes('/optional.js'), 'unopened dynamic routes remain optional')
}
console.log('PASS actual build plugin requires cyclic-safe public startup JS/CSS closure, not optional dynamic routes')

// 6.0.880: offline selling is cancelled. The storefront precaches only its
// startup closure; the staff host installs its shell and defers the rest, and
// neither plan carries a language pack (the worker adds the remembered one).
assert.deepEqual(shop.eager, required)
assert.deepEqual(shop.deferred, [])
assert.deepEqual(manifest.languagePacks, { en: '/lang-en.js', km: '/lang-km.js' })
assert.deepEqual(admin.eager, ['/AdminRoot.js', ...required.slice(0, 2), '/auth-login.js', '/khmer-400.woff2', ...required.slice(2)].sort())
assert.deepEqual(admin.deferred, ['/POS.js', '/optional.js', '/vendor.js'])
for (const plan of [admin, shop]) {
  for (const list of [plan.eager, plan.deferred]) assert.ok(!list.some((file: string) => /lang-/.test(file)), 'language packs are never in a fixed plan')
}
console.log('PASS per-host plans: storefront startup closure only, staff shell eager, POS/vendor deferred, no fixed language pack')
