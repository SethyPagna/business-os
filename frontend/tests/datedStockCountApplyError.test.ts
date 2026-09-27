import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATED_STOCK_COUNT_APPLY_ERRORS, datedStockCountApplyErrorText } from '../src/utils/datedStockCountApplyError.ts'

// H-stock 1 (2026-09-27): re-applying a dated stock count used to double it.
// The Worker now applies the whole count as one batch and refuses a double
// submit or a stale plan with 409 dated_stock_count_conflict, nothing written
// (driven for real by cloudflare/scripts/test-dated-stock-count-reapply-pure.cjs).
// These checks hold the client half: the refusal reaches a Khmer operator in
// Khmer, from the modal that applies the count, and the code is one the
// Worker actually sends.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback

runTest('the conflict refusal shows the translated text, thrown or returned', () => {
  const thrown = Object.assign(new Error('The stock count history for these products changed ...'), { status: 409, code: 'dated_stock_count_conflict' })
  assert.equal(datedStockCountApplyErrorText(thrown, trFrom(packs.km)), packs.km.dated_count_apply_conflict)
  const returned = { success: false, error: 'The stock count history ...', code: 'dated_stock_count_conflict' }
  assert.equal(datedStockCountApplyErrorText(returned, trFrom(packs.km)), packs.km.dated_count_apply_conflict)
  assert.notEqual(packs.km.dated_count_apply_conflict, packs.en.dated_count_apply_conflict)
})

runTest('an uncoded failure keeps the server message; nothing at all falls back to the apply-failed text', () => {
  assert.equal(datedStockCountApplyErrorText(new Error('Row 4: unknown product'), trFrom(packs.en)), 'Row 4: unknown product')
  assert.equal(datedStockCountApplyErrorText({ success: false, error: 'Plan too large' }, trFrom(packs.en)), 'Plan too large')
  assert.equal(datedStockCountApplyErrorText(null, trFrom(packs.km)), packs.km.dated_count_apply_failed)
})

runTest('every mapped code is one the Worker apply route actually returns', () => {
  const route = fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', 'routes', 'inventory.ts'), 'utf8')
  for (const code of Object.keys(DATED_STOCK_COUNT_APPLY_ERRORS)) {
    assert.ok(route.includes(`code: '${code}' }, 409)`), `routes/inventory.ts returns 409 ${code}`)
  }
})

runTest('both language packs carry every key, non-empty', () => {
  for (const [key] of Object.values(DATED_STOCK_COUNT_APPLY_ERRORS)) {
    for (const lang of ['en', 'km']) assert.ok(String(packs[lang][key] || '').trim(), `${lang}.${key}`)
  }
})

runTest('the dated stock count modal routes both apply failure paths through the mapping', () => {
  const source = read('src/components/products/import/DatedStockReconciliationModal.tsx')
  const start = source.indexOf('async function runApply()')
  assert.ok(start > 0, 'found runApply()')
  const apply = source.slice(start, source.indexOf('function updateDecision', start))
  assert.ok(apply.includes('await apiApply('), 'found runApply')
  assert.equal(apply.split('datedStockCountApplyErrorText(').length - 1, 2, 'returned failure and thrown failure both mapped')
  assert.ok(!/e instanceof Error \? e\.message/.test(apply), 'no raw server sentence in the apply path')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
