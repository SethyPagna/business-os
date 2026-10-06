// CUTOVER-LD: a Stock-in invoice names the branch AS IT WAS when its lots were received. After the consolidation
// (Shop -> "Old Shop" retired, Warehouse -> "LC Store") the live branch list says something else; the old invoice must
// not. The live list is only the fallback for a lot the Worker sent no label for.
//
// Run: node tests/stockInInvoiceBranchLabels.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/stockInInvoiceBranches.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const mod = { exports: {} as Record<string, any> }
new Function('module', 'exports', compiled)(mod, mod.exports)
const { stockInInvoiceBranchNames, stockInReportBranchOptions } = mod.exports as {
  stockInInvoiceBranchNames: (group: any, live: ReadonlyMap<string, string>) => string
  stockInReportBranchOptions: (branches: any[], retiredTag: string) => Array<{ value: string; label: string }>
}

// What the live directory says after the consolidation.
const live = new Map([['1', 'Old Shop'], ['2', 'LC Store']])

assert.equal(stockInInvoiceBranchNames({ branch_ids: '1', branch_labels: [{ id: 1, name: 'Shop' }] }, live), 'Shop',
  'received at Shop: still says Shop, not Old Shop')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '1,2', branch_labels: [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }] }, live), 'Shop, Warehouse')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '2', branch_labels: [{ id: 2, name: '  ហាងដើម  ' }] }, live), 'ហាងដើម', 'a Khmer label is kept (trimmed)')

// Fallbacks: no label list (older Worker), a blank label, a label for another id, an id the directory no longer lists.
assert.equal(stockInInvoiceBranchNames({ branch_ids: '1' }, live), 'Old Shop', 'no labels sent: the live name fills in')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '1', branch_labels: [{ id: 1, name: null }] }, live), 'Old Shop')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '1', branch_labels: [{ id: 1, name: '   ' }] }, live), 'Old Shop')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '1', branch_labels: [{ id: 2, name: 'Warehouse' }] }, live), 'Old Shop')
assert.equal(stockInInvoiceBranchNames({ branch_ids: '9' }, live), '#9')
assert.equal(stockInInvoiceBranchNames({ branch_ids: null }, live), '')
assert.equal(stockInInvoiceBranchNames({ branch_ids: ' 1 , ,2 ', branch_labels: [{ id: 1, name: 'Shop' }] }, live), 'Shop, LC Store', 'mixed: labelled id keeps its label, the other falls back')

// The component renders through this helper, not a live-name lookup of its own.
const component = readFileSync(new URL('../src/components/contacts/StockInInvoicesSection.tsx', import.meta.url), 'utf8')
assert.match(component, /stockInInvoiceBranchNames\(group, branchNameById\)/)
assert.doesNotMatch(component, /ids\.map\(\(id\) => branchNameById\.get\(id\)/)

// The Branch filter keeps retired branches reachable and says so; an older Worker (no is_active) shows all as live.
assert.deepEqual(
  stockInReportBranchOptions([{ id: 2, name: 'LC Store', is_active: 1 }, { id: 1, name: 'Old Shop', is_active: 0 }, { id: 3, name: null, is_active: false }], 'retired'),
  [{ value: '2', label: 'LC Store' }, { value: '1', label: 'Old Shop (retired)' }, { value: '3', label: '#3 (retired)' }],
)
assert.deepEqual(stockInReportBranchOptions([{ id: 1, name: 'Shop' }, { id: 2, name: 'Store', is_active: null }], 'retired'),
  [{ value: '1', label: 'Shop' }, { value: '2', label: 'Store' }], 'no flag = live')
assert.match(component, /stockInReportBranchOptions\(branches, tr\('branch_retired_tag'/)
for (const lang of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL('../src/lang/' + lang + '.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['branch_retired_tag', 'transfers_show_consolidation', 'transfers_hide_consolidation']) assert.ok(String(pack[key] || '').trim(), lang + '.' + key)
}

// The Transfer History toggle: icon-only with a translated tooltip, it re-queries with includeCutover, resets paging,
// is part of the filter count and Clear, and the export uses the same scope.
const branches = readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
assert.match(branches, /\.\.\.\(showConsolidationTransfers \? \{ includeCutover: '1' \} : \{\}\),\n\s+page: transferPage,/, 'list request')
assert.match(branches, /\.\.\.\(showConsolidationTransfers \? \{ includeCutover: '1' \} : \{\}\),\n\s+page: exportPage,/, 'export request')
assert.match(branches, /\[requestedMode, \.\.\.\(requestedMode === 'transfers' \? \[branchDateRange, transferFromFilter, transferToFilter, showConsolidationTransfers,/, 'load key')
assert.match(branches, /setShowConsolidationTransfers\(\(value\) => !value\); setTransferPage\(1\)/, 'toggle resets paging')
assert.match(branches, /setShowConsolidationTransfers\(false\)\n\s+setTransferPage\(1\)/, 'Clear resets it')
const toggle = /aria-pressed=\{showConsolidationTransfers\}[\s\S]*?<\/button>/.exec(branches)?.[0] || ''
assert.match(toggle, /title=\{showConsolidationTransfers \? tr\('transfers_hide_consolidation'/)
assert.match(toggle, /aria-label=\{/)
assert.doesNotMatch(toggle.replace(/<GitMerge[^>]*\/>/, ''), />\s*\{?tr\(/, 'icon only: no visible text')

console.log('PASS stock-in invoice branch labels keep the name at the time')
