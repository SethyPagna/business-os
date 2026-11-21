// Storefront dock (owner asks A58, A59, A60, A65, 21 Nov 2026, spec D1). Pins:
//   - wide screens: a vertical stack, top to bottom Language, Theme, Account, Shop, Contact; Contact is the only filled button and the
//     only one with a visible word (translate="no"); the others are icon-only with an accessible name and no title tooltip;
//   - phones: ONE round button (aria-label Menu) carrying the List count; its menu has the rows Contact, My List, Saved, Account,
//     Language, Theme, each with its value (counts, name, language, Light/Dark) in a no-translate element;
//   - the Language menu: six options, the Google tag, and ONE note line at the bottom (a notice, not a button), in English and Khmer;
//   - the dock steps out of the way while a sheet is open; the header holds none of these controls and nothing at the top is sticky.
// Each pin is followed by a control: the same scan run on a deliberately wrong input, which must fail.
//
// Run: node tests/portalDock.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { PUBLIC_STOREFRONT_LANGUAGE_OPTIONS } from '../src/components/catalog/portalLanguageOptions.ts'
import { SRC, storefrontTranslator } from './storefrontCopyScan.ts'

const requireActual = createRequire(import.meta.url)
const t = storefrontTranslator()
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').split(String.fromCharCode(13)).join('')
const copyFor = (language: 'en' | 'km') => (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, t, key, fallback, fallbackKm)

let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    process.exitCode = 1
    console.log(`FAIL ${name}: ${(error as Error).message}`)
  }
}

function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
}
const dockModule = loadModule('components/catalog/PortalDock.tsx')
const Dock = dockModule.default as React.ComponentType<Record<string, unknown>>
const DockMenu = dockModule.DockMenuContent as React.ComponentType<{ props: Record<string, unknown>; closeMenu: () => void }>
const LanguageOptions = dockModule.LanguageOptions as React.ComponentType<Record<string, unknown>>

const noop = () => {}
const entries = [
  { key: 'phone-0', platform: 'phone', href: 'tel:012345678', label: '012 345 678', accessibleName: 'Phone: 012 345 678', latin: true },
  { key: 'telegram-1', platform: 'telegram', href: 'https://t.me/Leangcosmetic', label: 'Leangcosmetic', accessibleName: 'Telegram: Leangcosmetic', latin: true },
]
const baseProps = (language: 'en' | 'km', extra: Record<string, unknown> = {}) => ({
  copy: copyFor(language), darkMode: false, contactEntries: entries,
  onOpenAccount: noop, accountSignedIn: false, onOpenList: noop, onOpenWishlist: noop, listCount: 3, wishlistCount: 2,
  languageEnabled: true, languageOptions: PUBLIC_STOREFRONT_LANGUAGE_OPTIONS, activeLanguage: 'km', changePageLanguage: noop, toggleTheme: noop,
  ...extra,
})
const renderDock = (language: 'en' | 'km', extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(Dock, baseProps(language, extra)))
const renderMenu = (language: 'en' | 'km', extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(DockMenu, { props: baseProps(language, extra), closeMenu: noop }))

const orderOf = (html: string) => [...html.matchAll(/data-portal-dock-button="([a-z]+)"/g)].map((match) => match[1])
const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const rowLabels = (html: string) => [...html.matchAll(/<span class="min-w-0 flex-1 truncate">([^<]*)<\/span>/g)].map((match) => match[1])
const wide = (html: string) => html.slice(html.indexOf('data-portal-dock-wide'), html.indexOf('data-portal-dock-small'))

