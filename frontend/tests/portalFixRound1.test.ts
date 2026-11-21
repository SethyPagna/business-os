// Public web fix round 1: the About name clear of the banner, one primary-button recipe, clean category and brand names, the product
// sheet's two long paragraphs closed by default, one Contact on About, the Saved/List page in one 720 px column, and the names and numbers
// Google Translate must leave alone.
//
// Run: node tests/portalFixRound1.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PORTAL_PRIMARY_COLORS, PORTAL_PRIMARY_BUTTON } from '../src/components/catalog/portalButtons.ts'
import { PORTAL_TOKENS, contrastRatio } from '../src/components/catalog/portalContrast.ts'
import { portalPrimaryValue, portalValues, splitPortalValues } from '../src/components/catalog/portalMultiValue.ts'
import { buildPortalGroupHeaders } from '../src/components/catalog/portalBrowse.ts'
import { productMetaFields } from '../src/components/catalog/portalProductSurfaces.ts'

const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src')
const requireActual = createRequire(import.meta.url)
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
}
let failed = 0
function run(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const copy = (_key: string, fallback = '') => fallback

// ---- 2. one primary-button recipe ----
run('the primary recipe is ink with ivory text, swapped in dark, and both pairs clear 7:1', () => {
  const { light, dark } = PORTAL_TOKENS
  assert.ok(PORTAL_PRIMARY_COLORS.includes(`bg-[${light.ink}]`) && PORTAL_PRIMARY_COLORS.includes(`text-[${light.onInk}]`))
  assert.ok(PORTAL_PRIMARY_COLORS.includes(`dark:bg-[${dark.ink}]`) && PORTAL_PRIMARY_COLORS.includes(`dark:text-[${dark.onInk}]`))
  assert.ok(contrastRatio(light.onInk, light.ink) >= 7, 'light label')
  assert.ok(contrastRatio(dark.onInk, dark.ink) >= 7, 'dark label')
  assert.ok(contrastRatio(dark.ink, dark.ground) >= 7, 'the dark fill is visible on the black page')
  assert.ok(contrastRatio(light.ink, light.ground) >= 7, 'the light fill is visible on the ivory page')
  assert.doesNotMatch(PORTAL_PRIMARY_COLORS, /(?:neutral|slate|zinc)-\d/, 'main.css remaps those families with !important in dark mode')
  assert.ok(PORTAL_PRIMARY_BUTTON.includes(PORTAL_PRIMARY_COLORS))
})

run('every storefront primary button takes the recipe', () => {
  const files: Record<string, RegExp> = {
    'components/catalog/PortalDock.tsx': /CONTACT_BUTTON = `[^`]*\$\{PORTAL_PRIMARY_COLORS\}`/,
    'components/catalog/CatalogProductsSection.tsx': /: PORTAL_PRIMARY_COLORS\}/,
    'components/catalog/ProductDetailFlyout.tsx': /\$\{PORTAL_PRIMARY_BUTTON\} flex-1/,
    'components/catalog/CatalogAccountSection.tsx': /submitClass = `\$\{PORTAL_PRIMARY_BUTTON\}/,
    'components/catalog/CatalogSecondaryTabs.tsx': /CHARCOAL_BUTTON = PORTAL_PRIMARY_BUTTON/,
    'components/catalog/PortalListPage.tsx': /\$\{PORTAL_PRIMARY_BUTTON\} min-h-10/,
  }
  for (const [file, pattern] of Object.entries(files)) {
    const source = read(file)
    assert.match(source, pattern, `${file} uses the shared recipe`)
    assert.doesNotMatch(source, /bg-slate-900 text-white hover:|bg-emerald-700 px-4 py-2\.5|dark:bg-neutral-100 dark:text-neutral-950|dark:bg-amber-300 dark:text-neutral-900 dark:hover/, `${file} has no private primary recipe`)
  }
})

