// The legal pages stay translatable by Google (owner, 21 Nov 2026: "make sure crucial and vital information are not
// translated or affected"). Google translates each piece between two untranslated spans on its own, so a span in the middle
// of a sentence breaks the sentence (measured: zh-CN read "16 or 18 years old" once numbers were wrapped). Only the shop's own
// details and the AI provider names are protected; numbers, units, dates and brand names stay in their sentence, where
// Google kept every one of them right (round 1, 644 pieces). protectLegalFacts (legal/legalContent.ts) does the cutting;
// ProtectedText (legal/LegalPages.tsx) renders it.
//
//   1. the shop's own details are protected wherever a sentence repeats them; the longest literal wins; control
//   2. numbers with units, dates, currency, links, handles, storage names and brand names are NOT cut out of a sentence
//   3. the visible text is byte-identical: every segment list joins back to its input, and every rendered page shows the exact
//      text of every key once the protective spans are taken away
//   4. on the real pages every span holds a shop detail, and no number or brand is wrapped, in English and Khmer
//   5. the spaces next to a protected detail sit inside its span (Google trims the edges of what it translates)
//   6. the Cookie type cell is KEEP-OFFICIAL; the other type cells stay translatable
//   7. no regex look-behind in the legal module (Safari before 16.4 rejects the whole file at parse time)
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
  LEGAL_KEEP_OFFICIAL_KEYS,
  LEGAL_PAGE_ORDER,
  LEGAL_PAGE_SECTIONS,
  LEGAL_STORAGE_ROWS,
  PORTAL_LEGAL_EN,
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

const protectedParts = (text: string, literals: readonly string[] = []) =>
  protectLegalFacts(text, literals).filter((part) => part.protect).map((part) => part.text)

runTest('the shop\'s own details are protected wherever a sentence repeats them; the longest literal wins', () => {
  const shop = ['Leang Beauty', 'Leang Beauty Co., Ltd.', 'KH-0001', 'Street 271, Phnom Penh', '012 345 678', 'hello@example.com']
  const text = 'This site shows what Leang Beauty has. Registered as Leang Beauty Co., Ltd. KH-0001. Find us at Street 271, Phnom Penh or on 012 345 678 or hello@example.com.'
  assert.deepEqual(protectedParts(text, shop), ['Leang Beauty', 'Leang Beauty Co., Ltd.', 'KH-0001', 'Street 271, Phnom Penh', '012 345 678', 'hello@example.com'])
  assert.deepEqual(protectedParts('Answers come from Groq and Mistral AI.', ['Groq', 'Mistral AI']), ['Groq', 'Mistral AI'])
  assert.deepEqual(protectedParts('a b', ['a']), [], 'a one-letter literal is ignored')
  assert.deepEqual(protectedParts(text, []), [], 'control: without the literals nothing is protected')
})

runTest('numbers, units, dates, currency, links, handles, storage names and brand names stay in their sentence', () => {
  const sentences = [
    'You stay signed in for up to 399 days. Your password needs at least 10 characters.',
    'យើងលុបកំណត់ត្រាសុវត្ថិភាពបន្ទាប់ពី ១ ថ្ងៃ។ ត្រូវមានយ៉ាងតិច ១០ តួអក្សរ។',
    'Create an account only if you are 16 or older.',
    'The deposit is $12.50 or 50000៛. Last updated 21/11/2026.',
    'Open https://t.me/leang_cosmetics or message @leang_cosmetics. Visit leangbeauty.com.',
    'This site and the Google translation script set the googtrans cookie and keep businessos_device_settings.',
    'Cloudflare hosts it, Sentry gets errors, Cloudinary resizes, Google Maps and Google Translate load. Telegram and Messenger open apps.',
  ]
  for (const sentence of sentences) {
    assert.deepEqual(protectedParts(sentence), [], sentence)
    assert.deepEqual(protectLegalFacts(sentence), [{ text: sentence, protect: false }], `${sentence}: kept whole`)
  }
})

