// FAQ, public-web overhaul 20 Nov 2026 (spec sections 1 and 7): the search is a field with a line that reaches 3:1 on the page and on the
// card, the list is one solid surface, one answer is open at a time, the subtitle is gone and the closing card is one row with the
// Contact button. Run: node tests/portalFaqSurface.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contrastRatio } from '../src/components/catalog/portalContrast.ts'
import { faqEntries, nextOpenFaqKey } from '../src/components/catalog/portalFaqLayout.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const tabs = code(read('../src/components/catalog/CatalogSecondaryTabs.tsx'))
const from = tabs.indexOf('function FaqSkeleton(')
const faq = tabs.slice(from, tabs.indexOf('const ASSISTANT_CONSENT_KEY'))
const section = faq.slice(faq.indexOf('function CatalogFaqSection('))
const list = faq.slice(faq.indexOf('export function FaqList('), faq.indexOf('function CatalogFaqSection('))

let failed = 0
function run(name: string, test: () => void): void {
  try { test(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// Tailwind steps used by the field recipe.
const HEX: Record<string, string> = { 'stone-400': '#a8a29e', 'stone-500': '#78716c', 'neutral-500': '#737373', 'neutral-600': '#525252' }
const IVORY = '#f4f1ea'
const WHITE = '#ffffff'
const DARK_PAGE = '#0b0b0c'
const DARK_CARD = '#171717'

run('the field line reaches 3:1 on the page and on the card, light and dark (stone-400 does not, so the step changed)', () => {
  const field = /const FIELD = '([^']+)'/.exec(read('../src/components/catalog/CatalogSecondaryTabs.tsx'))?.[1] ?? ''
  const light = /(?<![:-])border-(stone-\d+)/.exec(field)?.[1] ?? ''
  const dark = /dark:border-(neutral-\d+)/.exec(field)?.[1] ?? ''
  assert.ok(HEX[light] && HEX[dark], `unexpected steps in "${field}"`)
  for (const [name, a, b] of [['light page', HEX[light], IVORY], ['light card', HEX[light], WHITE], ['dark page', HEX[dark], DARK_PAGE], ['dark card', HEX[dark], DARK_CARD]] as const) {
    assert.ok(contrastRatio(a, b) >= 3, `${name}: ${contrastRatio(a, b).toFixed(2)}:1`)
  }
  // Controls: the steps the spec first named fail, which is why they moved.
  assert.ok(contrastRatio(HEX['stone-400'], WHITE) < 3, 'stone-400 on white')
  assert.ok(contrastRatio(HEX['neutral-600'], DARK_CARD) < 3, 'neutral-600 on the dark card')
  assert.match(field, /bg-white/)
  assert.match(field, /placeholder:text-stone-500/)
  assert.match(field, /focus-visible:border-\[#7a5c22\]/)
  assert.match(field, /dark:bg-neutral-900/)
})

run('the search is a field (rounded-xl, the field recipe), not a pill with a card line', () => {
  const input = /<input\s+type="search"[\s\S]*?\/>/.exec(list)?.[0] ?? ''
  assert.match(input, /className=\{`h-11 w-full rounded-xl pl-10 pr-11 text-sm \$\{FIELD\}`\}/)
  assert.doesNotMatch(input, /rounded-full|border-stone-300/)
})

run('the list is ONE surface; rows are lines inside it, not cards; one answer opens at a time', () => {
  assert.equal((list.match(/<ul /g) || []).length, 1)
  assert.match(list, /<ul className=\{`m-0 list-none overflow-hidden rounded-2xl p-0 \$\{SURFACE\}`\}>/)
  assert.match(list, /<li key=\{key\} className="border-t border-stone-200 first:border-t-0 dark:border-neutral-700">/)
  assert.match(list, /setExpandedFaqId\(\(current\) => nextOpenFaqKey\(current, key\)\)/)
  const [first, second] = faqEntries([{ id: 'a' }, { id: 'a' }])
  assert.equal(nextOpenFaqKey(nextOpenFaqKey(null, first.key), second.key), second.key, 'opening another closes the first, even with a repeated id')
  assert.equal(nextOpenFaqKey(first.key, first.key), null)
})

run('no subtitle: the heading stands alone', () => {
  assert.doesNotMatch(section, /subtitle=|faqHint/)
  assert.match(section, /<SectionShell title=\{previewConfig\.faqTitle \|\| copy\('faq', 'FAQ'\)\}>/)
})

run('the closing card is the question and the chat rows themselves, with no second sentence and no Contact button', () => {
  const row = /<div className=\{`mt-4 space-y-3 rounded-2xl px-4 py-3 \$\{SURFACE\}`\} data-portal-faq-contact="true">[\s\S]*?<\/div>/.exec(list)?.[0] ?? ''
  assert.ok(row, 'the closing card')
  assert.match(row, /copy\('faqStillHeading', 'Still have a question\?'/)
  assert.match(row, /<PortalContactRows inline entries=\{contactEntries\} copy=\{copy\} className="grid gap-2 sm:grid-cols-2" \/>/)
  assert.doesNotMatch(list, /faqStillBody|PortalContactButton|onOpenContact/, 'the "Ask our team" line and the button are gone')
  assert.doesNotMatch(tabs, /copy\('contactUs'/, 'no Contact button text on this page')
})

run('every FAQ surface is solid: no opacity suffix, no blur, no transparent fill, in light or dark', () => {
  const solid = /(?:\b(?:dark:)?(?:hover:)?(?:bg|border|ring|from|via|to|divide|shadow)-[\w[\]#.,()-]+\/\d+|backdrop-blur[\w-]*|bg-transparent|\bopacity-\d+)/g
  assert.deepEqual(faq.match(solid) || [], [])
})

if (failed) {
  console.error(`\n${failed} FAQ check(s) failed`)
  process.exit(1)
}
console.log('\nAll FAQ checks passed')