for (const language of ['en', 'km'] as const) {
  const copy = copyFor(language)

  check(`${language}: wide stack order is Language, Theme, Account, Shop, Contact; the phone button is last in the markup`, () => {
    const html = renderDock(language)
    assert.deepEqual(orderOf(html), ['language', 'theme', 'account', 'shop', 'contact', 'menu'])
    // control: a scan for a different order fails, and a dock without Language and Account really drops them
    assert.notDeepEqual(orderOf(html), ['contact', 'shop', 'account', 'theme', 'language', 'menu'])
    assert.deepEqual(orderOf(renderDock(language, { languageEnabled: false, onOpenAccount: undefined })), ['theme', 'shop', 'contact', 'menu'])
  })

  check(`${language}: Contact is the only filled button and the only one with a visible word, no-translate`, () => {
    const stack = wide(renderDock(language))
    const buttons = stack.split('<button').slice(1)
    assert.equal(buttons.length, 5)
    const filled = buttons.filter((button) => button.includes('bg-[#23201b]'))
    assert.equal(filled.length, 1, 'one filled (charcoal) button')
    assert.match(filled[0], /data-portal-dock-button="contact"/)
    assert.ok(filled[0].includes(`<span translate="no" class="notranslate">${copy('contactButton', 'Contact', 'ទាក់ទង')}</span>`), 'the word Contact, no-translate')
    for (const button of buttons.filter((item) => !item.includes('data-portal-dock-button="contact"'))) {
      assert.equal(visible(`<button${button}`.split('</button>')[0] + '</button>').replace(/\d+/g, '').trim(), '', 'the others hold an icon and at most a count, no word')
      assert.match(button, /aria-label="[^"]+"/, 'and carry an accessible name')
    }
    assert.doesNotMatch(stack, /\btitle="/, 'no title tooltip on any dock button')
    // control: the scan sees a word when one is added
    assert.notEqual(visible('<button><svg></svg>Shop</button>').replace(/\d+/g, '').trim(), '')
  })

  check(`${language}: the buttons are 48 px (round) on a wide screen and 56 px on a phone, and the phone button names itself`, () => {
    const html = renderDock(language)
    assert.equal((wide(html).match(/ h-12 w-12/g) || []).length, 4, 'four round 48 px buttons')
    assert.match(wide(html), /data-portal-dock-button="contact" class="[^"]*\bh-12\b/)
    const small = html.slice(html.indexOf('data-portal-dock-small'))
    assert.match(small, /h-14 w-14/)
    assert.ok(small.includes(`aria-label="${copy('dockMenu', 'Menu', 'ម៉ឺនុយ')}"`))
    assert.equal((small.match(/<button/g) || []).length, 1, 'exactly one button below md')
  })

  check(`${language}: the List count rides on the shop button and the menu button, and is absent at zero`, () => {
    const html = renderDock(language)
    assert.equal((html.match(/<span translate="no" class="notranslate absolute[^>]*>3<\/span>/g) || []).length, 2)
    assert.equal((renderDock(language, { listCount: 0 }).match(/rounded-full bg-rose-700/g) || []).length, 0)
  })

  check(`${language}: the phone menu rows are Contact, My List, Saved, Account, Language, Theme with their values`, () => {
    const html = renderMenu(language, { accountSignedIn: true, accountName: 'Sokha' })
    assert.deepEqual(rowLabels(html), [
      copy('contactButton', 'Contact', 'ទាក់ទង'),
      copy('bucketTitle', 'My List'),
      copy('saved', 'Saved'),
      copy('account', 'Account'),
      copy('dockLanguage', 'Language', 'ភាសា'),
      copy('dockTheme', 'Theme', 'របៀប'),
    ])
    assert.ok(html.includes('<span translate="no" class="notranslate">3</span>'), 'List count, no-translate')
    assert.ok(html.includes('<span translate="no" class="notranslate">2</span>'), 'Saved count')
    assert.ok(html.includes('<span translate="no" class="notranslate">Sokha</span>'), 'the signed-in name')
    assert.ok(html.includes('<span translate="no" class="notranslate">ភាសាខ្មែរ</span>'), 'the current language name in its own script')
    assert.ok(html.includes(`<span translate="no" class="notranslate">${copy('themeLight', 'Light', 'ភ្លឺ')}</span>`), 'the theme word')
    const dark = renderMenu(language, { darkMode: true })
    assert.ok(dark.includes(`>${copy('themeDark', 'Dark', 'ងងឹត')}</span>`), 'dark mode names itself and re-keys the word')
    assert.doesNotMatch(html, /aria-label="Menu"|title="/, 'the rows carry no tooltip')
    // control: without the account handler or a name the rows shrink and the Account value vanishes
    assert.deepEqual(rowLabels(renderMenu(language, { onOpenAccount: undefined, languageEnabled: false })).length, 4)
    assert.ok(!renderMenu(language, { accountSignedIn: false, accountName: 'Sokha' }).includes('>Sokha<'), 'a signed-out visitor never sees a name')
  })

  check(`${language}: the Language menu has the six options, the Google tags and one note line at the bottom`, () => {
    const html = renderToStaticMarkup(React.createElement(LanguageOptions, { copy, options: PUBLIC_STOREFRONT_LANGUAGE_OPTIONS, active: 'km', onPick: noop }))
    assert.equal((html.match(/<button/g) || []).length, 6, 'six options, and the note is no button')
    assert.equal((html.match(/>Google</g) || []).length, 4, 'the four Google tags stay')
    const note = copy('portalGoogleNote', 'Google translates the four marked languages. English and Khmer are the official text.', 'Google បកប្រែភាសាទាំងបួនដែលមានសញ្ញា។ អត្ថបទផ្លូវការគឺភាសាអង់គ្លេស និងខ្មែរ។')
    assert.ok(html.includes(note))
    assert.ok(html.lastIndexOf(note) > html.lastIndexOf('</button>'), 'the note is under the options')
    assert.match(html, /<p data-portal-google-note=""/, 'a paragraph, not a control')
    assert.notEqual(note, copyFor(language === 'en' ? 'km' : 'en')('portalGoogleNote', 'Google translates the four marked languages. English and Khmer are the official text.', 'Google បកប្រែភាសាទាំងបួនដែលមានសញ្ញា។ អត្ថបទផ្លូវការគឺភាសាអង់គ្លេស និងខ្មែរ។'), 'the two languages differ')
    assert.doesNotMatch(html, /aria-label=/, 'the group is named by aria-labelledby, never an aria-label on a container')
  })
}

check('hidden: the dock draws nothing while a sheet is open', () => {
  assert.equal(renderDock('en', { hidden: true }), '')
  assert.notEqual(renderDock('en', { hidden: false }), '')
})

check('the surface mounts the dock for the live page only, and hides it behind every sheet', () => {
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  assert.match(surface, /\{publicView \? \(\s*<PortalDock/, 'the Website Editor preview (publicView false) draws no dock')
  assert.match(surface, /hidden=\{dockHidden \|\| Boolean\(productGalleryView\.open \|\| portalImageView\.open \|\| productDetailView\?\.open\)\}/)
  const page = read('components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /dockHidden=\{accountOpen \|\| !!portalAccount\.consentRenewal\}/)
  const dock = read('components/catalog/PortalDock.tsx')
  assert.match(dock, /fixed bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\] right-\[calc\(1rem\+env\(safe-area-inset-right\)\)\] z-\[55\]/, 'bottom-right, above the home bar, under the sheets (z-60) and the lightbox (z-90)')
  assert.match(read('components/catalog/PortalSheet.tsx'), /fixed inset-0 z-\[60\]/, 'control: the sheets really are at z-60')
})

check('the header holds none of the six controls and nothing at the top is sticky or fixed', () => {
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  const header = surface.slice(surface.indexOf('<header className="portal-header-shell'), surface.indexOf('<nav'))
  const dockSource = read('components/catalog/PortalDock.tsx')
  for (const icon of ['Heart', 'ClipboardList', 'User', 'Globe', 'Moon', 'MessageCircle']) {
    assert.doesNotMatch(header, new RegExp('<' + icon + '\\b'), icon + ' left the header')
  }
  // control: the same icons are found in the dock file (Heart, User, Globe, Moon, MessageCircle); the old list clipboard became the shop bag
  for (const icon of ['Heart', 'User', 'Globe', 'Moon', 'MessageCircle', 'ShoppingBag']) assert.match(dockSource, new RegExp('\\b' + icon + '\\b'), icon + ' is in the dock')
  assert.doesNotMatch(dockSource, /ClipboardList/, 'one shop icon for List and Saved, not the clipboard')

  assert.doesNotMatch(surface, /className=[^\n]*\bsticky\b|position: 'fixed'|publicPortalNavPinned/, 'nothing at the top is sticky or pinned')
  assert.match(surface, /pb-\[calc\(7\.5rem\+env\(safe-area-inset-bottom\)\)\][^'`]*md:pb-\[calc\(19rem\+env\(safe-area-inset-bottom\)\)\]/, 'the page ends above the wide stack (tests/storefrontFooterClearance.test.ts holds the arithmetic)')
})

check('the new keys have Khmer in the storefront pack, equal to the call-site text', () => {
  const pack = read('components/catalog/portalLanguagePacks.ts')
  for (const key of ['dockMenu', 'dockLanguage', 'dockTheme', 'themeLight', 'themeDark', 'portalGoogleNote']) {
    assert.match(pack, new RegExp('\n    ' + key + ": '[^']*[ក-៿]"), key + ' has Khmer in portalLanguagePacks.ts')
  }
  assert.doesNotMatch(read('components/catalog/PortalDock.tsx'), /\bt\('/, 'the dock never reaches the admin pack')
})

console.log('portalDock: ' + passed + ' checks passed')
