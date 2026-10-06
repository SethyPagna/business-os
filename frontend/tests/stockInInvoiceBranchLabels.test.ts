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
const { stockInInvoiceBranchNames } = mod.exports as { stockInInvoiceBranchNames: (group: any, live: ReadonlyMap<string, string>) => string }

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

console.log('PASS stock-in invoice branch labels keep the name at the time')
