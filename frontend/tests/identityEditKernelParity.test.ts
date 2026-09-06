// N34 / lane "linkover", item 4 -- RULE PARITY for the edit-identity question.
//
// "Does this edit MOVE the row's identity?" is the question that decides
// whether a save has to stop and offer a link-over. Until 2026-09-06 it was
// answered in exactly one place -- cloudflare/src/lib/productIdentity.ts, a
// Worker-only module the client cannot import -- so the client had no answer at
// all on the edit path: ProductForm ran classifyCreateMatches in CREATE mode
// only (`if (!isCreateMode) return`), and an edit that renamed or re-barcoded a
// row onto another product's identity was discovered by the server's 409 after
// the operator had already pressed Save.
//
// The kernel now lives in productDetailRule.ts, the ONE module both packages
// carry verbatim, and productIdentity.ts re-exports it. This file pins that:
//
//   * BOTH package copies export the kernel (the base commit exports it from
//     neither -- this file cannot even import on 6e3abfea);
//   * they agree on every probe, including the ones where the answer must be
//     "no, this edit changes nothing about the identity" -- the false positive
//     that made every ordinary save of a leading-zero twin a 409;
//   * the Worker module no longer carries its own second definition, so the
//     re-export cannot quietly become a fork again.
//
// Every probe below is DISCRIMINATING: a copy that compares the raw barcode
// instead of the folded one, or that asks "is this identity shared?" instead
// of "did this edit move it?", disagrees on a named row here.
//
// Run: node tests/identityEditKernelParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  productRowIdentityKey as clientRowIdentityKey,
  resolveProductIdentityEdit as clientResolveEdit,
} from '../src/utils/productDetailRule.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')
const workerRulePath = path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productDetailRule.ts')
const workerIdentityPath = path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productIdentity.ts')

