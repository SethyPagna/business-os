// Which payment method is drawer CASH has one definition, the Worker's lib/paymentMethodRegistry.ts. The frontend
// needs the same answer for the riel cash rule (owner, 27 Oct 2026: riel paid in cash is whole 100-riel notes; any
// riel by other methods), so src/utils/paymentMethodKind.ts copies the declarations byte for byte. This test fails
// when either copy changes alone, and drives both through the same fixtures: an exact-name check ("cash" only), a
// case-sensitive one, or one that ignored the shop's pos_payment_method_kinds pin answers at least one row wrong.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

import * as ui from '../src/utils/paymentMethodKind.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'paymentMethodRegistry.ts')
const uiPath = path.join(here, '..', 'src', 'utils', 'paymentMethodKind.ts')
const NAMES = ['paymentMethodKey', 'PaymentMethodKind', 'PaymentMethodKindMap', 'CASH_METHOD_TOKENS', 'parsePaymentMethodKinds', 'resolvePaymentMethodKind', 'isCashPaymentMethod']

function declarations(file: string): Map<string, string> {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const out = new Map<string, string>()
  for (const statement of source.statements) {
    const name = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0].name.getText(source)
      : (statement as ts.Statement & { name?: ts.Identifier }).name?.text
    if (name && NAMES.includes(name)) out.set(name, statement.getText(source))
  }
  return out
}

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await runTest('the frontend copy of the cash-method declarations is byte-identical to the Worker registry', () => {
  const worker = declarations(workerPath)
  const copy = declarations(uiPath)
  for (const name of NAMES) {
    assert.ok(worker.has(name), `the Worker registry declares ${name}`)
    assert.equal(copy.get(name), worker.get(name), `${name} differs between the two copies`)
  }
})

await runTest('both copies resolve cash identically, and correctly', async () => {
  const worker = await import(pathToFileURL(workerPath).href) as typeof ui
  const pinned = '{"ABA":"cash","Cash USD":"digital","Drawer":"CASH","bad":"x"}'
  const rows: Array<[unknown, string, boolean]> = [
    ['Cash', '', true], [' cash ', '', true], ['CASH (USD)', '', true], ['សាច់ប្រាក់ដុល្លារ', '', true], ['ABA', '', false], ['', '', false], [null, '', false],
    ['ABA', pinned, true], ['Cash USD', pinned, false], ['drawer', pinned, true], ['Bad', pinned, false], ['Cash', 'not json', true],
  ]
  for (const copy of [ui, worker]) {
    for (const [method, kinds, cash] of rows) {
      assert.equal(copy.isCashPaymentMethod(method, copy.parsePaymentMethodKinds(kinds)), cash, `${JSON.stringify(method)} with ${kinds || 'no pins'}`)
    }
  }
})

await runTest('a riel field is invalid only when the method is cash and the riel is not whole hundreds', () => {
  assert.equal(ui.rielCashFieldInvalid('Cash', 39950), true)
  assert.equal(ui.rielCashFieldInvalid('Cash', '39950'), true)
  assert.equal(ui.rielCashFieldInvalid('Cash', 39900), false)
  assert.equal(ui.rielCashFieldInvalid('Cash', ''), false)
  assert.equal(ui.rielCashFieldInvalid('ABA', 39950), false)
  assert.equal(ui.rielCashFieldInvalid('ABA', 39950, ui.parsePaymentMethodKinds('{"ABA":"cash"}')), true)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
