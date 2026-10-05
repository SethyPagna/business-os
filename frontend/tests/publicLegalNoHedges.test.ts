// G38 P0: the storefront policies state facts plainly (owner rule 16 Sep
// 2026: "avoid using words like about and all, just gives off the feeling
// that you're unsure"), and keep the 30 Sep privacy substance: no billing
// data is kept or asked for, and nobody should ever be given bank details.
//
// Scans every legal string the storefront renders (policy sections, the
// cookie table, the footer content line, the map consent) in English and
// Khmer, and the inline map-consent fallback. Control: the retired
// 30 Sep wording must fail the same scan.
//
// Run: node tests/publicLegalNoHedges.test.ts
import assert from 'node:assert/strict'
import { LEGAL_PAGE_SECTIONS, LEGAL_STORAGE_ROWS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'
import fs from 'node:fs'

const embedSource = fs.readFileSync(new URL('../src/components/catalog/legal/PortalEmbedConsent.tsx', import.meta.url), 'utf8')
const MAP_CONSENT_BODY_EN = /export const MAP_CONSENT_BODY_EN = '([^']*)'/.exec(embedSource)?.[1] ?? ''
const MAP_CONSENT_BODY_KM = /export const MAP_CONSENT_BODY_KM = '([^']*)'/.exec(embedSource)?.[1] ?? ''

const EN_HEDGE = /\b(?:may|might|perhaps|possibly|approximately|roughly|generally|around \d)\b|\babout (?:an? (?:hour|day|week|month|year)|one|two|thirty|ninety|\d+)\b/i
const KM_HEDGE = /ប្រហែល/

const rendered = new Set<string>(['portal_legal_footer_content_concerns', 'portal_legal_map_consent_b'])
for (const sections of Object.values(LEGAL_PAGE_SECTIONS)) for (const section of sections) { rendered.add(section.heading); for (const body of section.bodies) rendered.add(body) }
for (const row of LEGAL_STORAGE_ROWS) { rendered.add(row.kindKey); rendered.add(row.purposeKey); rendered.add(row.lifetimeKey) }

function scan(en: Record<string, string>, km: Record<string, string>): string[] {
  const found: string[] = []
  for (const key of rendered) {
    if (EN_HEDGE.test(en[key] || '')) found.push(`en ${key}: ${en[key]}`)
    if (KM_HEDGE.test(km[key] || '')) found.push(`km ${key}: ${km[key]}`)
  }
  return found
}

let passed = 0
function check(name: string, fn: () => void) {
  try { fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${(error as Error).message}`) }
}

check('no rendered policy string hedges, in English or Khmer', () => {
  assert.ok(rendered.size > 40, `expected the full rendered key set, got ${rendered.size}`)
  assert.deepEqual(scan(PORTAL_LEGAL_EN, PORTAL_LEGAL_KM), [])
  assert.doesNotMatch(MAP_CONSENT_BODY_EN, EN_HEDGE)
  assert.doesNotMatch(MAP_CONSENT_BODY_KM, /អាចកំណត់/)
  assert.equal(MAP_CONSENT_BODY_EN, PORTAL_LEGAL_EN.portal_legal_map_consent_b, 'the inline map-consent fallback matches the policy text')
  assert.equal(MAP_CONSENT_BODY_KM, PORTAL_LEGAL_KM.portal_legal_map_consent_b)
})

check('privacy keeps its substance: no billing data, never share bank details (EN + KM)', () => {
  assert.match(PORTAL_LEGAL_EN.portal_legal_privacy_collect_list, /We do not keep billing information and never ask for it\./)
  assert.match(PORTAL_LEGAL_EN.portal_legal_privacy_scam_b, /never give your bank details, card numbers or passwords to anyone/)
  assert.match(PORTAL_LEGAL_KM.portal_legal_privacy_collect_list, /យើងមិនរក្សាទុកព័ត៌មានទូទាត់ប្រាក់ ហើយក៏មិនដែលសុំវាដែរ។/)
  assert.match(PORTAL_LEGAL_KM.portal_legal_privacy_scam_b, /សូមកុំផ្តល់ព័ត៌មានគណនីធនាគារ/)
  assert.match(PORTAL_LEGAL_EN.portal_legal_terms_nopayment_b, /We will never ask for your bank details/)
})

check('control: the retired 30 Sep wording fails the same scan', () => {
  const retiredEn = { ...PORTAL_LEGAL_EN,
    portal_legal_terms_account_b: 'tell us if someone else may be using your account. We may pause an account that is misused.',
    portal_legal_privacy_retention_b: 'Security records are removed after about a day.' }
  const retiredKm = { ...PORTAL_LEGAL_KM, portal_legal_store_session_l: 'រហូតដល់ប្រហែល ១៣ ខែ។' }
  assert.equal(scan(retiredEn, retiredKm).length, 3)
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
