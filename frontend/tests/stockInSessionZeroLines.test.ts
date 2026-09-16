import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// N29 (2026-09-06): "i see that the create products did not show in stock in".
//
// An Add-products session whose items were all created at quantity 0 leaves a
// session record (stock_session_operations + stock_session_members) and no
// movement. The Worker kernel (cloudflare/src/lib/stockInSessionsQuery.ts)
// now lists those lines beside received ones -- the pure test
// cloudflare/scripts/test-stock-in-sessions-zero-create-pure.cjs drives that
// SQL against the migrated schema. These pins hold the CLIENT half: a line
// without a movement id must render, count, and never be sent to the revert
// endpoint; and the create session must send the supplier on its zero lines
// so the list can show who the delivery came from.

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const sectionSource = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const createModalSource = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')
const kernelSource = readFileSync(new URL('../../cloudflare/src/lib/stockInSessionsQuery.ts', import.meta.url), 'utf8')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

runTest('the Worker lists zero-quantity session members beside receipt movements, keyed the same way', () => {
  // one row source, two halves, one session key
  assert.match(kernelSource, /UNION ALL/)
  assert.match(kernelSource, /FROM stock_session_members sm\s+JOIN stock_session_operations o ON o\.id = sm\.operation_id/)
  assert.match(kernelSource, /WHERE sm\.movement_id IS NULL AND COALESCE\(sm\.quantity, 0\) = 0/)
  assert.match(kernelSource, /'session:' \|\| CAST\(o\.rowid AS TEXT\) AS session_key/)
  assert.match(kernelSource, /GROUP BY session_key/)
  // the header the operator typed once is read back per line from the
  // canonical request, not guessed
  assert.match(kernelSource, /json_each\(o\.request_json, '\$\.items'\)/)
  // a zero line cannot make a receipt read as mixed
  assert.match(kernelSource, /NULL AS payment_state/)
  assert.match(kernelSource, /COUNT\(DISTINCT s\.supplier_state\) AS supplier_state_count/)
})

runTest('a receipt line may have no movement id, and only lines with one are ever reverted', () => {
  assert.match(sectionSource, /id: number \| null; session_line_id\?: string \| null/)
  // the revert transport is called only behind a null guard
  assert.match(sectionSource, /if \(row\.id == null\) return\s+if \(busy \|\| !window\.confirm\(/)
  assert.match(sectionSource, /const revertibleRows = selected \? selected\.rows\.filter\(\(row\) => row\.id != null\) : \[\]/)
  assert.match(sectionSource, /for \(const row of revertibleRows\) if \(row\.id != null\) await revertStockMovement\(row\.id\)/)
  assert.doesNotMatch(sectionSource, /for \(const row of selected\.rows\) await revertStockMovement/)
  // React keys never collapse onto `null`
  assert.match(sectionSource, /function lineKey\(row: Row\): string/)
  assert.match(sectionSource, /key=\{lineKey\(row\)\}/)
  assert.doesNotMatch(sectionSource, /key=\{row\.id\}/)
  // a zero line shows WHY it has no trash can instead of a dead cell
  assert.match(sectionSource, /row\.id == null \? <InfoHint label=\{tr\('quantity', 'Quantity'\)\} text=\{tr\('stock_session_zero_line'/)
})

runTest('an all-zero session shows $0 and its item count, and says why Edit/Remove are absent', () => {
  // $0 is a KNOWN total when no line is missing a cost; '—' remains for
  // legacy lines that never recorded one
  assert.match(sectionSource, /costUsd: Number\(row\.movement_cost_usd\) > 0 \? Number\(row\.movement_cost_usd\) : \(Number\(row\.lines_without_movement_cost\) \|\| 0\) === 0 \? 0 : null/)
  assert.match(sectionSource, /if \(Math\.abs\(Number\(row\.quantity\) \|\| 0\) === 0\) \{ known = true; continue \}/)
  // the list carries the line count the owner asked for
  assert.match(sectionSource, /lineCount: Number\(row\.line_count\) \|\| 0/)
  assert.match(sectionSource, /<th className="text-right">\{tr\('items', 'Items'\)\}<\/th>/)
  assert.match(sectionSource, /<td className="text-right tabular-nums text-gray-500">\{session\.lineCount\}<\/td>/)
  assert.match(sectionSource, /colSpan=\{9\}/)
  // a primary control that cannot proceed says why next to it
  assert.match(sectionSource, /\{editableLots \? <button[^]*?\{tr\('edit', 'Edit'\)\}<\/button> : null\}/)
  assert.match(sectionSource, /\{revertibleRows\.length \? <button[^]*?\{tr\('remove_session', 'Remove'\)\}<\/button> : <span[^>]*>\{tr\('stock_session_no_lot_to_edit'/)
})

runTest('the create session sends the supplier on its zero lines so the list can show it', () => {
  const zeroWire = createModalSource.slice(
    createModalSource.indexOf("if (line.kind === 'create_receive' && Number(line.quantity) === 0)"),
    createModalSource.indexOf('const common ='),
  )
  assert.match(zeroWire, /supplier_id: line\.supplierLocked \|\| line\.supplierId == null \? null : Number\(line\.supplierId\)/)
  assert.match(zeroWire, /supplier_name: line\.supplierLocked \? null : \(line\.supplierName \|\| null\)/)
})

runTest('every new string is in BOTH packs', () => {
  for (const key of ['stock_session_zero_line', 'stock_session_no_lot_to_edit', 'items']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.notEqual(String(km[key]).trim(), '', `km.${key} is empty`)
  }
  assert.match(String(km.stock_session_zero_line), /[ក-៿]/, 'km.stock_session_zero_line is Khmer')
  assert.match(String(km.stock_session_no_lot_to_edit), /[ក-៿]/, 'km.stock_session_no_lot_to_edit is Khmer')
})

if (failed > 0) {
  process.exitCode = 1
}
