import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source-scan guard for Section 8a's image deterrence: honest browser
// deterrence (right-click-save / drag-out / iOS long-press-save blocked),
// explicitly NOT DRM -- a screenshot or devtools still works, this only
// removes the ordinary one-click "save this" paths. Centralized in
// frontend/src/utils/protectedMedia.ts's protectedImageProps() so every
// caller gets the same draggable={false} + onContextMenu + onDragStart +
// data-protected-media="true" bundle instead of re-implementing it, and so
// this test only needs to check for the one spread instead of four
// separate attributes per <img>.
//
// Scope: every file that renders an <img> reachable from either the real
// customer storefront (PublicCatalogPage.tsx's render tree) or the admin
// app's own avatar/cover views, per the Section 8a brief's explicit
// extension to "admin avatar/cover ... via one shared wrapper". Files that
// only render images inside admin-only editing chrome (CatalogEditorSurface
// the staff product/catalog editor, CatalogImageField the staff image
// upload/crop tool, ManagePromotionsModal the staff promotions manager) are
// deliberately OUT of scope -- protecting a merchant's own asset-management
// tooling against their own right-click/drag would only get in staff's way,
// and none of those three are ever rendered on a path a customer reaches
// (confirmed by grep: nothing outside CatalogEditorSurface.tsx imports
// CatalogImageField or ManagePromotionsModal, and nothing outside
// CatalogPage.tsx -- the admin editor shell -- imports
// CatalogEditorSurface).

const PROTECTED_PROPS_IMPORT = /import\s*\{[^}]*protectedImageProps[^}]*\}\s*from\s*['"](?:\.\.\/)*utils\/protectedMedia['"]/

// Files where every <img> must be fully protected: draggable={false},
// onContextMenu + onDragStart prevented, via the shared
// {...protectedImageProps()} spread. Covers the storefront's product
// thumbnails/gallery (catalogImages.tsx, shared/ImageGalleryLightbox.tsx --
// the default <img> fallback every caller except CatalogPreviewSurface.tsx
// goes through), the promo/banner/about/logo/cover images
// (CatalogProductsSection.tsx, CatalogSecondaryTabs.tsx,
// PortalPromotionsBanner.tsx), and the admin app's own avatar/cover views
// (UserProfileModal.tsx) that the coordinator explicitly asked to extend
// the same mechanism to.
const FULLY_PROTECTED_FILES = [
  '../src/components/catalog/catalogImages.tsx',
  '../src/components/shared/ImageGalleryLightbox.tsx',
  '../src/components/catalog/CatalogProductsSection.tsx',
  '../src/components/catalog/CatalogSecondaryTabs.tsx',
  '../src/components/catalog/PortalPromotionsBanner.tsx',
  '../src/components/users/UserProfileModal.tsx',
]

// Strip // line comments and /* */ block comments before scanning for
// JSX <img tags -- several of these files have prose comments that mention
// "<img>" in passing (documenting renderImage()'s return type, etc.), which
// a naive text split would misidentify as an actual tag to check.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

for (const relativePath of FULLY_PROTECTED_FILES) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const codeOnly = stripComments(source)

  assert.match(
    source,
    PROTECTED_PROPS_IMPORT,
    `${relativePath} should import protectedImageProps from utils/protectedMedia instead of hand-rolling drag/context-menu guards`,
  )

  // Split the code (comments blanked out) on each <img tag: everything up
  // to (but not including) the following <img (or end of file) is that
  // tag's own attribute list, which must carry the shared spread before
  // its closing `/>` or `>`.
  const imgTagCount = (codeOnly.match(/<img\b/g) || []).length
  assert.ok(imgTagCount > 0, `${relativePath} was expected to render at least one <img> -- update this test's scope if that's no longer true`)

  const segments = codeOnly.split(/<img\b/g).slice(1)
  segments.forEach((segment, index) => {
    const tagBody = segment.slice(0, segment.indexOf('/>') > -1 ? segment.indexOf('/>') : segment.indexOf('>'))
    assert.match(
      tagBody,
      /\{\.\.\.protectedImageProps\(\)\}/,
      `${relativePath}: <img> #${index + 1} should spread {...protectedImageProps()} instead of being left unprotected`,
    )
  })
}

