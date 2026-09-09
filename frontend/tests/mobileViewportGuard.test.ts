import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const indexHtml = read('index.html')
const mainCss = read('src/styles/main.css')
const catalogPage = read('src/components/catalog/CatalogPage.tsx')
const preview = read('src/components/catalog/CatalogPreviewSurface.tsx')

if (!/name="viewport"[^>]*maximum-scale=1[^>]*user-scalable=no/.test(indexHtml)) {
  throw new Error('index viewport must cap browser zoom for the fixed-width mobile app')
}

const publicRoot = /html\[data-public-portal='true'\][\s\S]*?touch-action:\s*pan-y;/.exec(mainCss)?.[0] || ''
const publicBody = /body\[data-public-portal='true'\][\s\S]*?touch-action:\s*pan-y;/.exec(mainCss)?.[0] || ''
if (!publicRoot || !publicBody) throw new Error('public portal roots must allow vertical pan without browser pinch zoom')
if (/touch-action:\s*pan-y\s+pinch-zoom/.test(publicRoot + publicBody)) throw new Error('public portal must not opt back into browser pinch zoom')

if ((catalogPage.match(/touchAction:\s*'pan-y'/g) || []).length < 2) {
  throw new Error('catalog loading and fallback roots must keep vertical-only touch action')
}
if (!/touchAction:\s*'pan-y'/.test(preview)) throw new Error('catalog preview root must keep vertical-only touch action')

console.log('mobile viewport zoom guard: PASS')
