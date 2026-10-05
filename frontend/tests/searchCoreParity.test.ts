// The frontend half of the search-core parity contract (the Worker half is
// cloudflare/scripts/test-search-core-parity-pure.cjs).
//
//   1. src/utils/searchCore.ts is the byte copy of
//      ../cloudflare/src/lib/searchCore.ts after EOL normalization, with a
//      positive control.
//   2. Both copies, imported separately, give identical normalize, docTerms,
//      queryUnits and search output over the committed real-catalog fixture
//      and a generated corpus.
//   3. normalizeSearchText (the page re-filter's normalizer) equals the
//      core's normalize on every input.
//   4. The owner's cases hold through the frontend copy.
//
// Run: node tests/searchCoreParity.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as frontendCore from '../src/utils/searchCore.ts'
import { normalizeSearchText } from '../src/utils/searchMatch.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'searchCore.ts')
const frontendPath = path.join(here, '..', 'src', 'utils', 'searchCore.ts')
const lf = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

const workerText = lf(workerPath)
const frontendText = lf(frontendPath)
assert.equal(frontendText, workerText, 'searchCore copies differ; run node ops/scripts/sync-search-core.mjs')
assert.notEqual(workerText.replace('SEARCH_CORE_VERSION = 1', 'SEARCH_CORE_VERSION = 2'), frontendText, 'positive control')

const workerCore = (await import(pathToFileURL(workerPath).href)) as typeof frontendCore
assert.notEqual(workerCore, frontendCore, 'the two copies are loaded as separate modules')

type Row = { id: number; name?: string | null; brand?: string | null; category?: string | null; barcode?: string | null; sku?: string | null }
const fixturePath = path.join(here, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'search-core-catalog-sample.json')
const rows = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { rows: Row[] }).rows
assert.ok(rows.length >= 900)

let seed = 20261005
const next = (): number => {
  seed = (seed + 0x6D2B79F5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const PIECES = ['Blush', 'Palette', 'SK-II', 'sk ii', 'e.l.f.', 'Crème', 'Æther', 'Straße', 'O8Y', '100ml', '9-piece', 'II', 'iv', 'x',
  'សេរ៉ូម', 'ឡេ', 'ក្រឡ', 'ពេលព្រឹក', '​', '­', 'ＳＫ－ＩＩ', 'ﬁne', '™', '&', '/', '-', ',', 'L’Oréal', '085715166012', 'Ⅱ']
const corpus: string[] = []
for (let i = 0; i < 3000; i += 1) {
  const parts: string[] = []
  const words = 1 + Math.floor(next() * 5)
  for (let w = 0; w < words; w += 1) parts.push(PIECES[Math.floor(next() * PIECES.length)])
  corpus.push(parts.join(next() < 0.7 ? ' ' : ''))
}

const texts = [...rows.flatMap((row) => [row.name, row.brand, row.category, row.barcode]).filter((value): value is string => value != null), ...corpus]
for (const value of texts) {
  const core = workerCore.normalize(value)
  assert.equal(frontendCore.normalize(value), core, `normalize ${JSON.stringify(value)}`)
  assert.equal(normalizeSearchText(value), core, `normalizeSearchText ${JSON.stringify(value)}`)
  assert.deepEqual(frontendCore.queryUnits(value), workerCore.queryUnits(value), `queryUnits ${JSON.stringify(value)}`)
}
for (const row of rows) assert.equal(frontendCore.docTerms(row), workerCore.docTerms(row), `docTerms ${row.id}`)

const frontendIndex = frontendCore.buildTermIndex(rows)
const workerIndex = workerCore.buildTermIndex(rows)
const queries = ['Blush Palette', 'blush pallet', 'pallet', 'SK-II', 'skii', 'sk2', 'sk-2', 'សេរ៉ូម', 'ឡេ', 'zzzz', 'spf, oil']
for (let k = 0; k < 200; k += 1) queries.push(String(rows[(k * 7919) % rows.length].name || '').slice(0, 1 + (k % 12)))
for (const query of queries) {
  assert.deepEqual(frontendCore.searchTermIndex(frontendIndex, query), workerCore.searchTermIndex(workerIndex, query), query)
}

// Owner cases through the frontend copy (the full matrix lives in
// cloudflare/scripts/test-search-core-owner-cases-pure.cjs).
const idsFor = (query: string): number[] => frontendCore.searchTermIndex(frontendIndex, query).hits.map((hit) => hit.id)
const nameOf = new Map(rows.map((row) => [row.id, String(row.name)]))
const skii = new Set(rows.filter((row) => /\bsk-?\s?ii\b/i.test(String(row.name)) || /\bsk-?ii\b/i.test(String(row.brand || ''))).map((row) => row.id))
for (const query of ['SK-II', 'skii', 'sk2', 'sk ii', 'sk-2', 'sk 2']) {
  const got = idsFor(query)
  assert.equal(got.length, skii.size, query)
  assert.ok(got.every((id) => skii.has(id)), query)
}
const blush = idsFor('Blush Palette')
const evilEye = blush.findIndex((id) => /evil eye/i.test(nameOf.get(id) || ''))
assert.ok(evilEye >= 0 && evilEye < 30, 'Evil Eye inside the first 30')
assert.ok(idsFor('blush pallet').length >= blush.length, 'typo reaches the palettes')
assert.equal(idsFor('zzzz').length, 0)
assert.ok(!idsFor('ឡេ').some((id) => /ក្រឡ/.test(nameOf.get(id) || '')), 'ឡេ never matches ក្រឡ')

console.log(`PASS searchCoreParity (${texts.length} strings, ${rows.length} rows, ${queries.length} queries)`)
