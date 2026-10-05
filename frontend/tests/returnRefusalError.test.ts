import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RETURN_REFUSAL_DETAILS, RETURN_REFUSAL_ERRORS, returnRefusalText } from '../src/components/returns/helpers/returnRefusalError.ts'

// FX-returns2 F4 (2026-09-28): the FX-returns fixes refuse four return writes
// with a machine code next to an English sentence -- editing a cancelled
// return, restoring a legacy-sale return past the sold quantity, and the two
// refund-price refusals. A Khmer till showed the English sentence. These
// checks hold the client half: each refusal reaches the operator in the UI
// language on every surface that can receive it, the code is one the Worker
// actually sends, and any other failure keeps the server's own message.
// The Worker half is driven for real by
// cloudflare/scripts/test-returns-bulk-legacy-restore-capacity-pure.cjs,
// test-return-edit-cancelled-refused-native.cjs and
// test-return-refund-price-sale-line-native.cjs.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const readWorker = (rel: string) => fs.readFileSync(path.join(root, '..', 'cloudflare', 'src', rel), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback
const CODES = ['return_edit_cancelled', 'return_restore_over_capacity', 'return_refund_price_ambiguous', 'return_refund_sale_line_required']

runTest('the mapping covers exactly the four FX-returns refusal codes', () => {
  assert.deepEqual(Object.keys(RETURN_REFUSAL_ERRORS).sort(), [...CODES].sort())
})

runTest('each coded refusal shows the pack text -- Khmer on a Khmer till', () => {
  for (const code of CODES) {
    const thrown = Object.assign(new Error('English server sentence'), { status: 409, code })
    assert.equal(returnRefusalText(thrown, trFrom(packs.km)), packs.km[code], `km ${code}`)
    assert.equal(returnRefusalText(thrown, trFrom(packs.en)), packs.en[code], `en ${code}`)
    assert.ok(String(packs.en[code] || '').trim(), `en.${code} is non-empty`)
    assert.match(String(packs.km[code] || ''), /[ក-៿]/, `km.${code} is Khmer, not a copy of the English`)
    assert.equal(packs.en[code], RETURN_REFUSAL_ERRORS[code], `en.${code} is the helper's English fallback, one statement`)
  }
})

// FX-exc1 item 4 (28 Sep 2026): the restore refusal came back as a sentence
// with no product and no counts. The Worker now sends them as params, and
// the restated sentence names them in the operator's language.
runTest('a restore refusal with its params names the product and both counts, in both languages', () => {
  const params = { product: 'Serum', returned: 4, sold: 2 }
  const thrown = Object.assign(new Error('English server sentence'), { status: 409, code: 'return_restore_over_capacity', params })
  const detail = RETURN_REFUSAL_DETAILS.return_restore_over_capacity
  assert.equal(detail.key, 'return_restore_over_capacity_detail')
  assert.equal(packs.en[detail.key], detail.english, 'en is the helper\'s English fallback, one statement')
  assert.equal(returnRefusalText(thrown, trFrom(packs.en)), 'Cannot restore: 4 of Serum would count as returned, but the sale sold only 2. Nothing was changed.')
  const km = String(returnRefusalText(thrown, trFrom(packs.km)) || '')
  assert.match(km, /[ក-៿]/, 'km is Khmer')
  assert.notEqual(packs.km[detail.key], packs.en[detail.key])
  for (const value of ['Serum', '4', '2']) assert.ok(km.includes(value), `km names ${value}`)
  assert.ok(!/[{}]/.test(km), 'every km placeholder is filled')
  for (const name of detail.params) {
    assert.ok(String(packs.en[detail.key]).includes(`{${name}}`), `en names {${name}}`)
    assert.ok(String(packs.km[detail.key]).includes(`{${name}}`), `km names {${name}}`)
  }
  // A pack without the detail key still gives the English detail.
  assert.equal(returnRefusalText(thrown, (_key, fallback) => fallback), 'Cannot restore: 4 of Serum would count as returned, but the sale sold only 2. Nothing was changed.')
})

runTest('a restore refusal missing any param keeps the plain sentence; a name is printed as it is', () => {
  const refusal = (params: unknown) => Object.assign(new Error('English'), { status: 409, code: 'return_restore_over_capacity', params })
  for (const params of [null, undefined, [], {}, { product: 'Serum', returned: 4 }, { product: '  ', returned: 4, sold: 2 },
    { product: 'Serum', returned: Number.NaN, sold: 2 }, { product: 'Serum', returned: '4', sold: null }]) {
    assert.equal(returnRefusalText(refusal(params), trFrom(packs.km)), packs.km.return_restore_over_capacity, JSON.stringify(params))
  }
  assert.equal(returnRefusalText(refusal({ product: 'Gift {sold}', returned: 1.5, sold: '1' }), trFrom(packs.en)),
    'Cannot restore: 1.5 of Gift {sold} would count as returned, but the sale sold only 1. Nothing was changed.',
    'the product name is not substituted a second time')
  // Only this code has a detail sentence; another code's params change nothing.
  assert.equal(returnRefusalText(Object.assign(new Error('x'), { code: 'return_edit_cancelled', params: { product: 'Serum', returned: 4, sold: 2 } }), trFrom(packs.km)),
    packs.km.return_edit_cancelled)
})

runTest('an uncoded or foreign-coded failure returns null, so the caller keeps the server message', () => {
  assert.equal(returnRefusalText(new Error('Return not found'), trFrom(packs.km)), null)
  assert.equal(returnRefusalText(Object.assign(new Error('Return changed'), { code: 'write_conflict' }), trFrom(packs.km)), null)
  assert.equal(returnRefusalText(Object.assign(new Error('x'), { code: 'toString' }), trFrom(packs.km)), null, 'no prototype key is a refusal')
  assert.equal(returnRefusalText(null, trFrom(packs.km)), null)
  assert.equal(returnRefusalText('return_edit_cancelled', trFrom(packs.km)), null, 'a bare string is not a coded refusal')
})

