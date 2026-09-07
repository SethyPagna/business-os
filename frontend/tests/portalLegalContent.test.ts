// Lock for the storefront legal pages (N45).
//
// The policy text is declared in components/catalog/legal/legalContent.ts --
// the storefront cannot afford to pull the ~1MB admin packs onto a phone just
// to render a policy page -- and MIRRORED into src/lang/en.json + km.json,
// the same "declared inline, locked against the pack" shape AppContext's
// CORE_ENGLISH_PACK already uses. This test is the lock:
//
//   1. every portal_legal_* key exists in EN and in KM (no half-translated key)
//   2. every key exists in en.json AND km.json with byte-identical text
//   3. the packs carry no portal_legal_* key the module does not declare
//   4. every section/table key the pages render actually resolves
//   5. Khmer really is Khmer (not an English string copied across)
//   6. interpolation fills the business details and leaves no {placeholder}
//   7. "Last updated" renders dd/mm/yyyy, day-first
//
// Run: node tests/portalLegalContent.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEGAL_PAGE_ORDER,
  LEGAL_PAGE_SECTIONS,
  LEGAL_PAGE_TITLE_KEY,
  LEGAL_STORAGE_ROWS,
  PORTAL_LEGAL_CONSENT_VERSION,
  PORTAL_LEGAL_EN,
  PORTAL_LEGAL_KM,
  PORTAL_LEGAL_LAST_UPDATED_ISO,
  formatLegalLastUpdated,
  interpolateLegal,
  isLegalPageKey,
  legalText,
} from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const readPack = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', name), 'utf8')) as Record<string, unknown>
const en = readPack('en.json')
const km = readPack('km.json')

const enKeys = Object.keys(PORTAL_LEGAL_EN).sort()
const kmKeys = Object.keys(PORTAL_LEGAL_KM).sort()

// 1. no half-translated key
assert.deepEqual(enKeys, kmKeys, 'legalContent EN and KM declare different keys')
assert.ok(enKeys.length > 60, `expected the full policy set, found ${enKeys.length} keys`)
for (const key of enKeys) {
  assert.match(key, /^portal_legal_[a-z0-9_]+$/, `${key} is outside this lane's portal_legal_* namespace`)
}

// 2 + 3. the packs mirror the module exactly
for (const key of enKeys) {
  assert.equal(typeof en[key], 'string', `en.json is missing ${key}`)
  assert.equal(typeof km[key], 'string', `km.json is missing ${key}`)
  assert.equal(en[key], PORTAL_LEGAL_EN[key], `en.json drifted from legalContent for ${key}`)
  assert.equal(km[key], PORTAL_LEGAL_KM[key], `km.json drifted from legalContent for ${key}`)
}
for (const pack of [en, km]) {
  for (const key of Object.keys(pack)) {
    if (!key.startsWith('portal_legal_')) continue
    assert.ok(enKeys.includes(key), `pack carries ${key} which legalContent does not declare`)
  }
}

// 4. every key the pages render resolves in both languages
const rendered = new Set<string>()
for (const page of LEGAL_PAGE_ORDER) {
  rendered.add(LEGAL_PAGE_TITLE_KEY[page])
  const sections = LEGAL_PAGE_SECTIONS[page]
  assert.ok(sections.length >= 5, `${page} has too few sections`)
  for (const section of sections) {
    rendered.add(section.heading)
    for (const body of section.bodies) rendered.add(body)
  }
}
for (const row of LEGAL_STORAGE_ROWS) {
  rendered.add(row.kindKey)
  rendered.add(row.purposeKey)
  rendered.add(row.lifetimeKey)
}
for (const key of [...rendered].sort()) {
  assert.ok(legalText('en', key), `English text missing for rendered key ${key}`)
  assert.ok(legalText('km', key), `Khmer text missing for rendered key ${key}`)
}
assert.equal(legalText('fr', 'portal_legal_privacy_title'), PORTAL_LEGAL_EN.portal_legal_privacy_title)
assert.equal(legalText('en', 'portal_legal_not_a_key'), '')