// ---- 3. category and brand names ----
run('every stored form of a category or brand becomes clean names', () => {
  assert.deepEqual(splitPortalValues('["Skincare"]'), ['Skincare'], 'JSON array text')
  assert.deepEqual(splitPortalValues('["Skincare","Gift Set"]'), ['Skincare', 'Gift Set'])
  assert.deepEqual(splitPortalValues('Skincare||Gift Set'), ['Skincare', 'Gift Set'], 'the form production writes')
  assert.deepEqual(splitPortalValues('Skincare'), ['Skincare'], 'one plain name')
  assert.deepEqual(splitPortalValues('"Skincare"'), ['Skincare'], 'a quoted name')
  assert.deepEqual(splitPortalValues(['Skincare', ' Gift Set ']), ['Skincare', 'Gift Set'], 'an array already')
  assert.deepEqual(splitPortalValues('[Body] Care'), ['[Body] Care'], 'a name that merely contains brackets stays as written')
  assert.deepEqual(splitPortalValues('[broken'), ['[broken'])
  assert.deepEqual(splitPortalValues('Rose||rose'), ['Rose'], 'duplicates differing in case collapse')
  assert.deepEqual(splitPortalValues(null), [])
  assert.deepEqual(portalValues('["Aurelia"]', 'Other'), ['Aurelia'])
  assert.deepEqual(portalValues('', '["Aurelia"]'), ['Aurelia'], 'the single column when the multi one is empty')
  assert.equal(portalPrimaryValue('["Skincare"]', 'Gift Set'), 'Skincare')
  assert.equal(portalPrimaryValue('', 'Gift Set||Skincare'), 'Gift Set')
})

run('card meta line, group headings and list rows print clean names', () => {
  const product = { category: '["Skincare"]', brand: '["Aurelia"]' }
  const meta = productMetaFields(product, { showCategory: true, showBrand: true, groupField: null, underGroupHeading: false })
  assert.deepEqual(meta.map((field) => field.text), ['Skincare', 'Aurelia'])
  const headers = buildPortalGroupHeaders([product, { category: 'Body', brand: 'Aurelia||Nova' }], { view: 'brand', promotedRun: 0, promotionsLabel: 'Promo', noBrandLabel: 'No brand', noCategoryLabel: 'No category' })
  assert.equal(headers.get(0), 'Aurelia')
  assert.equal(headers.size, 1, 'both products fall under the one clean brand heading')
  assert.match(read('components/catalog/portalBucket.ts'), /portalPrimaryValue\(product\.category, product\.categories\)/)
  assert.doesNotMatch(read('components/catalog/ProductDetailFlyout.tsx'), /split\('\|\|'\)/, 'the sheet has no private splitter')
})

// ---- 3 and 4. the product sheet ----
const Flyout = loadModule('components/catalog/ProductDetailFlyout.tsx').default as React.ComponentType<Record<string, unknown>>
const flyoutHtml = () => renderToStaticMarkup(React.createElement(Flyout, {
  copy, onClose: () => {}, shopName: 'Leang', language: 'en',
  view: {
    open: true, gallery: [], status: 'in_stock', showPrices: false,
    product: { id: 1, name: 'Toner', category: '["Skincare"]', brand: '["Aurelia"]', categories: '["Skincare"]', brands: '["Aurelia"]', description: 'Soft toner.\n\nCaution: Patch test first.' },
  },
}))

