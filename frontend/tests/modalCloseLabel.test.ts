import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// F11 (audit sibling): the single close-affordance button on every shared
// Modal, kit/Fold, QuickAddModal, and the image lightbox rendered
// aria-label="Close" as a bare English literal -- the one accessible name
// screen-reader users get for this control never followed the app's
// language setting, even though 'close' is a real, already-translated key
// in both packs (en.json/km.json) and other close buttons in this codebase
// (FastStockInModal.tsx, contacts/shared.tsx) already read it correctly.

const modal = readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
const fold = readFileSync(new URL('../src/components/shared/kit/Fold.tsx', import.meta.url), 'utf8')
const quickAdd = readFileSync(new URL('../src/components/pos/QuickAddModal.tsx', import.meta.url), 'utf8')
const lightbox = readFileSync(new URL('../src/components/shared/ImageGalleryLightbox.tsx', import.meta.url), 'utf8')

// None of the four surfaces may hardcode the literal any more.
assert.doesNotMatch(modal, /aria-label="Close"/, 'Modal.tsx close button must not hardcode the English literal')
assert.doesNotMatch(fold, /aria-label="Close"/, 'Fold.tsx close buttons must not hardcode the English literal')
assert.doesNotMatch(quickAdd, /aria-label="Close"/, 'QuickAddModal.tsx close button must not hardcode the English literal')
assert.doesNotMatch(lightbox, /aria-label="Close"/, 'ImageGalleryLightbox.tsx close button must not hardcode the English literal')

// Each must route the accessible name through the translated 'close' key
// (or, for the lightbox's caller-supplied labels convention, a `close`
// field alongside its existing prev/next/dotsLabel labels) rather than a
// second, differently-named literal replacing the first.
assert.match(modal, /aria-label=\{tr\('close', 'Close'\)\}/, "Modal.tsx must resolve the close button's name through the 'close' translation key")
assert.match(fold, /aria-label=\{tr\('close', 'Close'\)\}/, "Fold.tsx close buttons must resolve their name through the 'close' translation key")
assert.match(quickAdd, /aria-label=\{T\('close', 'Close'\)\}/, "QuickAddModal.tsx must resolve the close button's name through its existing T() translation helper")
assert.match(lightbox, /close:\s*labels\.close \|\| 'Close'/, "ImageGalleryLightbox.tsx must expose a translatable 'close' label alongside prev/next/dotsLabel")

// Fold's two close buttons (mobile sheet + desktop panel) must BOTH be
// fixed -- a partial fix that only catches one instance of a repeated
// literal is not sibling parity within the same file.
const foldCloseMatches = fold.match(/aria-label=\{tr\('close', 'Close'\)\}/g) || []
assert.equal(foldCloseMatches.length, 2, 'both of Fold.tsx close buttons (mobile sheet and desktop panel) must be translated')

// Positive control: Modal.tsx/Fold.tsx/ImageGalleryLightbox.tsx still carry
// OTHER aria-label attributes untouched by this fix (this ask is scoped to
// the close control only) -- proves the regexes above are discriminating,
// not matching (or failing to match) everything in the file.
assert.match(modal, /role="dialog"/, 'positive control: Modal.tsx dialog role attribute is still findable')
assert.match(lightbox, /aria-label="Zoom out"/, 'positive control: ImageGalleryLightbox.tsx Zoom out label (out of this fix\'s scope) is untouched')
assert.match(lightbox, /aria-label=\{copy\.prev\}/, 'positive control: ImageGalleryLightbox.tsx prev/next labels (existing convention) are untouched')

// F11 follow-up: ImageGalleryLightbox.tsx gaining a `close` field on its
// `labels` prop type is necessary but not sufficient -- every real caller
// must actually PASS that field, or the component falls back to its
// hardcoded English 'Close' default and the fix has no runtime effect for
// any of the app's four real lightbox usages (POS, Products, and both
// catalog/portal call sites). Each caller must wire `close` through the
// same translation mechanism it already uses for the sibling prev/next
// labels right next to it.
const pos = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const catalogPreview = readFileSync(new URL('../src/components/catalog/CatalogPreviewSurface.tsx', import.meta.url), 'utf8')
const productDetailFlyout = readFileSync(new URL('../src/components/catalog/ProductDetailFlyout.tsx', import.meta.url), 'utf8')

assert.match(pos, /close:\s*t\('close'\)\s*\|\|\s*'Close',/, "POS.tsx's lightbox labels must pass a translated close label, not rely on the component default")
assert.match(products, /close:\s*t\('close'\)\s*\|\|\s*'Close',/, "Products.tsx's lightbox labels must pass a translated close label, not rely on the component default")
assert.match(productDetailFlyout, /close:\s*copy\('close', 'Close'\),/, "ProductDetailFlyout.tsx's lightbox labels must pass a translated close label, not rely on the component default")
const catalogPreviewCloseMatches = catalogPreview.match(/close:\s*copy\('close', 'Close'\),/g) || []
assert.equal(catalogPreviewCloseMatches.length, 2, 'CatalogPreviewSurface.tsx has two ImageGalleryLightbox call sites (product gallery + portal image view); BOTH must pass a translated close label')

// Positive control: each caller's own prev/next siblings, right next to the
// new close field, are untouched -- proves these regexes are scoped to the
// close wiring and not just matching anything in these large files.
assert.match(pos, /prev:\s*posCopy\('Prev'\)/, "positive control: POS.tsx's lightbox prev label (existing convention) is untouched")
assert.match(products, /prev:\s*t\('prev'\)\s*\|\|\s*'Prev'/, "positive control: Products.tsx's lightbox prev label (existing convention) is untouched")
assert.match(productDetailFlyout, /prev:\s*copy\('prevImage', 'Previous image'\)/, "positive control: ProductDetailFlyout.tsx's lightbox prev label (existing convention) is untouched")

console.log('modalCloseLabel.test.ts OK')
