// R40 review S5: a cash write the Worker refused for want of an open shift (409 shift_required_for_cash) already has its own clear message on the
// screen (the POS toast and note, the Sales form, the Returns toast). The global red "Write rejected" bar, whose generic text points to
// nothing for a cashier, must not appear beside it; every other rejected write still raises the bar.
// Mutants killed (each turns one assertion red):
//   the screen-presented list is empty                              -> "a shift refusal has its own message"
//   every code counts as presented                                  -> "every other rejected write still shows the bar"
//   the listener ignores the helper                                 -> "the bar's listener skips a refused cash write only"
//   the listener drops every coded write                            -> "the bar's listener skips a refused cash write only"
//   the event is no longer dispatched for other writes (http.ts)    -> "the event still reaches the listener for other rejected writes"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeRefusalHasOwnMessage } from '../src/utils/writeErrorPresentation.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, '..', rel), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('a shift refusal has its own message', () => {
  assert.equal(writeRefusalHasOwnMessage({ code: 'shift_required_for_cash' }), true)
})
runTest('every other rejected write still shows the bar', () => {
  for (const code of ['invalid_portal_language', 'portal_translation_private_key', 'client_request_id_required', 'sale_pricing_quote_conflict', 'idempotency_conflict', 'request_timeout', 'shift_required', 'shift_required_for_cash_x', '', null, undefined, 42]) {
    assert.equal(writeRefusalHasOwnMessage({ code }), false, String(code))
  }
  assert.equal(writeRefusalHasOwnMessage(null), false)
  assert.equal(writeRefusalHasOwnMessage(undefined), false)
  assert.equal(writeRefusalHasOwnMessage({}), false)
})
runTest("the bar's listener skips a refused cash write only", () => {
  const app = read('src/App.tsx')
  const listener = app.slice(app.indexOf('const onSyncError = (event: Event) => {'), app.indexOf('const onTransientOutage'))
  assert.match(listener, /if \(detail\?\.transient \|\| writeRefusalHasOwnMessage\(detail\)\) return\n/)
  assert.match(app, /import \{ presentWriteError, writeRefusalHasOwnMessage \} from '\.\/utils\/writeErrorPresentation\.ts'/)
})
runTest('the event still reaches the listener for other rejected writes', () => {
  const http = read('src/api/http.ts')
  assert.match(http, /window\.dispatchEvent\(new CustomEvent\('sync:error', \{\n\s+detail: \{\n\s+errorId,\n\s+channel,\n\s+error: e\.message,\n\s+code: e\.code \|\| null,/, 'http.ts still announces every rejected write with its code')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