const worker = await import(pathToFileURL(workerRulePath).href) as {
  productRowIdentityKey?: (name: unknown, barcode: unknown) => string
  resolveProductIdentityEdit?: (
    current: { name?: unknown; barcode?: unknown } | null | undefined,
    body: { name?: unknown; barcode?: unknown },
  ) => { nextName: string; nextBarcode: unknown; changesIdentity: boolean }
}

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${label}`)
}

check('both packages export the edit-identity kernel', () => {
  assert.equal(typeof worker.productRowIdentityKey, 'function', 'the Worker rule module must export productRowIdentityKey')
  assert.equal(typeof worker.resolveProductIdentityEdit, 'function', 'the Worker rule module must export resolveProductIdentityEdit')
  assert.equal(typeof clientRowIdentityKey, 'function', 'the client rule module must export productRowIdentityKey')
  assert.equal(typeof clientResolveEdit, 'function', 'the client rule module must export resolveProductIdentityEdit')
})

// --- the probes -----------------------------------------------------------
// [label, current row, edit body, expected changesIdentity]
const EDIT_PROBES: Array<[string, { name?: unknown; barcode?: unknown } | null, { name?: unknown; barcode?: unknown }, boolean]> = [
  // The false positive the guard exists to avoid: the form posts the WHOLE
  // row on every save, so name and barcode are present even when only the
  // price moved. Nothing moved -> no lookup, no 409.
  ['full-form resave of an unchanged row', { name: 'MAC Lipstick', barcode: '0601' }, { name: 'MAC Lipstick', barcode: '0601' }, false],
  // ...and the same resave with the barcode respelled past its leading zero
  // is STILL the same identity. A copy comparing the raw barcode says true
  // here and refuses a save that moved nothing.
  ['leading-zero respelling of the same row', { name: 'MAC Lipstick', barcode: '0601' }, { name: 'MAC Lipstick', barcode: '601' }, false],
  ['double leading zero folds too', { name: 'CT Wand', barcode: '008339327539' }, { name: 'CT Wand', barcode: '08339327539' }, false],
  // Case and internal whitespace are name normalization, not a move.
  ['case/whitespace-only rename', { name: 'MAC  Lipstick', barcode: '601' }, { name: 'mac lipstick', barcode: '601' }, false],
  ['surrounding whitespace on the name', { name: 'MAC Lipstick', barcode: '601' }, { name: '  MAC Lipstick  ', barcode: '601' }, false],
  // A body that omits a field keeps the row's current value -- so a
  // price-only save (no name, no barcode) can never move the identity.
  ['body omitting both fields', { name: 'MAC Lipstick', barcode: '601' }, {}, false],
  ['body carrying only the unchanged name', { name: 'MAC Lipstick', barcode: '601' }, { name: 'MAC Lipstick' }, false],
  // The real moves.
  ['a genuine rename', { name: 'MAC Lipstick', barcode: '601' }, { name: 'MAC Lipglass', barcode: '601' }, true],
  ['a genuine re-barcode', { name: 'MAC Lipstick', barcode: '601' }, { name: 'MAC Lipstick', barcode: '617' }, true],
  ['clearing the barcode', { name: 'MAC Lipstick', barcode: '601' }, { name: 'MAC Lipstick', barcode: '' }, true],
  ['adding a barcode to a bare row', { name: 'MAC Lipstick', barcode: '' }, { name: 'MAC Lipstick', barcode: '601' }, true],
  // The placeholder-barcode floor: '0' and '00' are NOT folded to blank, so
  // moving between them is a real move, and '0' -> '' is too.
  ['placeholder 0 -> 00 is a move', { name: 'Item', barcode: '0' }, { name: 'Item', barcode: '00' }, true],
  ['placeholder 0 -> blank is a move', { name: 'Item', barcode: '0' }, { name: 'Item', barcode: '' }, true],
  // Alphanumeric codes keep their zeros -- a leading zero in an SKU is not a
  // GTIN artefact, so this IS a move.
  ['alphanumeric code keeps its zeros', { name: 'Item', barcode: '0ab12' }, { name: 'Item', barcode: 'ab12' }, true],
  // The delimiter probe: without U+0001 between the two halves, name 'ab' +
  // barcode 'cde' and name 'abc' + barcode 'de' collide and this reads false.
  ['name/barcode boundary is delimited', { name: 'ab', barcode: 'cde' }, { name: 'abc', barcode: 'de' }, true],
  // A row that does not exist yet (create path) has no current identity.
  ['null current row', null, { name: 'New Item', barcode: '601' }, true],
]

check('both copies agree on every edit probe, and on the expected verdict', () => {
  for (const [label, current, body, expected] of EDIT_PROBES) {
    const client = clientResolveEdit(current, body)
    const server = worker.resolveProductIdentityEdit!(current, body)
    assert.equal(
      client.changesIdentity, expected,
      `client disagreed with the rule on "${label}" (expected changesIdentity=${expected})`,
    )
    assert.equal(
      server.changesIdentity, client.changesIdentity,
      `the two package copies disagree on "${label}"`,
    )
    assert.equal(server.nextName, client.nextName, `nextName differs on "${label}"`)
    assert.equal(String(server.nextBarcode ?? ''), String(client.nextBarcode ?? ''), `nextBarcode differs on "${label}"`)
  }
})

check('the row identity key itself is byte-identical across the packages', () => {
  const rows: Array<[unknown, unknown]> = [
    ['MAC Lipstick', '0601'], ['MAC Lipstick', '601'], ['mac  lipstick', '00601'],
    ['ab', 'cde'], ['abc', 'de'], ['Item', ''], ['Item', null], [null, '0'],
    ['Item', '0ab12'], ['Item', 'AB12'],
  ]
  for (const [name, barcode] of rows) {
    assert.equal(
      worker.productRowIdentityKey!(name, barcode), clientRowIdentityKey(name, barcode),
      `productRowIdentityKey differs for ${JSON.stringify([name, barcode])}`,
    )
  }
  // ...and it really does fold, rather than comparing the raw barcode.
  assert.equal(clientRowIdentityKey('MAC Lipstick', '0601'), clientRowIdentityKey('mac lipstick', '601'))
  assert.notEqual(clientRowIdentityKey('ab', 'cde'), clientRowIdentityKey('abc', 'de'))
})

check('the Worker no longer carries a second definition of the kernel', () => {
  const identitySource = fs.readFileSync(workerIdentityPath, 'utf8')
  assert.doesNotMatch(
    identitySource, /export function resolveProductIdentityEdit\s*\(/,
    'productIdentity.ts must re-export the kernel from productDetailRule.ts, never redefine it',
  )
  assert.doesNotMatch(
    identitySource, /export function productRowIdentityKey\s*\(/,
    'productIdentity.ts must re-export productRowIdentityKey, never redefine it',
  )
  assert.match(
    identitySource, /export \{[^}]*resolveProductIdentityEdit[^}]*\}/,
    'productIdentity.ts must keep re-exporting the kernel so its existing Worker callers still resolve',
  )
  // The rule module stays importable by BOTH packages, which is only true
  // while it imports nothing (productDetailRuleParity.test.ts pins this too;
  // repeated here because this file's dynamic import depends on it).
  const ruleSource = fs.readFileSync(workerRulePath, 'utf8')
  assert.doesNotMatch(ruleSource, /^\s*import\s/m, 'the rule module must stay dependency-free')
})

console.log(`PASS identityEditKernelParity (${passed} checks)`)
