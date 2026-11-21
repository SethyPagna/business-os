// Storefront dock lane, D2 (owner A57, A58): Contact is the ways to message or call; accounts are information.
//   - the Contact panel (dock) holds only chat entries; accounts never go in it;
//   - no platform account is on one screen twice (About card + footer, FAQ rows + footer, List rows + footer, the live Telegram account);
//   - where a Contact button used to be, the real rows sit inline: the List page, the FAQ and "Forgot password?";
//   - the one Contact-opening button is the dock's.
// Each pin has a control: the same scan on a deliberately wrong input must fail.
//
// Run: node tests/portalContactSplit.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { buildPortalContactEntries, buildPortalSocialFromConfig, portalContactFooterLinks, portalFooterAccounts } from '../src/components/catalog/portalSocialLinks.ts'
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

const LIVE = {
  links: { website: 'https://leang.example', facebook: 'https://www.facebook.com/share/1EuXg47WiG', instagram: 'https://instagram.com/leanggirlactik', telegram: 'https://t.me/Leangcosmetic?direct' },
  linkLabels: {}, contactLinks: { messenger: 'https://m.me/leanggirlactik', telegram: 'https://t.me/Leangcosmetic?direct', whatsapp: '+85512345678', phone: '', instagram: '' }, contactLinkLabels: {},
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true,
  showContactMessenger: true, showContactTelegram: true, showContactWhatsapp: true, showContactPhone: false, showContactInstagram: true,
}
const built = buildPortalSocialFromConfig(LIVE, 'en')
const { chat, accounts } = buildPortalContactEntries({ social: built.social, contact: built.contact, phone: '012 345 678', shopName: 'Leang Cosmetics', language: 'en' })
const identity = (entry: { platform: string; label: string }) => `${entry.platform}|${entry.label.toLowerCase()}`
const duplicates = (list: string[]) => list.filter((item, index) => list.indexOf(item) !== index)

check('the panel holds only chat entries, in the order Phone, Messenger, Telegram, WhatsApp', () => {
  assert.deepEqual(chat.map((entry) => entry.platform), ['phone', 'messenger', 'telegram', 'whatsapp'])
  assert.deepEqual(chat.filter((entry) => ['facebook', 'instagram', 'tiktok', 'website'].includes(entry.platform)), [])
  // control: the account list does hold exactly those, so the filter above can find something
  assert.deepEqual(accounts.map((entry) => entry.platform), ['facebook', 'instagram', 'telegram', 'website'])
})

