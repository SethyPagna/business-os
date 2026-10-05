#!/usr/bin/env node
// Keystroke benchmark for the shared product-search core (G37).
//
//   node ops/scripts/search-bench.mjs [path/to/d1-export-product-names.json]
//
// Default input: the 2026-09-26 active-catalog export under Records/Ops. It
// is read from disk only; this never touches D1. Prints:
//   - index build time (cold, from raw fields)
//   - per-keystroke match + rank latency p50/p95/p99/max over a replay of
//     300 product names typed one character at a time (target p95 <= 3 ms,
//     p99 <= 10 ms on a desktop CPU)
//   - recall: full name ranked first, reversed word order, one deleted letter
//   - the owner's examples and the negative controls
// Exit code 1 when a target or a control fails.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTermIndex, searchTermIndex } from '../../frontend/src/utils/searchCore.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const defaultExport = path.resolve(root, '..', '..', 'Records', 'Ops', '36275833905', 'ops-d1-export', 'd1-export-product-names-36275833905.json')
const file = process.argv[2] || defaultExport
if (!fs.existsSync(file)) {
  console.error(`catalog export not found: ${file}`)
  process.exit(2)
}
const rows = JSON.parse(fs.readFileSync(file, 'utf8')).rows
const nameOf = new Map(rows.map((row) => [row.id, row.name]))

let started = performance.now()
const index = buildTermIndex(rows)
const buildMs = performance.now() - started
console.log(`rows=${rows.length} vocab=${index.vocab.length} joins=${index.joinVocab.length} build=${buildMs.toFixed(0)}ms`)

for (let i = 0; i < 200; i += 1) searchTermIndex(index, String(rows[i].name).slice(0, 8))

const sample = Array.from({ length: 300 }, (_, k) => rows[(k * 7919) % rows.length])
const times = []
let rankFirst = 0
let found = 0
for (const row of sample) {
  const name = String(row.name)
  for (let n = 1; n <= name.length; n += 1) {
    started = performance.now()
    searchTermIndex(index, name.slice(0, n))
    times.push(performance.now() - started)
  }
  const hits = searchTermIndex(index, name).hits.slice(0, 50).map((hit) => nameOf.get(hit.id))
  if (hits.includes(name)) found += 1
  if (hits[0] === name) rankFirst += 1
}
times.sort((a, b) => a - b)
const pct = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))]
const p50 = pct(0.5)
const p95 = pct(0.95)
const p99 = pct(0.99)
console.log(`keystrokes=${times.length} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${times[times.length - 1].toFixed(2)}ms`)
console.log(`full-name recall: found=${found}/300 ranked-first=${rankFirst}/300`)

let reversed = 0
for (const row of sample) {
  const query = String(row.name).split(/\s+/).reverse().join(' ')
  if (searchTermIndex(index, query).hits.slice(0, 50).some((hit) => nameOf.get(hit.id) === row.name)) reversed += 1
}
console.log(`reversed-word-order recall: ${reversed}/300`)

let typo = 0
let typoCases = 0
for (const row of sample) {
  const words = String(row.name).split(/\s+/)
  let at = -1
  let best = 0
  words.forEach((word, i) => { if (/^[A-Za-z]{6,}$/.test(word) && word.length > best) { best = word.length; at = i } })
  if (at < 0) continue
  typoCases += 1
  const word = words[at]
  const mid = Math.floor(word.length / 2)
  words[at] = word.slice(0, mid) + word.slice(mid + 1)
  if (searchTermIndex(index, words.join(' ')).hits.slice(0, 50).some((hit) => nameOf.get(hit.id) === row.name)) typo += 1
}
console.log(`one-deletion-typo recall: ${typo}/${typoCases}`)

const cases = [
  ['Blush Palette', (r) => r.hits.slice(0, 30).some((hit) => /hourglass blush palette evil eye/i.test(nameOf.get(hit.id)))],
  ['blush pallet', (r) => r.total >= 13],
  ['pallet', (r) => /pallette/i.test(nameOf.get(r.hits[0]?.id) || '')],
  ['SK-II', (r) => r.total === 61], ['skii', (r) => r.total === 61], ['sk2', (r) => r.total === 61],
  ['sk ii', (r) => r.total === 61], ['sk-2', (r) => r.total === 61 && !r.hits.some((hit) => /skin tint 2/i.test(nameOf.get(hit.id)))],
  ['សេរ៉ូម', (r) => r.total === 6], ['ឡេ', (r) => r.total === 2],
  ['zzzz', (r) => r.total === 0], ['qwerty', (r) => r.total === 0],
  ['spf', (r) => r.hits.every((hit) => hit.tier <= 3)], ['oil', (r) => r.hits.every((hit) => hit.tier <= 3)],
  ['elf', (r) => !r.hits.some((hit) => /\b(self|shelf)\b/i.test(nameOf.get(hit.id)))],
]
let red = 0
for (const [query, ok] of cases) {
  const result = searchTermIndex(index, query)
  const pass = ok(result)
  if (!pass) red += 1
  console.log(`${pass ? 'ok ' : 'RED'} ${JSON.stringify(query).padEnd(16)} total=${String(result.total).padStart(5)}  ${result.hits.slice(0, 3).map((hit) => `[${hit.tier}] ${nameOf.get(hit.id)}`).join(' | ').slice(0, 160)}`)
}
if (p95 > 3) { red += 1; console.log(`RED p95 ${p95.toFixed(2)}ms > 3ms`) }
if (p99 > 10) { red += 1; console.log(`RED p99 ${p99.toFixed(2)}ms > 10ms`) }
if (found < 300 || reversed < 300 || typo / Math.max(typoCases, 1) < 0.97) { red += 1; console.log('RED recall below target') }
process.exit(red ? 1 : 0)
