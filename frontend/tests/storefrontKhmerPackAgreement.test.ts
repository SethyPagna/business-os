// The Khmer a storefront visitor reads has one source: the pack in portalLanguagePacks.ts.
// Call sites may carry a Khmer fallback, but only a copy of the pack's own text. This walks
// every copy() call the storefront makes (tests/storefrontCopyScan.ts) and fails when
//   - a key has neither a pack entry nor a call-site Khmer fallback,
//   - a pack entry and a call-site fallback for the same key differ,
//   - two call sites give the same key different Khmer or different English,
//   - a Khmer string keeps English words other than brand names and acronyms.
// It pins no key count: a lane that adds a copy() with its Khmer at the call site passes.
//
// Run: node tests/storefrontKhmerPackAgreement.test.ts
import assert from 'node:assert/strict'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'
import { assertCompleteScan, scanStorefrontCopy } from './storefrontCopyScan.ts'

const scan = scanStorefrontCopy()
assertCompleteScan(scan)

const KHMER_SCRIPT = /[ក-៿]/
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g
// Names, acronyms and the browser storage API name that stay in Latin letters inside Khmer text.
const LATIN_ALLOWED = new Set(['AI', 'Chrome', 'Safari', 'Google', 'Maps', 'Leang', 'Cosmetics', 'Beauty', 'Messenger', 'Facebook', 'Instagram', 'Telegram', 'WhatsApp', 'IP', 'HTTPS', 'Sentry', 'Cloudflare', 'Cloudinary', 'Cache', 'Storage'])
const isFlatKey = (key: string) => key.startsWith('portal_a11y_')

const byKey = new Map<string, { english: Set<string>; khmer: Set<string>; sites: string[] }>()
for (const entry of scan.entries) {
  const row = byKey.get(entry.key) || { english: new Set<string>(), khmer: new Set<string>(), sites: [] }
  if (/[A-Za-z]/.test(entry.en.replace(PLACEHOLDER, ''))) row.english.add(entry.en.trim().toLowerCase())
  if (entry.km !== undefined) row.khmer.add(entry.km)
  row.sites.push(entry.site)
  byKey.set(entry.key, row)
}

const problems: string[] = []
for (const [key, row] of byKey) {
  const at = `${key} [${row.sites.slice(0, 3).join(', ')}]`
  const pack = isFlatKey(key) ? '' : getPortalLanguageText('km', key)
  const sites = [...row.khmer]
  if (row.english.size === 0) continue // numbers and placeholders only: nothing to translate
  if (!pack && sites.length === 0) problems.push(`no Khmer in the pack or at any call site: ${at}`)
  if (pack && sites.some((text) => text !== pack)) problems.push(`call-site Khmer differs from the pack "${pack}": ${JSON.stringify(sites)} ${at}`)
  if (!pack && sites.length > 1) problems.push(`call sites disagree on the Khmer: ${JSON.stringify(sites)} ${at}`)
  if (row.english.size > 1) problems.push(`one key, two English texts ${JSON.stringify([...row.english])}: ${at}`)
  for (const text of pack ? [pack] : sites) {
    if (!KHMER_SCRIPT.test(text)) continue
    const stray = (text.replace(PLACEHOLDER, '').match(/[A-Za-z]{2,}/g) || []).filter((word) => !LATIN_ALLOWED.has(word))
    if (stray.length) problems.push(`English left in the Khmer "${text}" (${stray.join(', ')}): ${at}`)
  }
}
assert.deepEqual(problems, [], `${problems.length} Khmer problem(s):\n  ${problems.join('\n  ')}`)

console.log(`storefrontKhmerPackAgreement: ${byKey.size} keys, Khmer present, one text per key, pack and call sites agree`)