// The cookie table must enumerate the storage this storefront really writes.
const storageNames = LEGAL_STORAGE_ROWS.map((row) => row.name)
for (const expected of [
  'bos_portal',
  'googtrans',
  'business-os-portal-bucket-v1',
  'business-os-portal-wishlist-v1',
  'business-os:portal-translate-target',
  'business-os-catalog-portal-cache',
  'business-os-portal-map-consent-v1',
]) {
  assert.ok(storageNames.includes(expected), `cookie policy does not disclose ${expected}`)
}
// ...and the names must still be the ones the code writes.
const source = (rel: string) => fs.readFileSync(path.join(here, '..', 'src', rel), 'utf8')
const bucketSource = source('components/catalog/portalBucket.ts')
assert.match(bucketSource, /'business-os-portal-bucket-v1'/, 'the bucket storage key moved; update the cookie policy')
assert.match(bucketSource, /'business-os-portal-wishlist-v1'/, 'the wishlist storage key moved; update the cookie policy')
assert.match(source('components/catalog/portalTranslateController.ts'), /'business-os:portal-translate-target'/, 'the translate storage key moved; update the cookie policy')
assert.match(source('components/catalog/PublicCatalogPage.tsx'), /PUBLIC_PORTAL_CACHE_KEY = 'business-os-catalog-portal-cache'/, 'the portal cache key moved; update the cookie policy')
const embedSource = source('components/catalog/legal/PortalEmbedConsent.tsx')
assert.match(embedSource, /MAP_CONSENT_STORAGE_KEY = 'business-os-portal-map-consent-v1'/, 'the map consent key moved; update the cookie policy')
// Once the visitor does ask for the map, the frame still leaks as little as
// possible: origin-only referrer, and no navigation rights over the storefront.
assert.match(embedSource, /referrerPolicy="strict-origin-when-cross-origin"/, 'the map embed sends the full storefront URL to Google')
assert.doesNotMatch(embedSource, /no-referrer-when-downgrade/, 'the map embed still uses the full-URL referrer policy')
assert.match(embedSource, /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/, 'the map embed is not sandboxed')
// The gate itself: the map iframe must not render before the visitor asks.
const secondary = source('components/catalog/CatalogSecondaryTabs.tsx')
assert.doesNotMatch(secondary, /<iframe[^>]*src={mapEmbedUrl}/, 'the map embed loads Google without being asked')
assert.match(secondary, /<PortalEmbedConsent/, 'the map must go through the embed consent gate')

// The standing storefront notice ends on "YOUR PRIVACY IS OUR PRIORITY"; an
// assurance with no policy behind it is exactly the unsupported claim the
// Law on Consumer Protection reaches, so the sentence must carry the link.
const noPayment = source('components/catalog/PortalNoPaymentNotice.tsx')
assert.match(noPayment, /<LegalInlineLink page="privacy"/, 'the privacy promise has no privacy policy behind it')
assert.match(noPayment, /LEGAL_PAGE_TITLE_KEY.privacy/, 'the link label must come from the legal pack, not a hardcoded string')

