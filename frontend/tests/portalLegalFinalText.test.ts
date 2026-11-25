// The final English of the storefront legal pages, decided 21 Nov 2026 (owner: keep Google Translate, say plainly that
// English and Khmer are the official text, protect the facts). FIXTURE below is the decided final English;
// every key must equal it byte for byte, so a later edit of the wording has to change this file on purpose.
//
//   1. every changed key equals the fixture (English), and has real Khmer that differs from the English
//   2. the official-text notice is a pack key, is rendered on all three pages under the dates, in both languages
//   3. the map-consent items are gone (storage row, revoke control, strings)
//   4. the footer takedown sentence points at the page and repeats no handle
//   5. KEEP-OFFICIAL: the cookie type cell is not translated
//
// Run: node tests/portalLegalFinalText.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { LEGAL_PAGE_ORDER, LEGAL_STORAGE_ROWS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(path.dirname(here), 'src')

const FIXTURE: Record<string, string> = {
  portal_legal_official_notice: "English and Khmer are the official text. The Simplified Chinese, Traditional Chinese, French and Spanish versions are machine translations by Google. If a translation differs, the English or Khmer text applies.",
  portal_legal_terms_returns_h: "Return policy",
  portal_legal_terms_nopayment_h: "You cannot pay on this site",
  portal_legal_terms_use_h: "Rules for using this site",
  portal_legal_terms_liability_h: "Limits of our liability",
  portal_legal_privacy_collect_h: "The data we keep",
  portal_legal_privacy_basis_h: "Your consent",
  portal_legal_privacy_sharing_h: "Who else receives your data",
  portal_legal_privacy_rights_h: "Your rights",
  portal_legal_privacy_children_h: "Minimum age",
  portal_legal_privacy_changes_h: "Changes to this policy",
  portal_legal_cookies_consent_h: "Necessary and third-party storage",
  portal_legal_cookies_table_h: "Full list of what this site stores",
  portal_legal_cookies_third_h: "Third-party services",
  portal_legal_identity_address: "Shop address",
  portal_legal_col_name: "Storage name",
  portal_legal_col_kind: "Storage type",
  portal_legal_col_lifetime: "How long it is kept",
  portal_legal_terms_prices_b: "Prices, offers and stock are a guide and can change without notice. Each branch has its own stock. The price and stock our staff confirm when you buy are the ones that apply.",
  portal_legal_terms_returns_b: "You can return an unopened item within 7 days. Bring the receipt.",
  portal_legal_terms_account_b: "Create an account only if you are 16 or older. You must be legally able to agree to these terms yourself. Give accurate details and keep your password private. Tell us if you think someone else is using your account. We pause any account that is misused.",
  portal_legal_terms_use_b: "Do not break into this site, overload it, collect its data with automated tools, or stop it from working normally. Do not send us or post anything unlawful, misleading or owned by someone else. Anything you send us must be yours, or you must have the owner's permission to share it.",
  portal_legal_terms_ip_b: "Brand names, trademarks, and any pictures or text the shop did not create belong to their owners. This page does not claim that the shop owns, or has a licence to reuse, every picture or text shown here. If you have a concern about specific content, contact the shop using the verified details above.",
  portal_legal_terms_liability_b: "We cannot promise that this catalogue is error-free or always available. As far as the law allows, we are not liable for indirect loss from using this site. Nothing in these terms limits your rights under Cambodian consumer protection law.",
  portal_legal_privacy_collect_list: "If you create an account, we keep your name, phone number, membership ID, and a one-way hash made from your password (the password itself is never stored). We also keep which version of our Privacy Policy and Terms you agreed to, when you agreed, and in which language. If you save products while signed in, we keep that list. If you ask the AI assistant a question, we keep the question and any preferences you share with the assistant. If you send us pictures for review (when that option is on), we keep them together with the platform name you give, your note and your consent. We do not keep billing information and never ask for it. Short-lived security records use one-way codes instead of raw IP addresses or phone numbers. Brief error reports go to Sentry.",
  portal_legal_privacy_why_b: "We keep your account details only to know who is who and to keep your account safe. We use security records only to stop password guessing and other misuse of this site. We use error reports only to fix problems.",
  portal_legal_privacy_basis_b: "Creating an account is your choice. Before you create one, we ask you to agree to this policy and the Terms & Conditions. To change your mind, ask us to close your account.",
  portal_legal_privacy_retention_b: "We delete security records after 1 day. You stay signed in for up to 399 days. If you use the site while signed in after the first 200 days, your sign-in starts again with a full 399 days. Signing out ends your sign-in at once. We delete the questions you ask the AI assistant after 30 days. We delete pictures sent for review 90 days after the review. If no one reviews them, we delete them 180 days after you send them. We keep a short record of each picture review. We keep your account until you ask us to close it. Sentry keeps error reports for a period that Sentry sets.",
  portal_legal_privacy_sharing_list: "Cloudflare hosts the site, its data, images and security records. Error reports go to Sentry, and Cloudinary resizes some product photos. Google receives a request when you open the About page, because the store map loads there. Social media links open those apps, which follow their own policies.",
  portal_legal_privacy_translate_b: "The Simplified Chinese, Traditional Chinese, French and Spanish versions of this site are machine translations. Google Translate makes them in your browser when you pick one of these languages. The page text is then sent to Google. If you stay on Khmer or English, nothing is sent to Google. Translation is paused while you are signed in or while the account panel is open.",
  portal_legal_privacy_ai_b: "The questions you ask the AI assistant go to a third-party AI provider and are processed outside Cambodia. We delete our own copy after 30 days.",
  portal_legal_privacy_ai_named: "The questions you ask the AI assistant go to {providers} and are processed outside Cambodia. We delete our own copy after 30 days.",
  portal_legal_privacy_security_b: "We never store your password itself, only a one-way hash made from it that cannot be turned back into the password. Your password needs at least 10 characters. The sign-in cookie cannot be read by scripts, stays on this site and travels over HTTPS. After repeated wrong attempts, you must wait longer before each new sign-in attempt. Use a password that you do not use anywhere else.",
  portal_legal_privacy_scam_b: "Payment details are never collected through this site, and we will never ask for them. Never give your bank details, card numbers or passwords to anyone who asks, even someone who says they are from our shop. Anyone who asks for them is a scammer. Do not reply, and tell us using the business details above.",
  portal_legal_privacy_rights_b: "To see, correct or delete the information linked to your account, contact us using the verified business details above. We first check that it is really you. If we must keep a record for an operational or legal reason, we tell you.",
  portal_legal_privacy_children_b: "You must be 16 or older to have an account. You must be legally able to agree to these policies yourself. If you think someone under 16 has given us information, contact us and we will look into it.",
  portal_legal_cookies_what_b: "A cookie is a small file that a site stores in your browser. Local storage works the same way. This site stores only what it needs to work. There are no advertising or analytics cookies.",
  portal_legal_cookies_consent_b: "The store map on the About page comes from Google Maps. It loads when you open About, and Google sets its own cookies then. Apart from the map, third-party storage is created only after you turn on the feature that uses it.",
  portal_legal_cookies_table_b: "This table lists the browser storage that this storefront's code manages. Third-party services add their own storage. See Third-party services.",
  portal_legal_cookies_third_b: "Opening the About page loads Google Maps, a Google service that sets its own cookies. Picking Simplified Chinese, Traditional Chinese, French or Spanish loads Google Translate. This site and the Google translation script set the googtrans cookie to remember that choice. This site deletes that cookie when you go back to Khmer or English, or when translation is paused. Opening a Facebook, Instagram, Telegram, WhatsApp or Messenger link takes you to that app, under its own policy. The assistant sends your question to a third-party AI provider. Apart from the map, none of these run before you choose them.",
  portal_legal_cookies_clear_b: "Sign out to end the session cookie. To remove everything else this site stores, clear site data for this address in your browser settings. This removes your saved list, wishlist, language and theme on this device.",
  portal_legal_store_session_l: "Up to 399 days. If you use your account after the first 200 days, this cookie is renewed for 399 days from that day. Signing out deletes this cookie, not your account.",
  portal_legal_store_googtrans_l: "Deleted when you switch to Khmer or English, when translation is paused, or when you clear site data",
  portal_legal_store_reopen_p: "This site uses it to reopen the account panel once after translation is switched off. This site deletes this item as soon as it reads it.",
  portal_legal_store_device_p: "Stores your light or dark theme choice for this device.",
  portal_legal_store_announcement_p: "Remembers which shop announcement you closed on this device, so that it stays closed until the shop changes it.",
  portal_legal_store_ai_consent_p: "Stores whether you agreed to send questions to the AI assistant. It is kept on this device only.",
  portal_legal_store_page_size_p: "Stores how many products you show on each page.",
  portal_legal_store_signedin_l: "Deleted when you sign out or when you clear site data",
}