// ProductForm.tsx's single product-photo thumbnail is deliberately a
// PARTIAL exception: the wrapping <div draggable={imageList.length > 1}>
// implements custom drag-to-reorder, and the thumbnail is itself the drag
// source for that gesture -- the full protectedImageProps() bundle
// (draggable={false} + onDragStart prevented) would silently break
// reordering, not just image drag-out. Only the right-click-save path is
// blocked here, via the shared preventContextMenu handler (still centralized
// in protectedMedia.ts, just not the full bundle).
const productFormSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')

assert.match(
  productFormSource,
  /import\s*\{[^}]*preventContextMenu[^}]*\}\s*from\s*['"](?:\.\.\/)*utils\/protectedMedia['"]/,
  'ProductForm.tsx should import preventContextMenu from utils/protectedMedia for its product-photo thumbnail',
)

assert.match(
  productFormSource,
  /<img\b[^>]*onContextMenu=\{preventContextMenu\}/,
  'ProductForm.tsx product-photo thumbnail should block right-click-save via the shared preventContextMenu handler',
)

// Guard the deliberate partial-protection choice itself: this thumbnail
// must NOT be draggable={false}, or the reorder gesture silently breaks.
assert.doesNotMatch(
  productFormSource,
  /<img\b[^>]*draggable=\{false\}/,
  'ProductForm.tsx product-photo thumbnail must stay draggable (it is the drag-to-reorder source) -- do not apply the full protectedImageProps() bundle here',
)

// protectedMedia.ts itself: pin the exact shape every caller above relies
// on, so a future edit that silently drops one of the four guards (e.g.
// removing onDragStart while leaving onContextMenu) fails here instead of
// only being caught by a live browser check.
const protectedMediaSource = readFileSync(new URL('../src/utils/protectedMedia.ts', import.meta.url), 'utf8')

assert.match(
  protectedMediaSource,
  /draggable:\s*false,/,
  'protectedImageProps() must set draggable: false',
)
assert.match(
  protectedMediaSource,
  /onContextMenu:\s*preventContextMenu,/,
  'protectedImageProps() must wire onContextMenu to preventContextMenu',
)
assert.match(
  protectedMediaSource,
  /onDragStart:\s*preventDragStart,/,
  'protectedImageProps() must wire onDragStart to preventDragStart',
)
assert.match(
  protectedMediaSource,
  /'data-protected-media':\s*'true',/,
  "protectedImageProps() must set data-protected-media='true' so it is reachable by both the app-wide main.css rule and PublicCatalogPage.tsx's capture-phase handlers",
)
assert.match(
  protectedMediaSource,
  /export function preventContextMenu\(event: MouseEvent\): void \{\s*event\.preventDefault\(\)\s*\}/,
  'preventContextMenu must actually call event.preventDefault()',
)
assert.match(
  protectedMediaSource,
  /export function preventDragStart\(event: DragEvent\): void \{\s*event\.preventDefault\(\)\s*\}/,
  'preventDragStart must actually call event.preventDefault()',
)

// The CSS hook must exist app-wide (main.css, loaded on every page) so the
// mechanism reaches plain admin views like UserProfileModal.tsx that never
// load the portal-scoped public-portal.css.
const mainCssSource = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
assert.match(
  mainCssSource,
  /\[data-protected-media=['"]true['"]\]\s*\{[\s\S]*?-webkit-user-drag:\s*none/,
  'main.css must define the app-wide [data-protected-media="true"] deterrence rule (drag/select/touch-callout none) so it reaches admin views outside the portal-scoped stylesheet',
)

console.log('PASS image deterrence: protectedImageProps() covers every storefront and admin avatar/cover <img>, ProductForm keeps its deliberate reorder-drag exception, and the CSS hook is wired app-wide')
