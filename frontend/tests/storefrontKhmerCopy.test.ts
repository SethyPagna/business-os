// A first-time storefront visitor reads Khmer (P-public-1), so every string the
// storefront renders through its translator must resolve to real Khmer, not
// fall through to the English fallback.
//
// Run: node tests/storefrontKhmerCopy.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { localizeDefaultConfigCopy, resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { FRONTEND_ROOT, assertCompleteScan, readSource, scanStorefrontCopy, storefrontTranslator } from './storefrontCopyScan.ts'

const KHMER_SCRIPT = /[ក-៿]/
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g
const STOREFRONT_T = storefrontTranslator()

const scan = scanStorefrontCopy()
assertCompleteScan(scan)
const { entries } = scan

// Proper names, spelled the same in every language.
const PROPER_NAME_KEYS: Record<string, string> = {
  messenger: 'Facebook Messenger, a product name',
  facebook: 'Facebook, a brand name',
  instagram: 'Instagram, a brand name',
  telegram: 'Telegram, a brand name',
  whatsapp: 'WhatsApp, a brand name',
}
const renderedKeys = new Set(entries.map((entry) => entry.key))
for (const key of Object.keys(PROPER_NAME_KEYS)) assert.ok(renderedKeys.has(key), `${key} is allow-listed but the storefront no longer renders it`)

const gaps = new Map<string, { english: string; khmer: string; sites: Set<string> }>()
for (const entry of entries) {
  if (entry.key in PROPER_NAME_KEYS) continue
  const english = resolveStorefrontCopy('en', STOREFRONT_T, entry.key, entry.en, entry.km)
  if (!/[A-Za-z]/.test(english.replace(PLACEHOLDER, ''))) continue
  const khmer = resolveStorefrontCopy('km', STOREFRONT_T, entry.key, entry.en, entry.km)
  if (khmer.trim() && khmer !== english && KHMER_SCRIPT.test(khmer)) continue
  const gap = gaps.get(entry.key) || { english, khmer, sites: new Set<string>() }
  gap.sites.add(entry.site)
  gaps.set(entry.key, gap)
}
const report = [...gaps].sort(([a], [b]) => a.localeCompare(b)).map(([key, gap]) => `${key} = "${gap.english}" -> km "${gap.khmer}" [${[...gap.sites].join(', ')}]`)
assert.deepEqual(report, [], `${report.length} storefront string(s) render English on the Khmer storefront:\n  ${report.join('\n  ')}`)

// The Worker fills these config fields with English when the merchant left them empty;
// that system text renders in Khmer too, while a merchant's own wording is kept.
{
  const worker = fs.readFileSync(path.join(FRONTEND_ROOT, '..', 'cloudflare', 'src', 'routes', 'portal.ts'), 'utf8')
  const workerDefault = (pattern: RegExp) => {
    const match = pattern.exec(worker)
    assert.ok(match, `the Worker no longer fills ${pattern}`)
    return match[1]
  }
  const workerDefaults = {
    faqTitle: workerDefault(/faqTitle: settings\.customer_portal_faq_title \|\| '([^']+)'/),
    aiTitle: workerDefault(/aiTitle: settings\.customer_portal_ai_title \|\| '([^']+)'/),
    aiDisclaimer: workerDefault(/aiDisclaimer: settings\.customer_portal_ai_disclaimer\s*\|\| '([^']+)'/),
  }
  const website = workerDefault(/website: settings\.customer_portal_website_label \|\| '([^']+)'/)
  const config = { ...workerDefaults, linkLabels: { website, facebook: 'Facebook' } }

  const khmer = localizeDefaultConfigCopy(config, 'km')
  for (const [field, english] of Object.entries(workerDefaults)) {
    const value = String(khmer[field as keyof typeof workerDefaults])
    assert.ok(KHMER_SCRIPT.test(value) && value !== english, `the Worker default ${field} "${english}" renders "${value}" on the Khmer storefront`)
  }
  assert.ok(KHMER_SCRIPT.test(khmer.linkLabels.website), `the Worker default website label renders "${khmer.linkLabels.website}" on the Khmer storefront`)
  assert.equal(khmer.linkLabels.facebook, 'Facebook')
  assert.deepEqual(localizeDefaultConfigCopy(config, 'en'), config)
  const merchantWording = { faqTitle: 'Ask us anything', aiTitle: 'Skin coach', linkLabels: { website: 'Our online shop' } }
  assert.deepEqual(localizeDefaultConfigCopy(merchantWording, 'km'), merchantWording)
  assert.match(
    readSource('components/catalog/PublicCatalogPage.tsx'),
    /localizeDefaultConfigCopy\(\{ \.\.\.DEFAULT_PUBLIC_CONFIG, \.\.\.config \}, pageLanguage\)/,
    'the storefront displayConfig applies it in the routed page language',
  )
}

console.log(`storefrontKhmerCopy: ${renderedKeys.size} storefront keys from ${entries.length} translator calls resolve to Khmer, and so do the Worker's default config texts`)
