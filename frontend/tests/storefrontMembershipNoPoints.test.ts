// Owner, 30 Sep 2026: customers keep their membership, the Membership ID wording stays, and the one
// points row's value reads "Coming soon": no points number or balance ever reaches a shopper.
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

const POINTS_ROW = {
  labelKey: 'membershipPoints',
  valueKey: 'membershipPointsComingSoon',
  label: { en: 'Points', km: 'ពិន្ទុ' },
  value: { en: 'Coming soon', km: 'នឹងមកដល់ឆាប់ៗនេះ' },
}
const RETIRED_MEMBERSHIP_COMING_SOON = /Membership: coming soon|សមាជិកភាព៖ នឹងមកដល់/i

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
  assert.doesNotMatch(`${english} ${khmer}`, RETIRED_MEMBERSHIP_COMING_SOON, `${entry.key} still says membership itself is coming soon [${entry.site}]`)
  if (entry.key === POINTS_ROW.labelKey) {
    assert.equal(english, POINTS_ROW.label.en, `the points row label is exactly "${POINTS_ROW.label.en}" [${entry.site}]`)
    assert.equal(khmer, POINTS_ROW.label.km, `the Khmer points row label is exactly "${POINTS_ROW.label.km}" [${entry.site}]`)
    continue
  }
  if (entry.key === POINTS_ROW.valueKey) {
    assert.equal(english, POINTS_ROW.value.en, `the points value is exactly "${POINTS_ROW.value.en}" [${entry.site}]`)
    assert.equal(khmer, POINTS_ROW.value.km, `the Khmer points value is exactly "${POINTS_ROW.value.km}" [${entry.site}]`)
  }
  for (const value of [english, enPack[entry.key]]) if (value && ENGLISH_POINTS.test(value)) pointsFindings.push(`${entry.key} en "${value}" [${entry.site}]`)
  for (const value of [khmer, kmPack[entry.key]]) if (value && KHMER_POINTS.test(value)) pointsFindings.push(`${entry.key} km "${value}" [${entry.site}]`)
}
for (const key of [POINTS_ROW.labelKey, POINTS_ROW.valueKey]) {
  assert.ok(renderedOutsideLegal.some((entry) => entry.key === key), `the storefront renders the points row key ${key}`)
}
assert.deepEqual([...new Set(pointsFindings)], [], `the storefront shows points wording:\n  ${[...new Set(pointsFindings)].join('\n  ')}`)