runTest('every mapped code is one the Worker actually sends, and the route forwards it', () => {
  const route = readWorker('routes/returns.ts')
  const bulk = readWorker('lib/returnBulkAction.ts')
  const kernel = readWorker('lib/returnsStock.ts')
  assert.ok(route.includes("code: 'return_edit_cancelled', action: 'restore_required' }, 409)"), 'PATCH /:id refuses a cancelled return with 409 return_edit_cancelled')
  assert.match(bulk, /409, 'return_restore_over_capacity',\s+error instanceof ReturnCapacityError \? error\.params \?\? undefined : undefined\)/,
    'the legacy restore guard fails with return_restore_over_capacity and the capacity refusal\'s params')
  assert.ok(route.includes('if (error instanceof ReturnBulkError) return c.json({ error: error.message, code: error.code || '), 'POST /bulk forwards a coded bulk refusal before the generic write_conflict')
  assert.ok(route.includes("'invalid_bulk_action'), ...(error.params ? { params: error.params } : {}) }, error.statusCode)"), 'POST /bulk forwards the refusal\'s params with its code')
  assert.ok(read('src/api/http.ts').includes("error.params = parsed?.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params) ? parsed.params : null"),
    'the API error carries the refusal\'s params to the helper')
  assert.ok(kernel.includes("throw new RefundSaleLineError('return_refund_price_ambiguous',"), 'the kernel refuses an ambiguous product price')
  assert.ok(route.includes("throw new RefundSaleLineError('return_refund_sale_line_required',"), 'PATCH /:id refuses a line naming neither sale item nor product')
  assert.equal(route.split('if (error instanceof RefundSaleLineError) return c.json({ error: error.message, code: error.code }, 400)').length - 1, 2,
    'POST / and PATCH /:id both forward the refund-price refusal code')
})

// Each surface is sliced to the one handler that receives the refusal -- from
// its declaration to the next top-level handler -- and within that handler's
// catch the mapped text must come FIRST, with the server's own message only as
// the `??` fallback for an uncoded failure. The checks name the handler's
// request call too, so a slice that drifted onto a neighbouring handler fails
// instead of passing on someone else's code.
const slice = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  assert.ok(from >= 0, `found ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `found the end of ${start}`)
  return source.slice(from, to)
}
const catchBlock = (handler: string, label: string) => {
  const from = handler.lastIndexOf('} catch (error) {')
  assert.ok(from >= 0, `${label} has a catch (error) block`)
  return handler.slice(from)
}

runTest('Returns: the bulk action and the undo/redo of a return edit route refusals through the mapping', () => {
  const returns = read('src/components/returns/Returns.tsx')
  const bulk = slice(returns, 'const applyBulkAction = useCallback(', '\n  }, [')
  assert.ok(bulk.includes('bulkUpdateReturns(request)'), 'the slice is the bulk action')
  assert.match(catchBlock(bulk, 'the bulk action'), /notify\(returnRefusalText\(error, tr\) \?\? \(error instanceof Error \? error\.message : /,
    'a bulk refusal (restore over a legacy sale) notifies the mapped text; anything else keeps the server message')
  const history = slice(returns, 'const submitReturnHistoryRequest = useCallback(', '\n  }, [')
  assert.ok(history.includes('updateReturnRequest(returnId, body)'), 'the slice is the history restore')
  // useActionHistory notifies error.message for a failed undo/redo, so the
  // mapped text has to be ON the error that is rethrown.
  assert.match(catchBlock(history, 'the history restore'), /const refusal = returnRefusalText\(error, tr\)\s+if \(refusal && error instanceof Error\) error\.message = refusal\s+throw error/,
    'the action history shows the mapped text for a refused undo/redo of a return edit')
})

runTest('Edit and New return modals route refusals through the mapping', () => {
  const editSource = read('src/components/returns/EditReturnModal.tsx')
  const edit = slice(editSource, 'const handleSubmit = async (', '\n  const ')
  assert.ok(edit.includes('updateReturnRequest(ret.id, prepared)'), 'the slice is the edit submit')
  assert.match(catchBlock(edit, 'the edit submit'), /notify\([^\n]*\(returnRefusalText\(error, T\) \?\? getLoaderErrorMessage\(error\)\)/,
    'an edit refusal (cancelled return, refund price) shows the mapped text')
  const createSource = read('src/components/returns/NewReturnModal.tsx')
  const legacy = slice(createSource, 'const handleSubmit = async (', '\n  const reviewReturn')
  assert.ok(legacy.includes('createReturnRequest({'), 'the slice is the legacy create submit')
  assert.match(catchBlock(legacy, 'the legacy create submit'), /notify\([^\n]*\(returnRefusalText\(error, T\) \?\? localizeBranchRuleError\(/,
    'a legacy create refusal (refund price) shows the mapped text')
  // The net-return submit already translates by code; the pack keys are
  // named after the codes, so it resolves them with no extra wiring.
  const net = slice(createSource, 'const submitNetReturn = async (', '\n  if (sessionStale')
  assert.ok(net.includes('transport.submitReturnCreateV1('), 'the slice is the net-return submit')
  assert.match(catchBlock(net, 'the net-return submit'), /notify\(T\(\(error as \{ code\?: string \}\)\?\.code \|\| 'return_v1_pending', getLoaderErrorMessage\(error\)\), 'error'\)/,
    'the net-return submit translates by error code')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
