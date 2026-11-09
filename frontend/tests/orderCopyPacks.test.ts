// Every string the storefront's order screens render has English and Khmer in both language packs, and the packs say what the page says (KHQR S7).
//
// The storefront resolves its text through copy(key, English, Khmer) (see legalContent.ts for why it never reads src/lang/*.json), so the packs
// are a MIRROR the admin Website Editor preview and verify:i18n read. This test reads the real copy() calls of the order screens (the same
// scan the shopper-voice and Khmer tests use) and fails if a key is missing from a pack, a pack drifted from the page, a Khmer value is English,
// or one key says two different things at two places.
//
// Run: node tests/orderCopyPacks.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { SRC, assertCompleteScan, scanStorefrontCopy } from './storefrontCopyScan.ts'

const KHMER = /[ក-៿]/
const SLOT = /\{[A-Za-z0-9_]+\}/g
const readPack = (name: string) => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', name), 'utf8')) as Record<string, string>
const en = readPack('en.json')
const km = readPack('km.json')

const scan = scanStorefrontCopy()
assertCompleteScan(scan)
const orderEntries = scan.entries.filter((entry) => entry.key.startsWith('order_'))
const slots = (text: string) => [...(text.match(SLOT) ?? [])].sort()

test('the scan reaches the order screens: every file that renders order text is in it', () => {
  // CATCHES: the order chunks falling out of the storefront's import closure (their text would then escape the shopper-voice and Khmer checks).
  const sites = new Set(orderEntries.map((entry) => entry.site.split(':')[0]))
  for (const file of ['KhqrCard.tsx', 'CheckoutSheet.tsx', 'OrderPage.tsx', 'OrderRequests.tsx', 'OrderEditSheet.tsx', 'OrderRoute.tsx', 'orderErrors.ts']) {
    assert.ok(sites.has(`components/catalog/orders/${file}`), `${file} is not scanned`)
  }
  assert.ok(sites.has('components/catalog/PortalNoPaymentNotice.tsx'), 'the online notice is not scanned')
  assert.ok(sites.has('components/catalog/PublicCatalogPage.tsx'), 'the cart drawer\'s online text is not scanned')
  assert.ok(new Set(orderEntries.map((entry) => entry.key)).size >= 150, 'the order screens have 150+ distinct strings')
})

test('each key says one thing: every use of it has the same English and the same Khmer', () => {
  // CATCHES: a key reused with different wording at a second place (one pack value can only be right for one of them).
  const seen = new Map<string, { en: string; km?: string; site: string }>()
  const clashes: string[] = []
  for (const entry of orderEntries) {
    const first = seen.get(entry.key)
    if (!first) { seen.set(entry.key, entry); continue }
    if (first.en !== entry.en || first.km !== entry.km) clashes.push(`${entry.key}: ${first.site} vs ${entry.site}`)
  }
  assert.deepEqual(clashes, [])
})

test('both packs hold every key, with the page\'s own English and Khmer', () => {
  // CATCHES: a key added to the page and not to a pack (the editor preview shows the raw key), a pack edited without the page, and English left in km.json.
  const problems: string[] = []
  for (const entry of orderEntries) {
    if (en[entry.key] !== entry.en) problems.push(`en.json ${entry.key}: ${JSON.stringify(en[entry.key])} is not the page's ${JSON.stringify(entry.en)}`)
    if (!entry.km) { problems.push(`${entry.key} (${entry.site}) has no Khmer on the page`); continue }
    if (km[entry.key] !== entry.km) problems.push(`km.json ${entry.key}: ${JSON.stringify(km[entry.key])} is not the page's ${JSON.stringify(entry.km)}`)
    if (!KHMER.test(entry.km)) problems.push(`${entry.key} Khmer has no Khmer script: ${entry.km}`)
    if (entry.km === entry.en) problems.push(`${entry.key} Khmer is the English`)
    if (slots(entry.km).join() !== slots(entry.en).join()) problems.push(`${entry.key} has different {slots} in English (${slots(entry.en)}) and Khmer (${slots(entry.km)})`)
  }
  assert.deepEqual(problems, [])
})

test('a sentence is never assembled from pieces: placeholders stand for values, not for words that need translating', () => {
  // CATCHES: "By tapping X you agree to" + a link + "and" + a link (Khmer word order cannot be given); only these slot names are allowed.
  const allowed = new Set(['{amount}', '{time}', '{days}', '{hint}', '{name}', '{available}', '{terms}', '{privacy}', '{date}'])
  const unknown = orderEntries.flatMap((entry) => slots(entry.en).filter((slot) => !allowed.has(slot)).map((slot) => `${entry.key} ${slot}`))
  assert.deepEqual(unknown, [])
})

test('the owner\'s plain-words rule: no jargon a first-time shopper would not know', () => {
  // CATCHES: "token", "payload", "tran id" and the like leaking from the Worker's vocabulary into a shopper's screen, and em dashes in new copy.
  const jargon = /\b(token|payload|callback|webhook|tran[_ ]?id|revision|http|json|api|server|database|undefined|null)\b/i
  const offenders = orderEntries.filter((entry) => jargon.test(entry.en)).map((entry) => `${entry.key}: ${entry.en}`)
  assert.deepEqual(offenders, [])
  const dashes = orderEntries.filter((entry) => /—/.test(entry.en) || (entry.km && /—/.test(entry.km))).map((entry) => entry.key)
  // The standing "No online payments — ..." notice is the owner's own sentence and is not an order key; new order copy uses plain full stops.
  assert.deepEqual(dashes, [])
})
