// Owner, 2026-09-25: "Default language of the public site = Khmer", with
// business name, brand names, product names, prices and owner-marked About
// text never machine-translated. Owner, 2026-09-27: English and Khmer only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_STOREFRONT_DEFAULT_LANGUAGE,
  PUBLIC_STOREFRONT_LANGUAGE_OPTIONS,
  readPublicStorefrontLanguage,
  storePortalLanguage,
} from '../src/components/catalog/portalLanguageOptions.ts'
import { getPortalLanguageText, resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { splitNoTranslateSegments, stripNoTranslateMarkers } from '../src/components/catalog/portalNoTranslate.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8')

type Globals = { window?: unknown; document?: unknown }
const globals = globalThis as unknown as Globals
const originalWindow = globals.window
const originalDocument = globals.document

function installBrowser({ stored, cookie = '', throwOnStorage = false }: { stored?: string | null; cookie?: string; throwOnStorage?: boolean }) {
  const data = new Map<string, string>()
  if (stored != null) data.set('business-os:portal-translate-target', stored)
  const storage = {
    getItem(key: string) {
      if (throwOnStorage) throw new Error('SecurityError')
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (throwOnStorage) throw new Error('SecurityError')
      data.set(key, value)
    },
    removeItem(key: string) { data.delete(key) },
  }
  globals.window = { localStorage: storage, location: { hostname: 'shop.example', pathname: '/' } }
  globals.document = { cookie, documentElement: { className: '' }, body: { className: '' } }
}

try {
  // 1. A first-time visitor opens in Khmer.
  installBrowser({ stored: null })
  assert.equal(PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
  assert.equal(readPublicStorefrontLanguage(), 'km')

  // 2. A visitor's own English or Khmer choice wins over the default, and a
  //    picker choice is remembered for the next visit.
  installBrowser({ stored: 'en' })
  assert.equal(readPublicStorefrontLanguage(), 'en')
  installBrowser({ stored: null })
  storePortalLanguage('en')
  assert.equal(readPublicStorefrontLanguage(), 'en')
  storePortalLanguage('km')
  assert.equal(readPublicStorefrontLanguage(), 'km')

  // 3. What older builds left behind -- a Google Translate language, the old
  //    picker's 'original', a googtrans cookie -- never beats the default.
  for (const stale of ['fr', 'zh-CN', 'nl', 'original']) {
    installBrowser({ stored: stale })
    assert.equal(readPublicStorefrontLanguage(), 'km', `stored ${stale}`)
  }
  installBrowser({ stored: null, cookie: 'googtrans=%2Fen%2Fde' })
  assert.equal(readPublicStorefrontLanguage(), 'km')

  // 4. Blocked site data (Safari private mode) still opens in Khmer, and a
  //    choice that cannot be saved does not throw.
  installBrowser({ stored: 'en', throwOnStorage: true })
  assert.equal(readPublicStorefrontLanguage(), 'km')
  assert.doesNotThrow(() => storePortalLanguage('en'))
} finally {
  globals.window = originalWindow
  globals.document = originalDocument
}

// 5. The picker: Khmer first, English second, nothing else.
assert.deepEqual(PUBLIC_STOREFRONT_LANGUAGE_OPTIONS.map((option) => option.value), ['km', 'en'])

// 6. Owner-marked About text.
assert.deepEqual(splitNoTranslateSegments('Welcome to [[Leang Cosmetics]], home of [[Leang Glow]].'), [
  { text: 'Welcome to ', noTranslate: false },
  { text: 'Leang Cosmetics', noTranslate: true },
  { text: ', home of ', noTranslate: false },
  { text: 'Leang Glow', noTranslate: true },
  { text: '.', noTranslate: false },
])
assert.deepEqual(splitNoTranslateSegments('No markers here.'), [{ text: 'No markers here.', noTranslate: false }])
assert.deepEqual(splitNoTranslateSegments('Broken [[marker'), [{ text: 'Broken [[marker', noTranslate: false }])
assert.deepEqual(splitNoTranslateSegments(''), [])
assert.equal(stripNoTranslateMarkers('Our [[Leang]] story'), 'Our Leang story')

// 7. Wiring: the live page opens in the stored-or-Khmer language, renders
//    its own text in it, and remembers a picker choice.
const page = read('src/components/catalog/PublicCatalogPage.tsx')
assert.match(page, /const \[pageLanguage, setPageLanguage\] = useState\(readPublicStorefrontLanguage\)/)
assert.match(page, /resolveStorefrontCopy\(pageLanguage, t, key, fallback, fallbackKm\)/, 'storefront copy must follow the page language')
const storefrontT = (key: string) => key
assert.equal(resolveStorefrontCopy('km', storefrontT, 'products', 'Products'), getPortalLanguageText('km', 'products'))
assert.equal(resolveStorefrontCopy('en', storefrontT, 'products', 'Products'), 'Products')
assert.match(page, /changePageLanguage=\{changePageLanguage\}/)
assert.match(page, /storePortalLanguage\(language\)\s*setPageLanguage\(language\)/, 'a picker choice must be remembered, not only set in state')

// 8. Never machine-translated: product names, brands, prices, business name.
const card = read('src/components/catalog/CatalogProductsSection.tsx')
assert.match(card, /translate="no"\s*\{\.\.\.getKhmerTextProps\(product\.name, `notranslate/, 'product name on the card is translatable')
assert.match(card, /chip\.kind === 'brand'[\s\S]{0,200}translate="no"/, 'brand chip on the card is translatable')
assert.match(card, /<div translate="no" className=\{`notranslate font-semibold[^`]*`\}>\s*\{pricePresentation\?\.primaryText\}/, 'card price is translatable')
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
assert.match(flyout, /id=\{titleId\} translate="no"/, 'detail title (product name) is translatable')
assert.match(flyout, /translate="no" className="notranslate text-xl font-semibold[^"]*">\s*\{view\.pricePresentation\.primaryText\}/, 'detail price is translatable')
const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
assert.match(surface, /<h1\s[^>]*translate="no"/, 'header business name is translatable')
const tabs = read('src/components/catalog/CatalogSecondaryTabs.tsx')
assert.match(tabs, /<OwnerText text=\{storyText\} \/>/, 'the About story ignores owner [[ ]] markers')

console.log('PASS storefront opens in Khmer, offers only Khmer and English, remembers the choice, and guards names/brands/prices')
