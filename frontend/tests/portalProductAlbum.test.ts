// Owner, 2026-09-25 (P-public-6): product detail photos become a small,
// horizontally scrollable album row (object-fit cover); the full-screen
// viewer gets a dark backdrop, swipe + arrow navigation, a close button and a
// counter.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SWIPE_MIN_DISTANCE_PX, swipeDirection } from '../src/components/shared/lightboxSwipe.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')

// 1. Swipe: left = next, right = previous; short, vertical or diagonal-ish
//    movement is not a swipe (so scrolling and taps never change the photo).
assert.equal(swipeDirection(-120, 10), 1, 'finger left -> next photo')
assert.equal(swipeDirection(120, -10), -1, 'finger right -> previous photo')
assert.equal(swipeDirection(-(SWIPE_MIN_DISTANCE_PX - 1), 0), 0, 'too short')
assert.equal(swipeDirection(-SWIPE_MIN_DISTANCE_PX, 0), 1, 'exactly the threshold counts')
assert.equal(swipeDirection(-80, 70), 0, 'mostly vertical is a scroll')
assert.equal(swipeDirection(0, 300), 0, 'a vertical scroll')
assert.equal(swipeDirection(3, 2), 0, 'a tap')

// 2. The immersive viewer.
const lightbox = read('src/components/shared/ImageGalleryLightbox.tsx')
const immersive = lightbox.slice(lightbox.indexOf('if (immersive) {'), lightbox.indexOf('  return createPortal(\n    <div className="fixed inset-0 z-[90] flex items-center'))
assert.ok(immersive.length > 200, 'the immersive branch exists')
assert.match(immersive, /fixed inset-0 z-\[90\] flex flex-col bg-neutral-950/, 'a solid dark full-screen backdrop, not a translucent blur')
assert.doesNotMatch(immersive, /backdrop-blur/)
assert.match(immersive, /aria-label=\{copy\.close\}/, 'a close button')
assert.match(immersive, /formatLabel\(copy\.imageCount, \{ current: safeIndex \+ 1, total \}\)/, 'a counter')
assert.match(immersive, /aria-label=\{copy\.prev\}[\s\S]*aria-label=\{copy\.next\}/, 'arrow navigation')
assert.match(immersive, /onTouchEnd=\{handleTouchEnd\}/, 'swipe handled on the stage')
assert.match(immersive, /h-11 w-11/, 'bar and arrow buttons are full touch targets')
assert.doesNotMatch(immersive, /thumb-/, 'no thumbnail rail -- the album row is the caller\'s')
assert.match(lightbox, /const step = swipeDirection\(touch\.clientX - swipeStart\.x, touch\.clientY - swipeStart\.y\)/)
assert.match(lightbox, /\} else if \(immersive\) \{\s*swipeStartRef\.current =/, 'swipe only arms at 1x, and only in the immersive viewer')
// Admin callers are untouched: they do not opt in.
for (const admin of ['src/components/products/Products.tsx', 'src/components/pos/POS.tsx']) {
  assert.doesNotMatch(read(admin), /variant="immersive"/, `${admin} keeps the default viewer`)
}

// 3. The storefront uses it -- product flyout and the preview surface alike.
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
assert.match(flyout, /<ImageGalleryLightbox[\s\S]*?variant="immersive"/)
assert.match(surface, /<ImageGalleryLightbox[\s\S]*?variant="immersive"/)

// 4. The album row: small square cover tiles in one scrolling row, each
//    opening the viewer at that photo; no big single hero image any more.
const album = flyout.slice(flyout.indexOf('data-product-detail-album="true"') - 200, flyout.indexOf('data-product-detail-album="true"') + 1400)
assert.match(album, /flex snap-x snap-mandatory gap-2 overflow-x-auto/, 'one horizontally scrolling row')
assert.match(album, /h-28 w-28 shrink-0 snap-start/, 'small fixed tiles that do not shrink')
assert.match(album, /className="h-full w-full object-cover"/, 'object-fit cover')
assert.match(album, /setActiveIndex\(index\)\s*setLightboxOpen\(true\)/, 'a tile opens the viewer at that photo')
assert.doesNotMatch(flyout, /aspect-\[4\/3\]/, 'the large single-image hero is gone')

console.log('PASS product album row and immersive full-screen viewer')