const KHMER = /[ក-៿]/
let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}: ${(error as Error).message}`) }
}

const drifted = (pack: Readonly<Record<string, string>>) => Object.keys(FIXTURE).filter((key) => pack[key] !== FIXTURE[key])

runTest('every changed key equals FINAL-LEGAL-TEXT.md', () => {
  assert.ok(Object.keys(FIXTURE).length >= 49, `the fixture lists ${Object.keys(FIXTURE).length} keys`)
  assert.deepEqual(drifted(PORTAL_LEGAL_EN), [])
})

runTest('every changed key has Khmer that is Khmer and is not the English', () => {
  for (const key of Object.keys(FIXTURE)) {
    assert.ok(KHMER.test(PORTAL_LEGAL_KM[key] || ''), `${key} has no Khmer`)
    assert.notEqual(PORTAL_LEGAL_KM[key], PORTAL_LEGAL_EN[key], `${key} Khmer is the English`)
  }
})

runTest('Khmer check of 24 Nov 2026: the law and the consent language are said exactly', () => {
  // "Cambodian consumer protection law" by the law's own Khmer name, not "a law protecting Cambodian consumers".
  assert.ok(PORTAL_LEGAL_KM.portal_legal_terms_liability_b.includes('ក្រោមច្បាប់កម្ពុជាស្ដីពីកិច្ចការពារអ្នកប្រើប្រាស់ទេ។'))
  assert.doesNotMatch(PORTAL_LEGAL_KM.portal_legal_terms_liability_b, /គាំពារ/)
  // "in which language" you agreed, not "the language you use".
  assert.ok(PORTAL_LEGAL_KM.portal_legal_privacy_collect_list.includes('ពេលវេលាដែលអ្នកយល់ព្រម និងភាសាដែលអ្នកប្រើពេលយល់ព្រម។'))
})

runTest('control: the drift check names a key whose wording changed by one word, and a key that went missing', () => {
  const changed = { ...PORTAL_LEGAL_EN, portal_legal_terms_returns_b: PORTAL_LEGAL_EN.portal_legal_terms_returns_b.replace('7 days', '14 days') }
  assert.deepEqual(drifted(changed), ['portal_legal_terms_returns_b'])
  const { portal_legal_official_notice: _gone, ...without } = PORTAL_LEGAL_EN
  assert.deepEqual(drifted(without), ['portal_legal_official_notice'])
})

const NOTICE = FIXTURE.portal_legal_official_notice
const KM_NOTICE = PORTAL_LEGAL_KM.portal_legal_official_notice
const visible = (html: string) => html.replace(/<\/?span\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const bundle = buildSync({
  entryPoints: [path.join(SRC, 'components/catalog/legal/LegalPages.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const moduleObj = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), moduleObj, moduleObj.exports)
const PortalFooter = moduleObj.exports.default as React.ComponentType<Record<string, unknown>>
const globals = globalThis as unknown as { window?: unknown }
const renderPage = (page: string, language: 'en' | 'km', props: Record<string, unknown> = {}) => {
  const copy = (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k: string) => k, key, fallback, fallbackKm)
  globals.window = { location: { search: `?legal=${page}`, pathname: '/' } }
  try { return renderToStaticMarkup(React.createElement(PortalFooter, { copy, businessName: 'Leang Beauty', ...props })) } finally { delete globals.window }
}

runTest('the official-text notice is a pack key in English and Khmer', () => {
  assert.equal(PORTAL_LEGAL_EN.portal_legal_official_notice, NOTICE)
  assert.ok(KHMER.test(KM_NOTICE))
  // Ruling C (24 Nov 2026): the notice names the four Google languages; "the four marked languages" read to Google as
  // "marked with an asterisk", which the page does not have.
  assert.ok(KM_NOTICE.includes('កំណែភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង និងអេស្ប៉ាញ ជាការបកប្រែដោយម៉ាស៊ីនរបស់ Google។'), 'the Khmer notice names the four languages')
  assert.doesNotMatch(KM_NOTICE, /ដែលមានសញ្ញា/, 'the Khmer notice says "marked" again')
  const packs = ['en.json', 'km.json'].map((name) => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', name), 'utf8')) as Record<string, string>)
  assert.equal(packs[0].portal_legal_official_notice, NOTICE)
  assert.equal(packs[1].portal_legal_official_notice, KM_NOTICE)
})

runTest('the official-text notice shows once on each of the three pages, in both languages, under the dates', () => {
  assert.deepEqual([...LEGAL_PAGE_ORDER], ['privacy', 'terms', 'cookies'])
  for (const language of ['en', 'km'] as const) {
    const expected = language === 'en' ? NOTICE : KM_NOTICE
    for (const page of LEGAL_PAGE_ORDER) {
      const html = renderPage(page, language)
      const notices = [...html.matchAll(/<p\b[^>]*data-portal-legal-official-notice="true"[^>]*>([\s\S]*?)<\/p>/g)]
      assert.equal(notices.length, 1, `${language} ${page} shows the notice once`)
      assert.equal(visible(notices[0][1]), expected, `${language} ${page} notice text`)
      assert.match(notices[0][0], /leading-6/, `${language} ${page} notice has room for Khmer glyphs`)
      const text = visible(html)
      assert.ok(text.indexOf(expected) > text.indexOf(language === 'en' ? 'We updated our privacy policy' : 'យើងបានធ្វើបច្ចុប្បន្នភាព'), `${language} ${page} notice sits under the dates`)
    }
  }
  assert.doesNotMatch(visible(renderPage('privacy', 'en').replace(/data-portal-legal-page="privacy"[\s\S]*$/, '')), /official text/, 'the footer alone does not carry the notice')
})

runTest('ONE source string: the dock picker note is the policy pages\' official-text notice, in both languages', () => {
  const dockBundle = buildSync({
    entryPoints: [path.join(SRC, 'components/catalog/PortalDock.tsx')],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' },
  })
  const dockModule = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', dockBundle.outputFiles[0].text)(createRequire(import.meta.url), dockModule, dockModule.exports)
  const LanguageOptions = dockModule.exports.LanguageOptions as React.ComponentType<Record<string, unknown>>
  for (const language of ['en', 'km'] as const) {
    const copy = (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k: string) => k, key, fallback, fallbackKm)
    const picker = renderToStaticMarkup(React.createElement(LanguageOptions, { copy, options: [], active: 'en', onPick: () => {} }))
    const pickerNote = visible(/<p data-portal-google-note=""[^>]*>([\s\S]*?)<\/p>/.exec(picker)?.[1] ?? '')
    const pageNote = visible(/data-portal-legal-official-notice="true"[^>]*>([\s\S]*?)<\/p>/.exec(renderPage('privacy', language))?.[1] ?? '')
    assert.ok(pickerNote.length > 40, `${language} the picker shows the note`)
    assert.equal(pickerNote, pageNote, `${language} the picker and the policy page disagree`)
    assert.equal(pickerNote, language === 'en' ? NOTICE : KM_NOTICE)
  }
  const dockSource = fs.readFileSync(path.join(SRC, 'components', 'catalog', 'PortalDock.tsx'), 'utf8')
  assert.doesNotMatch(dockSource, /machine translations|portalGoogleNote|official text/, 'the dock holds no copy of the notice of its own')
  assert.match(dockSource, /legalCopy\(copy, 'portal_legal_official_notice'\)/, 'the dock reads the legal string through the legal resolver')
})

runTest('the map-consent items are gone', () => {
  assert.equal(LEGAL_STORAGE_ROWS.some((row) => row.id === 'map-consent' || row.name.includes('map-consent')), false)
  for (const pack of [PORTAL_LEGAL_EN, PORTAL_LEGAL_KM]) {
    assert.equal('portal_legal_map_consent_revoke' in pack, false)
    assert.equal('portal_legal_store_map_consent_p' in pack, false)
  }
  const all = Object.values(PORTAL_LEGAL_EN).join('\n')
  assert.doesNotMatch(all, /Unload map|stays blocked until you choose to load/)
  assert.doesNotMatch(Object.values(PORTAL_LEGAL_KM).join('\n'), /បិទផែនទី|ត្រូវបានរារាំងរហូតដល់អ្នកជ្រើសផ្ទុក/)
  assert.equal(fs.existsSync(path.join(SRC, 'components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')), false)
  const html = renderPage('cookies', 'en')
  assert.doesNotMatch(html, /map-consent/)
})

runTest('the footer takedown sentence points at the page and repeats no handle (EN + KM)', () => {
  for (const language of ['en', 'km'] as const) {
    const html = renderPage('privacy', language, { phone: '012 345 678', socialLinks: [{ key: 'telegram', label: 'leang_cosmetics', value: 'https://t.me/leang_cosmetics' }] })
    const footerHtml = html.slice(0, html.indexOf('data-portal-legal-page'))
    const sentence = visible(footerHtml)
    assert.ok(sentence.includes(language === 'en' ? 'contact us using the contact details on this page.' : 'សូមទាក់ទងយើងតាមព័ត៌មានទំនាក់ទំនងនៅលើទំព័រនេះ។'), `${language} footer sentence`)
    assert.equal(sentence.split('leang_cosmetics').length - 1, 1, `${language}: the handle shows once, in the Contact column`)
  }
})

if (failed) process.exitCode = 1
