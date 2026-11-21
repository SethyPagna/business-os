// Beauty Assistant, public-web overhaul 20 Nov 2026 (spec section 8): one column, the disclosure said once behind an info icon, example chips,
// a counter only after 400 characters, consent once per browser AND consent version while the request still carries the explicit flag the
// Worker requires, and each recommendation on one compact solid row. Run: node tests/portalAssistantLayout.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AI_CONSENT_STORAGE_KEY,
  AI_CONSENT_VERSION,
  aiConsentGiven,
  saveAiConsent,
} from '../src/components/catalog/legal/aiProviderDisclosure.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const raw = read('../src/components/catalog/CatalogSecondaryTabs.tsx')
const tabs = code(raw)
const from = tabs.indexOf('export function AssistantDisclosure(')
const ai = tabs.slice(from, tabs.indexOf('export default function CatalogSecondaryTabs('))
const page = code(read('../src/components/catalog/PublicCatalogPage.tsx'))

let failed = 0
function run(name: string, test: () => void): void {
  try { test(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

class MemoryStore {
  data = new Map<string, string>()
  getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key) as string : null }
  setItem(key: string, value: string): void { this.data.set(key, value) }
  removeItem(key: string): void { this.data.delete(key) }
}

run('consent is remembered per browser and per consent version, and can be withdrawn', () => {
  const store = new MemoryStore()
  assert.equal(aiConsentGiven(store), false, 'nobody has agreed yet')
  saveAiConsent(store, true)
  assert.equal(store.getItem(AI_CONSENT_STORAGE_KEY), AI_CONSENT_VERSION, 'the version is what is stored, not a bare yes')
  assert.equal(aiConsentGiven(store), true, 'a later visit is not asked again')
  store.setItem(AI_CONSENT_STORAGE_KEY, 'ai-1999-01-01')
  assert.equal(aiConsentGiven(store), false, 'an older consent version asks once more')
  store.setItem(AI_CONSENT_STORAGE_KEY, '1')
  assert.equal(aiConsentGiven(store), false, 'the old session flag "1" is not consent to this version')
  saveAiConsent(store, true)
  saveAiConsent(store, false)
  assert.equal(aiConsentGiven(store), false, 'withdrawn')
  assert.equal(store.getItem(AI_CONSENT_STORAGE_KEY), null)
})

run('blocked storage never throws and never counts as consent', () => {
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(aiConsentGiven(blocked), false)
  assert.doesNotThrow(() => saveAiConsent(blocked, true))
  assert.doesNotThrow(() => saveAiConsent(blocked, false))
  assert.equal(aiConsentGiven(null), false)
})

run('the request still carries the explicit consent flag, and nothing is sent without it', () => {
  assert.match(page, /if \(!assistantDataUseConsent\) \{[\s\S]*?return\s*\}/, 'the page still refuses to send without consent')
  assert.match(page, /askPortalAi\?\.\(\{ question, profile: assistantProfile, dataUseConsent: true \}\)/, 'the request carries dataUseConsent: true')
  assert.match(ai, /const send = \(\) => \{[\s\S]*?if \(!assistantDataUseConsent && assistantQuestion\.trim\(\)\) \{\s*setConsentPanel\(true\)\s*return\s*\}\s*askAssistant\(\)/, 'the first Send with a question opens the consent panel instead of sending')
  assert.match(ai, /const agreeAndSend = \(\) => \{\s*changeConsent\(true\)\s*setConsentPanel\(false\)\s*setSendAfterConsent\(true\)/)
  assert.match(ai, /useEffect\(\(\) => \{\s*if \(!sendAfterConsent \|\| !assistantDataUseConsent\) return\s*setSendAfterConsent\(false\)\s*askAssistant\(\)/, 'Agree and send sends from the render that already holds the flag')
  assert.doesNotMatch(ai, /type="checkbox"/, 'no always-visible checkbox')
  assert.doesNotMatch(tabs, /sessionStorage/, 'consent is per browser (localStorage), not per tab session')
})

run('one column, max 720 px: no two-column grid, no yellow card, no right-hand paragraph', () => {
  assert.match(ai, /<section data-portal-assistant="true" className="mx-auto w-full max-w-\[720px\] py-5">/)
  assert.doesNotMatch(ai, /xl:grid-cols|lg:grid-cols-\[1|bg-amber-50|border-amber-200|text-amber-900/, 'the two-column grid and the yellow card are gone')
  assert.doesNotMatch(ai, /text-\[11px\]/, 'the small right-hand paragraph is gone')
})

run('the disclosure is said once, behind an info icon next to the heading, with the facts intact and Withdraw consent inside', () => {
  assert.match(ai, /<LazyPortalMenu[\s\S]*?aria-label=\{infoLabel\} title=\{infoLabel\}[\s\S]*?<Info /)
  assert.match(ai, /copy\('assistantInfo', 'About the assistant', 'អំពីជំនួយការ'\)/)
  assert.equal((ai.match(/ASSISTANT_AUTOMATED_EN/g) || []).length, 1, 'the long paragraph renders in one place only')
  const en = /const ASSISTANT_AUTOMATED_EN = '([^']+)'/.exec(tabs)?.[1] ?? ''
  const km = /const ASSISTANT_AUTOMATED_KM = '([^']+)'/.exec(tabs)?.[1] ?? ''
  for (const fact of [/automated software/, /not medical advice/, /third-party AI provider\{providerNames\}/, /outside Cambodia/, /\{providerRetention\}/, /30 days/, /personal or medical details/, /pharmacist or doctor/]) assert.match(en, fact, `English keeps ${fact}`)
  for (const fact of [/ភាគីទីបី\{providerNames\}/, /ក្រៅប្រទេសកម្ពុជា/, /\{providerRetention\}/, /៣០ថ្ងៃ/, /មិនមែនជាការណែនាំវេជ្ជសាស្ត្រ/, /ឱសថការី/]) assert.match(km, fact, `Khmer keeps ${fact}`)
  assert.match(ai, /copy\('assistantConsentWithdraw', 'Withdraw consent', 'ដកការយល់ព្រម'\)/)
  assert.ok(ai.includes('onWithdraw={assistantDataUseConsent ? () => { changeConsent(false); closeMenu() } : undefined}'), 'Withdraw consent lives in the popover, only while consent is given')
})

run('the consent line keeps every fact: third-party provider, outside Cambodia, 30 days, no personal, medical or payment details', () => {
  const en = /const ASSISTANT_CONSENT_EN = '([^']+)'/.exec(tabs)?.[1] ?? ''
  const km = /const ASSISTANT_CONSENT_KM = '([^']+)'/.exec(tabs)?.[1] ?? ''
  for (const fact of [/question and any details/, /third-party AI provider\{providerNames\}/, /outside Cambodia/, /30 days/, /personal, medical and payment details/]) assert.match(en, fact, `English keeps ${fact}`)
  for (const fact of [/ភាគីទីបី\{providerNames\}/, /ក្រៅប្រទេសកម្ពុជា/, /៣០ថ្ងៃ/, /ព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់/]) assert.match(km, fact, `Khmer keeps ${fact}`)
  assert.match(ai, /copy\('assistantAgreeSend', 'Agree and send', 'យល់ព្រម ហើយផ្ញើ'\)/)
})

