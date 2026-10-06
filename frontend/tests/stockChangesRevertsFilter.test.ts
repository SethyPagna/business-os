import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// REVERT-SET (owner, 6 Oct 2026, relayed: the owner looked at the MAIN Stock
// Changes page, which opens on today, and could not find the Revert -- "make
// reverts discoverable there"). The Worker's "reverts" view (lib/
// stockLedgerQuery.ts revertInvolvedSql, tested in test-stock-revert-ledger-
// flags-pure.cjs) lists every Revert in the range and every row in it that was
// reverted on any day; its count rides the summary. The page shows that count
// as a chip next to In/Out, and a reverted row names the day of its Revert.

const page = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
assert.match(page, /type LedgerView = 'all' \| 'in' \| 'out' \| 'reverts'/)
assert.match(page, /Number\(summary\.revertCount\) > 0 \|\| view === 'reverts' \? \(/, 'the chip appears whenever the range holds a revert, and stays while its view is on')
assert.match(page, /onClick=\{\(\) => setView\(view === 'reverts' \? 'all' : 'reverts'\)\}/, 'it toggles the view')
assert.match(page, /aria-pressed=\{view === 'reverts'\}/)
assert.match(page, /revertedDay && revertedDay !== fmtDate\(row\.created_at\)[\s\S]{0,200}movement_reverted_on_chip/, 'a row reverted on another day names that day')

const worker = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')
assert.match(worker, /view: \['all', 'in', 'out', 'reverts'\]\.includes/, 'the Worker echoes the view')
assert.match(worker, /revertCount: Number\(summaryRow\?\.revert_count \|\| 0\)/, 'and returns the count the chip shows')

for (const lang of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['stock_reverts_filter', 'stock_reverts_filter_hint', 'movement_reverted_on_chip']) assert.ok(pack[key], `${lang} has ${key}`)
  assert.match(pack.movement_reverted_on_chip, /\{date\}/)
}

console.log('stock changes reverts filter: ok')
