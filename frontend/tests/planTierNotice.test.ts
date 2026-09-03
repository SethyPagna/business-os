import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIMIT_LABEL_KEYS,
  formatPlanNoticeValue,
  humanizePlanLimitId,
  planNoticeLabelKey,
} from '../src/utils/planTier.ts'

// The free-plan notice, and the one thing about it that cannot be checked by
// reading the code: that the Worker's limit table and the admin app's labels
// for it have not drifted apart.
//
// cloudflare/src/lib/planTier.ts owns the numbers and derives the notice list
// from them, deliberately carrying NO display copy -- each notice is
// identified by its PlanLimits field name and the admin app translates it.
// That split is what lets a new limit reach the panel with no client change,
// and it is also exactly how a limit ends up shown to an operator as
// "stockActionDispatchRead" in raw camelCase, or shown in English inside a
// Khmer session. So:
//
//   1. every field of the Worker's table has a label key here
//   2. every one of those keys is in BOTH packs
//   3. the Khmer entry is actually Khmer, not the English string copied over
//
// (3) is the one a pack-parity check misses: km.json can hold the English
// text under the right key and every existing lock still passes.

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const readJson = (rel: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as Record<string, string>

const en = readJson('src/lang/en.json')
const km = readJson('src/lang/km.json')

let failed = 0
const test = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Read the Worker's table as text rather than importing it: it is in the
// other package (its own tsconfig and workers-types), and the only thing
// needed here is the field list, which the object literal states plainly.
const workerPlanTier = fs.readFileSync(
  path.join(ROOT, '..', 'cloudflare', 'src', 'lib', 'planTier.ts'),
  'utf8',
)

function limitFieldsFrom(name: string): string[] {
  const anchor = `const ${name}: PlanLimits = {`
  const start = workerPlanTier.indexOf(anchor)
  assert.ok(start > -1, `expected ${name} in cloudflare/src/lib/planTier.ts`)
  const end = workerPlanTier.indexOf('\n}', start)
  assert.ok(end > start, `expected ${name} to close`)
  const body = workerPlanTier.slice(start + anchor.length, end)
  // Top-level entries only: two spaces of indent, then the field name. The
  // block is heavily commented, so match assignments, never prose.
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):/gm)].map((m) => m[1])
}

const paidFields = limitFieldsFrom('PAID_LIMITS')
const freeFields = limitFieldsFrom('FREE_LIMITS')

test('the Worker table parsed into a plausible field list', () => {
  assert.ok(paidFields.length >= 20, `expected the full limit table, parsed ${paidFields.length} fields`)
  assert.deepEqual([...paidFields].sort(), [...freeFields].sort(), 'both tiers must carry the same fields')
  assert.ok(paidFields.includes('tier'))
  assert.ok(paidFields.includes('rowsPerImportChunk'))
})

test('every Worker limit has a label key in the admin app', () => {
  const unlabelled = paidFields.filter((field) => field !== 'tier' && !LIMIT_LABEL_KEYS[field])
  assert.deepEqual(
    unlabelled,
    [],
    `these limits would reach the panel as raw identifiers -- add them to LIMIT_LABEL_KEYS in src/utils/planTier.ts: ${unlabelled.join(', ')}`,
  )
})

test('no label key describes a limit the Worker no longer has', () => {
  const known = new Set(paidFields)
  const stale = Object.keys(LIMIT_LABEL_KEYS).filter((field) => !known.has(field))
  assert.deepEqual(stale, [], `stale label entries (and their now-dead pack keys): ${stale.join(', ')}`)
})

const KHMER = /[ក-៿]/

test('every label key is present, and translated, in both packs', () => {
  const missingEn: string[] = []
  const missingKm: string[] = []
  const untranslated: string[] = []
  for (const key of Object.values(LIMIT_LABEL_KEYS)) {
    if (!en[key]) missingEn.push(key)
    if (!km[key]) missingKm.push(key)
    else if (!KHMER.test(km[key])) untranslated.push(key)
  }
  assert.deepEqual(missingEn, [], `missing from en.json: ${missingEn.join(', ')}`)
  assert.deepEqual(missingKm, [], `missing from km.json: ${missingKm.join(', ')}`)
  assert.deepEqual(untranslated, [], `km.json holds non-Khmer text for: ${untranslated.join(', ')}`)
})

// The notice's own chrome. These are copy() calls in PlanTierNotice.tsx with
// inline fallbacks, so a missing pack entry does not break the render -- it
// silently shows English inside a Khmer session, which is the bug this
// project's i18n rule exists to prevent.
const CHROME_KEYS = [
  'plan_tier_free_title',
  'plan_tier_free_summary',
  'plan_tier_free_hint_label',
  'plan_tier_free_hint',
  'plan_tier_paid',
  'plan_limit_value_on',
  'plan_limit_value_off',
]

test('the notice chrome is in both packs, in Khmer', () => {
  for (const key of CHROME_KEYS) {
    assert.ok(en[key], `en.json missing ${key}`)
    assert.ok(km[key], `km.json missing ${key}`)
    assert.ok(KHMER.test(km[key]), `km.json holds non-Khmer text for ${key}`)
  }
})

test('the summary keeps its {count} placeholder in both packs', () => {
  // The component substitutes this by string replace; a pack entry that
  // dropped it would render a sentence with no number in it at all.
  assert.match(en.plan_tier_free_summary, /\{count\}/)
  assert.match(km.plan_tier_free_summary, /\{count\}/)
})

test('values render as numbers a human can read, and booleans as words', () => {
  const words = { on: 'on', off: 'off' }
  assert.equal(formatPlanNoticeValue(150, words), '150')
  assert.equal(formatPlanNoticeValue(833_000_000, words), '833,000,000', 'nine-digit ceilings need separators')
  assert.equal(formatPlanNoticeValue(true, words), 'on')
  assert.equal(formatPlanNoticeValue(false, words), 'off')
})

test('an unlabelled id degrades to readable words rather than disappearing', () => {
  assert.equal(planNoticeLabelKey('somethingBrandNew'), null)
  assert.equal(humanizePlanLimitId('somethingBrandNew'), 'Something brand new')
  assert.equal(humanizePlanLimitId('rowsPerImportChunk'), 'Rows per import chunk')
})

test('the notice renders nothing on the paid plan', () => {
  // Paid IS the headroom baseline: there is nothing shrunk to disclose, so a
  // badge saying so would be chrome an operator cannot act on. Source-locked
  // because it is the difference between "compact notice" and "a banner on
  // every Backup page forever".
  const component = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'utils-settings', 'PlanTierNotice.tsx'),
    'utf8',
  )
  assert.match(component, /if \(!status \|\| status\.tier !== 'free' \|\| !status\.notices\.length\) return null/)
  assert.match(component, /<InfoHint/, 'the explanation belongs behind an InfoHint, not inline on the page')
})

test('the notice is mounted on the Backup page', () => {
  const backup = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'utils-settings', 'Backup.tsx'),
    'utf8',
  )
  assert.match(backup, /import PlanTierNotice from '\.\/PlanTierNotice\.tsx'/)
  assert.match(backup, /<PlanTierNotice copy=\{copy\} \/>/)
})

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS planTierNotice')
