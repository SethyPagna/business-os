// Refuter follow-up to P-public-6 (2026-09-25): the immersive photo viewer is
// a real modal (focus in, Tab trapped, focus back to the opener, page scroll
// locked) and the product sheet locks page scroll too -- through ONE counted
// lock whose release always runs, so the storefront can never be left
// unscrollable (storefrontScrollRoot.test.ts's original bug).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// A CSSStyleDeclaration-shaped fake that honours priority.
function fakeStyle(initial: Record<string, [string, string]> = {}) {
  const props = new Map<string, [string, string]>(Object.entries(initial))
  return {
    props,
    getPropertyValue: (name: string) => props.get(name)?.[0] || '',
    getPropertyPriority: (name: string) => props.get(name)?.[1] || '',
    setProperty: (name: string, value: string, priority = '') => { props.set(name, [value, priority]) },
    removeProperty: (name: string) => { const old = props.get(name)?.[0] || ''; props.delete(name); return old },
  }
}
const html = fakeStyle()
const body = fakeStyle({ overflow: ['clip', ''] })
;(globalThis as Record<string, unknown>).document = { documentElement: { style: html }, body: { style: body } }

const { lockDocumentScroll, documentScrollLockDepth } = await import('../src/components/shared/documentScrollLock.ts')

// 1. The lock beats html's `overflow-y: auto !important` (it needs priority).
const releaseSheet = lockDocumentScroll()
assert.deepEqual(html.props.get('overflow'), ['hidden', 'important'], 'html lock must be !important or main.css wins')
assert.deepEqual(body.props.get('overflow'), ['hidden', 'important'])

// 2. Nested: the viewer inside the sheet. Closing the viewer keeps the page
//    locked for the sheet; closing the sheet restores the ORIGINAL values.
const releaseViewer = lockDocumentScroll()
assert.equal(documentScrollLockDepth(), 2)
releaseViewer()
assert.deepEqual(html.props.get('overflow'), ['hidden', 'important'], 'the inner overlay closing must not unlock the outer one')
releaseViewer()
assert.equal(documentScrollLockDepth(), 1, 'a release is idempotent -- a double cleanup cannot underflow the count')
releaseSheet()
assert.equal(documentScrollLockDepth(), 0)
assert.equal(html.props.has('overflow'), false, 'html had no inline overflow before, and has none after')
assert.deepEqual(body.props.get('overflow'), ['clip', ''], 'body gets back exactly its previous inline value')

// 3. Wiring.
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')
const lightbox = read('src/components/shared/ImageGalleryLightbox.tsx')
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')

const effect = lightbox.slice(lightbox.indexOf('const immersiveOpen = immersive && open && total > 0'), lightbox.indexOf('if (!open || !total) return null'))
assert.ok(effect.length > 200, 'the immersive modal effect exists, before the early return (hook order)')
assert.match(effect, /const opener = document\.activeElement instanceof HTMLElement \? document\.activeElement : null/, 'the opening tile is remembered')
assert.match(effect, /const releaseScroll = lockDocumentScroll\(\)/, 'page scroll is locked while open')
assert.match(effect, /immersiveCloseRef\.current\?\.focus\(\)/, 'focus moves to Close on open')
assert.match(effect, /event\.key !== 'Tab'[\s\S]*last\.focus\(\)[\s\S]*first\.focus\(\)/, 'Tab and Shift+Tab wrap inside the viewer')
assert.match(effect, /return \(\) => \{[\s\S]*releaseScroll\(\)[\s\S]*if \(opener\?\.isConnected\) opener\.focus\(\)/, 'close releases the lock and returns focus to the opener')
assert.match(effect, /\}, \[immersiveOpen\]\)/)
assert.match(lightbox, /<button ref=\{immersiveCloseRef\} type="button" className=\{barButton\} onClick=\{\(\) => onClose\?\.\(\)\} aria-label=\{copy\.close\}>/)
assert.match(lightbox, /data-lightbox-variant="immersive"\s*ref=\{immersiveRootRef\}/)

assert.match(flyout, /const releaseScroll = lockDocumentScroll\(\)[\s\S]{0,200}return \(\) => \{\s*cancelAnimationFrame\(raf\)\s*releaseScroll\(\)/, 'the product sheet locks on mount and releases on unmount')
assert.match(flyout, /if \(event\.key !== 'Tab'\) return\s*\/\/[\s\S]{0,200}if \(lightboxOpen\) return/, 'the sheet does not fight the viewer for Tab')
// The flyout's own <img> tiles are real buttons, so the opener is focusable.
assert.match(flyout, /setActiveIndex\(index\)\s*setLightboxOpen\(true\)/)

// 4. No storefront overlay writes the style directly (that is the pattern
//    storefrontScrollRoot.test.ts forbids, and it loses to !important anyway).
for (const source of [lightbox, flyout]) {
  assert.doesNotMatch(source, /(document\.(body|documentElement)|body|html)\.style\.(overflow|overflowY|position)\s*=/)
}

console.log('PASS overlay scroll lock (counted, !important, restored) and immersive viewer focus management')
