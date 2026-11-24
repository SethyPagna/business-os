// Storefront dock lane, D3 (owner A62, A63, 21 Nov 2026): About shows one details card right under the story (address, the chat rows, the account rows,
// each a tappable row with the real value) and, beside it on a wide screen, the live Google map with the address line and one "Open in Maps"
// button. The map loads when the tab is shown: no consent click.
//
// LEGAL DEPENDENCY: this composes only together with the cookie-policy change in lane/web-legal-translate-safe (the policy used to say Google
// loads only after a tap).
//
// Run: node tests/portalAboutDetails.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getPortalLanguageText, resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { buildPortalContactEntries, buildPortalSocialFromConfig } from '../src/components/catalog/portalSocialLinks.ts'
import { SRC, storefrontTranslator } from './storefrontCopyScan.ts'

const requireActual = createRequire(import.meta.url)
const t = storefrontTranslator()
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
const tabsModule = loadModule('components/catalog/CatalogSecondaryTabs.tsx')
const Tabs = tabsModule.default as React.ComponentType<Record<string, unknown>>
const portalMapOpenHref = tabsModule.portalMapOpenHref as (link: unknown, address: unknown) => string

const CONFIG = {
  links: { website: 'https://leang.example', facebook: 'https://facebook.com/leangcosmetics', instagram: 'https://instagram.com/leanggirlactik', telegram: 'https://t.me/Leangcosmetic?direct' },
  linkLabels: {}, contactLinks: { messenger: 'https://m.me/leangcosmetics', telegram: 'https://t.me/Leangcosmetic?direct', whatsapp: '', phone: '', instagram: '' }, contactLinkLabels: {},
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true, showContactMessenger: true, showContactTelegram: true, showContactWhatsapp: false, showContactPhone: false, showContactInstagram: false,
}
const built = buildPortalSocialFromConfig(CONFIG, 'en')
const { chat, accounts } = buildPortalContactEntries({ social: built.social, contact: built.contact, phone: '012 345 678', shopName: 'Leang Cosmetics', language: 'en' })
const MAP = 'https://www.google.com/maps/embed?pb=!1m18'
const aboutHtml = (language: 'en' | 'km', over: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(Tabs, {
  tab: 'about', copy: copyFor(language), openPortalImage: () => {},
  previewConfig: { businessName: 'Leang Cosmetics', aboutContent: 'Our story.', showLogo: false, showCover: false, aboutBlocks: [{ id: 1, title: 'Chapter one', body: 'Body' }] },
  addressFact: { key: 'address', label: 'Address', value: '12 Street 271, Phnom Penh', href: 'https://maps.app.goo.gl/abc' },
  contactEntries: chat, accountEntries: accounts, mapEmbedUrl: MAP, ...over,
}))
const rowsIn = (html: string) => [...html.matchAll(/data-portal-contact-platform="([a-z]+)"/g)].map((match) => match[1])

