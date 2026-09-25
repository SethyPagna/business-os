// Owner, 2026-09-25: "Default language of the public site = Khmer. For other
// languages ... use Google Translate", with business name, brand names,
// product names, prices and owner-marked About text never machine-translated.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_STOREFRONT_DEFAULT_LANGUAGE,
  PUBLIC_STOREFRONT_TRANSLATE_OPTIONS,
  isPublicStorefrontBuiltInLanguage,
  resolvePublicStorefrontLanguage,
} from '../src/components/catalog/portalLanguageOptions.ts'
import { readPublicStorefrontLanguage, readStoredTranslateTarget } from '../src/components/catalog/portalTranslateController.ts'
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
    setItem(key: string, value: string) { data.set(key, value) },
    removeItem(key: string) { data.delete(key) },
  }
  globals.window = { localStorage: storage, location: { hostname: 'shop.example', pathname: '/' } }
  globals.document = { cookie, documentElement: { className: '' }, body: { className: '' } }
}

try {
  // 1. A first-time visitor opens in Khmer. The generic reader answers
  //    'original' (= the merchant's English source) here, which is exactly the
  //    behaviour the owner asked to change -- the pair proves the new reader
  //    is the one that decides.
  installBrowser({ stored: null })
  assert.equal(PUBLIC_STOREFRONT_DEFAULT_LANGUAGE, 'km')
  assert.equal(readStoredTranslateTarget('en'), 'original')
  assert.equal(readPublicStorefrontLanguage('en', PUBLIC_STOREFRONT_DEFAULT_LANGUAGE), 'km')

  // 2. A visitor's own choice wins over the default.
  installBrowser({ stored: 'en' })
  assert.equal(readPublicStorefrontLanguage('en', 'km'), 'en')
  installBrowser({ stored: 'fr' })
  assert.equal(readPublicStorefrontLanguage('en', 'km'), 'fr')
  installBrowser({ stored: null, cookie: 'googtrans=%2Fen%2Fde' })
  assert.equal(readPublicStorefrontLanguage('en', 'km'), 'de')

  // 3. A stored 'original' was written by the old picker / cookie clearing,
  //    never by a visitor asking for English -- it does not beat the default.
  installBrowser({ stored: 'original' })
  assert.equal(readPublicStorefrontLanguage('en', 'km'), 'km')

  // 4. Blocked site data (Safari private mode) still opens in Khmer.
  installBrowser({ stored: 'en', throwOnStorage: true })
  assert.equal(readPublicStorefrontLanguage('en', 'km'), 'km')
} finally {
  globals.window = originalWindow
  globals.document = originalDocument
}

// 5. Routing: Khmer and English render directly; every other language
//    renders the page in the merchant's source language and goes to Google.
assert.deepEqual(resolvePublicStorefrontLanguage('km', 'en'), { pageLanguage: 'km', googleTarget: null })
assert.deepEqual(resolvePublicStorefrontLanguage('en', 'en'), { pageLanguage: 'en', googleTarget: null })
assert.deepEqual(resolvePublicStorefrontLanguage('original', 'en'), { pageLanguage: 'en', googleTarget: null })
// zh-CN has a hand-written CHROME pack, but no translation of the merchant's
// content -- it must go to Google, not to the partial pack.
assert.deepEqual(resolvePublicStorefrontLanguage('zh-cn', 'en'), { pageLanguage: 'en', googleTarget: 'zh-CN' })
assert.deepEqual(resolvePublicStorefrontLanguage('fr', 'en'), { pageLanguage: 'en', googleTarget: 'fr' })
assert.deepEqual(resolvePublicStorefrontLanguage('nl', 'km'), { pageLanguage: 'km', googleTarget: 'nl' })
assert.equal(isPublicStorefrontBuiltInLanguage('km'), true)
assert.equal(isPublicStorefrontBuiltInLanguage('zh-CN'), false)

// 6. The picker: Khmer first, English second, everything else Google.
assert.deepEqual(PUBLIC_STOREFRONT_TRANSLATE_OPTIONS.slice(0, 2).map((option) => [option.value, option.kind]), [['km', 'first_party'], ['en', 'first_party']])
assert.ok(PUBLIC_STOREFRONT_TRANSLATE_OPTIONS.slice(2).every((option) => option.kind === 'external'))
const pickerValues = PUBLIC_STOREFRONT_TRANSLATE_OPTIONS.map((option) => option.value)
for (const value of ['zh-CN', 'fr', 'ja', 'nl', 'ta']) assert.ok(pickerValues.includes(value), `${value} missing from the storefront picker`)
assert.ok(!pickerValues.includes('original'), 'the storefront picker offers a meaningless "Original"')
assert.equal(new Set(pickerValues).size, pickerValues.length, 'duplicate language in the storefront picker')

// 7. Owner-marked About text.
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

// 8. Wiring: the live page reads the new default, renders its own text in
//    the routed page language, and offers the storefront picker.
const page = read('src/components/catalog/PublicCatalogPage.tsx')
assert.match(page, /useState\(\(\) => readPublicStorefrontLanguage\('en', PUBLIC_STOREFRONT_DEFAULT_LANGUAGE\)\)/)
assert.match(page, /getPortalLanguageText\(pageLanguage, key\)/, 'storefront copy must follow the routed page language')
assert.doesNotMatch(page, /getPortalLanguageText\(translateTarget, key\)/)
assert.match(page, /allPublicTranslateOptions=\{PUBLIC_STOREFRONT_TRANSLATE_OPTIONS\}/)
assert.match(page, /changeTranslateTarget=\{changeTranslateTarget\}/, 'a picker choice must be remembered, not only set in state')
assert.match(page, /storePortalTranslatePreference\(/)

// 9. Never machine-translated: product names, brands, prices, business name.
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

console.log('PASS storefront opens in Khmer, routes other languages to Google Translate, and guards names/brands/prices')