run('the sheet shows Category and Brand as plain names', () => {
  const html = flyoutHtml()
  assert.ok(html.includes('>Skincare<') && html.includes('>Aurelia<'))
  assert.doesNotMatch(html, /\[&quot;|\["/, 'no JSON brackets or quotes on the page')
})

run('Caution and Need More Details are closed rows with a chevron', () => {
  const html = flyoutHtml()
  for (const key of ['caution', 'need_more_details']) {
    const at = html.indexOf(`data-product-detail-section="${key}"`)
    assert.ok(at > -1, `${key} row exists`)
    const row = html.slice(at, at + 3000)
    assert.match(row, /<button[^>]*aria-expanded="false"[^>]*aria-controls="/, `${key} is a closed disclosure button`)
    assert.match(row, /lucide-chevron-down/, `${key} has a chevron`)
    assert.match(row, /hidden=""/, `${key} body is hidden until opened`)
  }
  assert.ok(html.indexOf('data-product-detail-section="caution"') < html.indexOf('data-product-detail-section="need_more_details"'))
  assert.ok(html.indexOf('Soft toner.') < html.indexOf('data-product-detail-section="caution"'), "the product's own text comes first")
})

// ---- 1 and 5. About ----
const Tabs = loadModule('components/catalog/CatalogSecondaryTabs.tsx').default as React.ComponentType<Record<string, unknown>>
const aboutHtml = (over: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(Tabs, {
  tab: 'about', copy, openPortalImage: () => {}, onOpenContact: () => {},
  previewConfig: { businessName: 'Leang Beauty', showLogo: false, showCover: false, ...over },
}))

run('About without a cover: the name never sits on the banner', () => {
  const html = aboutHtml()
  const bannerAt = html.indexOf('data-portal-about-hero="true"')
  const nameAt = html.indexOf('<h2')
  assert.ok(bannerAt > -1 && nameAt > bannerAt)
  const stack: string[] = []
  for (const match of html.slice(0, nameAt).matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi)) {
    const [, closing, tag, attrs, selfClose] = match
    if (['img', 'input', 'br', 'hr', 'meta', 'link', 'path', 'circle', 'line', 'polyline', 'rect'].includes(tag.toLowerCase()) || selfClose) continue
    if (closing) stack.pop()
    else stack.push(attrs)
  }
  assert.ok(stack.length > 0)
  assert.ok(!stack.some((attrs) => /-mt-/.test(attrs)), 'the name sits in a row with no negative top margin')
  assert.match(html, /-mt-11 sm:-mt-14/, 'the round logo still overlaps the banner edge')
})

run('About has no Contact button; the FAQ closing row keeps its own', () => {
  assert.doesNotMatch(aboutHtml(), />Contact</, 'the header Contact is the one entry point')
  const faq = renderToStaticMarkup(React.createElement(Tabs, {
    tab: 'faq', copy, previewConfig: { faqTitle: 'Questions' }, publicFaqItems: [], expandedFaqId: null, setExpandedFaqId: () => {}, onOpenContact: () => {},
  }))
  assert.match(faq, />Contact</)
  const about = read('components/catalog/CatalogSecondaryTabs.tsx')
  assert.doesNotMatch(about.slice(about.indexOf('function CatalogAboutSection'), about.indexOf('function FaqSkeleton')), /onOpenContact|PortalContactButton/)
})

// ---- 6. Saved / List ----
run('Saved and List sit in one centred 720 px column', () => {
  const source = read('components/catalog/PortalListPage.tsx')
  assert.match(source, /mx-auto w-full max-w-\[720px\]/)
  assert.doesNotMatch(source, /max-w-3xl/)
  assert.match(source, /grid min-w-0 flex-1 grid-cols-2/, 'the segments fill the column beside the back arrow')
  assert.match(source, /<PortalNoPaymentNotice copy=\{copy\} className="text-center" \/>/, 'the payment line is centred like the empty line')
})

// ---- 8. Google Translate ----
run('names and numbers are marked translate="no"; ordinary labels are not', () => {
  const { PortalSocialText } = loadModule('components/catalog/PortalSocialRow.tsx') as { PortalSocialText: React.ComponentType<Record<string, unknown>> }
  for (const latin of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(PortalSocialText, { text: 'ទំនាក់ទំនង', latin }))
    assert.match(html, /translate="no"/)
    assert.match(html, /notranslate/)
  }
  assert.doesNotMatch(aboutHtml(), /translate="no"[^>]*>About</, 'the About label stays translatable')
  const tabs = read('components/catalog/CatalogSecondaryTabs.tsx')
  assert.match(tabs, /<span translate="no" className="notranslate">\{item\.value\}<\/span>/, 'phone and address values')
  const combo = read('components/catalog/PortalFilterCombobox.tsx')
  assert.ok((combo.match(/translate="no" className="notranslate[^"]*detail-scroll-text|translate="no" className="notranslate min-w-0 detail-scroll-text/g) || []).length >= 3, 'option rows, group heading and selected chips')
  const account = read('components/catalog/CatalogAccountSection.tsx')
  assert.match(account, /<span translate="no" className="notranslate">\{account\.name\}<\/span>/)
  assert.match(account, /<span translate="no" className="notranslate">\{account\.membershipId\}<\/span>/)
  assert.match(read('components/catalog/PortalListPage.tsx'), /<div translate="no" \{\.\.\.getKhmerTextProps\(row\.name/)
})

run("the storefront hides Google's tooltip and highlight, and the body marker is set on the live path", () => {
  const css = read('styles/public-portal.css')
  assert.match(css, /body\[data-public-portal='true'\] #goog-gt-tt,\s*body\[data-public-portal='true'\] \.goog-tooltip \{\s*display: none !important;/)
  assert.match(css, /\.goog-text-highlight \{\s*background: none !important;\s*box-shadow: none !important;/)
  assert.match(read('components/catalog/PublicCatalogPage.tsx'), /body\.setAttribute\('data-public-portal', 'true'\)/)
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('PASS portalFixRound1')
