// The legal pages stay translatable by Google, but every fact is cut out of its sentence and rendered inside
// <span translate="no" className="notranslate"> (owner, 21 Nov 2026: "make sure crucial and vital information are not
// translated or affected"). protectLegalFacts (legal/legalContent.ts) does the cutting; ProtectedText (legal/LegalPages.tsx)
// renders it.
//
//   1. each fact class wraps its own samples (numbers WITH their unit, currency, dates, names, handles, e-mails, links, storage
//      names, provider and brand names) and the shop's own details (exact literals)
//   2. control: with one class dropped, that class's sample is no longer wrapped whole
//   3. the visible text is byte-identical: every segment list joins back to its input, and every rendered page shows the exact
//      text of every key once the protective spans are taken away
//   4. the real pages wrap the real facts, in English and Khmer
//   5. the Cookie type cell is KEEP-OFFICIAL; the other type cells stay translatable
//   6. no regex look-behind in the legal module (Safari before 16.4 rejects the whole file at parse time)
//
// Run: node tests/portalLegalProtectFacts.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import {
  LEGAL_FACT_CLASSES,
  LEGAL_KEEP_OFFICIAL_KEYS,
  LEGAL_PAGE_ORDER,
  LEGAL_PAGE_SECTIONS,
  LEGAL_STORAGE_ROWS,
  PORTAL_LEGAL_EN,
  PORTAL_LEGAL_KM,
  interpolateLegal,
  legalText,
  padProtectedSegments,
  protectLegalFacts,
} from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(path.dirname(here), 'src')
let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}: ${(error as Error).message}`) }
}

const protectedParts = (text: string, literals: readonly string[] = [], classes = LEGAL_FACT_CLASSES) =>
  protectLegalFacts(text, literals, classes).filter((part) => part.protect).map((part) => part.text)

// One row per class: a sentence and exactly the pieces that must be protected.
const SAMPLES: Array<{ id: string; text: string; expected: string[] }> = [
  { id: 'number-unit', text: 'You stay signed in for up to 399 days. Your password needs at least 10 characters.', expected: ['399 days', '10 characters'] },
  { id: 'number-unit', text: 'យើងលុបកំណត់ត្រាសុវត្ថិភាពបន្ទាប់ពី ១ ថ្ងៃ។ ត្រូវមានយ៉ាងតិច ១០ តួអក្សរ។', expected: ['១ ថ្ងៃ', '១០ តួអក្សរ'] },
  { id: 'number', text: 'You must be 16 or older. If you think someone under 16 has given us information.', expected: ['16', '16'] },
  { id: 'currency', text: 'The deposit is $12.50 or 50000៛ or 12 USD.', expected: ['$12.50', '50000៛', '12 USD'] },
  { id: 'date', text: 'Last updated 21/11/2026 and 2026-11-21.', expected: ['21/11/2026', '2026-11-21'] },
  { id: 'phone', text: 'Call 012 345 678 or +855 12 345 678.', expected: ['012 345 678', '+855 12 345 678'] },
  { id: 'email', text: 'Write to hello@example.com today.', expected: ['hello@example.com'] },
  { id: 'url', text: 'Open https://t.me/leang_cosmetics. Then stop.', expected: ['https://t.me/leang_cosmetics'] },
  { id: 'handle', text: 'Message @leang_cosmetics on the app.', expected: ['@leang_cosmetics'] },
  { id: 'domain', text: 'Visit leangbeauty.com for the shop.', expected: ['leangbeauty.com'] },
  { id: 'storage-name', text: 'This site and the Google translation script set the googtrans cookie. It also keeps business-os:portal-translate-target and business-os-portal-bucket-v1 and bos_portal and businessos_device_settings.', expected: ['Google', 'googtrans', 'business-os:portal-translate-target', 'business-os-portal-bucket-v1', 'bos_portal', 'businessos_device_settings'] },
  { id: 'brand', text: 'Cloudflare hosts it, Sentry gets errors, Cloudinary resizes, Google Maps and Google Translate load, Groq, Mistral AI, Cerebras and Google AI answer. Telegram, Facebook, Instagram, WhatsApp and Messenger open apps over HTTPS.', expected: ['Cloudflare', 'Sentry', 'Cloudinary', 'Google Maps', 'Google Translate', 'Groq', 'Mistral AI', 'Cerebras', 'Google AI', 'Telegram', 'Facebook', 'Instagram', 'WhatsApp', 'Messenger', 'HTTPS'] },
]

runTest('each fact class wraps exactly its own samples', () => {
  const covered = new Set(SAMPLES.map((sample) => sample.id))
  for (const entry of LEGAL_FACT_CLASSES) assert.ok(covered.has(entry.id), `class ${entry.id} has no sample`)
  for (const sample of SAMPLES) assert.deepEqual(protectedParts(sample.text), sample.expected, `${sample.id}: ${sample.text}`)
})

runTest('the match is the longest at its start: "399 days" and "Google Translate" are one span each, a bare number stays a number', () => {
  assert.deepEqual(protectedParts('399 days'), ['399 days'])
  assert.deepEqual(protectedParts('Google Translate'), ['Google Translate'])
  assert.deepEqual(protectedParts('Googlebot and Groqueen'), [], 'a word that only starts like a brand is not a brand')
  assert.deepEqual(protectedParts('version v1 of the page 5'), ['5'], 'a digit glued to a letter is not a number')
})

runTest('the shop\'s own details are protected wherever a sentence repeats them', () => {
  const details = ['Leang Beauty', 'Leang Beauty Co., Ltd.', 'KH-0001', 'Street 271, Phnom Penh', '012 345 678', 'hello@example.com']
  const text = 'This site shows what Leang Beauty has. Registered as Leang Beauty Co., Ltd. KH-0001. Find us at Street 271, Phnom Penh or on 012 345 678 or hello@example.com.'
  assert.deepEqual(protectedParts(text, details), ['Leang Beauty', 'Leang Beauty Co., Ltd.', 'KH-0001', 'Street 271, Phnom Penh', '012 345 678', 'hello@example.com'])
  assert.deepEqual(protectedParts(text, []).includes('Street 271, Phnom Penh'), false)
  assert.deepEqual(protectedParts('a b', ['a']), [], 'a one-letter literal is ignored')
})

runTest('control: with one class dropped, its sample is no longer wrapped whole', () => {
  for (const sample of SAMPLES) {
    const without = LEGAL_FACT_CLASSES.filter((entry) => entry.id !== sample.id)
    assert.notDeepEqual(protectedParts(sample.text, [], without), sample.expected, `dropping ${sample.id} changes nothing: the sample proves nothing`)
  }
  const literalText = 'Find us at Street 271, Phnom Penh.'
  assert.notDeepEqual(protectedParts(literalText, []), protectedParts(literalText, ['Street 271, Phnom Penh']), 'control: dropping the literal changes the result')
})

const allKeys = Object.keys(PORTAL_LEGAL_EN)
const details = { name: 'Leang Beauty', legalName: 'Leang Beauty Co., Ltd.', registrationNumber: 'KH-0001', address: 'Street 271, Phnom Penh', phone: '012 345 678', email: 'hello@example.com' }
const literals = Object.values(details)

runTest('every legal string, filled in, is byte-identical once its segments are joined', () => {
  for (const lang of ['en', 'km'] as const) {
    for (const key of allKeys) {
      const filled = interpolateLegal(legalText(lang, key), details, 2026)
      assert.equal(protectLegalFacts(filled, literals).map((part) => part.text).join(''), filled, `${lang} ${key}`)
      assert.equal(protectLegalFacts(filled, literals).some((part) => !part.text), false, `${lang} ${key} has an empty segment`)
    }
  }
})

const bundle = buildSync({
  entryPoints: [path.join(SRC, 'components/catalog/legal/LegalPages.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const moduleObj = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), moduleObj, moduleObj.exports)
const PortalFooter = moduleObj.exports.default as React.ComponentType<Record<string, unknown>>
const globals = globalThis as unknown as { window?: unknown }
const renderPage = (page: string, language: 'en' | 'km') => {
  const copy = (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k: string) => k, key, fallback, fallbackKm)
  globals.window = { location: { search: `?legal=${page}`, pathname: '/' } }
  try {
    return renderToStaticMarkup(React.createElement(PortalFooter, { copy, businessName: details.name, legalName: details.legalName, registrationNumber: details.registrationNumber, address: details.address, phone: details.phone, email: details.email }))
  } finally { delete globals.window }
}
const SPAN = '<span translate="no" class="notranslate">'
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The spaces next to a fact sit inside its span (padProtectedSegments), so a wrapped fact may carry them.
const wraps = (html: string, fact: string) => new RegExp(`${escapePattern(SPAN)}\\s*${escapePattern(fact)}\\s*</span>`).test(html)
const unwrap = (html: string) => html.split(SPAN).join('').replace(/<\/span>/g, '')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

runTest('every rendered page shows the exact text of every key, in English and Khmer, once the protective spans are taken away', () => {
  for (const lang of ['en', 'km'] as const) {
    for (const page of LEGAL_PAGE_ORDER) {
      const html = renderPage(page, lang)
      assert.ok(html.includes(SPAN), `${lang} ${page} wraps no fact at all`)
      const plainPage = unwrap(html)
      const keys = LEGAL_PAGE_SECTIONS[page].flatMap((section) => [section.heading, ...section.bodies])
      for (const key of keys) {
        const expected = escapeHtml(interpolateLegal(legalText(lang, key), details, new Date().getFullYear()))
        assert.ok(plainPage.includes(expected), `${lang} ${page} ${key} is not shown byte for byte`)
      }
      if (page === 'cookies') {
        for (const row of LEGAL_STORAGE_ROWS) for (const key of [row.kindKey, row.purposeKey, row.lifetimeKey]) assert.ok(plainPage.includes(escapeHtml(legalText(lang, key))), `${lang} cookies ${key}`)
      }
    }
  }
})

runTest('the real pages wrap the real facts', () => {
  const privacy = renderPage('privacy', 'en')
  for (const fact of ['399 days', '1 day', '30 days', '90 days', '180 days', '200 days', '16', 'Sentry', 'Cloudflare', 'Cloudinary', 'Google', 'Google Translate', details.name]) {
    assert.ok(wraps(privacy, fact), `privacy: ${fact} is not wrapped`)
  }
  const terms = renderPage('terms', 'en')
  for (const fact of ['7 days', '16', details.name]) assert.ok(wraps(terms, fact), `terms: ${fact} is not wrapped`)
  const cookies = renderPage('cookies', 'en')
  for (const fact of ['399 days', '200 days', 'googtrans', 'Google Maps', 'Google Translate', 'Telegram', 'WhatsApp', 'Messenger', 'Facebook', 'Instagram']) {
    assert.ok(wraps(cookies, fact), `cookies: ${fact} is not wrapped`)
  }
  for (const page of LEGAL_PAGE_ORDER) assert.ok(wraps(renderPage(page, 'en'), '21/11/2026'), `${page}: the date is not wrapped`)
  const km = renderPage('privacy', 'km')
  for (const fact of ['៣៩៩ ថ្ងៃ', '១ ថ្ងៃ', '៣០ ថ្ងៃ', '១៦ ឆ្នាំ', 'Sentry', 'Cloudflare', '21/11/2026']) assert.ok(wraps(km, fact), `km privacy: ${fact} is not wrapped`)
})

runTest('KEEP-OFFICIAL: the Cookie type cell is not translated, the other type cells still are', () => {
  assert.deepEqual([...LEGAL_KEEP_OFFICIAL_KEYS], ['portal_legal_kind_cookie'])
  const html = renderPage('cookies', 'en')
  const cookieCells = [...html.matchAll(/<td\b([^>]*)>Cookie<\/td>/g)]
  assert.equal(cookieCells.length, LEGAL_STORAGE_ROWS.filter((row) => row.kindKey === 'portal_legal_kind_cookie').length)
  assert.ok(cookieCells.length >= 2, 'the table has two Cookie rows')
  for (const cell of cookieCells) assert.match(cell[1], /translate="no"/, 'a Cookie cell can be translated')
  const localCell = /<td\b([^>]*)>Local storage<\/td>/.exec(html)
  assert.ok(localCell && !/translate="no"/.test(localCell[1]), 'the Local storage cell stays translatable')
  const km = renderPage('cookies', 'km')
  assert.equal([...km.matchAll(/<td\b[^>]*translate="no"[^>]*>ខូឃី<\/td>/g)].length, cookieCells.length, 'the Khmer Cookie cells are kept too')
})

runTest('PAD: the spaces next to a fact sit inside its span, so Google cannot glue the fact to its neighbours', () => {
  const text = 'You can return an unopened item within 7 days. Bring the receipt.'
  const raw = protectLegalFacts(text)
  assert.deepEqual(raw.filter((part) => part.protect).map((part) => part.text), ['7 days'], 'control: the bare cut has no spaces in the fact')
  const padded = padProtectedSegments(raw)
  assert.deepEqual(padded.map((part) => part.text), ['You can return an unopened item within', ' 7 days', '. Bring the receipt.'])
  assert.equal(padded.map((part) => part.text).join(''), text)
  assert.deepEqual(padProtectedSegments(protectLegalFacts('Hosted by Cloudflare and Sentry.')).map((part) => part.text), ['Hosted by', ' Cloudflare ', 'and', ' Sentry', '.'])
  for (const lang of ['en', 'km'] as const) {
    for (const page of LEGAL_PAGE_ORDER) {
      const html = renderPage(page, lang)
      assert.equal(html.includes(` ${SPAN}`), false, `${lang} ${page}: a space is left outside a fact's span (before it)`)
      assert.equal(/<span translate="no" class="notranslate">[^<]*<\/span> /.test(html), false, `${lang} ${page}: a space is left outside a fact's span (after it)`)
    }
  }
})

runTest('the legal module uses no regex look-behind', () => {
  const source = fs.readFileSync(path.join(SRC, 'components', 'catalog', 'legal', 'legalContent.ts'), 'utf8')
  assert.equal(/\(\?<[=!]/.test(source), false)
  assert.match('(?<=x)', /\(\?<[=!]/, 'control: the guard sees a look-behind')
})

if (failed) process.exitCode = 1