check('accounts never reach the panel: the dock, the page and the surface hand it only the chat list', () => {
  const page = read('components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /const \{ chat: contactEntries, accounts: accountEntries \} = buildPortalContactEntries\(/)
  const surfaceCall = /<CatalogPreviewSurface[\s\S]*?contactEntries=\{contactEntries\}/.exec(page)
  assert.ok(surfaceCall, 'the surface (and so the dock) gets contactEntries = the chat list')
  assert.doesNotMatch(page, /contactEntries=\{accountEntries\}|entries=\{accountEntries\}/, 'no account list is ever passed as chat entries')
  assert.match(read('components/catalog/PortalDock.tsx'), /<PortalContactMenu\s+entries=\{contactEntries\}/)
  assert.match(read('components/catalog/PortalContactMenu.tsx'), /chat entries only/, 'the panel documents that it is chat only')
  // control: a deliberately wrong page would match the forbidden pattern
  assert.match('<Dock contactEntries={accountEntries} />', /contactEntries=\{accountEntries\}/)
})

check('no platform account is on one screen twice (About, FAQ, List, other tabs), live config with the one Telegram account', () => {
  const screens: Array<{ tab: string; listOpen: boolean; inline: 'about' | 'chat' | 'none' }> = [
    { tab: 'about', listOpen: false, inline: 'about' },
    { tab: 'faq', listOpen: false, inline: 'chat' },
    { tab: 'products', listOpen: true, inline: 'chat' },
    { tab: 'products', listOpen: false, inline: 'none' },
    { tab: 'membership', listOpen: false, inline: 'none' },
  ]
  const onScreen = (screen: (typeof screens)[number]) => {
    const footer = portalFooterAccounts(accounts, chat, screen)
    // About: the details card holds the chat rows and the accounts; its Telegram account is the chat row (the card drops the second).
    const inline = screen.inline === 'about' ? [...chat, ...accounts] : screen.inline === 'chat' ? chat : []
    const cardDeduped = screen.inline === 'about' ? [...chat, ...accounts.filter((entry) => !chat.some((row) => identity(row) === identity(entry)))] : inline
    return [...cardDeduped, ...footer].map(identity)
  }
  for (const screen of screens) assert.deepEqual(duplicates(onScreen(screen)), [], `${screen.tab}${screen.listOpen ? ' + list' : ''}`)
  // control: the same screens WITHOUT the footer rule do repeat an account
  const naive = (screen: (typeof screens)[number]) => [...(screen.inline === 'chat' ? chat : []), ...accounts].map(identity)
  assert.ok(duplicates(naive(screens[1])).length > 0, 'the FAQ screen repeats Telegram when the footer lists every account')
  assert.ok(portalContactFooterLinks(portalFooterAccounts(accounts, chat, screens[3])).some((link) => link.platform === 'telegram'), 'and a screen with no chat rows keeps the Telegram account in the footer')
})

check('the List page shows the chat rows inline under the payment line, in English and Khmer; no Contact button', () => {
  const ListPage = loadModule('components/catalog/PortalListPage.tsx').default as React.ComponentType<Record<string, unknown>>
  const noop = () => {}
  const render = (language: 'en' | 'km', entries: unknown[]) => renderToStaticMarkup(React.createElement(ListPage, {
    copy: copyFor(language), segment: 'list', onSegment: noop, onBack: noop,
    listItems: [{ id: 1, name: 'Rose Cleanser', qty: 1 }], savedItems: [], imageFor: () => '', inList: () => true,
    onSetQty: noop, onRemoveFromList: noop, onClearList: noop, onAddSaved: noop, onRemoveSaved: noop, onClearSaved: noop,
    contactEntries: entries, onCopy: noop, onDownload: noop, copyState: 'idle',
  }))
  for (const language of ['en', 'km'] as const) {
    const html = render(language, chat)
    for (const entry of chat) assert.ok(html.includes(`href="${entry.href}"`), `${language}: ${entry.platform} row`)
    assert.ok(html.includes('translate="no"'), 'names are no-translate')
    assert.doesNotMatch(html, /data-portal-contact-trigger|aria-haspopup/, 'nothing opens a menu')
    assert.equal((html.match(/data-portal-contact-platform=/g) || []).length, 4)
    // control: no chat entries, no rows
    assert.doesNotMatch(render(language, []), /data-portal-contact-inline/)
  }
})

check('the FAQ shows the chat rows at the bottom and, when there are no questions, in the empty card', () => {
  const Tabs = loadModule('components/catalog/CatalogSecondaryTabs.tsx').default as React.ComponentType<Record<string, unknown>>
  const faq = (over: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Tabs, {
    tab: 'faq', copy: copyFor('en'), previewConfig: { faqTitle: 'Questions' }, expandedFaqId: null, setExpandedFaqId: () => {}, publicFaqItems: [{ id: 'a', question: 'Q1?', answer: 'A1' }], ...over,
  }))
  const withRows = faq({ contactEntries: chat })
  assert.equal((withRows.match(/data-portal-contact-platform=/g) || []).length, 4)
  assert.ok(withRows.indexOf('data-portal-faq-contact') < withRows.indexOf('data-portal-contact-platform='), 'the rows are in the closing card')
  const empty = faq({ publicFaqItems: [], contactEntries: chat })
  assert.equal((empty.match(/data-portal-contact-platform=/g) || []).length, 4)
  assert.equal((faq({}).match(/data-portal-contact-platform=/g) || []).length, 0, 'control: no chat entries, no rows')
})

check('"Forgot password?" shows the line and the chat rows inline, with no button', () => {
  const Account = loadModule('components/catalog/CatalogAccountSection.tsx').default as React.ComponentType<Record<string, unknown>>
  const noop = () => {}
  const render = (entries: unknown[]) => renderToStaticMarkup(React.createElement(Account, {
    copy: copyFor('en'), account: null, ready: true, busy: false, error: '', signIn: noop, signUp: noop, signOut: noop, clearError: noop, cartCount: 0, wishlistCount: 0, contactEntries: entries,
  }))
  const html = render(chat)
  assert.match(html, /data-portal-forgot-password-hint=""/)
  assert.equal((html.match(/data-portal-contact-platform=/g) || []).length, 4)
  assert.ok(html.indexOf('data-portal-forgot-password-hint') < html.indexOf('data-portal-contact-platform='), 'the line, then the rows')
  assert.doesNotMatch(html, /Forgot password\?<\/button>|data-portal-contact-trigger/, 'no Forgot-password button')
  const bare = render([])
  assert.match(bare, /data-portal-forgot-password-hint=""/, 'control: with no chat channel the line stands alone')
  assert.doesNotMatch(bare, /data-portal-contact-platform=/)
})

check('the dock Contact button is the one place that opens the panel', () => {
  for (const file of ['CatalogPreviewSurface.tsx', 'PublicCatalogPage.tsx', 'CatalogSecondaryTabs.tsx', 'PortalListPage.tsx', 'CatalogAccountSection.tsx']) {
    assert.doesNotMatch(read(`components/catalog/${file}`), /<PortalContactMenu|PortalContactAnchor|openContactSheet|PortalContactButton|onOpenContact/, `${file} opens no contact menu of its own`)
  }
  assert.match(read('components/catalog/PortalDock.tsx'), /<PortalContactMenu/, 'control: the dock does')
})

console.log(`portalContactSplit: ${passed} checks passed`)
