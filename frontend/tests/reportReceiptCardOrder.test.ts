// Receipt-style report cards follow the owner's old-POS reference cards
// (Sep 5 2026, screenshots #6 / #10): money lines, then the headline total,
// then counts in muted text, then detail -- whatever order the spreadsheet
// columns are in. Counts are muted in the excel style too (reference rule:
// badges only on headline money, counts never emphasised).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const source = read('src/components/sales/reports/ReportTable.tsx')
const helpers = source.slice(source.indexOf('function isNumericKind'), source.indexOf('export function csvColumnsFor'))
  .replaceAll('export function', 'function')
type Column = { key?: string; kind?: string; emphasis?: boolean }
const { orderReceiptColumns, receiptLineKind } = new Function(`${stripTypeScriptTypes(helpers)}; return { orderReceiptColumns, receiptLineKind }`)() as {
  orderReceiptColumns: (columns: Column[]) => Column[]
  receiptLineKind: (column: Column) => string | undefined
}

// The canonical grouped-view column order: count first, money, total, share, then a date.
const columns: Column[] = [
  { key: 'tx_count', kind: 'int' },
  { key: 'qty', kind: 'qty' },
  { key: 'revenue_usd', kind: 'money' },
  { key: 'profit_usd', kind: 'money', emphasis: true },
  { key: 'share', kind: 'pct' },
  { key: 'last_sale', kind: 'date' },
  { key: 'note' },
]
assert.deepEqual(orderReceiptColumns(columns).map((c) => c.key), ['revenue_usd', 'share', 'profit_usd', 'tx_count', 'qty', 'last_sale', 'note'])
assert.equal(orderReceiptColumns(columns).length, columns.length, 'no column is dropped or duplicated')
assert.deepEqual(orderReceiptColumns([]), [])

assert.equal(receiptLineKind({ kind: 'money', emphasis: true }), 'total')
assert.equal(receiptLineKind({ kind: 'int', emphasis: true }), 'total', 'an emphasised count still closes the block')
assert.equal(receiptLineKind({ kind: 'int' }), 'muted')
assert.equal(receiptLineKind({ kind: 'qty' }), 'muted')
assert.equal(receiptLineKind({ kind: 'money' }), undefined, 'plain money lines carry no sign glyph')
assert.equal(receiptLineKind({ kind: 'pct' }), undefined)
assert.equal(receiptLineKind({ kind: 'date' }), 'info')
assert.equal(receiptLineKind({}), 'info')

// Wiring: the receipt branch and its totals block go through the helpers,
// and the excel cells mute counts.
const receipt = source.slice(source.indexOf("if (style === 'receipt')"), source.indexOf('<ReceiptSheet blocks={blocks} />'))
assert.match(receipt, /const lineColumns = orderReceiptColumns\(visibleColumns\.filter\(\(c\) => c !== primary\)\)/)
assert.equal((receipt.match(/kind: receiptLineKind\(c\)/g) || []).length, 2, 'row cards and the totals card share one kind rule')
assert.doesNotMatch(receipt, /kind: c\.emphasis \? 'total'/, 'no inline copy of the kind rule survives')
assert.match(source, /!c\.emphasis && isCountKind\(c\.kind\) \? 'text-\[var\(--ui-ink-2\)\]' : ''/, 'excel cells mute counts')
const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
assert.match(sheet, /muted: 'text-\[var\(--ui-ink-3\)\]'/, 'the sheet still paints muted lines in the tertiary ink')

console.log('PASS report receipt card order')
