// Owner phone screenshot report (leangbeauty.com, Products tab, ~400px wide,
// Android Chrome), 2026-09-15: the letter rail blocked content and its
// section-title rules ran under it; the three social icons wrapped to a
// second row; the contact FAB had no minimize control; the pagination row
// was ordered wrong and duplicated the results count on a separate line with
// a dead hint sentence; and the storefront had no add-to-home-screen offer
// at all. Each check below names the wrong shape it catches.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(here, '..', rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>

// Comments legitimately name tokens the real code must not contain (e.g. this
// file's own IosInstallHint.tsx explains it no longer duplicates
// beforeinstallprompt handling, using that very word to say so).
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')

const catalogProductsSection = read('src/components/catalog/CatalogProductsSection.tsx')
const catalogPreviewSurface = read('src/components/catalog/CatalogPreviewSurface.tsx')
const publicCatalogPage = read('src/components/catalog/PublicCatalogPage.tsx')
const paginationControls = read('src/components/shared/PaginationControls.tsx')
const catalogPagination = read('src/components/catalog/catalogPagination.tsx')
const installPromptBand = read('src/components/shared/InstallPromptBand.tsx')
const iosInstallHint = read('src/components/shared/IosInstallHint.tsx')
const alphaIndexRail = read('src/components/shared/AlphaIndexRail.tsx')
const publicPortalCss = read('src/styles/public-portal.css')
const en = readJson('src/lang/en.json') as Record<string, unknown>
const km = readJson('src/lang/km.json') as Record<string, unknown>

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- 1. The alpha rail must not run under page content ---------------------

check('1 the public product grid reserves a gutter for the screen-edge rail', () => {
  // CATCHES: a right-aligned line (the brand-header rule, the results count)
  // reaching the real viewport edge, where the `fixed` (not laid-out) rail
  // sits -- the admin editor preview's `inline` variant already reserves its
  // own `w-9` track; the storefront's `screen` variant never reserved
  // anything until this fix.
  assert.match(
    catalogProductsSection,
    /const railGutterActive = publicView && initialOptions\.length > 1/,
    'the gutter must be scoped to exactly where AlphaIndexRail actually mounts',
  )
  assert.match(
    catalogProductsSection,
    /pr-\[calc\(1\.75rem\+env\(safe-area-inset-right\)\)\]/,
    'the gutter must clear both the rail width and the notch',
  )
  assert.match(
    catalogProductsSection,
    /className=\{`min-w-0 \$\{railGutterClass\}`\}/,
    'the gutter class must actually apply to the content column, not just be declared',
  )
})

// --- 1b. The rail's (and header icons') own tap-target floor must not -------
//         repaint them oversized --------------------------------------------

// Isolates the `@media (pointer: coarse) { ... }` block by brace-counting
// from its opening `{`, rather than guessing an end offset from a nearby
// string -- CSS has no comment-stripping concern here (public-portal.css's
// comments are /* */ only, and none of them contain a bare `{` or `}`).
function extractMediaBlock(css: string, atRule: string): string {
  const start = css.indexOf(atRule)
  assert.ok(start > -1, `${atRule} must exist in public-portal.css`)
  const braceStart = css.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  throw new Error(`${atRule} block never closes`)
}

const coarsePointerBlock = extractMediaBlock(publicPortalCss, '@media (pointer: coarse)')