for (const language of ['en', 'km'] as const) {
  check(`${language}: the details card is right after the story and before the About blocks`, () => {
    const html = aboutHtml(language)
    const story = html.indexOf('Our story.')
    const card = html.indexOf('data-portal-about-details="true"')
    const block = html.indexOf('Chapter one')
    assert.ok(story > -1 && card > story && block > card, 'story, card, blocks')
    // control: without chat, accounts and address the card is not drawn at all
    assert.equal(aboutHtml(language, { contactEntries: [], accountEntries: [], addressFact: null, mapEmbedUrl: '' }).includes('data-portal-about-details'), false)
  })

  check(`${language}: the card holds the address, the chat rows, then the account rows, each with its real value and no account twice`, () => {
    const html = aboutHtml(language)
    const card = html.slice(html.indexOf('data-portal-contact-tray="true"'), html.indexOf('data-portal-map-card="true"'))
    assert.ok(card.includes('12 Street 271, Phnom Penh'), 'the address')
    assert.ok(card.indexOf('data-portal-about-address') < card.indexOf('data-portal-contact-platform='), 'address first')
    // chat rows (phone, messenger, telegram) then accounts (facebook, instagram, website); the one Telegram account is not repeated
    assert.deepEqual(rowsIn(card), ['phone', 'messenger', 'telegram', 'facebook', 'instagram', 'website'])
    for (const label of ['012 345 678', 'leangcosmetics', 'Leangcosmetic', 'leanggirlactik']) assert.ok(card.includes(label), label)
    assert.equal((card.match(/Leangcosmetic</g) || []).length, 1, 'Telegram is on the card once')
    assert.ok(!card.includes('>@'), 'no "@" in any visible name')
    assert.ok(card.includes('href="https://maps.app.goo.gl/abc"'), 'the address row opens the shop map link')
    // control: the same Telegram account handed in a second time is still shown once
    const doubled = aboutHtml(language, { accountEntries: [...accounts, ...chat.filter((entry) => entry.platform === 'telegram')] })
    assert.equal((doubled.match(/Leangcosmetic</g) || []).length, 1)
    // control: with no chat rows the account Telegram row shows instead
    assert.ok(rowsIn(aboutHtml(language, { contactEntries: [] })).includes('telegram'))
  })

  check(`${language}: the shop's e-mail is a row on the card when the owner shows it (Show email), and absent when not`, () => {
    const shown = aboutHtml(language, { emailText: 'hello@leang.example' })
    const card = shown.slice(shown.indexOf('data-portal-contact-tray="true"'), shown.indexOf('data-portal-map-card="true"'))
    assert.match(card, /<a href="mailto:hello@leang\.example"[^>]*data-portal-about-email=""/)
    assert.match(card, /<span translate="no" class="notranslate[^"]*">hello@leang\.example<\/span>/, 'the address is never translated')
    assert.equal(aboutHtml(language).includes('data-portal-about-email'), false, 'control: no e-mail, no row')
    // the e-mail alone is enough to draw the card
    assert.ok(aboutHtml(language, { contactEntries: [], accountEntries: [], addressFact: null, mapEmbedUrl: '', emailText: 'hello@leang.example' }).includes('data-portal-about-email'))
  })

  check(`${language}: the live map is an iframe at first paint (no consent click), lazy, with the address line and one Open in Maps button`, () => {
    const html = aboutHtml(language)
    assert.ok(/<iframe[^>]*src="https:\/\/www\.google\.com\/maps\/embed\?pb=!1m18"/.test(html), 'the map iframe is in the first markup')
    assert.ok(/<iframe[^>]*referrerPolicy="strict-origin-when-cross-origin"/.test(html), 'referrer policy')
    assert.ok(/<iframe[^>]*sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/.test(html), 'the map frame is sandboxed')
    assert.ok(/<iframe[^>]*title="[^"]+"/.test(html), 'title kept')
    assert.ok(/<iframe[^>]*loading="lazy"/.test(html), 'lazy')
    assert.ok(html.includes('aspect-[4/3]') && html.includes('sm:aspect-video'), '4:3 on a phone, 16:9 wide')
    const label = copyFor(language)('openInMaps', 'Open in Maps', 'បើកក្នុងផែនទី')
    assert.equal(html.split(`>${label}</span>`).length - 1, 1, 'one Open in Maps button')
    assert.doesNotMatch(html, /Load map|ផ្ទុកផែនទី|Google Maps sets its own cookies|data-portal-map-consent/, 'no consent gate text')
    // control: no map configured, no iframe and no Open in Maps button
    const none = aboutHtml(language, { mapEmbedUrl: '' })
    assert.equal(none.includes('<iframe'), false)
    assert.equal(none.includes(`>${label}</span>`), false)
  })
}

check('Open in Maps refuses a link that is not http or https, and falls back as for an empty link', () => {
  for (const hostile of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'ftp://example.com/a', '//example.com/a']) {
    assert.equal(portalMapOpenHref(hostile, ''), '', hostile)
    assert.equal(portalMapOpenHref(hostile, '12 Street 271'), 'https://www.google.com/maps/search/?api=1&query=12%20Street%20271', hostile)
  }
  assert.equal(portalMapOpenHref('http://maps.example.com/a', ''), 'http://maps.example.com/a', 'control: http is the callers rule too')
  const html = aboutHtml('en', { addressFact: { key: 'address', label: 'Address', value: '12 Street 271', href: 'javascript:alert(1)' } })
  assert.equal(html.toLowerCase().includes('javascript:'), false)
})

check('Open in Maps goes to the shop link, else a maps search for the address, else nowhere', () => {
  assert.equal(portalMapOpenHref('https://maps.app.goo.gl/abc', '12 Street'), 'https://maps.app.goo.gl/abc')
  assert.equal(portalMapOpenHref('', '12 Street 271'), 'https://www.google.com/maps/search/?api=1&query=12%20Street%20271')
  assert.equal(portalMapOpenHref('', ''), '')
  const search = aboutHtml('en', { addressFact: { key: 'address', label: 'Address', value: '12 Street 271', href: '' } })
  assert.ok(search.includes('href="https://www.google.com/maps/search/?api=1&amp;query=12%20Street%20271"'))
})

check('the new key has Khmer in the storefront pack and the retired keys are gone', () => {
  assert.equal(getPortalLanguageText('km', 'openInMaps'), 'បើកក្នុងផែនទី')
  assert.equal(getPortalLanguageText('km', 'openInGoogleMaps'), '')
  assert.equal(getPortalLanguageText('km', 'callUs'), '')
})

console.log(`portalAboutDetails: ${passed} checks passed`)
