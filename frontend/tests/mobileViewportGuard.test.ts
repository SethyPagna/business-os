// Owner, 27 Sep 2026: pinch-zoom is allowed on the public storefront only; the staff app and the
// till keep the zoom lock (WCAG 1.4.4 for the storefront). The static viewport carries no cap, the
// inline bootstrap writes the lock on every admin route, and the storefront roots must not pin a
// touch-action that blocks the pinch.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.join(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')

const indexHtml = read('index.html')
const mainCss = read('src/styles/main.css')
const catalogPage = read('src/components/catalog/CatalogPage.tsx')
const preview = read('src/components/catalog/CatalogPreviewSurface.tsx')

const LOCKED = /maximum-scale=1[^"]*user-scalable=no|user-scalable=no[^"]*maximum-scale=1/

const staticViewport = /<meta name="viewport" content="([^"]+)"/.exec(indexHtml)?.[1] || ''
if (!staticViewport.includes('width=device-width')) throw new Error('the viewport meta must exist and set width=device-width')
if (/maximum-scale|user-scalable/.test(staticViewport)) throw new Error('the static viewport must not cap zoom: it is what the storefront serves')

const bootstrap = indexHtml.match(/<script>\s*(\(function setInitialBusinessOsRoute\(\)[\s\S]*?\}\(\)\))\s*<\/script>/)?.[1]
if (!bootstrap) throw new Error('the route-aware bootstrap should stay inline in <head>')

function viewportAfterBootstrap(hostname: string, pathname: string): string {
  const viewport = { content: staticViewport, getAttribute(name: string) { return name === 'content' ? this.content : null }, setAttribute(name: string, value: string) { if (name === 'content') this.content = value } }
  const element = () => ({ getAttribute: () => null, setAttribute: () => {} })
  const document = {
    title: '',
    documentElement: { setAttribute: () => {} },
    head: { appendChild: (node: unknown) => node },
    createElement: element,
    querySelector: (selector: string) => (selector === 'meta[name="viewport"]' ? viewport : element()),
    querySelectorAll: () => [],
  }
  vm.runInNewContext(bootstrap as string, { window: { location: { hostname, pathname } }, document })
  return viewport.content
}

for (const [hostname, pathname] of [['leangbeauty.com', '/'], ['leangbeauty.com', '/privacy'], ['leangbeauty.com', '/login'], ['leangbeauty.com', '/dashboard']]) {
  const content = viewportAfterBootstrap(hostname, pathname)
  if (/maximum-scale|user-scalable/.test(content)) throw new Error(`${hostname}${pathname} is the storefront and must stay zoomable: ${content}`)
}
for (const [hostname, pathname] of [['admin.leangbeauty.com', '/'], ['admin.leangbeauty.com', '/pos'], ['localhost', '/products'], ['admin.leangbeauty.com', '/login']]) {
  const content = viewportAfterBootstrap(hostname, pathname)
  if (!LOCKED.test(content) || !content.includes('width=device-width')) throw new Error(`${hostname}${pathname} is the staff app and must keep the zoom lock: ${content}`)
}

const publicRoot = /html\[data-public-portal='true'\][\s\S]*?touch-action:\s*([^;]+);/.exec(mainCss)?.[1] || ''
const publicBody = /body\[data-public-portal='true'\][\s\S]*?touch-action:\s*([^;]+);/.exec(mainCss)?.[1] || ''
for (const [name, value] of [['html', publicRoot], ['body', publicBody]]) {
  if (!/pinch-zoom/.test(value)) throw new Error(`public portal ${name} must allow browser pinch zoom, got "${value}"`)
}
if (!/html\[data-business-os-initial-route='public'\],\s*html\[data-business-os-initial-route='public'\] body\s*\{\s*touch-action:\s*pan-x pan-y pinch-zoom;/.test(mainCss)) {
  throw new Error('the storefront must be pinch-zoomable before React mounts, keyed off the bootstrap route marker')
}
const baseRoots = mainCss.match(/^\s{2}(?:html|body) \{[^}]*?touch-action:\s*([^;]+);/gm) || []
if (baseRoots.length !== 2 || baseRoots.some((rule) => /pinch-zoom/.test(rule))) {
  throw new Error('the app-wide html/body rules keep pan-x pan-y so the admin stays unzoomable')
}

if ((catalogPage.match(/touchAction:\s*'pan-x pan-y pinch-zoom'/g) || []).length < 2) {
  throw new Error('catalog loading and fallback roots must allow pinch zoom on the public view')
}
if (/touchAction:\s*'pan-y'/.test(catalogPage + preview)) throw new Error('no storefront root may pin a vertical-only touch action')
if (!/touchAction:\s*'pan-x pan-y pinch-zoom'/.test(preview)) throw new Error('catalog preview root must allow pinch zoom on the public view')

console.log('mobile viewport zoom guard: PASS')