const allKeys = Object.keys(PORTAL_LEGAL_EN)
const details = { name: 'Leang Beauty', legalName: 'Leang Beauty Co., Ltd.', registrationNumber: 'KH-0001', address: 'Street 271, Phnom Penh', phone: '012 345 678', email: 'hello@example.com' }
const literals = Object.values(details)

runTest('every legal string, filled in, is byte-identical once its segments are joined', () => {
  for (const lang of ['en', 'km'] as const) {
    for (const key of allKeys) {
      const filled = interpolateLegal(legalText(lang, key), details, 2026)
      for (const parts of [protectLegalFacts(filled, literals), padProtectedSegments(protectLegalFacts(filled, literals))]) {
        assert.equal(parts.map((part) => part.text).join(''), filled, `${lang} ${key}`)
        assert.equal(parts.some((part) => !part.text), false, `${lang} ${key} has an empty segment`)
      }
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
const unwrap = (html: string) => html.split(SPAN).join('').replace(/<\/span>/g, '')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const spanTexts = (html: string) => [...html.matchAll(/<span translate="no" class="notranslate">([^<]*)<\/span>/g)].map((match) => match[1])

runTest('every rendered page shows the exact text of every key, in English and Khmer, once the protective spans are taken away', () => {
  for (const lang of ['en', 'km'] as const) {
    for (const page of LEGAL_PAGE_ORDER) {
      const html = renderPage(page, lang)
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

runTest('on the real pages every span holds a shop detail, and no number or brand is wrapped', () => {
  const shownLiterals = new Set(literals.map(escapeHtml))
  for (const lang of ['en', 'km'] as const) {
    for (const page of LEGAL_PAGE_ORDER) {
      const spans = spanTexts(renderPage(page, lang))
      assert.ok(spans.length > 0, `${lang} ${page}: the shop's details are not wrapped at all`)
      for (const span of spans) assert.ok(shownLiterals.has(span.trim()), `${lang} ${page}: "${span}" is wrapped but is not a shop detail`)
    }
  }
  const terms = renderPage('terms', 'en')
  assert.ok(spanTexts(terms).some((span) => span.trim() === details.name), 'terms: the shop name in a sentence is not wrapped')
  const privacy = unwrap(renderPage('privacy', 'en'))
  for (const fact of ['399 days', '16', 'Sentry', 'Cloudflare', 'Google']) assert.ok(privacy.includes(fact), `control: privacy still shows ${fact}`)
})

runTest('PAD: the spaces next to a protected detail sit inside its span, so Google cannot glue it to its neighbours', () => {
  const text = 'Visit Leang Beauty today.'
  const raw = protectLegalFacts(text, ['Leang Beauty'])
  assert.deepEqual(raw.map((part) => part.text), ['Visit ', 'Leang Beauty', ' today.'], 'control: the bare cut leaves the spaces outside')
  assert.deepEqual(padProtectedSegments(raw).map((part) => part.text), ['Visit', ' Leang Beauty ', 'today.'])
  assert.deepEqual(padProtectedSegments(protectLegalFacts('Groq Mistral', ['Groq', 'Mistral'])).map((part) => part.text), ['Groq ', 'Mistral'], 'a space between two details goes to the first')
  for (const lang of ['en', 'km'] as const) {
    for (const page of LEGAL_PAGE_ORDER) {
      const html = renderPage(page, lang)
      assert.equal(html.includes(` ${SPAN}`), false, `${lang} ${page}: a space is left outside a detail's span (before it)`)
      assert.equal(/<span translate="no" class="notranslate">[^<]*<\/span> /.test(html), false, `${lang} ${page}: a space is left outside a detail's span (after it)`)
    }
  }
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

runTest('the legal module uses no regex look-behind', () => {
  const source = fs.readFileSync(path.join(SRC, 'components', 'catalog', 'legal', 'legalContent.ts'), 'utf8')
  assert.equal(/\(\?<[=!]/.test(source), false)
  assert.match('(?<=x)', /\(\?<[=!]/, 'control: the guard sees a look-behind')
})

if (failed) process.exitCode = 1