run('one tagline under the heading; four example chips fill the box; details sit behind one button', () => {
  assert.match(ai, /copy\('assistantTagline', 'AI suggestions, not medical advice\.', 'ការណែនាំពី AI មិនមែនជាយោបល់វេជ្ជសាស្ត្រទេ។'\)/)
  assert.equal((ai.match(/copy\('assistantExample\d', '[^']+', '[ក-៿][^']*'\)/g) || []).length, 4, 'four examples, each with Khmer')
  assert.equal((ai.match(/copy\('skin(?:Dry|Oily|Combination|Sensitive|Normal|AcneProne)', '[^']+', '[ក-៿][^']*'\)/g) || []).length, 6, 'the six fixed skin types are chips with Khmer')
  assert.match(ai, /const fillExample = \(text: string\) => \{\s*setAssistantQuestion\(text\)\s*questionRef\.current\?\.focus\(\)/)
  assert.match(ai, /\{!assistantQuestion \? \(\s*<div className="mb-3 flex flex-wrap gap-2" data-portal-assistant-examples="true">/, 'the chips show while the box is empty')
  assert.match(ai, /copy\('assistantAddDetails', 'Add details', 'បន្ថែមព័ត៌មាន'\)/)
  assert.match(ai, /\{detailsOpen \? \(\s*<div className="mt-3 space-y-3" data-portal-assistant-details="true">/, 'details render only when opened')
  assert.doesNotMatch(ai, /<details/, 'the old collapsible is gone')
  assert.match(ai, /aria-pressed=\{active\}/, 'the fixed skin types are toggle chips')
})

run('the box grows with its text and the counter shows only after 400 characters', () => {
  assert.match(tabs, /const ASSISTANT_COUNTER_FROM = 400/)
  assert.match(ai, /rows=\{2\}/)
  assert.match(ai, /box\.style\.height = `\$\{Math\.min\(box\.scrollHeight, 192\)\}px`/)
  assert.match(ai, /\{assistantQuestion\.length > ASSISTANT_COUNTER_FROM \? \(/)
  assert.doesNotMatch(ai, /\{assistantQuestion\.length\}\/\{questionCharLimit\}<\/div>\s*\n?\s*<\/div>\s*\n\s*<details/, 'no always-visible n/500')
})

run('a recommendation is one compact solid row: image, name, stock badge, Add; nothing translucent anywhere in the assistant', () => {
  assert.match(ai, /<article key=\{item\.product_id\} className=\{`rounded-2xl p-3 \$\{SURFACE\}`\}>/)
  assert.match(ai, /<AssistantStockBadge status=\{item\.stock_status\} copy=\{copy\} \/>/)
  assert.match(ai, /onAddRecommendation && Number\.isFinite\(productId\)/, 'without the wiring prop the row has no Add button')
  assert.match(ai, /copy\('addToList', 'Add', 'បន្ថែម'\)/)
  const solid = /(?:\b(?:dark:)?(?:hover:)?(?:bg|border|ring|from|via|to|divide|shadow)-[\w[\]#.,()-]+\/\d+|backdrop-blur[\w-]*|bg-transparent|\bopacity-\d+)/g
  assert.deepEqual(tabs.match(solid) || [], [], 'no opacity suffix, blur or transparent fill anywhere in CatalogSecondaryTabs.tsx')
})

run('the reset button clears the question as well as the answer, as its name says', () => {
  assert.ok(tabs.includes("copy('assistantReset', 'Clear the question and answer')"), 'the button is named for the question and the answer')
  const start = page.indexOf('const clearAssistantState = () => {')
  assert.ok(start > 0, 'the storefront page defines clearAssistantState')
  const body = page.slice(start, page.indexOf('\n  }', start))
  assert.ok(body.includes("setAssistantQuestion('')"), 'it empties the question box')
  assert.ok(body.includes('setAssistantResponse(null)') && body.includes("setAssistantError('')"), 'and still clears the answer and the error')
})

if (failed) {
  console.error(`\n${failed} assistant check(s) failed`)
  process.exit(1)
}
console.log('\nAll assistant checks passed')
