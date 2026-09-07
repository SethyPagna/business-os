// audit "storefront-sheet-safe-area" (mobile:F1/F2/F3/F4, i18n:16). Four
// `items-end ... p-0` bottom sheets sat flush against the iOS home
// indicator while nine sibling sheets already carry
// `pb-[env(safe-area-inset-bottom)] sm:pb-0` (grep leads: PublicCatalogPage.tsx,
// pos/ProductDetailSheet.tsx, users/UserDetailSheet.tsx). Two of the four
// also duplicated a header Close as a second footer Close button.
//
// This file is a source-shape check (no DOM/jsdom in this suite -- see the
// sibling tests/portalCatalogDisplay.test.ts for the same style): it reads
// the fixed files as text and asserts the exact classes/structure landed.
// Run: node tests/sheetSafeArea.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const productDetailFlyoutSource = fs.readFileSync(
  new URL('../src/components/catalog/ProductDetailFlyout.tsx', import.meta.url),
  'utf8',
)
const productDescriptionDetailModalSource = fs.readFileSync(
  new URL('../src/components/products/surfaces/ProductDescriptionDetailModal.tsx', import.meta.url),
  'utf8',
)
const renameCascadeModalSource = fs.readFileSync(
  new URL('../src/components/shared/RenameCascadeModal.tsx', import.meta.url),
  'utf8',
)
const enLang = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const kmLang = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('mobile:F1 -- ProductDetailFlyout panel clears the home indicator', () => {
  assert.match(
    productDetailFlyoutSource,
    /rounded-t-2xl bg-white shadow-2xl pb-\[env\(safe-area-inset-bottom\)\][\s\S]{0,80}sm:pb-0[\s\S]{0,40}dark:bg-neutral-900/,
    'the sheet panel must carry pb-[env(safe-area-inset-bottom)] sm:pb-0, matching PublicCatalogPage/ProductDetailSheet/UserDetailSheet',
  )
})

runTest('mobile:F1 -- ProductDetailFlyout gesture strip keeps only Add to Bucket', () => {
  // The defect was a footer BUTTON labelled Close that duplicated the header
  // X with no distinct purpose (Add to Bucket is the strip's one real action).
  //
  // Counting occurrences of copy('close', 'Close') was a proxy for that, and
  // it stopped measuring the right thing once the a11y lane wired a translated
  // close label into the ImageGalleryLightbox this flyout opens (65e22314):
  // that is a DIFFERENT control's label, on a different surface, and it is
  // wanted. Assert the actual rule instead -- exactly one close affordance in
  // the flyout's own chrome, and it is the header X.
  const lightboxLabels = productDetailFlyoutSource.match(/labels=\{\{[\s\S]*?\}\}/g) || []
  const ownChrome = lightboxLabels.reduce((text, block) => text.replace(block, ''), productDetailFlyoutSource)
  assert.equal(
    (ownChrome.match(/copy\('close', 'Close'\)/g) || []).length,
    1,
    'the footer Close button duplicating the header X must stay removed -- only the header aria-label may carry it',
  )
  assert.match(ownChrome, /aria-label=\{copy\('close', 'Close'\)\}/)
  // ...and no Close-labelled button anywhere in the flyout's own markup.
  assert.doesNotMatch(ownChrome, /<button[^>]*>[\s\S]{0,400}?\{copy\('close', 'Close'\)\}[\s\S]{0,40}?<\/button>/)
  // The lightbox's own close label is wanted, and stays.
  assert.match(productDetailFlyoutSource, /close: copy\('close', 'Close'\)/)
})

runTest('mobile:F2 -- ProductDescriptionDetailModal panel clears the home indicator', () => {
  assert.match(
    productDescriptionDetailModalSource,
    /rounded-t-2xl bg-white shadow-2xl pb-\[env\(safe-area-inset-bottom\)\][\s\S]{0,80}sm:pb-0[\s\S]{0,40}dark:bg-gray-800/,
    'the sheet panel must carry pb-[env(safe-area-inset-bottom)] sm:pb-0',
  )
})

runTest('mobile:F2 -- ProductDescriptionDetailModal drops the duplicate footer Close', () => {
  // Same "appears twice before, once after" signature as the flyout: the
  // header X's aria-label is the only remaining close affordance per the
  // one-close-per-modal convention.
  const closeTOccurrences = productDescriptionDetailModalSource.match(/T\('close', 'Close'\)/g) || []
  assert.equal(
    closeTOccurrences.length,
    1,
    'the bottom Close button (a second close affordance) must be removed -- only the header aria-label should remain',
  )
  assert.doesNotMatch(
    productDescriptionDetailModalSource,
    /border-t border-gray-200 p-4 dark:border-gray-700/,
    'the footer wrapper that only ever held the duplicate Close button must be removed entirely, not just its button',
  )
})

runTest('mobile:F4 -- RenameCascadeModal panel clears the home indicator', () => {
  assert.match(
    renameCascadeModalSource,
    /overflow-y-auto rounded-t-2xl bg-white shadow-2xl pb-\[env\(safe-area-inset-bottom\)\][\s\S]{0,60}dark:bg-gray-800[\s\S]{0,60}sm:pb-0/,
    'the sheet panel must carry pb-[env(safe-area-inset-bottom)] sm:pb-0 -- its last control (Cancel) sat flush with the home indicator',
  )
})

runTest('i18n:16 -- the POS "+" new-order tab title has a translation key ready in both packs', () => {
  // POS.tsx:3351 (title="New order") is owned by sibling lanes (salesfix /
  // additems both hold open hunks in POS.tsx) so the JSX swap itself is left
  // as an addendum for the coordinator -- but the key must exist in both
  // packs now so that follow-up edit is a pure `t('pos_new_order_tab')`
  // swap with no i18n work left over.
  assert.equal(typeof enLang.pos_new_order_tab, 'string', 'en.json must define pos_new_order_tab')
  assert.ok(enLang.pos_new_order_tab.trim().length > 0, 'pos_new_order_tab (en) must not be empty')
  assert.equal(typeof kmLang.pos_new_order_tab, 'string', 'km.json must define pos_new_order_tab')
  assert.ok(kmLang.pos_new_order_tab.trim().length > 0, 'pos_new_order_tab (km) must not be empty')
  assert.notEqual(
    kmLang.pos_new_order_tab,
    enLang.pos_new_order_tab,
    'km.json must carry a real Khmer translation, not a copy of the English fallback',
  )
})

if (failed > 0) {
  process.exitCode = 1
}
