// Owner rules for the storefront legal surfaces (20 Oct 2026): 7-day returns
// in the Terms, the independent-retailer footer line, minimum age 16 in the
// consent wording and the Children section, a sign-in-specific consent refusal,
// plain factual copy, and a policy page that never truncates its title.
//
// The footer and the consent helper are RENDERED (esbuild + static markup), so
// a line that is declared but never shown fails here.
//
// Run: node tests/portalLegalOwnerRules.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSync } from 'esbuild'
import {
  LEGAL_PAGE_SECTIONS,
  PORTAL_LEGAL_EN,
  PORTAL_LEGAL_KM,
  interpolateLegal,
  legalText,
} from '../src/components/catalog/legal/legalContent.ts'
import { resolveClientIdentity } from '../../cloudflare/src/lib/clientIdentity.ts'
import { LEANG_CLIENT_IDENTITY, writeIdentityBlock } from './leangClientIdentity.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), 'utf8')
const KHMER = /[ក-៿]/
const requireFrom = createRequire(import.meta.url)

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string
const copyIn = (lang: 'en' | 'km'): CopyFn => (_key, en, km) => (lang === 'km' ? km ?? en ?? '' : en ?? '')
// Returns the KEY, so a test can see which message a caller selected.
const keyCopy: CopyFn = (key) => key

