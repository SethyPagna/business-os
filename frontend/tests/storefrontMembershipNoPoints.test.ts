// Owner answer, 29 Sep 2026: no points anywhere on the storefront, Membership reads only "coming soon",
// and the Membership ID wording stays. Policy texts wait on the consent-version decision, so they are exempt.
//
// Run: node tests/storefrontMembershipNoPoints.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { LEGAL_KEYS, SRC, assertCompleteScan, parseSource, scanStorefrontCopy, storefrontTranslator } from './storefrontCopyScan.ts'

const ENGLISH_POINTS = /\b(?:points?|rewards?|redeem\w*|redemption|loyalty)\b/i
const KHMER_POINTS = /ពិន្ទុ|រង្វាន់|ប្ដូរយក|ប្តូរយក|ស្មោះត្រង់|ភក្ដីភាព/

const MEMBERSHIP_COMING_SOON = { en: 'Membership: coming soon', km: 'សមាជិកភាព៖ នឹងមកដល់ឆាប់ៗនេះ' }

const MEMBERSHIP_ID_WORDING: Record<string, { en: string; km: string }> = {
  membershipId: { en: 'Membership ID', km: 'លេខសមាជិក' },
  membershipIdOptional: { en: 'Membership ID (optional)', km: 'លេខសមាជិក (ស្រេចចិត្ត)' },
  membershipIdHint: { en: 'Leave blank and we will create one for you.', km: 'ទុកទទេ ហើយយើងនឹងបង្កើតលេខមួយជូនអ្នក។' },
  nameOrMembershipId: { en: 'Name or Membership ID', km: 'ឈ្មោះ ឬលេខសមាជិក' },
}

type Tree = Record<string, unknown>
function flatten(input: Tree, target: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') flatten(value as Tree, target)
    else target[key] = String(value)
  }
  return target
}
const readPack = (name: string) => flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', `${name}.json`), 'utf8')) as Tree)

const t = storefrontTranslator()
const scan = scanStorefrontCopy()
assertCompleteScan(scan)
const enPack = readPack('en')
const kmPack = readPack('km')

const renderedOutsideLegal = scan.entries.filter((entry) => !LEGAL_KEYS.has(entry.key))
const pointsFindings: string[] = []
for (const entry of renderedOutsideLegal) {
  const english = resolveStorefrontCopy('en', t, entry.key, entry.en, entry.km)
  const khmer = resolveStorefrontCopy('km', t, entry.key, entry.en, entry.km)
  for (const value of [english, enPack[entry.key]]) if (value && ENGLISH_POINTS.test(value)) pointsFindings.push(`${entry.key} en "${value}" [${entry.site}]`)
  for (const value of [khmer, kmPack[entry.key]]) if (value && KHMER_POINTS.test(value)) pointsFindings.push(`${entry.key} km "${value}" [${entry.site}]`)
}
assert.deepEqual([...new Set(pointsFindings)], [], `the storefront shows points wording:\n  ${[...new Set(pointsFindings)].join('\n  ')}`)

{
  const source = parseSource(path.join(SRC, 'components/catalog/portalLanguagePacks.ts'))
  const pointsLabels: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer) && KHMER_POINTS.test(node.initializer.text)) {
      pointsLabels.push(`${node.name.getText(source)}: ${node.initializer.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual(pointsLabels, [], 'the public Khmer pack keeps no points labels')
}

const requireActual = createRequire(import.meta.url)
function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom'],
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
}
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const storefrontCopy = (language: 'en' | 'km') => (key: string, fallback = '', fallbackKm = fallback) =>
  resolveStorefrontCopy(language, t, key, fallback, fallbackKm)

const CatalogSecondaryTabs = loadModule('components/catalog/CatalogSecondaryTabs.tsx').default as React.ComponentType<Record<string, unknown>>
const membershipProps = {
  tab: 'membership',
  previewConfig: { submissionEnabled: true, redeemPoints: 100, showMembership: true },
  accountSignedIn: true,
  membershipError: '',
  submissionDraft: { platform: 'Facebook', note: '', screenshots: [], rightsConsent: false, privacyConsent: false },
  setSubmissionDraft: () => {},
  submissionSaving: false,
  handleSubmissionPaste: () => {},
  handleSubmitShareProof: () => {},
  handleUploadSubmissionImages: () => {},
  openPortalImage: () => {},
  redeemSummaryText: '100 points = $1.00',
}
for (const language of ['en', 'km'] as const) {
  const html = renderToStaticMarkup(React.createElement(CatalogSecondaryTabs, { ...membershipProps, copy: storefrontCopy(language) }))
  assert.equal(visibleText(html), MEMBERSHIP_COMING_SOON[language], `the ${language} Membership section shows only the coming-soon line`)
  assert.doesNotMatch(html, /<(?:input|textarea|button|select|form)\b/, `the ${language} Membership section has no form or control`)
}

for (const [key, wording] of Object.entries(MEMBERSHIP_ID_WORDING)) {
  const entry = scan.entries.find((candidate) => candidate.key === key)
  assert.ok(entry, `${key} is still rendered on the storefront`)
  assert.equal(resolveStorefrontCopy('en', t, key, entry.en, entry.km), wording.en, `${key} English is the owner's wording`)
  assert.equal(resolveStorefrontCopy('km', t, key, entry.en, entry.km), wording.km, `${key} Khmer is the owner's wording`)
}
const CatalogAccountSection = loadModule('components/catalog/CatalogAccountSection.tsx').default as React.ComponentType<Record<string, unknown>>
const account = { id: 7, name: 'Dara', phone: '012345678', membershipId: 'LC-00042', points: 250 }
for (const language of ['en', 'km'] as const) {
  const props = { copy: storefrontCopy(language), ready: true, busy: false, error: '', signIn: async () => true, signUp: async () => true, signOut: () => {}, clearError: () => {}, cartCount: 2, wishlistCount: 3 }
  const signedIn = visibleText(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...props, account })))
  assert.ok(signedIn.includes(`${MEMBERSHIP_ID_WORDING.membershipId[language]}: LC-00042`), `the ${language} signed-in card shows the Membership ID`)
  assert.doesNotMatch(signedIn, language === 'en' ? ENGLISH_POINTS : KHMER_POINTS, `the ${language} signed-in card shows no points`)
  assert.ok(!signedIn.includes('250'), `the ${language} signed-in card never prints the points balance`)
  const signedOut = visibleText(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...props, account: null })))
  assert.ok(signedOut.includes(MEMBERSHIP_ID_WORDING.nameOrMembershipId[language]), `the ${language} sign-in form keeps "${MEMBERSHIP_ID_WORDING.nameOrMembershipId[language]}"`)
  assert.doesNotMatch(signedOut, language === 'en' ? ENGLISH_POINTS : KHMER_POINTS, `the ${language} sign-in form shows no points`)
}

console.log(`storefrontMembershipNoPoints: ${new Set(renderedOutsideLegal.map((entry) => entry.key)).size} rendered keys carry no points wording in either language; Membership reads only "${MEMBERSHIP_COMING_SOON.en}"; Membership ID wording kept`)
