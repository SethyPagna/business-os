// Google Translate now rewrites the storefront on request, so what must never be translated has to
// carry the marker: product names, brand names, prices, the shop's name, account and contact
// names and phone numbers. This pins every place the redesign prints one of those and that
// already carries translate="no" (or the notranslate class), plus the language menu itself.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(frontend, 'src/components/catalog', relative), 'utf8')
const failures: string[] = []
const check = (name: string, run: () => void) => {
  try {
    run()
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  }
}

check('header: business name, tagline and the brand label are marked', () => {
  const surface = read('CatalogPreviewSurface.tsx')
  assert.match(surface, /<div className="notranslate truncate[^>]*translate="no"[^>]*>\s*\{displayConfig\.businessName\}/)
  assert.match(surface, /<h1[\s\S]{0,400}translate="no"/)
  assert.match(surface, /notranslate hidden truncate[^>]*translate="no"[^>]*>\s*\{displayConfig\.businessTagline\}/)
})

check('language menu: every label is marked, so a page translator never rewrites a language name', () => {
  assert.match(read('CatalogPreviewSurface.tsx'), /<span translate="no" className="notranslate">\{option\.label\}<\/span>/)
})

check('product card: name, brand chip and price are marked', () => {
  const card = read('CatalogProductsSection.tsx')
  assert.match(card, /translate="no"\s*title=\{productHeading\}/)
  assert.match(card, /<div translate="no" className=\{`notranslate min-w-0 break-words font-semibold[^`]*`\}>\s*\{pricePresentation\?\.primaryText\}/)
  assert.match(card, /<span className="notranslate min-w-0 break-words" translate="no">\{chip\.label\}<\/span>/)
})

check('product sheet: title, price and shop name are marked', () => {
  const flyout = read('ProductDetailFlyout.tsx')
  assert.match(flyout, /id=\{titleId\} translate="no"/)
  assert.match(flyout, /<div translate="no" className="notranslate text-xl font-semibold[^"]*">\s*\{view\.pricePresentation\.primaryText\}/)
  assert.match(flyout, /<div translate="no" className="notranslate font-medium[^"]*">\{shopName\}<\/div>/)
})

check('My List: the product name and the price are marked', () => {
  const list = read('PortalListPage.tsx')
  assert.match(list, /getKhmerTextProps\(row\.name, '[^']*\bnotranslate\b[^']*'\)\}>\{row\.name\}/)
  assert.match(list, /<div translate="no" className="notranslate[^"]*">\{row\.priceText\}<\/div>/)
})

check('About and the Assistant: the shop name, tagline, owner [[ ]] spans and recommended product rows are marked', () => {
  const tabs = read('CatalogSecondaryTabs.tsx')
  assert.match(tabs, /<span key=\{index\} translate="no" className="notranslate">\{segment\.text\}<\/span>/)
  assert.match(tabs, /<h2 className="notranslate[^"]*" translate="no">/)
  assert.match(tabs, /translate="no" className="notranslate text-sm font-semibold leading-6[^"]*">\{item\.name\}<\/div>/)
  assert.match(tabs, /<span translate="no" className="notranslate">\{priceLabel\}<\/span>/)
})

check('Contact menu: Latin account names and numbers are marked', () => {
  assert.match(read('PortalSocialRow.tsx'), /if \(latin\) return <span translate="no" lang="en" dir="ltr" className=\{`notranslate \$\{wrap\}`\}>/)
})

assert.deepEqual(failures, [], `no-translate markers:\n  ${failures.join('\n  ')}`)
console.log('PASS names, brands, prices, the shop name and the language menu carry the no-translate marker')
