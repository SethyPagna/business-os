// The shared search core must be ONE implementation in two packages.
//
//   1. frontend/src/utils/searchCore.ts is the byte copy of
//      cloudflare/src/lib/searchCore.ts (after EOL normalization; autocrlf
//      rewrites CR bytes on checkout). A positive control proves the
//      comparison can fail.
//   2. Both copies, loaded separately, give identical normalize / docTerms /
//      queryUnits / search output over the real-catalog fixture, a generated
//      corpus (Khmer marks, diacritics, joiners, roman numerals, zero-width
//      characters, fullwidth forms) and, when it is on this machine, the
//      whole 6,226-row export (G37_EXPORT=<path> or the Records default).
//   3. Both searchMatch.ts normalizeSearchText functions equal the core's
//      normalize over the same inputs, so the stored name_normalized, the
//      page re-filter and the index agree on every string.
//
// Run: node scripts/test-search-core-parity-pure.cjs
'use strict'
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs, loadWorkerCore, loadFrontendCore, CF_SRC, FE_SRC } = require('./harness/search_impls.cjs')

const workerFile = path.join(CF_SRC, 'lib', 'searchCore.ts')
const frontendFile = path.join(FE_SRC, 'utils', 'searchCore.ts')
const lf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

let failures = 0
function check(label, fn) {
  try { fn(); console.log(`ok   ${label}`) } catch (error) { failures += 1; console.log(`RED  ${label}\n     ${error.message.split('\n').slice(0, 3).join('\n     ')}`) }
}

check('frontend searchCore.ts is the byte copy of the Worker searchCore.ts', () => {
  const worker = lf(workerFile)
  const frontend = lf(frontendFile)
  assert.strictEqual(frontend, worker, 'run: node ops/scripts/sync-search-core.mjs')
  assert.notStrictEqual(worker.replace('SEARCH_CORE_VERSION = 1', 'SEARCH_CORE_VERSION = 2'), frontend, 'positive control')
  assert.ok(!/^import /m.test(worker), 'the core stays import-free so both bundlers take it as is')
})

const worker = loadWorkerCore()
const frontend = loadFrontendCore()
const workerMatch = loadTs(path.join(CF_SRC, 'lib', 'searchMatch.ts'))
const frontendMatch = loadTs(path.join(FE_SRC, 'utils', 'searchMatch.ts'))

// Deterministic corpus generator (mulberry32).
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const PIECES = [
  'Blush', 'Palette', 'pallet', 'SK-II', 'sk ii', 'sk2', 'e.l.f.', 'Lip', 'Oil', 'Crème', 'Æther', 'Œuvre', 'Straße', 'Łódź',
  'O8Y', '08y', '100ml', '9-piece', 'BS-Mall', 'II', 'iv', 'vi', 'ix', 'x', 'v', '2', '3 5', 'Vol.', 'N°5', 'L’Oréal', "L'Oreal",
  'សេរ៉ូម', 'ឡេ', 'ពេលព្រឹក', 'ក្រឡ', 'តូច', 'ដបមូល', '​', '­', '﻿', 'ＳＫ－ＩＩ', 'ﬁne', '½', '™', '&', '+', '/', '_', '-', '.',
  ',', '  ', 'SPF50+++', 'Volume Ii', 'Hourglass', '085715166012', '0012345678905', 'Ⅱ', 'ı', 'İ', 'ß', 'ǅ',
]
function generatedCorpus(count) {
  const next = rng(20261005)
  const out = []
  for (let i = 0; i < count; i += 1) {
    const words = 1 + Math.floor(next() * 6)
    const parts = []
    for (let w = 0; w < words; w += 1) parts.push(PIECES[Math.floor(next() * PIECES.length)])
    out.push(parts.join(next() < 0.7 ? ' ' : ''))
  }
  return out
}

const fixtureRows = require(path.join(__dirname, 'fixtures', 'search-core-catalog-sample.json')).rows
const exportPath = process.env.G37_EXPORT
  || path.join(__dirname, '..', '..', '..', '..', 'Records', 'Ops', '36275833905', 'ops-d1-export', 'd1-export-product-names-36275833905.json')
const exportRows = fs.existsSync(exportPath) ? require(exportPath).rows : null
const rowSets = [['fixture', fixtureRows]]
if (exportRows) rowSets.push(['full export', exportRows])
const corpus = generatedCorpus(5000)

