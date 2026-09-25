import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
function renderSessionCost(source: string, canViewCosts: boolean, costUsd: number | null): string {
  const code = ts.transpileModule(`module.exports = (<tr>${source}</tr>)`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    fileName: 'session-cost.tsx',
  }).outputText
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', 'canViewCosts', 'session', code)(require, module, module.exports, canViewCosts, { costUsd })
  return renderToStaticMarkup(module.exports)
}

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
  // (U-records: the review is the shared ConfirmDialog, which only opens for
  // a line with an id; removeRow still re-checks before the write.)
  assert.match(sectionSource, /if \(row\.id == null\) return\s+if \(busy\) return/)
  assert.match(sectionSource, /const reviewLineRemoval = \(row: Row\) => \{ if \(row\.id != null && /)
  assert.match(sectionSource, /const revertibleRows = selected \? selected\.rows\.filter\(\(row\) => row\.id != null\) : \[\]/)
  // Bulk removal retains movement identities but refreshes their lot revisions
  // after each write; the actual-handler test covers zero/mixed/shared-lot rows.
  assert.match(sectionSource, /for \(const original of revertibleRows\) if \(original\.id != null\)/)
  assert.match(sectionSource, /reviewedRowsRef\.current\.find\(\(candidate\) => candidate\.id === original\.id\)/)
  assert.match(sectionSource, /if \(!row \|\| row\.id == null\) continue/)
  // N6: removeLine reverts an unedited line's movement and sends an edited
  // line to 0 through the edit writer; either way it acts only on a movement id.
  assert.match(sectionSource, /const removeLine = \(row: Row\) => Number\(row\.edit_count\) > 0 && row\.id != null\s*\? editStockInLine\([^]*?: revertStockMovement\(row\.id as number\)/)
  assert.doesNotMatch(sectionSource, /for \(const row of selected\.rows\) await revertStockMovement/)
  // React keys never collapse onto `null`
  assert.match(sectionSource, /function lineKey\(row: Row\): string/)
  assert.match(sectionSource, /key=\{lineKey\(row\)\}/)
  assert.doesNotMatch(sectionSource, /key=\{row\.id\}/)
  // a zero line shows WHY it has no trash can instead of a dead cell
  assert.match(sectionSource, /row\.id == null \? <InfoHint label=\{tr\('quantity', 'Quantity'\)\} text=\{tr\('stock_session_zero_line'/)
})

runTest('an all-zero session shows authorized $0 and its item count, and says why Edit/Remove are absent', () => {
  // $0 is a KNOWN total when no line is missing a cost; '—' remains for
  // legacy lines that never recorded one
  assert.match(sectionSource, /costUsd: Number\(row\.movement_cost_usd\) > 0 \? Number\(row\.movement_cost_usd\) : \(Number\(row\.lines_without_movement_cost\) \|\| 0\) === 0 \? 0 : null/)
  assert.match(sectionSource, /if \(Math\.abs\(Number\(row\.quantity\) \|\| 0\) === 0\) \{ known = true; continue \}/)
  // the list carries the line count the owner asked for
  assert.match(sectionSource, /lineCount: Number\(row\.line_count\) \|\| 0/)
  assert.match(sectionSource, /<th className="text-right">\{tr\('items', 'Items'\)\}<\/th>/)
  assert.match(sectionSource, /<td className="text-right tabular-nums text-gray-500">\{session\.lineCount\}<\/td>/)
  const span = sectionSource.match(/colSpan=\{([^}]+)\}/)?.[1]
  assert.ok(span, 'session day-header colspan located')
  const columnCount = new Function('canViewCosts', `return (${span})`)
  assert.equal(columnCount(true), 9)
  assert.equal(columnCount(false), 8, 'day header spans only visible columns')
  const costCell = sectionSource.match(/\{canViewCosts \? <td[^>]*>\{session\.costUsd[^\n]*?<\/td> : null\}/)?.[0]
  assert.ok(costCell, 'session cost cell located')
  assert.match(renderSessionCost(costCell, true, 0), /\$0\.00/, 'known zero is shown when authorized')
  assert.match(renderSessionCost(costCell, true, null), /—/, 'unknown cost is not invented as zero')
  for (const cost of [0, null, 123.45]) {
    assert.equal(renderSessionCost(costCell, false, cost), '<tr></tr>', 'revocation omits zero, unknown, and retained nonzero costs entirely')
  }
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
