// Keys the public-web overhaul left without a reader were removed from the Khmer pack,
// legalContent.ts and both language packs. This pins that none of them comes back, for
// example through a union merge of the packs (tests would still pass: nothing reads them).
//
// Run: node tests/portalRetiredKeys.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'
import { PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const readJson = (name: string) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', name), 'utf8')) as Record<string, unknown>

const RETIRED_PACK_KEYS = ['liveCatalog', 'liveCatalogNoStock', 'promotionsSectionHint', 'clickToViewDetails', 'productOfficialName', 'faqHint', 'assistantNotice', 'mapCard', 'noPaymentNotice', 'noPaymentNoticeShort', 'bucketHint', 'signupReminder', 'accountSubtitle']
const RETIRED_LEGAL_KEYS = ['portal_legal_map_consent_b', 'portal_legal_map_consent_load', 'portal_legal_map_consent_link', 'portal_legal_consent_label', 'portal_legal_consent_read_terms', 'portal_legal_consent_read_privacy']
const RETIRED_A11Y_KEYS = ['social_links', 'choose_account', 'contact_messenger', 'contact_telegram', 'contact_instagram', 'contact_whatsapp', 'contact_phone'].map((name) => `portal_a11y_${name}`)

for (const key of RETIRED_PACK_KEYS) assert.equal(getPortalLanguageText('km', key), '', `${key} is back in the Khmer pack`)
for (const key of RETIRED_LEGAL_KEYS) {
  assert.equal(key in PORTAL_LEGAL_EN, false, `${key} is back in legalContent.ts (en)`)
  assert.equal(key in PORTAL_LEGAL_KM, false, `${key} is back in legalContent.ts (km)`)
}
for (const name of ['en.json', 'km.json']) {
  const pack = readJson(name)
  for (const key of [...RETIRED_PACK_KEYS, ...RETIRED_LEGAL_KEYS, ...RETIRED_A11Y_KEYS]) {
    // liveCatalogNoStock, productOfficialName, noPaymentNotice, noPaymentNoticeShort, signupReminder and accountSubtitle were never top-level keys here.
    assert.equal(key in pack, false, `${key} is back in ${name}`)
  }
}

console.log(`portalRetiredKeys: ${RETIRED_PACK_KEYS.length + RETIRED_LEGAL_KEYS.length + RETIRED_A11Y_KEYS.length} retired keys stay out of the pack, legalContent.ts, en.json and km.json`)