// A distinct `instance` gives a fresh module instance (and so a fresh read of the
// page's client identity); the same entry and instance share one.
async function bundle<T>(entry: string, instance = ''): Promise<T> {
  const built = buildSync({
    entryPoints: [path.resolve(here, entry)],
    bundle: true, write: false, format: 'esm', platform: 'neutral', jsx: 'automatic',
    target: 'es2020', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const source = built.outputFiles[0].text.replace(
    /from\s*"(react(?:\/[\w.-]+)*)"/g,
    (_all, specifier) => `from "${pathToFileURL(requireFrom.resolve(specifier)).href}"`,
  )
  const tagged = instance ? `${source}\n// instance: ${instance}\n` : source
  return await import('data:text/javascript;base64,' + Buffer.from(tagged).toString('base64')) as T
}

const details = { name: 'Leang Cosmetics', legalName: '', registrationNumber: '', address: '', phone: '', email: '' }
const pageText = (page: 'privacy' | 'terms', lang: 'en' | 'km') =>
  LEGAL_PAGE_SECTIONS[page].flatMap((s) => [s.heading, ...s.bodies]).map((k) => interpolateLegal(legalText(lang, k), details, 2026)).join('\n')

test('Terms carry a Returns section: 7 days, unopened, with the receipt (EN + KM)', () => {
  const keys = LEGAL_PAGE_SECTIONS.terms.map((s) => s.heading)
  assert.ok(keys.includes('portal_legal_terms_returns_h'), 'the Terms have no Returns section')
  assert.equal(PORTAL_LEGAL_EN.portal_legal_terms_returns_b, 'Returns are accepted within 7 days for unopened items with the receipt.')
  assert.match(PORTAL_LEGAL_KM.portal_legal_terms_returns_b, KHMER)
  assert.match(PORTAL_LEGAL_KM.portal_legal_terms_returns_b, /៧ ថ្ងៃ/, 'Khmer returns window must say 7 days')
  assert.match(pageText('terms', 'km'), /៧ ថ្ងៃ/)
})

test('minimum age 16 is stated in the consent wording and in the Children section (EN + KM)', () => {
  for (const [lang, pack] of [['en', PORTAL_LEGAL_EN], ['km', PORTAL_LEGAL_KM]] as const) {
    const sixteen = lang === 'en' ? /\b16\b/ : /១៦/
    for (const key of ['portal_legal_consent_label', 'portal_legal_consent_required', 'portal_legal_consent_required_signin', 'portal_legal_privacy_children_b', 'portal_legal_terms_account_b']) {
      assert.match(pack[key], sixteen, `${lang} ${key} does not state the minimum age`)
    }
  }
  // The inline fallbacks the form renders before any pack loads match the packs.
  const field = read('../src/components/catalog/legal/SignupConsentField.tsx')
  assert.ok(field.includes(`'${PORTAL_LEGAL_EN.portal_legal_consent_label}'`), 'inline EN consent label drifted from the pack')
  assert.ok(field.includes(`'${PORTAL_LEGAL_KM.portal_legal_consent_label}'`), 'inline KM consent label drifted from the pack')
})

test('plain factual copy: no welcome, effort or gladness sentences, no hedge about banners', () => {
  const banned = /welcome|we work hard|glad to help|does not claim that one banner/i
  for (const [key, value] of Object.entries(PORTAL_LEGAL_EN)) assert.doesNotMatch(value, banned, `en ${key}: ${value}`)
  assert.doesNotMatch(JSON.stringify(PORTAL_LEGAL_KM), /ស្វាគមន៍|ខិតខំ|រីករាយនឹងជួយ|មិនអះអាងថាច្បាប់ផ្ទាំង/)
  assert.equal('portal_legal_store_cache_l' in PORTAL_LEGAL_EN, false, 'the retired "About 20 minutes" cache row text is back')
  assert.doesNotMatch(read('../src/lang/en.json'), /About 20 minutes/)
})

test("the fallback name 'This business' is translated", async () => {
  assert.match(PORTAL_LEGAL_KM.portal_legal_business_fallback, KHMER)
  const legalPages = read('../src/components/catalog/legal/LegalPages.tsx')
  assert.doesNotMatch(legalPages, /\|\| 'This business'/, 'the English-only fallback name is hard-coded again')
  const mod = await bundle<{ default: React.FunctionComponent<Record<string, unknown>> }>('../src/components/catalog/legal/LegalPages.tsx')
  const km = renderToStaticMarkup(React.createElement(mod.default, { copy: copyIn('km') }))
  assert.match(km, /អាជីវកម្មនេះ/)
  assert.doesNotMatch(km, /This business/)
})

// The footer as a host with this client identity renders it (null: no identity
// block, the neutral Business OS document).
async function footerOnHost(instance: string, identity: Parameters<typeof writeIdentityBlock>[0] | null, businessName: string) {
  const undo = identity ? writeIdentityBlock(identity) : () => {}
  try {
    const mod = await bundle<{ default: React.FunctionComponent<Record<string, unknown>> }>('../src/components/catalog/legal/LegalPages.tsx', instance)
    return {
      en: renderToStaticMarkup(React.createElement(mod.default, { copy: copyIn('en'), businessName })),
      km: renderToStaticMarkup(React.createElement(mod.default, { copy: copyIn('km'), businessName })),
    }
  } finally {
    undo()
  }
}

test('the footer bottom row shows the independent-retailer line in both languages', async () => {
  const { en, km } = await footerOnHost('leang-host', LEANG_CLIENT_IDENTITY, 'Leang Cosmetics')
  assert.match(en, /data-portal-footer-independent="true">Leang Cosmetics is an independent beauty retailer in Cambodia\.</)
  assert.match(km, /data-portal-footer-independent="true">Leang Cosmetics ជាអ្នកលក់រាយ[^<]*កម្ពុជា។</)
  assert.doesNotMatch(km, /independent beauty retailer/)
})

test('another client gets its own name and, without the beauty category, the general retailer line', async () => {
  const bmShop = await footerOnHost('bm-shop-host', resolveClientIdentity({ BUSINESS_OS_SHOP_NAME: 'BM Shop' }), 'BM Shop')
  assert.match(bmShop.en, /data-portal-footer-independent="true">BM Shop is an independent retailer in Cambodia\.</)
  assert.match(bmShop.km, /data-portal-footer-independent="true">BM Shop ជាអ្នកលក់រាយឯករាជ្យនៅកម្ពុជា។</)
  assert.doesNotMatch(bmShop.en + bmShop.km, /Leang|beauty|សម្រស់/)
  const neutral = await footerOnHost('neutral-host', null, '')
  assert.match(neutral.en, /data-portal-footer-independent="true">Business OS is an independent retailer in Cambodia\.</)
})

test('the consent refusal names the action: sign-in is not told to "create an account"', async () => {
  const mod = await bundle<{ consentRequiredMessage: (copy: CopyFn, mode: 'signin' | 'signup') => string }>('../src/components/catalog/legal/SignupConsentField.tsx')
  assert.equal(mod.consentRequiredMessage(keyCopy, 'signin'), 'portal_legal_consent_required_signin')
  assert.equal(mod.consentRequiredMessage(keyCopy, 'signup'), 'portal_legal_consent_required')
  for (const lang of ['en', 'km'] as const) {
    const signin = mod.consentRequiredMessage(copyIn(lang), 'signin')
    const signup = mod.consentRequiredMessage(copyIn(lang), 'signup')
    assert.notEqual(signin, signup)
    assert.equal(signin, (lang === 'en' ? PORTAL_LEGAL_EN : PORTAL_LEGAL_KM).portal_legal_consent_required_signin, `${lang} inline sign-in fallback drifted from the pack`)
    assert.equal(signup, (lang === 'en' ? PORTAL_LEGAL_EN : PORTAL_LEGAL_KM).portal_legal_consent_required, `${lang} inline sign-up fallback drifted from the pack`)
  }
  assert.doesNotMatch(PORTAL_LEGAL_EN.portal_legal_consent_required_signin, /create an account/i)
  assert.match(PORTAL_LEGAL_EN.portal_legal_consent_required, /create an account/i)
  const account = read('../src/components/catalog/CatalogAccountSection.tsx')
  assert.match(account, /async \(event: React\.FormEvent\) => \{\s*event\.preventDefault\(\)\s*if \(!consent\) \{\s*setConsentError\(consentRequiredMessage\(copy, 'signin'\)\)[\s\S]*?await signIn\(/, 'the sign-in handler does not use the sign-in message')
  assert.match(account, /setConsentError\(consentRequiredMessage\(copy, 'signup'\)\)/, 'the sign-up handler does not use the sign-up message')
})

test('the policy page never truncates its title and its policy links are 44px targets', () => {
  const source = read('../src/components/catalog/legal/LegalPages.tsx')
  const h1 = source.match(/<h1[\s\S]*?className="([^"]*)"/)?.[1] ?? ''
  assert.ok(h1, 'the reader title moved; re-anchor this check')
  assert.doesNotMatch(h1, /\btruncate\b/, 'the policy title is truncated')
  assert.match(h1, /break-words/)
  assert.match(h1, /leading-7/, 'Khmer needs a taller line box than Latin')
  const reader = source.slice(source.indexOf('function LegalReader'))
  assert.match(reader, /onClick=\{\(\) => onNavigate\(other\)\}[\s\S]{0,120}className="inline-flex min-h-11/, 'reader policy links are under 44px')
  assert.match(source, /className="inline-flex min-h-11 items-center rounded-2xl border border-slate-200 bg-white/, 'footer policy links are under 44px')
})