check('1b the alpha rail is exempt from the coarse-pointer 44px aria-label floor', () => {
  // CATCHES: public-portal.css's `@media (pointer: coarse)` block forces
  // min-width/min-height:44px on every `button[aria-label]` on the real
  // storefront root -- and every rail entry carries an aria-label (its
  // accessible name), so the collapsed `h-0.5 w-2.5` dashes and expanded
  // `h-5 w-6` letters were silently repainted as a column of blank 44x44
  // grey circles that blocked the page underneath (owner, 2026-09-15,
  // image 3). The gutter fix (check 1) reserves layout space for the rail;
  // it does nothing about the rail's own entries being oversized.
  assert.match(
    alphaIndexRail,
    /data-alpha-rail=""/,
    'the rail container must carry a stable attribute the CSS exemption can key off',
  )
  assert.match(coarsePointerBlock, /\[data-alpha-rail\] button/, 'the rail exemption must live inside the SAME pointer:coarse block as the 44px floor it overrides')
  assert.match(
    coarsePointerBlock,
    /body\[data-public-portal='true'\] \[data-alpha-rail\] button,[\s\S]{0,120}\[data-public-media-protection='true'\] \[data-alpha-rail\] button \{[\s\S]{0,80}min-width: 0;[\s\S]{0,40}min-height: 0;/,
    'the exemption must cover BOTH storefront roots (admin body[data-public-portal] preview and the real PublicCatalogPage.tsx marker) and revert min-width/min-height to 0 so entries keep their own intrinsic sizes',
  )
})

check('1c the header social/account icon rows are exempt from the same floor', () => {
  // CATCHES: the header's social-links and wishlist/account/language/theme
  // rows intentionally shrink to h-8/h-9 (32/36px) below `sm` so they fit on
  // one row (check 2) -- every icon in them carries an aria-label too, so
  // without this exemption the 44px floor silently re-widens them past that
  // width and reopens the same overflow the nowrap fix closed.
  assert.equal(
    (catalogPreviewSurface.match(/data-portal-header-icons=""/g) || []).length,
    2,
    'BOTH icon rows (social links and wishlist/account/language/theme) must carry the exemption hook',
  )
  assert.match(coarsePointerBlock, /\[data-portal-header-icons\] a\[aria-label\]/, 'the header-icon exemption must live inside the SAME pointer:coarse block as the 44px floor')
  assert.match(
    coarsePointerBlock,
    /\[data-portal-header-icons\] a\[aria-label\],[\s\S]{0,400}\[data-portal-header-icons\] button\[aria-label\][\s\S]{0,200}min-width: 0;[\s\S]{0,40}min-height: 0;/,
    'the exemption must cover both <a> and <button> icons (social links are anchors, account/wishlist/theme are buttons) and revert to 0',
  )
})

// --- 2. Social icons on one row ---------------------------------------------

check('2 the header icon rows never wrap on a phone', () => {
  // CATCHES `flex-wrap` splitting Facebook/Instagram from Telegram (or
  // wishlist/account from language/theme) onto a second row at 320-375px.
  assert.ok(!/flex min-w-0 flex-wrap items-center/.test(catalogPreviewSurface), 'the social-links row must not wrap')
  assert.ok(!/flex flex-wrap items-center justify-end/.test(catalogPreviewSurface), 'the account-side row must not wrap')
  assert.match(catalogPreviewSurface, /flex min-w-0 flex-nowrap items-center gap-0\.5 sm:gap-1/, 'social links: nowrap + shrunk gap below sm')
  assert.match(catalogPreviewSurface, /flex flex-nowrap items-center justify-end gap-0\.5 sm:gap-1/, 'account-side icons: nowrap + shrunk gap below sm')
  // Every icon button in both rows shrinks one size below `sm` rather than
  // wrapping -- catches a partial fix that stops wrapping but overflows the
  // header instead.
  const iconButtonCount = (catalogPreviewSurface.match(/h-8 w-8 shrink-0 items-center justify-center rounded-full/g) || []).length
    + (catalogPreviewSurface.match(/inline-flex h-8 w-8 shrink-0/g) || []).length
  assert.ok(iconButtonCount >= 4, `expected at least 4 shrink-below-sm icon buttons, found ${iconButtonCount}`)
})

// --- 3. Contact FAB minimize ------------------------------------------------

check('3 the contact FAB has a minimize control with a per-viewer memory', () => {
  assert.match(publicCatalogPage, /CONTACT_MINIMIZED_STORAGE_KEY = 'business-os-portal-contact-minimized-v1'/, 'the minimized flag must be versioned')
  assert.match(publicCatalogPage, /const \[contactMinimized, setContactMinimizedState\] = useState/, 'minimize must be real state, not a CSS-only hover trick')
  assert.match(publicCatalogPage, /window\.localStorage\?\.setItem\(CONTACT_MINIMIZED_STORAGE_KEY/, 'minimize must persist per viewer')
  // The X control must exist and be reachable on touch (not hover-only),
  // per the owner's "always reachable on touch" requirement.
  assert.match(publicCatalogPage, /setContactMinimized\(true\)/, 'there must be a control that minimizes the button')
  assert.match(publicCatalogPage, /opacity-100[^"]*\[@media\(hover:hover\)\]:opacity-0[^"]*\[@media\(hover:hover\)\]:group-hover:opacity-100/, 'the X must default visible and only hide-until-hover on genuine hover-capable pointers')
  // Restoring from the minimized tab.
  assert.match(publicCatalogPage, /onClick=\{\(\) => setContactMinimized\(false\)\}/, 'tapping the minimized tab must restore the full button')
})

check('3 the minimize/restore labels exist in both language packs', () => {
  const pagesEn = en.pages as Record<string, unknown>
  const pagesKm = km.pages as Record<string, unknown>
  const portalEditor = (pagesEn?.portalEditor as { contactUsMinimize?: string; contactUsRestore?: string } | undefined)
  const portalEditorKm = (pagesKm?.portalEditor as { contactUsMinimize?: string; contactUsRestore?: string } | undefined)
  assert.ok(portalEditor?.contactUsMinimize, 'en.json must carry portalEditor.contactUsMinimize')
  assert.ok(portalEditor?.contactUsRestore, 'en.json must carry portalEditor.contactUsRestore')
  assert.ok(portalEditorKm?.contactUsMinimize && portalEditorKm.contactUsMinimize !== portalEditor?.contactUsMinimize, 'km.json must carry a REAL Khmer translation, not the English string')
  assert.ok(portalEditorKm?.contactUsRestore && portalEditorKm.contactUsRestore !== portalEditor?.contactUsRestore, 'km.json must carry a REAL Khmer translation, not the English string')
})

// --- 4. Pagination row order + results count + dead hint removed ----------

check('4 the storefront pager reads Back, page size, page/total, Next', () => {
  const centeredBranch = paginationControls.slice(
    paginationControls.indexOf("if (layout === 'centered') {"),
    paginationControls.indexOf("if (compact && rangeAsPageSize) {"),
  )
  const backIndex = centeredBranch.indexOf('aria-label={backLabel}')
  const sizeSelectIndex = centeredBranch.indexOf('<PageSizeSelect')
  // The FIRST `aria-label={pageLabel}` in this branch is the enclosing
  // <nav>'s own accessible name, not the editable page box -- search past it.
  const pageBoxIndex = centeredBranch.indexOf('aria-label={pageLabel}', centeredBranch.indexOf('aria-label={pageLabel}') + 1)
  const nextIndex = centeredBranch.indexOf('aria-label={nextLabel}')
  assert.ok(backIndex > -1 && sizeSelectIndex > -1 && pageBoxIndex > -1 && nextIndex > -1, 'all four controls must exist')
  assert.ok(
    backIndex < sizeSelectIndex && sizeSelectIndex < pageBoxIndex && pageBoxIndex < nextIndex,
    `expected Back < size select < page box < Next in source order, got ${JSON.stringify({ backIndex, sizeSelectIndex, pageBoxIndex, nextIndex })}`,
  )
})

check('4 the results count renders on the same row as the pill, not a second line', () => {
  assert.match(paginationControls, /resultsCount\?: string/, 'PaginationControls must accept an opt-in results count')
  const centeredBranch = paginationControls.slice(
    paginationControls.indexOf("if (layout === 'centered') {"),
    paginationControls.indexOf("if (compact && rangeAsPageSize) {"),
  )
  assert.match(centeredBranch, /<nav className=\{`flex w-full flex-wrap items-center justify-center gap-2/, 'the count must sit in the SAME <nav> row as the pill')
  assert.match(centeredBranch, /\{resultsCount \? \(/, 'the count must be conditionally rendered beside the pill')
  assert.match(catalogPagination, /resultsCount\?: string/, 'the storefront wrapper must forward resultsCount')
  assert.match(catalogPagination, /resultsCount=\{resultsCount\}/, 'the storefront wrapper must actually pass it through')
  assert.match(
    catalogProductsSection,
    /resultsCount=\{replaceVars\(copy\('filterSummary', '\{count\} result\(s\)'\), \{ count: totalProducts \}\)\}/,
    'both pager mounts must supply the live total',
  )
})

check('4 the dead "Use quick filters" hint sentence is gone from source and both packs', () => {
  assert.ok(!/filterCompactHint/.test(catalogProductsSection), 'no remaining reference to the removed hint key')
  assert.ok(!Object.prototype.hasOwnProperty.call(en, 'filterCompactHint'), 'en.json top-level key must be removed')
  assert.ok(!Object.prototype.hasOwnProperty.call(km, 'filterCompactHint'), 'km.json top-level key must be removed')
  const enPortalEditor = (en.pages as Record<string, unknown>).portalEditor as Record<string, unknown>
  const kmPortalEditor = (km.pages as Record<string, unknown>).portalEditor as Record<string, unknown>
  assert.ok(!Object.prototype.hasOwnProperty.call(enPortalEditor, 'filterCompactHint'), 'en.json portalEditor key must be removed')
  assert.ok(!Object.prototype.hasOwnProperty.call(kmPortalEditor, 'filterCompactHint'), 'km.json portalEditor key must be removed')
  // filterSummary (the actual count, now on the pager row) must survive.
  assert.ok(Object.prototype.hasOwnProperty.call(en, 'filterSummary'), 'filterSummary must NOT have been deleted along with the hint')
})

// --- 5. Install prompt on the storefront + admin parity ---------------------

check('5 the storefront arms the install-prompt capture and link guard at mount', () => {
  // CATCHES: neither installer ever running for the public route, because
  // App.tsx (which arms them for admin) never mounts there -- see
  // PublicCatalogRoot.tsx.
  assert.match(publicCatalogPage, /const stopInstallPromptCapture = installBeforeInstallPromptCapture\(\)/, 'the storefront must arm the beforeinstallprompt capture')
  assert.match(publicCatalogPage, /const stopExternalLinkGuard = installStandaloneExternalLinkGuard\(\)/, 'the storefront must arm the standalone external-link guard')
  assert.match(publicCatalogPage, /stopInstallPromptCapture\(\)/, 'the capture teardown must run on unmount')
  assert.match(publicCatalogPage, /stopExternalLinkGuard\(\)/, 'the guard teardown must run on unmount')
})

check('5 the storefront mounts the shared install band, not a duplicate implementation', () => {
  assert.match(publicCatalogPage, /import InstallPromptBand from '\.\.\/shared\/InstallPromptBand\.tsx'/, 'must reuse the shared component')
  assert.match(publicCatalogPage, /<InstallPromptBand translate=\{\(key, fallback, fallbackKm\) => copy\(key, fallback, fallbackKm\)\}/, 'must adapt the storefront copy() into the shared translate signature')
  assert.match(publicCatalogPage, /\{installBand\}/, 'the band must actually be mounted in the render tree')
})

check('5 the admin app keeps the same install behaviour via the shared band', () => {
  assert.match(iosInstallHint, /<InstallPromptBand translate=\{\(key, fallback\) => t\(key\) \|\| fallback\}/, 'IosInstallHint must delegate to the shared band')
  assert.ok(!/beforeinstallprompt|shouldOfferIosInstallHint\(\)/.test(stripComments(iosInstallHint)), 'the device-detection logic must not be duplicated in the admin wrapper (comments may still explain the history)')
})

check('5 InstallPromptBand supplies real Khmer fallback text for every translated string, not the English default', () => {
  const calls = [...installPromptBand.matchAll(/translate\(\s*'([^']+)',\s*'[^']*',\s*'([^']*)'/g)]
  assert.ok(calls.length >= 3, 'expected install_app / ios_install_hint / ios_install_hint_detail / dismiss_notification calls')
  for (const [, key, khmerFallback] of calls) {
    assert.ok(/[ក-៿]/.test(khmerFallback), `translate('${key}', ...) must supply real Khmer script, not an English placeholder`)
  }
})

console.log(`\npublicStorefrontPhoneFixesSep15: ${failed === 0 ? 'all checks passed' : `${failed} check(s) FAILED`}`)
if (failed > 0) process.exit(1)