// The AI panel carries TWO notices: the merchant's editable disclaimer, and
// the app's own, which says the shopper is talking to software, that the
// question leaves the shop, and where a health question actually belongs.
// The second one must not be reachable from the portal editor -- a notice a
// merchant can shorten to nothing is not a notice.
assert.match(secondary, /copy\('assistantAutomatedNotice'/, 'the automated-assistant notice must render beside the AI panel')
const automated = (secondary.match(/const ASSISTANT_AUTOMATED_EN = '([^']*)'/) || [])[1] || ''
for (const phrase of [/automated/i, /not medical advice/i, /third-party AI provider/i, /30 days/, /pharmacist or doctor/i]) {
  assert.match(automated, phrase, `the assistant notice no longer says ${phrase}`)
}
assert.match(secondary, /const ASSISTANT_AUTOMATED_KM = '[^']*[ក-៿]/, 'the assistant notice must ship a real Khmer string, not an English fallback')
assert.doesNotMatch(secondary, /aiDisclaimer \|\| copy\('assistantAutomatedNotice'/, 'the safety notice must not be a merchant-editable field')

// 5. Khmer is really Khmer
const KHMER = /[ក-៿]/
for (const key of enKeys) {
  const value = PORTAL_LEGAL_KM[key]
  assert.ok(value.trim().length > 0, `${key} has empty Khmer`)
  // Every Khmer string must contain Khmer script, and must not be the English
  // string copied across.
  assert.ok(KHMER.test(value), `${key} Khmer contains no Khmer script: ${value}`)
  assert.notEqual(value, PORTAL_LEGAL_EN[key], `${key} Khmer is the English string`)
}
assert.doesNotMatch(JSON.stringify(PORTAL_LEGAL_KM), /�/, 'Khmer content contains replacement characters')

// 6. interpolation
const details = {
  name: 'Leang Beauty',
  legalName: 'Leang Beauty Co., Ltd.',
  registrationNumber: 'KH-0001',
  address: 'Street 271, Phnom Penh',
  phone: '012 345 678',
  email: 'hello@example.com',
}
const who = interpolateLegal(PORTAL_LEGAL_EN.portal_legal_privacy_who_b, details, 2026)
assert.match(who, /Leang Beauty Co\., Ltd\./)
assert.doesNotMatch(who, /\{legalName\}/)
// legalName falls back to the display name rather than leaving a hole.
const fallback = interpolateLegal(PORTAL_LEGAL_EN.portal_legal_privacy_who_b, { ...details, legalName: '' }, 2026)
assert.match(fallback, /Leang Beauty/)
assert.doesNotMatch(fallback, /\{legalName\}/)
const rights = interpolateLegal(PORTAL_LEGAL_EN.portal_legal_footer_rights, details, 2026)
assert.equal(rights, '© 2026 Leang Beauty. All rights reserved.')
// No rendered string may leave an unfilled placeholder once interpolated.
for (const key of [...rendered, 'portal_legal_template_notice', 'portal_legal_footer_rights', 'portal_legal_footer_content_concerns', 'portal_legal_last_updated']) {
  for (const target of ['en', 'km']) {
    const filled = interpolateLegal(legalText(target, key), details, 2026)
    assert.doesNotMatch(filled, /\{(name|legalName|registration|address|phone|email|year|date)\}/, `${target}.${key} left a placeholder unfilled`)
  }
}

// The takedown line is the site's only route for a person who appears in a
// picture they never agreed to. It has to carry a real address and a named
// window -- "contact us" with no deadline is a sentiment, not an undertaking
// -- and the footer must hide it entirely when no address is configured,
// because a promise with nowhere to send it is worse than no promise.
const takedown = interpolateLegal(PORTAL_LEGAL_EN.portal_legal_footer_content_concerns, details, 2026)
assert.match(takedown, /2 business days/, 'the takedown line must state a window')
assert.match(takedown, /hello@example\.com/, 'the takedown line must resolve to the configured address')
assert.match(PORTAL_LEGAL_KM.portal_legal_footer_content_concerns, /\{email\}/, 'the Khmer takedown line must interpolate the same address')
const footerSource = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'legal', 'LegalPages.tsx'), 'utf8')
assert.match(
  footerSource,
  /details\.email \? \([\s\S]{0,200}portal_legal_footer_content_concerns/,
  'the takedown line must render only when an address is configured',
)

// 7. day-first date, and a consent version tied to it
assert.match(PORTAL_LEGAL_LAST_UPDATED_ISO, /^\d{4}-\d{2}-\d{2}$/)
assert.equal(formatLegalLastUpdated('2026-09-07'), '07/09/2026')
assert.equal(formatLegalLastUpdated(), '07/09/2026')
assert.equal(PORTAL_LEGAL_CONSENT_VERSION, `portal-legal-${PORTAL_LEGAL_LAST_UPDATED_ISO}`)

// Page keys
assert.equal(isLegalPageKey('privacy'), true)
assert.equal(isLegalPageKey('cookies'), true)
assert.equal(isLegalPageKey('refunds'), false)
assert.deepEqual([...LEGAL_PAGE_ORDER], ['privacy', 'terms', 'cookies'])

// The template disclaimer must be present and must not claim to be advice.
assert.match(PORTAL_LEGAL_EN.portal_legal_template_notice, /template/i)
assert.match(PORTAL_LEGAL_EN.portal_legal_template_notice, /not legal advice/i)
// Governing law is Cambodia, stated once.
assert.match(PORTAL_LEGAL_EN.portal_legal_terms_law_b, /Kingdom of Cambodia/)

console.log(`PASS portalLegalContent: ${enKeys.length} keys mirrored in en.json + km.json, ${LEGAL_STORAGE_ROWS.length} storage rows disclosed`)