function sameOutputs(label, inputs, fn) {
  check(label, () => {
    let compared = 0
    for (const input of inputs) {
      const a = JSON.stringify(fn(worker, input))
      const b = JSON.stringify(fn(frontend, input))
      assert.strictEqual(b, a, `differs for ${JSON.stringify(input)}`)
      compared += 1
    }
    assert.ok(compared > 0)
  })
}

const textInputs = (rows) => rows.flatMap((row) => [row.name, row.brand, row.category, row.barcode]).filter((value) => value != null)
for (const [label, rows] of rowSets) {
  sameOutputs(`normalize identical over the ${label} (${rows.length} rows)`, textInputs(rows), (core, value) => core.normalize(value))
  sameOutputs(`docTerms identical over the ${label}`, rows, (core, row) => core.docTerms(row))
  sameOutputs(`queryUnits identical over the ${label} names`, rows.map((row) => row.name), (core, value) => core.queryUnits(value))
}
sameOutputs(`normalize / queryUnits / codeKeys identical over a generated corpus (${corpus.length})`, corpus,
  (core, value) => [core.normalize(value), core.queryUnits(value), core.codeKeys(value), core.queryCodeKeys(value)])

for (const [label, rows] of rowSets) {
  check(`search results identical over the ${label} for owner queries and name prefixes`, () => {
    const a = worker.buildTermIndex(rows)
    const b = frontend.buildTermIndex(rows)
    const queries = ['Blush Palette', 'blush pallet', 'pallet', 'SK-II', 'skii', 'sk2', 'sk ii', 'sk-2', 'សេរ៉ូម', 'ឡេ', 'zzzz', 'lipstik', 'elf', 'spf, oil', '085715166012']
    for (let k = 0; k < Math.min(rows.length, 300); k += 1) {
      const name = String(rows[(k * 7919) % rows.length].name || '')
      queries.push(name, name.slice(0, Math.max(1, Math.floor(name.length / 2))))
    }
    for (const query of queries) {
      for (const options of [{}, { mode: 'OR' }, { titleOnly: true }]) {
        assert.deepStrictEqual(frontend.searchTermIndex(b, query, options), worker.searchTermIndex(a, query, options), `${query} ${JSON.stringify(options)}`)
      }
    }
  })
}

const allTexts = [...textInputs(fixtureRows), ...corpus, ...(exportRows ? textInputs(exportRows) : [])]
check('both searchMatch.ts normalizeSearchText equal the core normalize', () => {
  for (const value of allTexts) {
    const core = worker.normalize(value)
    assert.strictEqual(workerMatch.normalizeSearchText(value), core, `Worker searchMatch differs for ${JSON.stringify(value)}`)
    assert.strictEqual(frontendMatch.normalizeSearchText(value), core, `frontend searchMatch differs for ${JSON.stringify(value)}`)
  }
})

check('Khmer marks survive normalization (the defect this core fixes)', () => {
  assert.strictEqual(worker.normalize('សេរ៉ូម'), 'សេរ៉ូម')
  assert.strictEqual(worker.normalize('ឡេ ពេលព្រឹក'), 'ឡេ ពេលព្រឹក')
  assert.strictEqual(worker.normalize('Crème​Brûlée'), 'cremebrulee')
  assert.strictEqual(worker.normalize('ＳＫ－ＩＩ'), 'sk ii')
})

check('core barcode keys equal searchMatch barcodeSearchKeys over every fixture barcode and the corpus', () => {
  const codes = [...fixtureRows.map((row) => row.barcode), ...(exportRows || []).map((row) => row.barcode), ...corpus, '01234565', '012345000065', '0012345000065']
  for (const code of codes) {
    assert.deepStrictEqual(worker.codeKeys(code), workerMatch.barcodeSearchKeys(code), `codeKeys ${JSON.stringify(code)}`)
    assert.deepStrictEqual(worker.queryCodeKeys(code), workerMatch.searchTermBarcodeKeys(code), `queryCodeKeys ${JSON.stringify(code)}`)
  }
})

console.log(exportRows ? `(full export compared: ${exportRows.length} rows)` : '(full export not on this machine; fixture + generated corpus only)')
if (failures) { console.log(`${failures} failure(s)`); process.exit(1) }
console.log('PASS test-search-core-parity-pure')