{
  const source = parseSource(path.join(SRC, 'components/catalog/portalLanguagePacks.ts'))
  const pointsLabels: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer) && KHMER_POINTS.test(node.initializer.text)
      && !(node.name.getText(source) === POINTS_ROW.labelKey && node.initializer.text === POINTS_ROW.label.km)) {
      pointsLabels.push(`${node.name.getText(source)}: ${node.initializer.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual(pointsLabels, [], 'the public Khmer pack keeps no points labels beyond the points row label')
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
const pointsRowOf = (html: string) => ({
  rows: [...html.matchAll(/<(div|p|li)\b[^>]*data-portal-points-row="true"[^>]*>([\s\S]*?)<\/\1>/g)].map((match) => visibleText(match[2])),
  values: [...html.matchAll(/<(span|strong|dd)\b[^>]*data-portal-points-value="true"[^>]*>([\s\S]*?)<\/\1>/g)].map((match) => visibleText(match[2])),
})
const assertPointsRow = (html: string, language: 'en' | 'km', where: string) => {
  const { rows, values } = pointsRowOf(html)
  assert.deepEqual(values, [POINTS_ROW.value[language]], `the ${language} ${where} has one points value and it reads exactly "${POINTS_ROW.value[language]}"`)
  assert.deepEqual(rows, [`${POINTS_ROW.label[language]}: ${POINTS_ROW.value[language]}`], `the ${language} ${where} points row is the label and the coming-soon value, nothing else`)
}
for (const language of ['en', 'km'] as const) {
  const html = renderToStaticMarkup(React.createElement(CatalogSecondaryTabs, { ...membershipProps, copy: storefrontCopy(language) }))
  const text = visibleText(html)
  assert.ok(text.startsWith(storefrontCopy(language)('membership', 'Membership', 'សមាជិកភាព')), `the ${language} Membership section keeps its Membership heading`)
  assert.doesNotMatch(text, RETIRED_MEMBERSHIP_COMING_SOON, `the ${language} Membership section no longer says membership itself is coming soon`)
  assertPointsRow(html, language, 'Membership section')
  assert.doesNotMatch(text, /[0-9០-៩]/, `the ${language} Membership section prints no number`)
  assert.doesNotMatch(html, /<(?:input|textarea|button|select|form)\b/, `the ${language} Membership section has no form or control`)
}

for (const [key, wording] of Object.entries(MEMBERSHIP_ID_WORDING)) {
  const entry = scan.entries.find((candidate) => candidate.key === key)
  assert.ok(entry, `${key} is still rendered on the storefront`)
  assert.equal(resolveStorefrontCopy('en', t, key, entry.en, entry.km), wording.en, `${key} English is the owner's wording`)
  assert.equal(resolveStorefrontCopy('km', t, key, entry.en, entry.km), wording.km, `${key} Khmer is the owner's wording`)
}
const CatalogAccountSection = loadModule('components/catalog/CatalogAccountSection.tsx').default as React.ComponentType<Record<string, unknown>>
const account = { id: 7, name: 'Dara', phone: '012345678', membershipId: 'LC-00042', points: 250, pointsBalance: 250, balance: 250, redeemValueUsd: 2.5 }
for (const language of ['en', 'km'] as const) {
  const props = { copy: storefrontCopy(language), ready: true, busy: false, error: '', signIn: async () => true, signUp: async () => true, signOut: () => {}, clearError: () => {}, cartCount: 2, wishlistCount: 3 }
  const signedIn = visibleText(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...props, account })))
  assert.ok(signedIn.includes(`${MEMBERSHIP_ID_WORDING.membershipId[language]}: LC-00042`), `the ${language} signed-in card shows the Membership ID`)
  assertPointsRow(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...props, account })), language, 'signed-in card')
  assert.ok(!/250|2\.5/.test(signedIn), `the ${language} signed-in card never prints the points balance or its value`)
  const outsidePointsRow = signedIn.replace(`${POINTS_ROW.label[language]}: ${POINTS_ROW.value[language]}`, '')
  assert.doesNotMatch(outsidePointsRow, language === 'en' ? ENGLISH_POINTS : KHMER_POINTS, `the ${language} signed-in card has no points wording outside the points row`)
  const signedOut = visibleText(renderToStaticMarkup(React.createElement(CatalogAccountSection, { ...props, account: null })))
  assert.ok(signedOut.includes(MEMBERSHIP_ID_WORDING.nameOrMembershipId[language]), `the ${language} sign-in form keeps "${MEMBERSHIP_ID_WORDING.nameOrMembershipId[language]}"`)
  assert.doesNotMatch(signedOut, language === 'en' ? ENGLISH_POINTS : KHMER_POINTS, `the ${language} sign-in form shows no points`)
}

{
  const accountSource = fs.readFileSync(path.join(SRC, 'components/catalog/portalAccount.ts'), 'utf8')
  const profileType = accountSource.match(/export type PortalAccountProfile = \{([^}]*)\}/)
  assert.ok(profileType, 'PortalAccountProfile moved; re-anchor this check')
  assert.doesNotMatch(profileType[1], /point|balance|reward|redeem/i, 'the storefront account profile never carries a points balance')
}

console.log(`storefrontMembershipNoPoints: ${new Set(renderedOutsideLegal.map((entry) => entry.key)).size} rendered keys carry no points wording beyond the points row; the points row reads only "${POINTS_ROW.value.en}" / "${POINTS_ROW.value.km}" with no number; Membership ID wording kept`)
