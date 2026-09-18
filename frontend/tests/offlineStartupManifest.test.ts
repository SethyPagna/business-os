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
  chunk('optional'), { type: 'asset', fileName: 'public.css' }, { type: 'asset', fileName: 'shared.css' },
].map(item => [item.fileName, item]))
const outputs: any[] = []
const hook = plugin.generateBundle as Function
hook.call({ emitFile: (file: unknown) => outputs.push(file) }, {}, bundle)
const manifest = JSON.parse(outputs.find(file => file.fileName === 'business-os-precache.json').source)
assert.deepEqual(manifest.required, ['/PublicCatalogRoot.js', '/entry.js', '/public-data.js', '/public.css', '/shared.css', '/shared.js'])
for (const file of manifest.required) assert.ok(manifest.eager.includes(file), file)
assert.ok(!manifest.required.includes('/optional.js'), 'unopened dynamic routes remain optional')
assert.ok(manifest.deferred.includes('/optional.js'))
console.log('PASS actual build plugin requires cyclic-safe public startup JS/CSS closure, not optional dynamic routes')
