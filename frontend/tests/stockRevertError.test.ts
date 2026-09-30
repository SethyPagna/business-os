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

// REVERT-FIX F5: the sold/transferred-away refusals name numbers; the Khmer
// text must carry them, not the Worker's English sentence.
runTest('a refusal with numbers shows them in the Khmer text', () => {
  const error = Object.assign(new Error('Cannot revert: only 2 in stock at Shop, 5 needed.'), {
    status: 400, code: 'revert_insufficient_branch_stock', params: { available: 2, needed: 5, branch: 'Shop' },
  })
  const km = stockRevertErrorText(error, trFrom(packs.km))
  assert.ok(!/Cannot revert/.test(km), km)
  assert.ok(km.includes('2') && km.includes('5') && km.includes('Shop'), km)
  assert.ok(!/\{\w+\}/.test(km), `every placeholder filled: ${km}`)
  const lot = stockRevertErrorText({ code: 'revert_insufficient_lot_stock', params: { available: 1, needed: 3 }, message: 'x' }, trFrom(packs.km))
  assert.ok(lot.includes('1') && lot.includes('3') && !/\{\w+\}/.test(lot), lot)
})

runTest('every refusal the Worker can return has a code, a mapping and nothing else', () => {
  const worker = fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', 'lib', 'stockRevert.ts'), 'utf8').replace(/\r\n/g, '\n')
  const union = /export type RevertRefusalCode =([\s\S]*?)\n\n/.exec(worker)?.[1] ?? ''
  const workerCodes = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  assert.ok(workerCodes.length >= 10, `found the RevertRefusalCode union: ${union}`)
  const routes = fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', 'routes', 'inventory.ts'), 'utf8').replace(/\r\n/g, '\n')
  const revertRoute = routes.slice(routes.indexOf("app.post('/movements/:id/revert'"), routes.indexOf("app.post('/stock-in-lines/"))
  const routeCodes = [...revertRoute.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(routeCodes.sort(), ['movement_not_found', 'revert_forbidden'], 'the route\'s own refusals are coded too')
  assert.deepEqual(Object.keys(STOCK_REVERT_ERRORS).sort(), [...workerCodes, ...routeCodes].sort())
  for (const code of workerCodes) assert.ok(worker.includes(`refuse(400, '${code}'`) || worker.includes(`refuse(409, '${code}'`), `Worker actually returns ${code}`)
  // No refusal is built by hand, so none can leave its code behind.
  assert.equal((worker.match(/ok: false/g) || []).length, 3, 'only the result type and the refuse() helper spell ok: false')
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

runTest('Stock Changes names the sale types the Worker refuses as sale-made stock', () => {
  const worker = fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', 'lib', 'stockRevert.ts'), 'utf8')
  const workerSale = JSON.parse((worker.match(/const SALE_SOURCE_TYPES = new Set<string>\((\[[^\]]*\])\)/)?.[1] || '[]').replace(/'/g, '"')) as string[]
  assert.deepEqual(workerSale, ['sale', 'sale_from_damaged'])
  const section = read('src/components/products/StockChangeSection.tsx')
  for (const type of workerSale) assert.ok(section.includes(`detail.movement_type === '${type}'`), `the detail hint treats ${type} as a sale`)
  assert.ok(section.includes("tr(t, 'revert_err_from_sale'") && section.includes("tr(t, 'revert_err_from_return'"), 'the hint uses the same texts as the refusal')
})

// R-REVERT-FIX RF1/RF5: the two refusals added by the fix round are shown in the operator's language.
runTest('the receipt of an undone session and a merge-made row are refused in Khmer, pointing to where to change them', () => {
  for (const code of ['revert_session_undone', 'revert_from_merge']) {
    const text = stockRevertErrorText({ code, message: 'Server English' }, trFrom(packs.km))
    assert.ok(text && text !== 'Server English' && !/[A-Za-z]{4,}/.test(text), `${code}: ${text}`)
    assert.notEqual(text, stockRevertErrorText({ code, message: 'x' }, trFrom(packs.en)), `${code}: km differs from en`)
  }
  assert.match(packs.en.revert_err_from_merge, /Undo the merge from History/)
  assert.match(packs.en.revert_err_session_undone, /Redo that session/)
})

// R-REVERT-FIX RF8: the Stock Changes confirmation states the effect, like the Stock-in Sessions one.
runTest('the Revert confirmation says it removes the change from the purchase and the reports, in both packs', () => {
  assert.match(packs.en.confirm_revert, /purchase/i)
  assert.match(packs.en.confirm_revert, /supplier totals/i)
  assert.match(packs.en.confirm_revert, /reports/i)
  assert.ok(packs.km.confirm_revert.includes('ការទិញ') && packs.km.confirm_revert.includes('របាយការណ៍') && packs.km.confirm_revert.includes('អ្នកផ្គត់ផ្គង់'), packs.km.confirm_revert)
  assert.ok(read('src/components/products/StockChangeSection.tsx').includes("tr(t, 'confirm_revert'"), 'the review shows it')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
