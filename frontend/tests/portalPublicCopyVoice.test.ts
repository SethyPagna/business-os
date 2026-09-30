// Every first-time visitor reads the storefront in Khmer, so each string it renders
// speaks to the shopper about the shop: never an instruction to the merchant, never
// "customers" in the third person. The Website Editor preview reads the same keys
// from src/lang/*.json, so those values follow the same rule.
//
// Run: node tests/portalPublicCopyVoice.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { LEGAL_KEYS, SRC, assertCompleteScan, parseSource, scanStorefrontCopy, storefrontTranslator } from './storefrontCopyScan.ts'

// The K1 sweep of every storefront-rendered value (2026-09-30), with the shopper
// wording each editor-voiced one became.
const SHOPPER_WORDING: Record<string, { en: string; km: string }> = {
  portalAboutFallback: { en: 'Welcome to our store.', km: 'សូមស្វាគមន៍មកកាន់ហាងរបស់យើង។' },
  faqHint: { en: 'Quick answers to common questions.', km: 'ចម្លើយរហ័សចំពោះសំណួរទូទៅ។' },
  liveCatalog: { en: 'Browse our products and check availability.', km: 'រុករកផលិតផលរបស់យើង និងពិនិត្យមើលថាមានស្តុកឬអត់។' },
  promotionsSectionHint: { en: 'Our latest offers and announcements.', km: 'ការផ្ដល់ជូន និងសេចក្ដីជូនដំណឹងថ្មីៗរបស់យើង។' },
}

const KHMER_EDITOR = 'កម្មវិធីកែសម្រួល'
const KHMER_CUSTOMERS = 'អតិថិជន'
const ENGLISH_EDITOR_VOICE = /\b(?:editor|customers?)\b/i

type Tree = Record<string, unknown>
const readPack = (name: string): Tree => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', `${name}.json`), 'utf8')) as Tree

// AppContext flattens nested groups into one namespace, last write wins.
function flatten(input: Tree, target: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(input)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') flatten(value as Tree, target)
    else target[key] = String(value)
  }
  return target
}

function everyValueOf(input: Tree, wanted: string, found: string[] = []): string[] {
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) everyValueOf(value as Tree, wanted, found)
    else if (key === wanted) found.push(String(value))
  }
  return found
}

function publicKhmerPack(): Record<string, string> {
  const source = parseSource(path.join(SRC, 'components/catalog/portalLanguagePacks.ts'))
  const pack: Record<string, string> = {}
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'km' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) pack[property.name.getText(source)] = property.initializer.text
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(Object.keys(pack).length > 100, 'the Khmer storefront pack is read from portalLanguagePacks.ts')
  return pack
}

const t = storefrontTranslator()
const scan = scanStorefrontCopy()
assertCompleteScan(scan)
const enRaw = readPack('en')
const kmRaw = readPack('km')
const enPack = flatten(enRaw)
const kmPack = flatten(kmRaw)
const renderedKeys = new Set(scan.entries.map((entry) => entry.key))

for (const [key, wording] of Object.entries(SHOPPER_WORDING)) {
  const entry = scan.entries.find((candidate) => candidate.key === key)
  assert.ok(entry, `${key} is in the sweep but the storefront no longer renders it`)
  assert.equal(resolveStorefrontCopy('en', t, key, entry.en, entry.km), wording.en, `the storefront English for ${key} is unchanged`)
  assert.equal(resolveStorefrontCopy('km', t, key, entry.en, entry.km), wording.km, `the Khmer storefront renders the approved shopper wording for ${key}`)
  for (const value of everyValueOf(enRaw, key)) assert.equal(value, wording.en, `en.json ${key} (read by the editor preview) is the storefront English`)
  for (const value of everyValueOf(kmRaw, key)) assert.equal(value, wording.km, `km.json ${key} (read by the editor preview) is the storefront Khmer`)
}

const khmerPack = publicKhmerPack()
for (const [key, value] of Object.entries(khmerPack)) {
  assert.ok(!value.includes(KHMER_EDITOR), `the public Khmer pack names the editor in ${key}: ${value}`)
}

const voiceFindings: string[] = []
for (const entry of scan.entries) {
  const khmer = resolveStorefrontCopy('km', t, entry.key, entry.en, entry.km)
  if (khmer.includes(KHMER_EDITOR)) voiceFindings.push(`${entry.key} km names the editor: ${khmer} [${entry.site}]`)
  if (LEGAL_KEYS.has(entry.key)) continue
  const english = resolveStorefrontCopy('en', t, entry.key, entry.en, entry.km)
  const previewEnglish = enPack[entry.key] ?? english
  const previewKhmer = kmPack[entry.key] ?? khmer
  if (khmer.includes(KHMER_CUSTOMERS) || previewKhmer.includes(KHMER_CUSTOMERS)) voiceFindings.push(`${entry.key} km talks about customers: ${khmer} / km.json ${previewKhmer} [${entry.site}]`)
  if (ENGLISH_EDITOR_VOICE.test(english) || ENGLISH_EDITOR_VOICE.test(previewEnglish)) voiceFindings.push(`${entry.key} en is editor-voiced: ${english} / en.json ${previewEnglish} [${entry.site}]`)
}
assert.deepEqual([...new Set(voiceFindings)], [], `storefront text that addresses the merchant:\n  ${[...new Set(voiceFindings)].join('\n  ')}`)

console.log(`portalPublicCopyVoice: ${renderedKeys.size} storefront keys speak to the shopper in both languages; ${Object.keys(SHOPPER_WORDING).length} swept values pinned; ${Object.keys(khmerPack).length} public Khmer values never name the editor`)
