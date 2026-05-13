import assert from 'node:assert/strict'
import fs from 'node:fs'
import { decodeTextBuffer, normalizeCsvKey, normalizeCsvMoney, parseCsvNumber, parseCsvRows } from '../src/utils/csvImport.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('parseCsvRows handles quoted values and trims headers', () => {
  const rows = parseCsvRows(' "Name" , "Quantity" , "Note"\n"Alpha, Beta",2," hello " ')
  assert.deepEqual(rows, [
    { _rowNumber: 2, name: 'Alpha, Beta', quantity: '2', note: 'hello' },
  ])
})

await runTest('normalizeCsvKey lowercases and trims values', () => {
  assert.equal(normalizeCsvKey('  SKU-001  '), 'sku-001')
})

await runTest('parseCsvNumber falls back for invalid numbers', () => {
  assert.equal(parseCsvNumber('12.5', 0), 12.5)
  assert.equal(parseCsvNumber('oops', 7), 7)
})

await runTest('parseCsvRows preserves Khmer text and TSV delimiter input', () => {
  const rows = parseCsvRows('\uFEFFName\tDescription\tPrice\n\u1780\u17d2\u179a\u17c2\u1798\u179b\u17b6\u1794\u1798\u17bb\u1781\t\u17a2\u178f\u17d2\u1790\u1794\u1791\u1781\u17d2\u1798\u17c2\u179a\t\u17e1\u17e2\u17e3\u17e4.\u17e5\u17e6\u17e7')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '\u1780\u17d2\u179a\u17c2\u1798\u179b\u17b6\u1794\u1798\u17bb\u1781')
  assert.equal(rows[0].description, '\u17a2\u178f\u17d2\u1790\u1794\u1791\u1781\u17d2\u1798\u17c2\u179a')
  assert.equal(normalizeCsvMoney(rows[0].price), 1234.57)
})

await runTest('normalizeCsvMoney rounds messy currency and decimal formats upward', () => {
  assert.equal(normalizeCsvMoney('$1,234.567'), 1234.57)
  assert.equal(normalizeCsvMoney('\u17db\u17e1\u17e2\u17e3\u17e4.\u17e5\u17e6\u17e1'), 1234.57)
  assert.equal(normalizeCsvMoney('1 234,567'), 1234.57)
  assert.equal(normalizeCsvMoney('3'), 3.00)
})

await runTest('decodeTextBuffer preserves Khmer UTF-8 content with BOM', () => {
  const encoded = new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...new TextEncoder().encode('\u179f\u17c1\u179a\u17c9\u17bc\u1798 CeraVe'),
  ])
  assert.equal(decodeTextBuffer(encoded), '\u179f\u17c1\u179a\u17c9\u17bc\u1798 CeraVe')
})

await runTest('decodeTextBuffer handles UTF-16LE spreadsheet exports', () => {
  const source = '\u179f\u17c1\u179a\u17c9\u17bc\u1798\tCeraVe'
  const bytes = [0xff, 0xfe]
  for (const char of source) {
    const code = char.charCodeAt(0)
    bytes.push(code & 0xff, code >> 8)
  }
  assert.equal(decodeTextBuffer(new Uint8Array(bytes)), source)
})

await runTest('background import modals notify parent pages when a job is queued', () => {
  const files = [
    '../src/components/inventory/InventoryImportModal.jsx',
    '../src/components/sales/SalesImportModal.jsx',
    '../src/components/contacts/ContactImportModal.jsx',
    '../src/components/products/BulkImportModal.jsx',
  ]
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /signalDone\s*=\s*async\s*\(payload\)/, `${file} should define a queued import callback helper`)
    assert.match(source, /await\s+signalDone\(.*queuedResult|await\s+signalDone\(response\)|await\s+signalDone\(nextResult\)/, `${file} should notify the parent after queueing an import job`)
  }
})

if (failed > 0) {
  process.exitCode = 1
}
