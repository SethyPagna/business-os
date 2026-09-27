import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STOCK_REVERT_ERRORS, stockRevertErrorText } from '../src/utils/stockRevertError.ts'

// H-stock 2 (2026-09-27): a second revert of the same stock movement is
// refused atomically by the Worker (cloudflare/src/lib/stockRevert.ts, driven
// for real by cloudflare/scripts/test-stock-revert-race-pure.cjs) with a 409
// and a code. These checks hold the client half: every code the Worker can
// send has operator-language text in both packs, and both surfaces that call
// the revert show it instead of the server's English sentence.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback

runTest('a coded refusal shows the translated text, not the server sentence', () => {
  const error = Object.assign(new Error('This movement has already been reverted.'), { status: 409, code: 'already_reverted' })
  assert.equal(stockRevertErrorText(error, trFrom(packs.km)), packs.km.movement_already_reverted)
  assert.notEqual(packs.km.movement_already_reverted, packs.en.movement_already_reverted)
  const changed = Object.assign(new Error('The stock changed ...'), { status: 409, code: 'stock_changed' })
  assert.equal(stockRevertErrorText(changed, trFrom(packs.km)), packs.km.movement_revert_stock_changed)
})

runTest('an uncoded refusal keeps the server message; nothing at all falls back to Revert failed', () => {
  assert.equal(stockRevertErrorText(new Error('Cannot revert: only 2 in stock'), trFrom(packs.en)), 'Cannot revert: only 2 in stock')
  assert.equal(stockRevertErrorText({ code: 'something_else', message: 'x' }, trFrom(packs.en)), 'x')
  assert.equal(stockRevertErrorText(null, trFrom(packs.en)), packs.en.revert_failed)
})

runTest('every code the Worker returns has a mapping, and every mapping is a Worker code', () => {
  const worker = fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', 'lib', 'stockRevert.ts'), 'utf8')
  const typeLine = /code\?: ([^;}\n]+)/.exec(worker)?.[1] ?? ''
  const workerCodes = [...typeLine.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  assert.ok(workerCodes.length >= 2, `found the RevertResult code union: ${typeLine}`)
  assert.deepEqual(Object.keys(STOCK_REVERT_ERRORS).sort(), workerCodes)
  for (const code of workerCodes) assert.ok(worker.includes(`code: '${code}'`), `Worker actually returns ${code}`)
})

runTest('both language packs carry every key, non-empty', () => {
  for (const [key] of Object.values(STOCK_REVERT_ERRORS)) {
    for (const lang of ['en', 'km']) assert.ok(String(packs[lang][key] || '').trim(), `${lang}.${key}`)
  }
})

runTest('both revert surfaces route errors through stockRevertErrorText', () => {
  for (const file of ['src/components/products/StockChangeSection.tsx', 'src/components/products/StockInSessionsSection.tsx']) {
    const source = read(file)
    assert.ok(source.includes('revertStockMovement('), `${file} calls the revert`)
    assert.ok(source.includes('stockRevertErrorText(error'), `${file} shows the localized refusal`)
  }
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
