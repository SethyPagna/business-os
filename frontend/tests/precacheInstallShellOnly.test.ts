import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Plugin } from 'vite'
import config from '../vite.config.ts'

// F3 (27 Sep 2026). Offline selling is cancelled (owner, 26 Sep); the PWA
// stays installable caching app code only. The precache manifest used to list
// every other generated chunk as `deferred`, and the service worker fetched
// all of them right after each activation (~7.9 MB per device per deploy); the
// generic `vendor` chunk (html2canvas, qrcode, ffmpeg) was also precached at
// install so a receipt could print offline. Neither survives: unopened routes
// and the print libraries are fetched and cached on first use.
//
// Runs the real build-manifest plugin, so it is red against c5b28762, whose
// manifest carries `deferred` and names /vendor.js as eager.

const plugins = (await Promise.all((config.plugins ?? []) as unknown[])).flat(Infinity) as Plugin[]
const plugin = plugins.find((p) => p.name === 'business-os-build-manifest')
assert.ok(plugin)
const chunk = (name: string, imports: string[] = []) => ({
  type: 'chunk', name, fileName: `assets/${name}-h.js`, imports: imports.map((dep) => `assets/${dep}-h.js`),
  dynamicImports: [], isEntry: name === 'index', viteMetadata: { importedCss: new Set<string>() },
})
const bundle = Object.fromEntries([
  chunk('index', ['vendor-react']), chunk('vendor-react'), chunk('AdminRoot'), chunk('POS'),
  chunk('lang-km'), chunk('vendor'), chunk('Reports'), chunk('vendor-xlsx'),
  { type: 'asset', fileName: 'assets/noto-sans-khmer-400-h.woff2' },
].map((item) => [item.fileName, item]))
const outputs: Array<{ fileName: string, source: string }> = []
;(plugin.generateBundle as Function).call({ emitFile: (file: { fileName: string, source: string }) => outputs.push(file) }, {}, bundle)
const manifest = JSON.parse(outputs.find((file) => file.fileName === 'business-os-precache.json')!.source)

assert.equal('deferred' in manifest, false, 'the manifest must not hand the worker a list of every other chunk to fetch after activation')
assert.ok(!manifest.eager.includes('/assets/vendor-h.js'), 'the print/QR/ffmpeg vendor chunk is fetched on first use, not at install')
for (const lazy of ['/assets/Reports-h.js', '/assets/vendor-xlsx-h.js']) assert.ok(!manifest.eager.includes(lazy), `${lazy} stays lazy`)

// Installability and the offline banner/shell: the entry closure, admin shell,
// POS, language pack and the Khmer font are still precached at install.
for (const url of ['/assets/index-h.js', '/assets/vendor-react-h.js', '/assets/AdminRoot-h.js', '/assets/POS-h.js', '/assets/lang-km-h.js', '/assets/noto-sans-khmer-400-h.woff2']) {
  assert.ok(manifest.eager.includes(url), `${url} must stay eager`)
}
assert.deepEqual(manifest.required, ['/assets/index-h.js', '/assets/vendor-react-h.js'])

// The worker is unchanged by F3; it must read an absent list as empty rather
// than fall back to every generated asset, in the source and the shipped copy.
for (const rel of ['src/public-runtime/service-worker.ts', 'public/sw.js']) {
  const sw = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  assert.match(sw, /const deferredAssets = Array\.isArray\(precachePayload\?\.deferred\)\s*\?[^:]+:\s*\[\]/, rel)
}

console.log('PASS precache manifest: install caches the shell only; no post-activate precache-all list; vendor fetched on first use')
